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
frontend/            React (Vite) admin dashboard
  src/App.jsx        State: auth, filters, auto-refresh, panels
  src/api.js         Fetch wrapper (401 → login screen) + API calls
  src/components/    LoginScreen, StatTiles, JobsTable, JobDetail, SettingsPanel
  nginx.conf.template  Serves the build + proxies API to BACKEND_URL (prod)
```

## Frontend dev & build

```bash
cd frontend
npm install
npm run dev      # dev server on :5173, proxies API to backend on :3000
npm run build    # outputs dist/ — the backend serves it at /admin locally
```

No frontend .env and no CORS config are needed: in dev, Vite proxies
`/api` etc. to the backend; in production, nginx does the same using the
`BACKEND_URL` variable on the frontend service. The browser only ever
talks to its own origin, so cookies work and CORS never applies.

## Admin dashboard (frontend)

Open `http://localhost:3000/admin` (or your deployed domain). Log in with
**any username** and the password from `ADMIN_PASSWORD` in `.env`.

It shows: stat tiles (total/completed/failed/in-progress/success rate),
a searchable + filterable jobs table that auto-refreshes every 10s, a
detail panel with the original vs processed photos side by side, and a
**Retry** button for failed jobs. Sample data: `node scripts/seed.js`.

## Deploying on Railway (two services)

Both services deploy from this same GitHub repo:

1. **Backend service**: New service → GitHub repo → Settings → **Root
   Directory = `backend`**. Add all `.env` variables in the Variables tab
   (use a strong `ADMIN_PASSWORD`). Generate a public domain.
2. **Frontend service**: second service from the same repo → **Root
   Directory = `frontend`**. Add one variable:
   `BACKEND_URL=https://<backend-domain>` (no trailing slash). Generate a
   public domain — this is the URL you open for the dashboard.
3. MongoDB Atlas → Network Access must allow Railway's IPs (`0.0.0.0/0`
   is the simple option).

The frontend's nginx proxies `/api`, `/webhooks`, `/jobs`, and `/health`
to the backend, so the browser sees one origin. Point GHL's form webhook
at either domain's `/webhooks/ghl-smile-upload`.

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

## S3 setup (private bucket — no public access needed)

The bucket stays fully private: **leave "Block all public access" ON, no
bucket policy needed.** The app generates presigned URLs (valid 7 days,
the S3 maximum) for every image — WhatsApp/Meta downloads the image at
send time, and the dashboard re-signs fresh URLs on every load.

1. S3 → Create bucket → name `fts-images-processing`, region `eu-west-2`,
   defaults unchanged.
2. IAM → Users → create a user with this inline policy, then create an
   access key → `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::fts-images-processing/smile-results/*"
    }
  ]
}
```

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
