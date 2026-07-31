const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const s3 = new S3Client({ region: process.env.AWS_REGION });

const BUCKET = process.env.S3_BUCKET_NAME;
const PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL; // e.g. https://your-bucket.s3.region.amazonaws.com

/**
 * Uploads a processed image buffer to S3 and returns a public HTTPS URL.
 * The bucket/object must be publicly readable (or served via CloudFront)
 * since WhatsApp/Meta needs to fetch it without auth.
 */
async function uploadProcessedImage(buffer, contentType = 'image/png') {
  const key = `smile-results/${Date.now()}-${crypto.randomUUID()}.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read'
    })
  );

  return `${PUBLIC_BASE_URL}/${key}`;
}

module.exports = { uploadProcessedImage };
