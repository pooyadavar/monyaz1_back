const db = require("../config/db");
const {
  hashPassword,
  signToken,
  verifyPassword,
} = require("../services/authService");

const normalizePhone = (value) => String(value || "").trim();

const publicUser = (user) => ({
  id: user.id,
  fullName: user.fullName,
  phone: user.phone,
  role: user.role,
});

const issueAuthResponse = (user) => ({
  success: true,
  token: signToken({ sub: user.id, phone: user.phone, role: user.role }),
  user: publicUser(user),
});

const roleForPhone = (phone) =>
  phone && phone === process.env.ADMIN_PHONE ? "admin" : "operator";

exports.register = (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (!fullName || fullName.length < 2) {
      return res.status(422).json({ success: false, error: "نام و نام خانوادگی معتبر نیست." });
    }
    if (!phone || phone.length < 8) {
      return res.status(422).json({ success: false, error: "شماره تلفن معتبر نیست." });
    }
    if (password.length < 6) {
      return res.status(422).json({ success: false, error: "پسورد باید حداقل ۶ کاراکتر باشد." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
    if (existing) {
      return res.status(409).json({ success: false, error: "این شماره تلفن قبلا ثبت شده است." });
    }

    const info = db
      .prepare(
        `INSERT INTO users (fullName, phone, passwordHash, role)
         VALUES (?, ?, ?, ?)`,
      )
      .run(fullName, phone, hashPassword(password), roleForPhone(phone));

    const user = db
      .prepare("SELECT id, fullName, phone, role FROM users WHERE id = ?")
      .get(info.lastInsertRowid);

    return res.status(201).json(issueAuthResponse(user));
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ success: false, error: "خطا در ثبت‌نام." });
  }
};

exports.login = (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    const user = db
      .prepare("SELECT id, fullName, phone, passwordHash, role FROM users WHERE phone = ?")
      .get(phone);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ success: false, error: "شماره تلفن یا پسورد اشتباه است." });
    }

    return res.json(issueAuthResponse(user));
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, error: "خطا در ورود." });
  }
};

exports.me = (req, res) => {
  return res.json({
    success: true,
    user: publicUser(req.user),
  });
};
