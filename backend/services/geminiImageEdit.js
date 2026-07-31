const { GoogleGenAI } = require('@google/genai');

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Sends a photo to Gemini's image model and asks it to perform a
 * smile/teeth transformation while leaving the rest of the photo untouched.
 *
 * @param {Buffer} imageBuffer - original photo bytes
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @returns {Promise<Buffer>} processed image bytes
 */
async function generateSmileTransformation(imageBuffer, mimeType = 'image/jpeg') {
  const prompt = `
    Edit this photo to show a realistic dental smile makeover simulation.
    - Whiten the teeth naturally (not artificially bright/fake looking)
    - Straighten and even out visible tooth alignment and spacing
    - Keep the exact same face, skin tone, lighting, background, hair, and expression
    - Do not change anything outside the mouth/teeth region
    - The result must look like a realistic "after" photo, not a filter or cartoon
  `.trim();

  const response = await genAI.models.generateContent({
    model: 'gemini-2.5-flash-image', // "Nano Banana" - cheaper editing model
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
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

  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);

  if (!imagePart) {
    throw new Error('Gemini did not return an image in the response');
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

module.exports = { generateSmileTransformation };
