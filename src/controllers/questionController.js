const fs = require("fs");
const path = require("path");
const db = require("../config/db");

const UPLOADS_DIR = path.join(__dirname, "../../uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const getUploadedFiles = (req) => {
  if (req.files?.files?.length) {
    return req.files.files;
  }

  if (req.files?.image?.length) {
    return req.files.image;
  }

  if (Array.isArray(req.files) && req.files.length > 0) {
    return req.files;
  }

  if (req.file) {
    return [req.file];
  }

  return [];
};

const saveBase64Image = (base64Image, prefix) => {
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const fileName = `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e6)}.jpg`;
  const uploadPath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(uploadPath, buffer);
  return `/uploads/${fileName}`;
};

const persistQuestion = ({
  questionText,
  options,
  correctOption,
  hasQuestionImage,
  questionImage,
}) => {
  let finalImagePath = null;

  if (hasQuestionImage && questionImage) {
    finalImagePath = saveBase64Image(questionImage, "question");
  }

  const stmt = db.prepare(`
    INSERT INTO questions (questionText, options, correctOption, hasQuestionImage, imageUrl)
    VALUES (?, ?, ?, ?, ?)
  `);

  return stmt.run(
    questionText,
    JSON.stringify(options),
    correctOption,
    hasQuestionImage ? 1 : 0,
    finalImagePath,
  );
};

exports.extractData = async (req, res) => {
  try {
    if (process.env.ENABLE_LEGACY_GEMINI_EXTRACT !== "1") {
      return res.status(410).json({
        success: false,
        errorCode: "LEGACY_EXTRACT_DISABLED",
        error:
          "مسیر قدیمی Gemini غیرفعال است. استخراج جدید باید از moniaz-ai-services انجام شود.",
        nextEndpoint: "/api/extractions",
      });
    }

    const files = getUploadedFiles(req);

    console.log("Extract request received:", {
      fileCount: files.length,
      names: files.map((file) => file.originalname),
    });

    if (files.length === 0) {
      return res.status(400).json({ error: "هیچ فایلی ارسال نشده است." });
    }

    const pages = files.map((file) => ({
      buffer: file.buffer,
      mimeType: file.mimetype,
      name: file.originalname,
    }));

    const geminiService = require("../services/geminiService");
    const extraction = await geminiService.extractFromPages(pages);
    const questions = extraction.questions || extraction;

    res.json({
      success: true,
      data: {
        questions,
        answerKey: extraction.answerKey || { source: "gemini" },
      },
    });
  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    res.status(500).json({
      error: "خطا در ارتباط با هوش مصنوعی.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};

exports.saveQuestion = (req, res) => {
  try {
    if (process.env.ENABLE_LEGACY_QUESTION_SAVE !== "1") {
      return res.status(410).json({
        success: false,
        errorCode: "LEGACY_SAVE_DISABLED",
        error:
          "مسیر ذخیره قدیمی غیرفعال است. ذخیره جدید از extraction sessions و autosave انجام می‌شود.",
      });
    }

    const {
      questionText,
      options,
      correctOption,
      hasQuestionImage,
      questionImage,
      optionImages,
    } = req.body;

    const normalizedOptions = Array.isArray(options) ? [...options] : [];
    const images = Array.isArray(optionImages) ? optionImages : [];

    normalizedOptions.forEach((option, index) => {
      if (option?.type === "image" && images[index]) {
        normalizedOptions[index] = {
          type: "image",
          text: option.text || "",
          imageUrl: saveBase64Image(images[index], `option_${index + 1}`),
        };
      }
    });

    const info = persistQuestion({
      questionText,
      options: normalizedOptions,
      correctOption,
      hasQuestionImage: Boolean(hasQuestionImage),
      questionImage,
    });

    res.json({
      success: true,
      message: "سوال با موفقیت ذخیره شد.",
      questionId: info.lastInsertRowid,
    });
  } catch (error) {
    console.error("Database Save Error:", error);
    res.status(500).json({ error: "خطا در ذخیره اطلاعات در دیتابیس: " + error.message });
  }
};

exports.saveQuestionsBatch = (req, res) => {
  try {
    if (process.env.ENABLE_LEGACY_QUESTION_SAVE !== "1") {
      return res.status(410).json({
        success: false,
        errorCode: "LEGACY_SAVE_DISABLED",
        error:
          "مسیر ذخیره قدیمی غیرفعال است. ذخیره جدید از extraction sessions و autosave انجام می‌شود.",
      });
    }

    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "لیست سوالات خالی است." });
    }

    const savedIds = questions.map((item) => {
      const normalizedOptions = Array.isArray(item.options) ? [...item.options] : [];
      const images = Array.isArray(item.optionImages) ? item.optionImages : [];

      normalizedOptions.forEach((option, index) => {
        if (option?.type === "image" && images[index]) {
          normalizedOptions[index] = {
            type: "image",
            text: option.text || "",
            imageUrl: saveBase64Image(images[index], `option_${index + 1}`),
          };
        }
      });

      const info = persistQuestion({
        questionText: item.questionText,
        options: normalizedOptions,
        correctOption: item.correctOption,
        hasQuestionImage: Boolean(item.hasQuestionImage),
        questionImage: item.questionImage,
      });

      return info.lastInsertRowid;
    });

    res.json({
      success: true,
      message: `${savedIds.length} سوال ذخیره شد.`,
      questionIds: savedIds,
    });
  } catch (error) {
    console.error("Batch Save Error:", error);
    res.status(500).json({ error: "خطا در ذخیره دسته‌ای: " + error.message });
  }
};
