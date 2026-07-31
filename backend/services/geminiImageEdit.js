const { GoogleGenAI } = require('@google/genai');

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Both overridable via env — no redeploy needed to switch model or tune wording.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
// Keep default phrasing simple: the earlier elaborate "dental smile makeover
// simulation" prompt made the model refuse (finishReason IMAGE_OTHER, no
// image). This wording returns an image reliably.
const SMILE_PROMPT =
  process.env.SMILE_PROMPT ||
  'Whiten the teeth in this photo so they look naturally white, and make ' +
    'them appear straight and evenly aligned. Keep the face, skin, lighting, ' +
    'hair, background and expression exactly the same. The edit should look ' +
    'like a realistic photo, not a filter. Return the edited image.';

/**
 * Sends a photo to Gemini's image model and asks it to perform a
 * smile/teeth transformation while leaving the rest of the photo untouched.
 *
 * @param {Buffer} imageBuffer - original photo bytes
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @returns {Promise<Buffer>} processed image bytes
 */
async function generateSmileTransformation(imageBuffer, mimeType = 'image/jpeg') {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL, // default: "Nano Banana" (gemini-2.5-flash-image)
    contents: [
      {
        role: 'user',
        parts: [
          { text: SMILE_PROMPT },
          {
            inlineData: {
              mimeType,
              data: imageBuffer.toString('base64')
            }
          }
        ]
      }
    ]
  });

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);

  if (!imagePart) {
    const text = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
    throw new Error(
      `Gemini did not return an image (finishReason: ${candidate?.finishReason || 'none'}` +
        (text ? `, said: "${text}"` : '') +
        ')'
    );
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

module.exports = { generateSmileTransformation };
