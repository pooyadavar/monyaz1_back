const db = require("../config/db");

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const publicAdminSession = (row, { includeOutput = false } = {}) => {
  const body = {
    id: row.id,
    userId: row.userId,
    operatorName: row.operatorName,
    operatorPhone: row.operatorPhone,
    title: row.title,
    originalFilename: row.originalFilename,
    fileMime: row.fileMime,
    moniazJobId: row.moniazJobId,
    status: row.status,
    editCount: row.editCount || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  if (includeOutput) {
    body.aiOutputJson = parseJson(row.aiOutputJson);
    body.aiOutputText = row.aiOutputText || "";
    body.currentOutputText = row.currentOutputText || "";
    body.errorJson = parseJson(row.errorJson);
  }

  return body;
};

exports.listSessions = (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         s.*,
         u.fullName AS operatorName,
         u.phone AS operatorPhone,
         COUNT(e.id) AS editCount
       FROM extraction_sessions s
       JOIN users u ON u.id = s.userId
       LEFT JOIN edit_events e ON e.sessionId = s.id
       GROUP BY s.id
       ORDER BY s.updatedAt DESC, s.id DESC
       LIMIT 200`,
    )
    .all();

  return res.json({
    success: true,
    sessions: rows.map((row) => publicAdminSession(row)),
  });
};

exports.getSession = (req, res) => {
  const row = db
    .prepare(
      `SELECT
         s.*,
         u.fullName AS operatorName,
         u.phone AS operatorPhone,
         COUNT(e.id) AS editCount
       FROM extraction_sessions s
       JOIN users u ON u.id = s.userId
       LEFT JOIN edit_events e ON e.sessionId = s.id
       WHERE s.id = ?
       GROUP BY s.id`,
    )
    .get(req.params.sessionId);

  if (!row) {
    return res.status(404).json({ success: false, error: "درخواست یافت نشد." });
  }

  return res.json({
    success: true,
    session: publicAdminSession(row, { includeOutput: true }),
  });
};

exports.listSessionEdits = (req, res) => {
  const session = db
    .prepare("SELECT id FROM extraction_sessions WHERE id = ?")
    .get(req.params.sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: "درخواست یافت نشد." });
  }

  const edits = db
    .prepare(
      `SELECT
         e.id,
         e.sessionId,
         e.userId,
         u.fullName AS operatorName,
         u.phone AS operatorPhone,
         e.beforeText,
         e.afterText,
         e.diffJson,
         e.createdAt
       FROM edit_events e
       JOIN users u ON u.id = e.userId
       WHERE e.sessionId = ?
       ORDER BY e.createdAt ASC, e.id ASC`,
    )
    .all(req.params.sessionId)
    .map((row) => ({
      ...row,
      diffJson: parseJson(row.diffJson),
    }));

  return res.json({
    success: true,
    edits,
  });
};

exports.stats = (_req, res) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS sessionCount,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneCount,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
       FROM extraction_sessions`,
    )
    .get();

  const editStats = db
    .prepare(
      `SELECT
         COUNT(*) AS editCount,
         COUNT(DISTINCT sessionId) AS editedSessionCount
       FROM edit_events`,
    )
    .get();

  return res.json({
    success: true,
    stats: {
      ...totals,
      ...editStats,
    },
  });
};
