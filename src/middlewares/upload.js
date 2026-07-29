const multer = require("multer");

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("فقط PDF، PNG و JPG پشتیبانی می‌شوند."));
  },
});

module.exports = upload;
