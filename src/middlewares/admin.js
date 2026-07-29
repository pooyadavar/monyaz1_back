const adminRequired = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, error: "دسترسی ادمین لازم است." });
  }
  return next();
};

module.exports = adminRequired;
