const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const s3 = new S3Client({ region: process.env.AWS_REGION });

const BUCKET = process.env.S3_BUCKET_NAME;
const KEY_PREFIX = process.env.S3_KEY_PREFIX || 'smile-results/';

// Presigned URLs: the bucket stays fully PRIVATE (Block Public Access on).
// Each image link is signed with our credentials and valid for 7 days —
// the S3 maximum. WhatsApp/Meta downloads the image at send time, so
// expiry doesn't affect delivery; the dashboard re-signs on every load.
const PRESIGN_EXPIRY_SECONDS =
  Number(process.env.PRESIGN_EXPIRY_SECONDS) || 7 * 24 * 3600;

/**
 * Uploads a processed image buffer to the private S3 bucket.
 * Returns the object key (not a URL) — call getProcessedImageUrl(key)
 * whenever a fetchable URL is needed.
 */
async function uploadProcessedImage(buffer, contentType = 'image/png') {
  const key = `${KEY_PREFIX}${Date.now()}-${crypto.randomUUID()}.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return key;
}

/**
 * Returns a presigned HTTPS URL for a stored image (valid 7 days).
 * Signing is local crypto — no network call, cheap to do per request.
 */
async function getProcessedImageUrl(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: PRESIGN_EXPIRY_SECONDS
  });
}

module.exports = { uploadProcessedImage, getProcessedImageUrl };
