const multer = require('multer');

// ذخیره در مموری برای ارسال سریع به هوش مصنوعی
const storage = multer.memoryStorage();
const upload = multer({ storage });

module.exports = upload;