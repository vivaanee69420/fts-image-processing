# Smile Pipeline + Admin Dashboard — Design

Date: 2026-07-31
Status: awaiting user approval

## Goal

GHL form submission → this backend processes the photo with AI → result is
sent back to GHL via webhook → GHL workflow delivers it to the lead.
An internal admin dashboard shows every job and its data.

## End-to-end flow

1. GHL workflow (trigger: Form Submitted) POSTs to
   `POST /webhooks/ghl-smile-upload` with name, email, phone, contact id,
   and the uploaded photo URL.
2. Server creates a `Job` document (idempotent on `ghlWebhookId`), acks
   GHL immediately with 200, and runs the pipeline in the background.
3. Pipeline (`pipeline.js`):
   `received → downloading → processing → uploading → sending_result → completed/failed`
   - download original photo
   - Gemini `gemini-2.5-flash-image` smile transformation
   - upload result to S3 (public URL)
   - POST result payload to `GHL_RESULTS_WEBHOOK_URL`
4. GHL receives the inbound webhook and its own workflow sends the image
   to the lead (WhatsApp/SMS/email — configured inside GHL, not here).
5. On failure: up to 3 attempts with backoff (existing behavior), job ends
   `failed` with `failureReason`.

## Change 1 — Result delivery via webhook (replaces WhatsApp API send)

- Remove `sendWhatsAppImage` (GHL Conversations API) from the pipeline.
- Add `sendResultWebhook(job)` in `services/ghl.js`: POST JSON to
  `process.env.GHL_RESULTS_WEBHOOK_URL`:

  ```json
  {
    "jobId": "...",
    "contactId": "...",
    "name": "...",
    "email": "...",
    "phone": "...",
    "originalImageUrl": "...",
    "processedImageUrl": "..."
  }
  ```

- Non-2xx or network error → throw, so the existing retry logic applies.
- `models/Job.js`: status enum value `sending_whatsapp` → `sending_result`.

## Change 2 — Admin dashboard (internal ops/debugging)

### Backend (added to `server.js`)

All routes below (and `/admin`) behind HTTP Basic Auth middleware:
password = `ADMIN_PASSWORD` from `.env`, any username. Webhook and
`/health` routes stay open.

- `GET /admin` — serves `public/admin.html` (static, no build step).
- `GET /api/jobs?status=&search=&page=` — newest first, 25/page.
  `search` matches name, phone, or email (case-insensitive regex);
  `status` filters by enum value. Returns `{ jobs, total, page, pages }`.
- `GET /api/stats` — one aggregation: counts per status, total,
  success rate (completed / (completed+failed)), jobs last 24h and 7d.
- `POST /api/jobs/:id/retry` — allowed only when status is `failed`
  (else 409). Resets `failureReason` and `attempts` to 0, sets status
  `received`, calls existing `runPipeline(job._id)` fire-and-forget.

### Frontend (`public/admin.html`, single file: HTML + vanilla JS + CSS)

- Stat tiles: total, completed, failed, in-progress, success rate.
- Filter bar: status dropdown, search box, Refresh button; auto-refresh
  every 10s (paused while detail panel is open).
- Jobs table: created time, name, phone, status badge (color-coded),
  attempts, truncated failure reason. Pagination controls.
- Row click → detail panel: all fields, full failure reason,
  timestamps, original vs processed photo side by side (images loaded
  directly from their URLs; broken image shows placeholder + raw link).
  Retry button shown only for `failed` jobs; after retry, re-poll.
- API errors render an inline banner, never a blank page.

## Config (`.env` additions → also update `.env.example`)

- `GHL_RESULTS_WEBHOOK_URL` — the GHL Inbound Webhook trigger URL (new).
- `ADMIN_PASSWORD` — dashboard password (new).
- Still required: `MONGODB_URI`, `GEMINI_API_KEY`, AWS_* / S3_* values.
- `GHL_API_KEY` becomes optional — only needed if the original image URL
  requires auth to download (kept in `.env.example` with a comment).

## Out of scope

- No test framework (repo has none); verification is manual via a small
  optional `scripts/seed.js` that inserts sample jobs.
- No real queue (setTimeout retries stay, per README note).
- No client-facing/branded UI — internal tool only.

## Verification

1. `npm install`, fill `.env`, `npm run dev`.
2. Seed sample jobs → open `/admin` → check auth prompt, stats, filters,
   search, pagination, detail panel, retry on a failed job.
3. Fire a test GHL form submission → confirm field mappings in
   `server.js` against the real payload (existing README step) → confirm
   result webhook arrives in GHL workflow history.
