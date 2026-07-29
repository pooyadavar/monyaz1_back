const express = require("express");
const extractionController = require("../controllers/extractionController");
const authRequired = require("../middlewares/auth");
const upload = require("../middlewares/upload");

const router = express.Router();

router.get("/", authRequired, extractionController.listExtractions);
router.post("/", authRequired, upload.single("file"), extractionController.createExtraction);
router.get("/:sessionId", authRequired, extractionController.getExtraction);
router.get("/:sessionId/status", authRequired, extractionController.getExtractionStatus);
router.patch("/:sessionId/content", authRequired, extractionController.updateExtractionContent);

module.exports = router;
