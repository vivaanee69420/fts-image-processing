const path = require('path');
// .env lives at the repo root, one level above backend/
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Job = require('./models/Job');
const { runPipeline } = require('./pipeline');
const { getProcessedImageUrl } = require('./services/storage');

const app = express();
// Railway (and most hosts) terminate HTTPS at a proxy in front of the app
app.set('trust proxy', 1);
app.use(express.json());

/**
 * Session-cookie auth for the admin dashboard's API.
 * The dashboard page itself is public (it renders a login screen);
 * data/API routes require a session obtained via POST /api/login.
 * Sessions are in-memory: a server restart logs everyone out.
 */
const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const sessions = new Map(); // token -> expiry timestamp

function getSessionToken(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

function adminAuth(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
  }
  const token = getSessionToken(req);
  const expiry = token && sessions.get(token);
  if (expiry && expiry > Date.now()) return next();
  if (token) sessions.delete(token);
  return res.status(401).json({ error: 'unauthorized' });
}

app.post('/api/login', (req, res) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
  }
  // trim: stray whitespace from copy-paste should never fail a login
  const supplied = String(req.body?.password || '').trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(password.trim());
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) return res.status(401).json({ error: 'wrong password' });

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // HTTPS-only cookie on Railway
    maxAge: SESSION_TTL_MS
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

const Setting = require('./models/Setting');
const RESULTS_WEBHOOK_KEY = 'resultsWebhookUrl';

app.get('/api/settings', adminAuth, async (req, res) => {
  try {
    const doc = await Setting.findOne({ key: RESULTS_WEBHOOK_KEY });
    const resultsWebhookUrl = (doc && doc.value) || process.env.GHL_RESULTS_WEBHOOK_URL || '';
    res.json({
      inboundWebhookPath: '/webhooks/ghl-smile-upload',
      resultsWebhookUrl,
      config: {
        mongodb: mongoose.connection.readyState === 1,
        gemini: Boolean(process.env.GEMINI_API_KEY),
        s3: Boolean(
          process.env.AWS_ACCESS_KEY_ID &&
            process.env.AWS_SECRET_ACCESS_KEY &&
            process.env.S3_BUCKET_NAME &&
            process.env.S3_PUBLIC_BASE_URL
        ),
        resultsWebhook: Boolean(resultsWebhookUrl)
      }
    });
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', adminAuth, async (req, res) => {
  try {
    const url = String(req.body?.resultsWebhookUrl || '').trim();
    if (url && !/^https?:\/\/.+/i.test(url)) {
      return res.status(400).json({ error: 'must be a full http(s):// URL' });
    }
    await Setting.findOneAndUpdate(
      { key: RESULTS_WEBHOOK_KEY },
      { value: url },
      { upsert: true }
    );
    res.json({ ok: true, resultsWebhookUrl: url });
  } catch (err) {
    console.error('PUT /api/settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

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

// The page itself is public — it shows a login screen until /api/login succeeds.
// In the split Railway deployment the frontend service serves the UI instead,
// so a missing file here answers with a pointer rather than a crash.
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'UI is served by the frontend service — open its domain instead' });
    }
  });
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
      .limit(PER_PAGE)
      .lean();
    // Bucket is private: re-sign a fresh 7-day image URL from the stored key
    // so dashboard images never go stale.
    await Promise.all(
      jobs.map(async (j) => {
        if (j.processedImageKey) {
          try {
            j.processedImageUrl = await getProcessedImageUrl(j.processedImageKey);
          } catch (e) {
            console.error(`presign failed for job ${j._id}:`, e.message);
          }
        }
      })
    );
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
  const job = await Job.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.processedImageKey) {
    try {
      job.processedImageUrl = await getProcessedImageUrl(job.processedImageKey);
    } catch (e) {
      console.error(`presign failed for job ${job._id}:`, e.message);
    }
  }
  res.json(job);
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
