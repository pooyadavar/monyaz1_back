const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const questionController = require('../controllers/questionController');

// روت برای گرفتن عکس خام و ارسال به جمینای
router.post('/extract', upload.single('image'), questionController.extractData);

// روت برای ذخیره نهایی در دیتابیس
router.post('/save', questionController.saveQuestion);

module.exports = router;