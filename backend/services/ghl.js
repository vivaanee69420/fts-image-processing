const axios = require('axios');

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_VERSION = process.env.GHL_API_VERSION || '2021-04-15';

const ghlHeaders = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: GHL_API_VERSION
};

/**
 * Downloads the original uploaded image from the URL GHL gave us in the webhook.
 * Returns the raw bytes + content-type so we can hand it straight to Gemini.
 */
async function downloadOriginalImage(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    // If GHL's media URL requires auth, uncomment the line below.
    // headers: ghlHeaders,
  });

  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || 'image/jpeg'
  };
}

/**
 * POSTs the finished job's data to a GHL Inbound Webhook trigger URL.
 * GHL's own workflow takes it from there (WhatsApp/SMS/email send).
 * Throws on missing config or non-2xx so the pipeline's retry logic applies.
 */
async function sendResultWebhook(job) {
  // Dashboard-configured URL wins; .env is the fallback.
  const Setting = require('../models/Setting');
  const doc = await Setting.findOne({ key: 'resultsWebhookUrl' });
  const url = (doc && doc.value) || process.env.GHL_RESULTS_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      'Results webhook URL is not configured — set it in the dashboard Settings (or GHL_RESULTS_WEBHOOK_URL in .env)'
    );
  }

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
