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
    hasQuestionImage INTEGER NOT NULL DEFAULT 0,
    imageUrl TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const questionColumns = db.prepare(`PRAGMA table_info(questions)`).all();
const hasQuestionImageColumn = questionColumns.some((column) => column.name === 'hasQuestionImage');

if (!hasQuestionImageColumn) {
  db.exec(`ALTER TABLE questions ADD COLUMN hasQuestionImage INTEGER NOT NULL DEFAULT 0`);
}

module.exports = db;
