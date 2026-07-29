const db = require("../config/db");
const { verifyToken } = require("../services/authService");

const authRequired = (req, res, next) => {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ success: false, error: "ورود لازم است." });
  }

  const payload = verifyToken(match[1]);
  if (!payload?.sub) {
    return res.status(401).json({ success: false, error: "نشست نامعتبر یا منقضی است." });
  }

  const user = db
    .prepare("SELECT id, fullName, phone, role FROM users WHERE id = ?")
    .get(payload.sub);

  if (!user) {
    return res.status(401).json({ success: false, error: "کاربر یافت نشد." });
  }

  req.user = user;
  return next();
};

module.exports = authRequired;
