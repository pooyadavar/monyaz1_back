const db = require("../config/db");
const {
  createTestingJob,
  getTestingJobResult,
  getTestingJobStatus,
} = require("../services/moniazAiClient");
const { questionObjectToText } = require("../utils/questionObjectToText");

const buildSessionTitle = (filename) => {
  const clean = String(filename || "فایل جدید").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
};

const repairFilename = (filename) => {
  const raw = String(filename || "").trim();
  if (!raw) return raw;
  if (!/[ØÙÃÂï]/.test(raw)) return raw;
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8").trim();
    return repaired.includes("�") ? raw : repaired;
  } catch {
    return raw;
  }
};

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getOwnedSession = (sessionId, userId) =>
  db
    .prepare(
      `SELECT *
       FROM extraction_sessions
       WHERE id = ? AND userId = ?`,
    )
    .get(sessionId, userId);

const publicSession = (session, { includeOutput = false } = {}) => {
  const body = {
    id: session.id,
    title: session.title,
    originalFilename: session.originalFilename,
    fileMime: session.fileMime,
    moniazJobId: session.moniazJobId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };

  if (includeOutput) {
    body.aiOutputJson = parseJson(session.aiOutputJson);
    body.aiOutputText = session.aiOutputText || "";
    body.currentOutputJson = parseJson(session.currentOutputJson);
    body.currentOutputText = session.currentOutputText || "";
    body.errorJson = parseJson(session.errorJson);
  }

  return body;
};

const persistAiResult = (session, resultEnvelope) => {
  const aiOutputJson = resultEnvelope.result || resultEnvelope;
  const aiOutputText = questionObjectToText(aiOutputJson);
  const currentOutputJson = session.currentOutputJson || JSON.stringify(aiOutputJson);
  const currentOutputText = session.currentOutputText || aiOutputText;

  db.prepare(
    `UPDATE extraction_sessions
     SET status = ?,
         aiOutputJson = ?,
         aiOutputText = ?,
         currentOutputJson = ?,
         currentOutputText = ?,
         updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(
    resultEnvelope.status || "done",
    JSON.stringify(aiOutputJson),
    aiOutputText,
    currentOutputJson,
    currentOutputText,
    session.id,
  );
};

const syncSessionStatus = async (session) => {
  const statusEnvelope = await getTestingJobStatus(session.moniazJobId);
  const nextStatus = statusEnvelope.status || session.status;
  const nextErrorJson = statusEnvelope.error ? JSON.stringify(statusEnvelope.error) : session.errorJson;

  if (nextStatus !== session.status || nextErrorJson !== session.errorJson) {
    db.prepare(
      `UPDATE extraction_sessions
       SET status = ?,
           errorJson = ?,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(nextStatus, nextErrorJson, session.id);
  }

  if (nextStatus === "done" && !session.aiOutputJson) {
    const resultEnvelope = await getTestingJobResult(session.moniazJobId);
    persistAiResult({ ...session, status: nextStatus }, resultEnvelope);
  }

  return getOwnedSession(session.id, session.userId);
};

exports.createExtraction = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "هیچ فایلی ارسال نشده است." });
    }
    const originalName = repairFilename(file.originalname);

    const aiJob = await createTestingJob({
      file: { ...file, originalname: originalName || file.originalname },
      subject: req.body.subject,
      grade: req.body.grade,
    });

    const jobId = aiJob.job_id || aiJob.jobId;
    if (!jobId) {
      return res.status(502).json({
        success: false,
        error: "پاسخ moniaz-ai-services فاقد job_id است.",
        details: aiJob,
      });
    }

    const info = db
      .prepare(
        `INSERT INTO extraction_sessions (
          userId,
          title,
          originalFilename,
          fileMime,
          moniazJobId,
          status
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.user.id,
        buildSessionTitle(originalName),
        originalName || null,
        file.mimetype || null,
        jobId,
        aiJob.status || "queued",
      );

    return res.status(202).json({
      success: true,
      sessionId: info.lastInsertRowid,
      jobId,
      status: aiJob.status || "queued",
      createdAt: aiJob.created_at,
    });
  } catch (error) {
    console.error("Create extraction error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: "خطا در ایجاد درخواست استخراج.",
      details: process.env.NODE_ENV === "production" ? undefined : error.details || error.message,
    });
  }
};

exports.listExtractions = (req, res) => {
  const rows = db
    .prepare(
      `SELECT *
       FROM extraction_sessions
       WHERE userId = ?
       ORDER BY updatedAt DESC, id DESC`,
    )
    .all(req.user.id);

  return res.json({
    success: true,
    sessions: rows.map((row) => publicSession(row)),
  });
};

exports.getExtraction = (req, res) => {
  const session = getOwnedSession(req.params.sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ success: false, error: "درخواست یافت نشد." });
  }

  return res.json({
    success: true,
    session: publicSession(session, { includeOutput: true }),
  });
};

exports.getExtractionStatus = async (req, res) => {
  try {
    const session = getOwnedSession(req.params.sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: "درخواست یافت نشد." });
    }

    if (!session.moniazJobId) {
      return res.status(409).json({ success: false, error: "این درخواست job معتبر ندارد." });
    }

    const synced = await syncSessionStatus(session);

    return res.json({
      success: true,
      session: publicSession(synced, { includeOutput: true }),
    });
  } catch (error) {
    console.error("Extraction status error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: "خطا در دریافت وضعیت استخراج.",
      details: process.env.NODE_ENV === "production" ? undefined : error.details || error.message,
    });
  }
};

exports.updateExtractionContent = (req, res) => {
  const session = getOwnedSession(req.params.sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ success: false, error: "درخواست یافت نشد." });
  }

  const content = String(req.body.content ?? "");
  const contentJson = req.body.contentJson === undefined ? undefined : req.body.contentJson;
  const beforeText = session.currentOutputText || "";
  const beforeJson = session.currentOutputJson || "";

  if (content === beforeText && contentJson === undefined) {
    return res.json({
      success: true,
      session: publicSession(session, { includeOutput: true }),
      changed: false,
    });
  }

  const diffJson = JSON.stringify({
    beforeLength: beforeText.length,
    afterLength: content.length,
    deltaLength: content.length - beforeText.length,
    beforeJsonLength: beforeJson.length,
    afterJsonLength: contentJson === undefined ? beforeJson.length : JSON.stringify(contentJson).length,
  });

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE extraction_sessions
       SET currentOutputText = ?,
           currentOutputJson = COALESCE(?, currentOutputJson),
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      content,
      contentJson === undefined ? null : JSON.stringify(contentJson),
      session.id,
    );

    db.prepare(
      `INSERT INTO edit_events (
        sessionId,
        userId,
        beforeText,
        afterText,
        diffJson
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(session.id, req.user.id, beforeText, content, diffJson);
  });

  tx();
  const updated = getOwnedSession(session.id, req.user.id);

  return res.json({
    success: true,
    session: publicSession(updated, { includeOutput: true }),
    changed: true,
  });
};
