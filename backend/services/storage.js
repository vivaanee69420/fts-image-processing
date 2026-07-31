const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const s3 = new S3Client({ region: process.env.AWS_REGION });

const BUCKET = process.env.S3_BUCKET_NAME;
const PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL; // e.g. https://your-bucket.s3.region.amazonaws.com

/**
 * Uploads a processed image buffer to S3 and returns a public HTTPS URL.
 * Public read access comes from the BUCKET POLICY (not per-object ACLs,
 * which modern buckets reject) — WhatsApp/Meta must be able to fetch the
 * URL without auth. See README "S3 setup" for the policy JSON.
 */
async function uploadProcessedImage(buffer, contentType = 'image/png') {
  const key = `smile-results/${Date.now()}-${crypto.randomUUID()}.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return `${PUBLIC_BASE_URL}/${key}`;
}

module.exports = { uploadProcessedImage };
