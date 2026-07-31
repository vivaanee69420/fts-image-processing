const Job = require('./models/Job');
const { downloadOriginalImage, sendResultWebhook } = require('./services/ghl');
const { generateSmileTransformation } = require('./services/geminiImageEdit');
const { uploadProcessedImage } = require('./services/storage');

const MAX_ATTEMPTS = 3;

/**
 * Runs the full pipeline for a single job. Designed to be called
 * fire-and-forget from the webhook handler (never await this in the
 * request/response cycle - GHL needs a fast ack).
 */
async function runPipeline(jobId) {
  const job = await Job.findById(jobId);
  if (!job) return;

  job.attempts += 1;
  job.lastAttemptAt = new Date();

  try {
    // 1. Download original image from GHL
    job.status = 'downloading';
    await job.save();
    const { buffer: originalBuffer, contentType } = await downloadOriginalImage(
      job.originalImageUrl
    );

    // 2. AI processing (Gemini smile transformation)
    job.status = 'processing';
    await job.save();
    const processedBuffer = await generateSmileTransformation(originalBuffer, contentType);

    // 3. Upload processed result to public storage
    job.status = 'uploading';
    await job.save();
    const publicUrl = await uploadProcessedImage(processedBuffer);
    job.processedImageUrl = publicUrl;
    await job.save();

    // 4. Send result back to GHL via webhook - GHL's workflow handles delivery
    job.status = 'sending_result';
    await job.save();
    await sendResultWebhook(job);

    job.status = 'completed';
    job.failureReason = undefined;
    await job.save();
  } catch (err) {
    job.status = 'failed';
    job.failureReason = err.message?.slice(0, 500) || 'Unknown error';
    await job.save();

    // Simple retry: re-run later if attempts remain.
    // In production, swap this for a proper queue (BullMQ/SQS) instead of setTimeout.
    if (job.attempts < MAX_ATTEMPTS) {
      const delayMs = job.attempts * 15000; // 15s, 30s, 45s backoff
      setTimeout(() => runPipeline(jobId), delayMs);
    } else {
      console.error(`Job ${jobId} failed permanently after ${job.attempts} attempts:`, err);
      // TODO: alert Sona/Ruhith (Slack webhook, email, etc.) on permanent failure
    }
  }
}

module.exports = { runPipeline };
