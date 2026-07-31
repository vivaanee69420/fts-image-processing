const axios = require('axios');

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_VERSION = '2021-04-15';

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
 * Sends the processed image to the contact over WhatsApp via GHL's
 * Conversations API. Requires the WhatsApp channel to already be
 * connected on this GHL location (it is, per Ruhith's existing setup).
 */
async function sendWhatsAppImage(contactId, imageUrl, caption = '') {
  const response = await axios.post(
    `${GHL_API_BASE}/conversations/messages`,
    {
      type: 'WhatsApp',
      contactId,
      message: caption,
      attachments: [imageUrl]
    },
    { headers: { ...ghlHeaders, 'Content-Type': 'application/json' } }
  );

  return response.data;
}

module.exports = { downloadOriginalImage, sendWhatsAppImage };
