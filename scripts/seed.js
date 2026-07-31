// Inserts sample jobs so the /admin dashboard has data during development.
// Re-runnable: wipes previous seed docs (email @seed.test) first.
require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('../models/Job');

const IMG = (n) => `https://picsum.photos/seed/smile${n}/400/400`;

const samples = [
  { name: 'Asha Verma', phone: '+919800000001', status: 'completed', processedImageUrl: IMG(11) },
  { name: 'Rahul Nair', phone: '+919800000002', status: 'completed', processedImageUrl: IMG(12) },
  { name: 'Meera Iyer', phone: '+919800000003', status: 'processing' },
  { name: 'John Dsouza', phone: '+919800000004', status: 'failed', failureReason: 'Gemini did not return an image in the response', attempts: 3 },
  { name: 'Sana Khan', phone: '+919800000005', status: 'received' },
  { name: 'Vikram Rao', phone: '+919800000006', status: 'sending_result', processedImageUrl: IMG(16) },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Job.deleteMany({ email: /@seed\.test$/ });
  await Job.insertMany(
    samples.map((s, i) => ({
      ghlContactId: `seed-contact-${i + 1}`,
      ghlWebhookId: `seed-webhook-${i + 1}`,
      email: `${s.name.split(' ')[0].toLowerCase()}@seed.test`,
      originalImageUrl: IMG(i + 1),
      attempts: s.attempts ?? 1,
      lastAttemptAt: new Date(),
      ...s
    }))
  );
  const count = await Job.countDocuments({ email: /@seed\.test$/ });
  console.log(`Seeded ${count} jobs`);
  await mongoose.disconnect();
})();
