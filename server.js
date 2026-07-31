require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Job = require('./models/Job');
const { runPipeline } = require('./pipeline');

const app = express();
app.use(express.json());

// --- Mongo connection ---
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

/**
 * Webhook endpoint - point your GHL "Form Submitted" workflow's
 * webhook step at: POST https://your-domain.com/webhooks/ghl-smile-upload
 *
 * IMPORTANT: Before wiring this into the real workflow, fire one test
 * submission from the GHL form and log req.body to confirm the exact
 * field names/shape GHL sends for the uploaded file URL, contact id,
 * phone, email, and name - payload shape varies by workflow config.
 */
app.post('/webhooks/ghl-smile-upload', async (req, res) => {
  try {
    const payload = req.body;

    // Adjust these field paths once you've confirmed the real GHL payload shape.
    const ghlContactId = payload.contact_id || payload.contactId;
    const phone = payload.phone;
    const email = payload.email;
    const name = payload.full_name || payload.name;
    const ghlWebhookId = payload.id || payload.webhook_id; // for idempotency
    const originalImageUrl =
      payload.uploaded_image_url ||
      payload.customData?.image_url ||
      payload.attachments?.[0];

    if (!ghlContactId || !originalImageUrl || !phone) {
      // Ack 200 anyway so GHL doesn't retry-storm a malformed payload,
      // but log it loudly so you notice during setup/testing.
      console.error('Missing required fields in GHL webhook payload:', payload);
      return res.status(200).json({ received: true, warning: 'missing required fields' });
    }

    // Idempotency: if we've already got a job for this exact webhook delivery, skip.
    let job = ghlWebhookId ? await Job.findOne({ ghlWebhookId }) : null;

    if (!job) {
      job = await Job.create({
        ghlContactId,
        ghlWebhookId,
        phone,
        email,
        name,
        originalImageUrl,
        status: 'received'
      });
    }

    // Ack GHL immediately - do not make it wait on AI processing.
    res.status(200).json({ received: true, jobId: job._id });

    // Fire-and-forget the actual pipeline.
    runPipeline(job._id).catch((err) =>
      console.error(`Unhandled pipeline error for job ${job._id}:`, err)
    );
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Still ack 200 to avoid GHL retry storms once we've logged the issue;
    // change to 500 during initial testing if you want to see retries.
    res.status(200).json({ received: true, error: 'internal error, logged' });
  }
});

/**
 * Simple status-check endpoint - useful for debugging a specific
 * submission while you're testing (or for Ruhith to check from Postman).
 */
app.get('/jobs/:id', async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
