const mongoose = require('mongoose');

// Simple key/value store for settings editable from the admin dashboard,
// so non-secret config (like the GHL results webhook URL) doesn't require
// editing .env and restarting the server.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: String
  },
  { timestamps: true }
);

module.exports = mongoose.model('Setting', settingSchema);
