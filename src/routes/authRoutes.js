const express = require("express");
const authController = require("../controllers/authController");
const authRequired = require("../middlewares/auth");

const router = express.Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/me", authRequired, authController.me);

module.exports = router;
