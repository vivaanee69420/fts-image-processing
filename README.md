# Smile Transformation Webhook

GHL form (name/email/phone/photo) → webhook → this backend → Gemini image edit → S3 → result webhook back to GHL.

## Setup

```bash
cp .env.example .env    # fill in real values (.env stays at the repo root)
cd backend
npm install
npm run dev             # or: npm start
```

## Project layout

```
.env                 Secrets/config (repo root, gitignored)
backend/
  server.js          Express app: GHL webhook in, admin API, serves the dashboard
  pipeline.js        Job pipeline: download → Gemini → S3 → result webhook, with retries
  models/Job.js      Mongoose Job schema (status tracking per submission)
  services/ghl.js    Download original image + POST results back to GHL
  services/geminiImageEdit.js   Gemini smile transformation
  services/storage.js           S3 upload of the processed image
  scripts/seed.js    Inserts 6 sample jobs (emails @seed.test) for dashboard dev
frontend/
  admin.html         The admin dashboard (vanilla HTML/JS, no build step)
```

## Admin dashboard (frontend)

Open `http://localhost:3000/admin` (or your deployed domain). Log in with
**any username** and the password from `ADMIN_PASSWORD` in `.env`.

It shows: stat tiles (total/completed/failed/in-progress/success rate),
a searchable + filterable jobs table that auto-refreshes every 10s, a
detail panel with the original vs processed photos side by side, and a
**Retry** button for failed jobs. Sample data: `node scripts/seed.js`.

## Wiring into GHL

1. In the GHL form's workflow, add a **Webhook** action on "Form Submitted".
2. Point it at: `POST https://your-domain.com/webhooks/ghl-smile-upload`
3. Create a **second workflow** with an **Inbound Webhook** trigger; copy its
   URL into `GHL_RESULTS_WEBHOOK_URL` in `.env`. In that workflow, add your
   send-to-lead action (WhatsApp/SMS/email) using the incoming
   `processedImageUrl` field — this backend POSTs `jobId`, `contactId`,
   `name`, `email`, `phone`, `originalImageUrl`, `processedImageUrl` there
   when a job finishes.
4. **Before going live**: submit one test entry and check your server logs
   (`console.error('Missing required fields...')` in `server.js`) to see the
   *actual* raw payload GHL sends. Field names for the uploaded file URL
   especially vary by workflow config — update the field-mapping lines near
   the top of the `/webhooks/ghl-smile-upload` handler to match what you
   actually receive.

## Why MongoDB is here

Each upload becomes a `Job` document tracked through:
`received → downloading → processing → uploading → sending_result → completed/failed`

This gives you:
- **Idempotency** — GHL sometimes retries webhook deliveries; the unique
  index on `ghlWebhookId` stops the same photo being processed/sent twice.
- **Retry on failure** — if Gemini or the result webhook fails transiently,
  the job retries automatically (up to 3 attempts, `pipeline.js`).
- **Debuggability** — `GET /jobs/:id` lets you check exactly where a
  specific patient's submission is stuck, instead of guessing from logs.

You could skip the DB for a pure throwaway prototype, but for anything
running real ad traffic you'll want it — silent failures on a lead-gen
funnel are expensive.

## Swapping pieces

- **Storage**: `services/storage.js` uses S3. Swap for Cloudflare R2 or
  Cloudinary if you prefer — just keep the function signature
  `uploadProcessedImage(buffer) -> publicUrl`.
- **AI model**: `services/geminiImageEdit.js` uses Gemini's "Nano Banana"
  (gemini-2.5-flash-image). If results on real patient photos aren't
  convincing, this is the file to swap for Nano Banana Pro or a
  dental-specific API.
- **Queue**: retries currently use `setTimeout` for simplicity. For
  production volume, swap `pipeline.js`'s retry logic for a real queue
  (BullMQ + Redis, or SQS) so retries survive a server restart.
