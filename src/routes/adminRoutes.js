const express = require("express");
const adminController = require("../controllers/adminController");
const adminRequired = require("../middlewares/admin");
const authRequired = require("../middlewares/auth");

const router = express.Router();

router.use(authRequired, adminRequired);

router.get("/stats", adminController.stats);
router.get("/sessions", adminController.listSessions);
router.get("/sessions/:sessionId", adminController.getSession);
router.get("/sessions/:sessionId/edits", adminController.listSessionEdits);

module.exports = router;
