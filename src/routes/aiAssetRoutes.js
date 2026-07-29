const express = require("express");
const { getApiBase } = require("../services/moniazAiClient");

const router = express.Router();

router.get("/:fileId", async (req, res) => {
  try {
    const response = await fetch(`${getApiBase()}/assets/${encodeURIComponent(req.params.fileId)}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: "asset not found" });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(buffer);
  } catch (error) {
    console.error("AI asset proxy error:", error);
    return res.status(502).json({ error: "خطا در دریافت تصویر از سرویس هوش مصنوعی." });
  }
});

module.exports = router;
