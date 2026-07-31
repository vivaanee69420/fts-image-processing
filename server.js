require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const Job = require('./models/Job');
const { runPipeline } = require('./pipeline');

const app = express();
app.use(express.json());

/**
 * HTTP Basic Auth for the admin dashboard + its API.
 * Any username; password must equal ADMIN_PASSWORD from .env.
 */
function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
  }
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const supplied = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    if (supplied === password) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="smile-admin"');
  return res.status(401).send('Authentication required');
}

// --- Mongo connection ---
mongoose
  .connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'smile-webhook' })
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

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/jobs', adminAuth, async (req, res) => {
  try {
    const PER_PAGE = 25;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
    }
    const total = await Job.countDocuments(filter);
    const jobs = await Job.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PER_PAGE)
      .limit(PER_PAGE);
    res.json({ jobs, total, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)) });
  } catch (err) {
    console.error('GET /api/jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', adminAuth, async (req, res) => {
  try {
    const grouped = await Job.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const byStatus = Object.fromEntries(grouped.map((g) => [g._id, g.count]));
    const total = grouped.reduce((sum, g) => sum + g.count, 0);
    const completed = byStatus.completed || 0;
    const failed = byStatus.failed || 0;
    const successRate = completed + failed > 0 ? completed / (completed + failed) : null;
    const [last24h, last7d] = await Promise.all([
      Job.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }),
      Job.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } })
    ]);
    res.json({ total, byStatus, successRate, last24h, last7d });
  } catch (err) {
    console.error('GET /api/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs/:id/retry', adminAuth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'not found' });
    if (job.status !== 'failed') {
      return res.status(409).json({ error: `only failed jobs can be retried (status: ${job.status})` });
    }
    job.status = 'received';
    job.failureReason = undefined;
    job.attempts = 0;
    await job.save();
    runPipeline(job._id).catch((err) =>
      console.error(`Unhandled pipeline error for retried job ${job._id}:`, err)
    );
    res.json({ ok: true, jobId: job._id });
  } catch (err) {
    console.error('POST /api/jobs/:id/retry error:', err);
    res.status(500).json({ error: err.message });
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
