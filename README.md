# Smile Transformation Webhook

GHL form (name/email/phone/photo) → webhook → this backend → Gemini image edit → S3 → WhatsApp via GHL.

## Setup

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # or: npm start
```

## Wiring into GHL

1. In the GHL form's workflow, add a **Webhook** action on "Form Submitted".
2. Point it at: `POST https://your-domain.com/webhooks/ghl-smile-upload`
3. **Before going live**: submit one test entry and check your server logs
   (`console.error('Missing required fields...')` in `server.js`) to see the
   *actual* raw payload GHL sends. Field names for the uploaded file URL
   especially vary by workflow config — update the field-mapping lines near
   the top of the `/webhooks/ghl-smile-upload` handler to match what you
   actually receive.

## Why MongoDB is here

Each upload becomes a `Job` document tracked through:
`received → downloading → processing → uploading → sending_whatsapp → completed/failed`

This gives you:
- **Idempotency** — GHL sometimes retries webhook deliveries; the unique
  index on `ghlWebhookId` stops the same photo being processed/sent twice.
- **Retry on failure** — if Gemini or the WhatsApp send fails transiently,
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
