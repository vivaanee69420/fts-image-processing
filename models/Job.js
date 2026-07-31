const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    // Identity from GHL
    ghlContactId: { type: String, required: true, index: true },
    ghlWebhookId: { type: String, index: true }, // GHL's own event/webhook id, used for idempotency
    phone: { type: String, required: true },
    email: String,
    name: String,

    // Image data
    originalImageUrl: { type: String, required: true }, // URL GHL gave us
    processedImageUrl: String, // public URL after AI processing + re-upload

    // Pipeline status
    status: {
      type: String,
      enum: [
        'received',        // webhook received, not started
        'downloading',      // fetching original image from GHL
        'processing',       // sent to Gemini
        'uploading',        // uploading processed result to public storage
        'sending_whatsapp', // calling GHL Conversations API
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
