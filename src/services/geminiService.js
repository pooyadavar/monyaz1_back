const { normalizeExtractPayload } = require("../utils/normalizeQuestion");

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EXTRACTION_PROMPT = `Extract every exam question visible in this image and return raw JSON only.

The JSON shape must be exactly:
{
  "questions": [
    {
      "questionText": "Persian question text without answer options",
      "options": [
        { "type": "text", "text": "option text" },
        { "type": "image", "text": "", "imageCrop": { "x": 0, "y": 0, "width": 0, "height": 0 } }
      ],
      "correctOption": 1,
      "hasQuestionImage": false,
      "questionImageCrop": null
    }
  ]
}

Rules:
- Use Persian text.
- Return one item in questions[] per distinct question on the page. If there is only one question, still use an array with one object.
- options must contain exactly 4 items.
- correctOption is a number from 1 to 4. If the answer is not visible, use 1.
- For each option, set type to "image" only when that option is primarily a diagram, figure, formula image, chart, or visual choice instead of plain text. Otherwise use type "text".
- When an option has type "image", imageCrop must bound only that option's visual on the uploaded image (percentages 0-100: x, y, width, height). text can be empty.
- hasQuestionImage must be true only when the question stem/body contains a separate diagram, chart, figure, table, formula image, or visual that should be saved with the question (not the whole page and not the options).
- If hasQuestionImage is false, questionImageCrop must be null.
- If hasQuestionImage is true, questionImageCrop must bound only that stem visual with comfortable margin (not tight).
- All coordinates are percentages 0-100 relative to THIS image only (single page).
- Do not include pageIndex, markdown, explanations, or code fences.`;

exports.extractQuestionData = async (imageBuffer, mimeType, pageIndex = 0) => {
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  const apiKey = process.env.GEMINI_API_KEY;
  const proxyAgent = new HttpsProxyAgent("http://192.168.1.4:10807");

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: EXTRACTION_PROMPT },
          {
            inlineData: {
              mimeType,
              data: imageBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
  };

  let response;
  let errorText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Calling Gemini ${model}, page ${pageIndex}, attempt ${attempt}/3`);

    response = await fetch(url, {
      method: "POST",
      agent: proxyAgent,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

  const parsed = JSON.parse(responseText);
  return normalizeExtractPayload(parsed, pageIndex);
};

exports.extractFromPages = async (pages) => {
  const allQuestions = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const questions = await exports.extractQuestionData(
      page.buffer,
      page.mimeType,
      pageIndex,
    );

    questions.forEach((question) => {
      allQuestions.push({ ...question, pageIndex });
    });
  }

  return allQuestions;
};
