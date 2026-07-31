# Results Webhook + Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WhatsApp API send with a webhook POST back to GHL, and add a password-protected `/admin` dashboard to view/retry jobs.

**Architecture:** One Express app (existing `server.js`). The pipeline's final step becomes an outbound webhook to `GHL_RESULTS_WEBHOOK_URL`. Three new authed JSON routes plus one static `public/admin.html` (vanilla HTML/JS/CSS, no build step) provide the dashboard.

**Tech Stack:** Node.js (CommonJS), Express 4, Mongoose 8, axios. No new npm dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-smile-pipeline-and-dashboard-design.md`
- No new npm dependencies; no test framework (repo has none — verification is via node one-liners, curl, and the browser).
- Status enum value is exactly `sending_result` (replaces `sending_whatsapp`) everywhere.
- Result webhook payload keys, exactly: `jobId`, `contactId`, `name`, `email`, `phone`, `originalImageUrl`, `processedImageUrl`.
- Admin auth: HTTP Basic, any username, password from `ADMIN_PASSWORD` env var. Webhook routes and `/health` stay unauthenticated.
- Pagination: 25 jobs per page, newest first.
- **Tasks 3–5 verification needs a real `MONGODB_URI` in `.env`.** `.env` is currently empty (0 bytes). If it still is when you get there, STOP and ask the user for the value — do not invent one.
- Dashboard colors (from the dataviz reference palette): status good `#0ca30c`, warning `#fab219`, critical `#d03b3b`; every status badge shows icon + text label, never color alone. Light surface `#fcfcfb` / dark `#1a1a19`; support both via `prefers-color-scheme` plus `:root[data-theme=…]` override.

---

### Task 1: Repo + install setup

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Produces: a git repo with an initial commit; installed `node_modules` so later tasks can run code.

- [ ] **Step 1: Initialize git** (repo is not one yet; the user approved the plan that includes commits)

```bash
cd /Users/ruhithpasha/code/work/smile-webhook
git init -b main
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
.env
.DS_Store
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: exits 0, `node_modules/` exists. (`npm ls express mongoose axios` shows all three.)

- [ ] **Step 4: Initial commit**

```bash
git add -A
git commit -m "chore: initial commit of smile-webhook backend"
```

---

### Task 2: Send results to GHL via webhook (replace WhatsApp API send)

**Files:**
- Modify: `services/ghl.js` (replace `sendWhatsAppImage` with `sendResultWebhook`)
- Modify: `models/Job.js:24` (enum: `sending_whatsapp` → `sending_result`)
- Modify: `pipeline.js:2,40-47` (call the new function)

**Interfaces:**
- Consumes: `Job` mongoose model (existing).
- Produces: `sendResultWebhook(job) -> Promise<any>` exported from `services/ghl.js`; throws on missing `GHL_RESULTS_WEBHOOK_URL` or non-2xx response. `downloadOriginalImage` is unchanged.

- [ ] **Step 1: Rewrite the send function in `services/ghl.js`**

Replace the whole `sendWhatsAppImage` function (and its export) with:

```js
/**
 * POSTs the finished job's data to a GHL Inbound Webhook trigger URL.
 * GHL's own workflow takes it from there (WhatsApp/SMS/email send).
 * Throws on missing config or non-2xx so the pipeline's retry logic applies.
 */
async function sendResultWebhook(job) {
  const url = process.env.GHL_RESULTS_WEBHOOK_URL;
  if (!url) throw new Error('GHL_RESULTS_WEBHOOK_URL is not set');

  const response = await axios.post(
    url,
    {
      jobId: job._id.toString(),
      contactId: job.ghlContactId,
      name: job.name,
      email: job.email,
      phone: job.phone,
      originalImageUrl: job.originalImageUrl,
      processedImageUrl: job.processedImageUrl
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  return response.data;
}

module.exports = { downloadOriginalImage, sendResultWebhook };
```

Note: `GHL_API_KEY`/`ghlHeaders` stay in the file — `downloadOriginalImage` still has the commented-out auth-header option.

- [ ] **Step 2: Rename the enum value in `models/Job.js`**

In the `status` enum, change `'sending_whatsapp', // calling GHL Conversations API` to:

```js
        'sending_result',   // POSTing result webhook back to GHL
```

- [ ] **Step 3: Update `pipeline.js`**

Change the import on line 2 to:

```js
const { downloadOriginalImage, sendResultWebhook } = require('./services/ghl');
```

Replace step 4 of the pipeline (the `sending_whatsapp` block through the `sendWhatsAppImage(...)` call) with:

```js
    // 4. Send result back to GHL via webhook - GHL's workflow handles delivery
    job.status = 'sending_result';
    await job.save();
    await sendResultWebhook(job);
```

- [ ] **Step 4: Verify with a throwaway local receiver**

```bash
node -e "
require('http').createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => { console.log('RECEIVED:', b); res.end('{}'); process.exit(0); });
}).listen(4001, () => console.log('receiver up'));
" &
sleep 1
GHL_RESULTS_WEBHOOK_URL=http://localhost:4001 node -e "
const { sendResultWebhook } = require('./services/ghl');
sendResultWebhook({
  _id: 'test123',
  ghlContactId: 'c1',
  name: 'Test',
  email: 't@e.st',
  phone: '+10000000000',
  originalImageUrl: 'http://x/orig.jpg',
  processedImageUrl: 'http://x/done.png'
}).then(() => console.log('SEND OK')).catch((e) => { console.error('SEND FAIL', e.message); process.exit(1); });
"
```

Expected: receiver prints `RECEIVED: {"jobId":"test123",...}` with all seven keys, then `SEND OK`. Also verify the old name is gone: `grep -rn sending_whatsapp -r . --exclude-dir=node_modules --exclude-dir=docs` and `grep -rn sendWhatsAppImage . --exclude-dir=node_modules --exclude-dir=docs` both return nothing.

- [ ] **Step 5: Commit**

```bash
git add services/ghl.js models/Job.js pipeline.js
git commit -m "feat: send results to GHL via webhook instead of WhatsApp API"
```

---

### Task 3: Seed script for sample jobs

**Files:**
- Create: `scripts/seed.js`

**Interfaces:**
- Consumes: `Job` model, `MONGODB_URI` from `.env`.
- Produces: repeatable sample data — all seed docs have emails ending `@seed.test`; re-running replaces them. Used to verify Tasks 4–5.

- [ ] **Step 1: Check `.env` has `MONGODB_URI`** — if missing, STOP and ask the user (see Global Constraints).

- [ ] **Step 2: Write `scripts/seed.js`**

```js
// Inserts sample jobs so the /admin dashboard has data during development.
// Re-runnable: wipes previous seed docs (email @seed.test) first.
require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('../models/Job');

const IMG = (n) => `https://picsum.photos/seed/smile${n}/400/400`;

const samples = [
  { name: 'Asha Verma', phone: '+919800000001', status: 'completed', processedImageUrl: IMG(11) },
  { name: 'Rahul Nair', phone: '+919800000002', status: 'completed', processedImageUrl: IMG(12) },
  { name: 'Meera Iyer', phone: '+919800000003', status: 'processing' },
  { name: 'John Dsouza', phone: '+919800000004', status: 'failed', failureReason: 'Gemini did not return an image in the response', attempts: 3 },
  { name: 'Sana Khan', phone: '+919800000005', status: 'received' },
  { name: 'Vikram Rao', phone: '+919800000006', status: 'sending_result', processedImageUrl: IMG(16) },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Job.deleteMany({ email: /@seed\.test$/ });
  await Job.insertMany(
    samples.map((s, i) => ({
      ghlContactId: `seed-contact-${i + 1}`,
      ghlWebhookId: `seed-webhook-${i + 1}`,
      email: `${s.name.split(' ')[0].toLowerCase()}@seed.test`,
      originalImageUrl: IMG(i + 1),
      attempts: s.attempts ?? 1,
      lastAttemptAt: new Date(),
      ...s
    }))
  );
  const count = await Job.countDocuments({ email: /@seed\.test$/ });
  console.log(`Seeded ${count} jobs`);
  await mongoose.disconnect();
})();
```

- [ ] **Step 3: Run it twice (proves it's re-runnable)**

Run: `node scripts/seed.js && node scripts/seed.js`
Expected: `Seeded 6 jobs` both times (not 12).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.js
git commit -m "chore: add seed script for dashboard development"
```

---

### Task 4: Basic auth + admin API routes

**Files:**
- Modify: `server.js` (add auth middleware + 4 routes; add `path` require)

**Interfaces:**
- Consumes: `Job` model, `runPipeline` (both already imported in `server.js`).
- Produces:
  - `adminAuth(req, res, next)` middleware — Basic auth against `ADMIN_PASSWORD`.
  - `GET /admin` → serves `public/admin.html` (file created in Task 5).
  - `GET /api/jobs?status=&search=&page=` → `{ jobs: Job[], total: number, page: number, pages: number }`.
  - `GET /api/stats` → `{ total, byStatus: {<status>: count}, successRate: number|null, last24h, last7d }`.
  - `POST /api/jobs/:id/retry` → `{ ok: true, jobId }`; 404 unknown id, 409 if status ≠ `failed`.

- [ ] **Step 1: Add requires and middleware to `server.js`**

Below the existing requires add:

```js
const path = require('path');
```

Below `app.use(express.json());` add:

```js
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
```

- [ ] **Step 2: Add the four routes** (above the `/jobs/:id` route)

```js
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
```

- [ ] **Step 3: Verify with curl** (needs `ADMIN_PASSWORD` — add `ADMIN_PASSWORD=devpass123` to `.env` if the user hasn't set one; tell them what you set)

```bash
node server.js &   # or npm run dev in another terminal
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/stats                       # expect 401
curl -s -u admin:devpass123 http://localhost:3000/api/stats                                    # expect JSON: total 6, byStatus, successRate ≈ 0.667 (2 completed, 1 failed)
curl -s -u admin:devpass123 'http://localhost:3000/api/jobs?status=failed' | head -c 300       # expect 1 job: John Dsouza
curl -s -u admin:devpass123 'http://localhost:3000/api/jobs?search=meera' | head -c 300        # expect 1 job: Meera Iyer
FAILED_ID=$(curl -s -u admin:devpass123 'http://localhost:3000/api/jobs?status=failed' | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>console.log(JSON.parse(b).jobs[0]._id))")
curl -s -u admin:devpass123 -X POST "http://localhost:3000/api/jobs/$FAILED_ID/retry"          # expect {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' -u admin:devpass123 -X POST "http://localhost:3000/api/jobs/$FAILED_ID/retry"  # expect 409 (no longer 'failed'; if 200, the pipeline already re-failed it — also proves the transition worked)
```

Note: the retried seed job will end up `failed` again (its picsum "original" downloads fine but Gemini/S3 aren't configured) — that's expected and fine here; we only verified the endpoint's state transition. Kill the server after.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add basic-auth admin API (jobs list, stats, retry)"
```

---

### Task 5: Admin dashboard page

**Files:**
- Create: `public/admin.html`

**Interfaces:**
- Consumes: `GET /api/jobs`, `GET /api/stats`, `POST /api/jobs/:id/retry` (Task 4 shapes). The browser's Basic-auth session covers the fetches (same origin).

- [ ] **Step 1: Write `public/admin.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smile Jobs — Admin</title>
<style>
  :root {
    color-scheme: light;
    --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e;
    --muted: #898781; --line: #e1e0d9; --ring: rgba(11,11,11,0.10);
    --good: #0ca30c; --warn: #fab219; --crit: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7;
      --muted: #898781; --line: #2c2c2a; --ring: rgba(255,255,255,0.10);
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7;
    --muted: #898781; --line: #2c2c2a; --ring: rgba(255,255,255,0.10);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--page); color: var(--ink);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .banner {
    display: none; background: var(--surface); border: 1px solid var(--crit);
    color: var(--ink); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px;
  }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .tile { background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 12px 14px; }
  .tile .v { font-size: 26px; font-weight: 650; }
  .tile .k { color: var(--ink-2); font-size: 12px; margin-top: 2px; }
  .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  select, input[type=search], button {
    font: inherit; color: var(--ink); background: var(--surface);
    border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px;
  }
  input[type=search] { min-width: 220px; }
  button { cursor: pointer; }
  button.primary { border-color: var(--ink-2); font-weight: 600; }
  .tablewrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
  td.reason { max-width: 260px; overflow: hidden; text-overflow: ellipsis; color: var(--ink-2); }
  td.num, th.num { font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px;
  }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .badge.completed .dot { background: var(--good); }
  .badge.failed .dot { background: var(--crit); }
  .badge.working .dot { background: var(--warn); }
  .pager { display: flex; gap: 8px; align-items: center; margin-top: 12px; color: var(--ink-2); }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; }
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100%);
    background: var(--surface); border-left: 1px solid var(--ring);
    padding: 20px; overflow-y: auto; display: none;
  }
  .panel h2 { margin: 0 0 4px; font-size: 16px; }
  .panel dl { display: grid; grid-template-columns: 130px 1fr; gap: 6px 10px; margin: 14px 0; }
  .panel dt { color: var(--muted); font-size: 12px; }
  .panel dd { margin: 0; word-break: break-word; }
  .imgs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .imgs figure { margin: 0; }
  .imgs figcaption { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .imgs img { width: 100%; border-radius: 8px; border: 1px solid var(--line); background: var(--page); }
  .imgs .none { color: var(--muted); font-size: 12px; border: 1px dashed var(--line); border-radius: 8px; padding: 20px 10px; text-align: center; }
  .imgs .none a { color: inherit; }
  .row { display: flex; gap: 8px; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Smile Jobs</h1>
  <div class="banner" id="banner"></div>
  <div class="tiles" id="tiles"></div>
  <div class="bar">
    <select id="statusFilter">
      <option value="">All statuses</option>
      <option>received</option><option>downloading</option><option>processing</option>
      <option>uploading</option><option>sending_result</option>
      <option>completed</option><option>failed</option>
    </select>
    <input type="search" id="search" placeholder="Search name / phone / email">
    <button id="refresh" class="primary">Refresh</button>
    <span id="autoNote" style="color:var(--muted);font-size:12px">auto-refreshes every 10s</span>
  </div>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th>Created</th><th>Name</th><th>Phone</th><th>Status</th>
        <th class="num">Attempts</th><th>Failure reason</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <div class="pager">
    <button id="prev">‹ Prev</button>
    <span id="pageInfo"></span>
    <button id="next">Next ›</button>
  </div>
</div>

<div class="overlay" id="overlay"></div>
<aside class="panel" id="panel"></aside>

<script>
const $ = (id) => document.getElementById(id);
const WORKING = ['received', 'downloading', 'processing', 'uploading', 'sending_result'];
const ICONS = { completed: '✓', failed: '✕' };
let state = { page: 1, pages: 1, openJob: null, timer: null };

function badge(status) {
  const cls = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'working';
  const icon = ICONS[status] || '●';
  return `<span class="badge ${cls}"><span class="dot"></span>${icon} ${status}</span>`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showError(msg) { const b = $('banner'); b.textContent = msg; b.style.display = 'block'; }
function clearError() { $('banner').style.display = 'none'; }

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function loadStats() {
  const s = await api('/api/stats');
  const working = WORKING.reduce((n, k) => n + (s.byStatus[k] || 0), 0);
  const rate = s.successRate == null ? '—' : Math.round(s.successRate * 100) + '%';
  $('tiles').innerHTML = [
    [s.total, 'Total jobs'],
    [s.byStatus.completed || 0, 'Completed'],
    [s.byStatus.failed || 0, 'Failed'],
    [working, 'In progress'],
    [rate, 'Success rate'],
    [s.last24h, 'Last 24h']
  ].map(([v, k]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

async function loadJobs() {
  const q = new URLSearchParams();
  if ($('statusFilter').value) q.set('status', $('statusFilter').value);
  if ($('search').value.trim()) q.set('search', $('search').value.trim());
  q.set('page', state.page);
  const data = await api('/api/jobs?' + q);
  state.pages = data.pages;
  $('pageInfo').textContent = `page ${data.page} / ${data.pages} — ${data.total} jobs`;
  $('prev').disabled = data.page <= 1;
  $('next').disabled = data.page >= data.pages;
  $('rows').innerHTML = data.jobs.map((j) => `
    <tr data-id="${j._id}">
      <td>${new Date(j.createdAt).toLocaleString()}</td>
      <td>${esc(j.name) || '—'}</td>
      <td>${esc(j.phone)}</td>
      <td>${badge(j.status)}</td>
      <td class="num">${j.attempts}</td>
      <td class="reason" title="${esc(j.failureReason)}">${esc(j.failureReason) || ''}</td>
    </tr>`).join('');
  data.jobs.forEach((j) => {
    document.querySelector(`tr[data-id="${j._id}"]`).onclick = () => openPanel(j);
  });
}

async function refresh() {
  try { clearError(); await Promise.all([loadStats(), loadJobs()]); }
  catch (e) { showError('Failed to load data: ' + e.message); }
}

function img(label, url) {
  if (!url) return `<figure><figcaption>${label}</figcaption><div class="none">no image yet</div></figure>`;
  return `<figure><figcaption>${label}</figcaption>
    <img src="${esc(url)}" alt="${label}"
      onerror="this.outerHTML='<div class=none>image failed to load<br><a href=&quot;${esc(url)}&quot; target=_blank>open URL</a></div>'>
  </figure>`;
}

function openPanel(j) {
  state.openJob = j;
  $('overlay').style.display = 'block';
  const p = $('panel');
  p.style.display = 'block';
  p.innerHTML = `
    <div class="row"><h2>${esc(j.name) || 'Unnamed'} ${badge(j.status)}</h2>
      <button onclick="closePanel()">Close ✕</button></div>
    <dl>
      <dt>Job ID</dt><dd>${j._id}</dd>
      <dt>Contact ID</dt><dd>${esc(j.ghlContactId)}</dd>
      <dt>Phone</dt><dd>${esc(j.phone)}</dd>
      <dt>Email</dt><dd>${esc(j.email) || '—'}</dd>
      <dt>Attempts</dt><dd>${j.attempts}</dd>
      <dt>Created</dt><dd>${new Date(j.createdAt).toLocaleString()}</dd>
      <dt>Last attempt</dt><dd>${j.lastAttemptAt ? new Date(j.lastAttemptAt).toLocaleString() : '—'}</dd>
      <dt>Failure reason</dt><dd>${esc(j.failureReason) || '—'}</dd>
    </dl>
    <div class="imgs">${img('Original', j.originalImageUrl)}${img('Processed', j.processedImageUrl)}</div>
    ${j.status === 'failed' ? `<p><button class="primary" onclick="retryJob('${j._id}')">Retry this job</button></p>` : ''}
    <p id="retryMsg" style="color:var(--ink-2)"></p>`;
}
function closePanel() {
  state.openJob = null;
  $('overlay').style.display = 'none';
  $('panel').style.display = 'none';
}
async function retryJob(id) {
  try {
    await api(`/api/jobs/${id}/retry`, { method: 'POST' });
    $('retryMsg').textContent = 'Retry started — refreshing…';
    setTimeout(() => { closePanel(); refresh(); }, 1200);
  } catch (e) { $('retryMsg').textContent = 'Retry failed: ' + e.message; }
}

$('overlay').onclick = closePanel;
$('refresh').onclick = () => { state.page = 1; refresh(); };
$('statusFilter').onchange = () => { state.page = 1; refresh(); };
$('search').oninput = () => { clearTimeout(state.searchT); state.searchT = setTimeout(() => { state.page = 1; loadJobs().catch((e) => showError(e.message)); }, 300); };
$('prev').onclick = () => { if (state.page > 1) { state.page--; loadJobs(); } };
$('next').onclick = () => { if (state.page < state.pages) { state.page++; loadJobs(); } };
state.timer = setInterval(() => { if (!state.openJob) refresh(); }, 10000);
refresh();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify in a browser**

Start the server (`npm run dev`), open `http://localhost:3000/admin`, log in with any username + the `ADMIN_PASSWORD` value. Check, with the seed data present:
- 6 stat tiles render with numbers (6 total, 2 completed, 1 failed, 3 in progress).
- Status filter `failed` shows only John Dsouza; search `meera` shows only Meera Iyer.
- Clicking a row opens the panel: fields, both images (picsum loads; missing processed image shows "no image yet").
- The failed job shows a Retry button; clicking it shows "Retry started" and the panel closes.
- Toggle OS dark mode (or set `document.documentElement.dataset.theme='dark'` in devtools): page restyles, text stays readable.
- Break verification: stop the server, click Refresh → red-bordered error banner appears (no blank page).

If a browser isn't available, use the gstack `/browse` skill for the checks and a screenshot.

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: add /admin dashboard (stats, jobs table, detail view, retry)"
```

---

### Task 6: Config + docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: accurate setup docs; no code.

- [ ] **Step 1: Update `.env.example`** — replace the GHL section with:

```bash
# GHL
# Inbound Webhook trigger URL from your GHL workflow - processed results are POSTed here
GHL_RESULTS_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/xxxx/webhook-trigger/xxxx
# Only needed if the uploaded-image URL requires auth to download (see services/ghl.js)
GHL_API_KEY=your_ghl_private_integration_or_api_key
GHL_LOCATION_ID=vDM9L71zA6LpZHZCnYqb

# Admin dashboard (/admin) password - any username, this password
ADMIN_PASSWORD=change-me
```

(Keep the MongoDB, Gemini, AWS, and PORT sections as they are.)

- [ ] **Step 2: Update `README.md`**
  - First line of the flow: change `→ WhatsApp via GHL` to `→ result webhook back to GHL (GHL workflow sends WhatsApp/SMS)`.
  - In "Wiring into GHL", add a step: create a second GHL workflow with an **Inbound Webhook** trigger, copy its URL into `GHL_RESULTS_WEBHOOK_URL`, and add the send-to-lead action (WhatsApp/SMS) inside that workflow using the incoming `processedImageUrl` field.
  - Add an "Admin dashboard" section: `/admin`, Basic auth with `ADMIN_PASSWORD`, what it shows (stats, jobs, before/after images, retry), and `node scripts/seed.js` for sample data.
  - In "Why MongoDB is here", change the `sending_whatsapp` mention in the status list to `sending_result`.

- [ ] **Step 3: Final check + commit**

Run: `grep -rn 'sending_whatsapp\|sendWhatsAppImage\|Conversations API' README.md server.js pipeline.js services models public` — expect no hits (docs/ may still mention history).

```bash
git add .env.example README.md
git commit -m "docs: document results webhook + admin dashboard setup"
```
