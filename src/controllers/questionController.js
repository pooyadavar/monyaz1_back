const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const geminiService = require('../services/geminiService');

// مسیر پوشه آپلودها (در ریشه پروژه)
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// اطمینان از وجود پوشه در زمان شروع برنامه
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

exports.extractData = async (req, res) => {
  try {
    console.log("Extract request received:", {
      hasFile: Boolean(req.file),
      fileName: req.file?.originalname,
      mimeType: req.file?.mimetype,
      size: req.file?.size
    });

    if (!req.file) {
      return res.status(400).json({ error: 'هیچ عکسی ارسال نشده است.' });
    }

    const extractedData = await geminiService.extractQuestionData(req.file.buffer, req.file.mimetype);
    res.json({ success: true, data: extractedData });

  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    res.status(500).json({
      error: 'خطا در ارتباط با هوش مصنوعی.',
      detail: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};

exports.saveQuestion = (req, res) => {
  try {
    const { questionText, options, correctOption, hasQuestionImage, questionImage } = req.body;

    let finalImagePath = null;
    const shouldSaveImage = Boolean(hasQuestionImage) && Boolean(questionImage);

    if (shouldSaveImage) {
      const base64Data = questionImage.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      const fileName = `question_${Date.now()}.jpg`;
      const uploadPath = path.join(UPLOADS_DIR, fileName);
      
      fs.writeFileSync(uploadPath, buffer);
      finalImagePath = `/uploads/${fileName}`;
    }

    // لاگ برای دیباگ کردن دیتای ارسالی
    console.log("Saving to DB:", {
        questionText,
        options,
        correctOption,
        hasQuestionImage: Boolean(hasQuestionImage),
        finalImagePath
    });

    const stmt = db.prepare(`
      INSERT INTO questions (questionText, options, correctOption, hasQuestionImage, imageUrl)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    // اجرای کوئری و دریافت ID
    const info = stmt.run(
      questionText,
      JSON.stringify(options),
      correctOption,
      Boolean(hasQuestionImage) ? 1 : 0,
      finalImagePath
    );
    
    console.log("Database ID:", info.lastInsertRowid);

    res.json({ 
      success: true, 
      message: 'سوال با موفقیت ذخیره شد.', 
      questionId: info.lastInsertRowid 
    });

  } catch (error) {
    console.error("Database Save Error:", error);
    res.status(500).json({ error: 'خطا در ذخیره اطلاعات در دیتابیس: ' + error.message });
  }
};
