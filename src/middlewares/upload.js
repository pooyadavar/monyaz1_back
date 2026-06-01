const multer = require("multer");

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("فقط فایل‌های تصویری پشتیبانی می‌شوند."));
  },
});

module.exports = upload;
