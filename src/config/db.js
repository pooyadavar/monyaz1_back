const Database = require('better-sqlite3');
const path = require('path');


const dbPath = path.join(__dirname, '../../../database.sqlite');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    questionText TEXT NOT NULL,
    options TEXT NOT NULL, -- ما آرایه گزینه‌ها رو به شکل JSON String ذخیره می‌کنیم
    correctOption INTEGER NOT NULL,
    hasQuestionImage INTEGER NOT NULL DEFAULT 0,
    imageUrl TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fullName TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS extraction_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    title TEXT,
    originalFilename TEXT,
    fileMime TEXT,
    moniazJobId TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    aiOutputJson TEXT,
    aiOutputText TEXT,
    currentOutputJson TEXT,
    currentOutputText TEXT,
    errorJson TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS edit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    beforeText TEXT,
    afterText TEXT NOT NULL,
    diffJson TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sessionId) REFERENCES extraction_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_extraction_sessions_user_updated
    ON extraction_sessions(userId, updatedAt DESC);

  CREATE INDEX IF NOT EXISTS idx_extraction_sessions_moniaz_job
    ON extraction_sessions(moniazJobId);

  CREATE INDEX IF NOT EXISTS idx_edit_events_session_created
    ON edit_events(sessionId, createdAt ASC);
`);

const questionColumns = db.prepare(`PRAGMA table_info(questions)`).all();
const hasQuestionImageColumn = questionColumns.some((column) => column.name === 'hasQuestionImage');

if (!hasQuestionImageColumn) {
  db.exec(`ALTER TABLE questions ADD COLUMN hasQuestionImage INTEGER NOT NULL DEFAULT 0`);
}

const extractionColumns = db.prepare(`PRAGMA table_info(extraction_sessions)`).all();
const hasCurrentOutputJsonColumn = extractionColumns.some((column) => column.name === 'currentOutputJson');

if (!hasCurrentOutputJsonColumn) {
  db.exec(`ALTER TABLE extraction_sessions ADD COLUMN currentOutputJson TEXT`);
}

module.exports = db;
