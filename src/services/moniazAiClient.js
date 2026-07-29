const getApiBase = () => {
  const base = (process.env.MONIAZ_AI_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
  const prefix = (process.env.MONIAZ_AI_API_PREFIX || "/ai/v1").replace(/^\/?/, "/").replace(/\/+$/, "");
  return `${base}${prefix}`;
};

const readErrorBody = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const createTestingJob = async ({ file, subject, grade }) => {
  const formData = new FormData();
  const blob = new Blob([file.buffer], {
    type: file.mimetype || "application/octet-stream",
  });

  formData.append("file", blob, file.originalname || "upload.bin");
  if (subject) formData.append("subject", String(subject));
  if (grade !== undefined && grade !== null && grade !== "") {
    formData.append("grade", String(grade));
  }

  const response = await fetch(`${getApiBase()}/testing/jobs`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const details = await readErrorBody(response);
    const error = new Error("moniaz-ai-services testing job failed");
    error.statusCode = response.status;
    error.details = details;
    throw error;
  }

  return response.json();
};

const requestJson = async (path) => {
  const response = await fetch(`${getApiBase()}${path}`);

  if (!response.ok) {
    const details = await readErrorBody(response);
    const error = new Error("moniaz-ai-services request failed");
    error.statusCode = response.status;
    error.details = details;
    throw error;
  }

  return response.json();
};

const getTestingJobStatus = async (jobId) =>
  requestJson(`/testing/jobs/${encodeURIComponent(jobId)}`);

const getTestingJobResult = async (jobId) =>
  requestJson(`/testing/jobs/${encodeURIComponent(jobId)}/result`);

const getAiHealth = async () => requestJson("/health");

module.exports = {
  createTestingJob,
  getAiHealth,
  getApiBase,
  getTestingJobResult,
  getTestingJobStatus,
};
