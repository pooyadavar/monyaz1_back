const Database = require('better-sqlite3');
const path = require('path');

// ساخت یک فایل دیتابیس در روت پروژه
const dbPath = path.join(__dirname, '../../../database.sqlite');
const db = new Database(dbPath);

// ساخت جدول سوالات
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    questionText TEXT NOT NULL,
    options TEXT NOT NULL, -- ما آرایه گزینه‌ها رو به شکل JSON String ذخیره می‌کنیم
    correctOption INTEGER NOT NULL,
    imageUrl TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;