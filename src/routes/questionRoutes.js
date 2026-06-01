const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const questionController = require('../controllers/questionController');

const extractUpload = upload.fields([
  { name: 'files', maxCount: 30 },
  { name: 'image', maxCount: 1 },
]);

router.post('/extract', extractUpload, questionController.extractData);
router.post('/save', questionController.saveQuestion);
router.post('/save-batch', questionController.saveQuestionsBatch);

module.exports = router;
