const { normalizeExtractPayload } = require("../utils/normalizeQuestion");

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildMultiPagePrompt = (
  pageCount,
) => `You receive ${pageCount} exam page image(s) in order (Page 1 = first upload, Page ${pageCount} = last upload).
Return raw JSON only with this exact shape:
{
  "questions": [
    {
      "questionText": "Persian question stem only",
      "options": [
        { "type": "text", "text": "..." },
        { "type": "image", "text": "", "imageCrop": { "x": 0, "y": 0, "width": 0, "height": 0 } }
      ],
      "correctOption": 3,
      "hasQuestionImage": false,
      "questionImageCrop": null,
      "pageIndex": 0
    }
  ]
}

CRITICAL — correctOption (answer key / bubble sheet):
- The LAST page is very often a bubble answer sheet: each ROW = one question number.
- IMPORTANT RTL RULE: Persian bubble sheets are Right-to-Left. 
  * Option 1 = RIGHTMOST bubble
  * Option 2 = Second bubble from the right
  * Option 3 = Third bubble from the right
  * Option 4 = LEFTMOST bubble
- The FILLED, DARK, or MARKED bubble in a row = correctOption for that question number based strictly on the Right-to-Left rule above.
- You MUST read the answer sheet and set correctOption for EVERY question by matching the question number to the filled bubble. Double check your column tracking.
- Do NOT default to 1. Do NOT copy the example value. Only use 1–4 based on the filled bubble.
- If a question appears on an earlier page, still take correctOption from the answer sheet row with the same question number.
- If there is truly no answer sheet and no visible correct mark anywhere, set correctOption to null.

MATHEMATICS — LaTeX (required for formulas):
- Any math (roots, fractions, powers, limits, trig, Greek letters, matrices, etc.) MUST be valid LaTeX inside delimiters.
- Inline math: wrap with $...$ e.g. $\\sqrt{3}$, $\\frac{1}{2}$, $x^2-4x$, $\\lim_{x \\to 0} f(x)$
- Display/block math (long equations): wrap with $$...$$
- Keep Persian words OUTSIDE the dollar signs; only the formula inside.
- Do NOT output broken Unicode math (like √2, x² alone) when LaTeX is possible — use $\\sqrt{2}$, $x^2$
- In JSON strings escape backslashes: write \\\\frac{a}{b} for \\frac{a}{b}

Other rules:
- Use Persian text.
- One questions[] entry per distinct question (all pages combined).
- pageIndex = zero-based index of the page where that question's stem appears (0 = Page 1).
- Do not put question numbers (۱.) in questionText; do not put option labels (۱), الف) in option text.
- options: exactly 4 items.
- type "image" for options that are primarily diagrams/figures; include imageCrop as percentages 0–100 on that option's page.
- hasQuestionImage + questionImageCrop only for diagrams in the question stem (not whole page, not options).
- No markdown, no code fences, no explanations.`;


const callGemini = async (parts, logLabel) => {
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  const apiKey = process.env.GEMINI_API_KEY;
  const proxyAgent = new HttpsProxyAgent("http://192.168.31.174:10807");

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let response;
  let errorText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Calling Gemini ${model}, ${logLabel}, attempt ${attempt}/3`);

    response = await fetch(url, {
      method: "POST",
      agent: proxyAgent,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    if (response.ok) {
      break;
    }

    errorText = await response.text();

    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === 3) {
      break;
    }

    await wait(attempt * 1000);
  }

  if (!response || !response.ok) {
    throw new Error(`Google API Error (${response?.status}): ${errorText}`);
  }

  const result = await response.json();
  const responseText = result.candidates[0].content.parts[0].text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(responseText);
};

const buildPartsFromPages = (pages, promptText) => {
  const parts = [{ text: promptText }];

  pages.forEach((page, index) => {
    parts.push({
      text: `--- Page ${index + 1} of ${pages.length}${page.name ? ` (${page.name})` : ""} ---`,
    });
    parts.push({
      inlineData: {
        mimeType: page.mimeType,
        data: page.buffer.toString("base64"),
      },
    });
  });

  return parts;
};

/** همه صفحات در یک درخواست تا پاسخنامه آخر دیده شود */
exports.extractFromPages = async (pages) => {
  if (!pages.length) {
    return [];
  }

  const prompt = buildMultiPagePrompt(pages.length);
  const parts = buildPartsFromPages(pages, prompt);
  const parsed = await callGemini(parts, `${pages.length} page(s) batch`);

  const questions = normalizeExtractPayload(parsed, 0);

  console.log(
    "Extracted correctOption values:",
    questions.map((q, i) => ({
      i,
      correctOption: q.correctOption,
      pageIndex: q.pageIndex,
    })),
  );

  return questions;
};

/** تک‌صفحه — همان مسیر batch با یک تصویر */
exports.extractQuestionData = async (imageBuffer, mimeType, pageIndex = 0) => {
  const pages = [
    { buffer: imageBuffer, mimeType, name: `page-${pageIndex + 1}` },
  ];
  const questions = await exports.extractFromPages(pages);
  return questions.map((q) => ({ ...q, pageIndex: q.pageIndex ?? pageIndex }));
};
