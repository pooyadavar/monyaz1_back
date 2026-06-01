require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const questionRoutes = require('./src/routes/questionRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// لیمیت بالا برای دریافت عکس‌های کراپ شده با فرمت Base64
app.use(express.json({ limit: '50mb' })); 

// اجازه دادن به فرانت‌اند برای دسترسی به پوشه عکس‌های آپلود شده
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// اتصال روت‌ها به برنامه اصلی
app.use('/api/questions', questionRoutes);

app.listen(PORT, () => {
  console.log(`Server is running brutally on http://localhost:${PORT}`);
});