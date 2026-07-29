require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./src/routes/adminRoutes');
const aiAssetRoutes = require('./src/routes/aiAssetRoutes');
const authRoutes = require('./src/routes/authRoutes');
const extractionRoutes = require('./src/routes/extractionRoutes');
const questionRoutes = require('./src/routes/questionRoutes');
const { getAiHealth, getApiBase } = require('./src/services/moniazAiClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// لیمیت بالا برای دریافت عکس‌های کراپ شده با فرمت Base64
app.use(express.json({ limit: '50mb' })); 

// اجازه دادن به فرانت‌اند برای دسترسی به پوشه عکس‌های آپلود شده
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/health', async (req, res) => {
  const body = { ok: true, service: 'monyaz1_back', aiBase: getApiBase(), ai: null };
  try {
    body.ai = await getAiHealth();
  } catch (error) {
    body.ai = {
      status: 'down',
      error: process.env.NODE_ENV === 'production' ? 'unavailable' : error.message,
    };
  }
  res.json(body);
});

// اتصال روت‌ها به برنامه اصلی
app.use('/api/admin', adminRoutes);
app.use('/api/ai-assets', aiAssetRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/extractions', extractionRoutes);
app.use('/api/questions', questionRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled API Error:", err);
  res.status(500).json({
    error: 'خطای داخلی سرور.',
    detail: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running brutally on http://localhost:${PORT}`);
  });
}

module.exports = app;
