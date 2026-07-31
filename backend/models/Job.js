const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    // Identity from GHL
    ghlContactId: { type: String, required: true, index: true },
    ghlWebhookId: String, // GHL's own event/webhook id; unique sparse index defined below for idempotency
    phone: { type: String, required: true },
    email: String,
    name: String,

    // Image data
    originalImageUrl: { type: String, required: true }, // URL GHL gave us
    processedImageKey: String, // S3 object key (bucket is private; URLs are presigned from this)
    processedImageUrl: String, // last presigned URL (webhook payload); dashboard re-signs fresh

    // Pipeline status
    status: {
      type: String,
      enum: [
        'received',        // webhook received, not started
        'downloading',      // fetching original image from GHL
        'processing',       // sent to Gemini
        'uploading',        // uploading processed result to public storage
        'sending_result',   // POSTing result webhook back to GHL
        'completed',
        'failed'
      ],
      default: 'received',
      index: true
    },

    failureReason: String,
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date
  },
  { timestamps: true }
);

// Prevent double-processing if GHL retries the same webhook delivery
jobSchema.index({ ghlWebhookId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Job', jobSchema);
