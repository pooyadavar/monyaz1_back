const normalizeExtractedData = (data) => {
  const hasQuestionImage = Boolean(data.hasQuestionImage);
  const rawCrop = data.questionImageCrop || data.imageCrop || null;
  let crop = null;

  if (
    hasQuestionImage &&
    rawCrop &&
    Number.isFinite(Number(rawCrop.x)) &&
    Number.isFinite(Number(rawCrop.y)) &&
    Number.isFinite(Number(rawCrop.width)) &&
    Number.isFinite(Number(rawCrop.height))
  ) {
    const x = Math.max(0, Math.min(100, Number(rawCrop.x)));
    const y = Math.max(0, Math.min(100, Number(rawCrop.y)));

    crop = {
      x,
      y,
      width: Math.max(0, Math.min(100 - x, Number(rawCrop.width))),
      height: Math.max(0, Math.min(100 - y, Number(rawCrop.height))),
    };
  }

  return {
    questionText: data.questionText || "",
    options: Array.isArray(data.options) ? data.options.slice(0, 4) : [],
    correctOption: Number(data.correctOption) || 1,
    hasQuestionImage,
    questionImageCrop: crop,
  };
};

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.extractQuestionData = async (imageBuffer, mimeType) => {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const apiKey = process.env.GEMINI_API_KEY;
  const proxyAgent = new HttpsProxyAgent('http://192.168.1.4:10807');

  // ۱. نام مدلی که ۱۰۰٪ در لیستِ سیستمِ تو وجود دارد را انتخاب کن
  // از لیست مدل‌هایی که قبلاً بهت داد، "gemini-2.5-flash" یا "gemini-flash-latest" را تست کن
  const model = "gemini-2.5-flash"; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ 
      parts: [
        {
          text: `Extract the exam question from this image and return raw JSON only.
The JSON shape must be exactly:
{
  "questionText": "Persian question text without answer options",
  "options": ["option 1", "option 2", "option 3", "option 4"],
  "correctOption": 1,
  "hasQuestionImage": true,
  "questionImageCrop": { "x": 0, "y": 0, "width": 0, "height": 0 }
}

Rules:
- Use Persian text.
- correctOption is a number from 1 to 4. If the answer is not visible, use 1.
- hasQuestionImage must be true only when the body of the question contains a separate diagram, chart, figure, table, formula image, or visual element that should be saved with the question.
- If hasQuestionImage is false, questionImageCrop must be null.
- If hasQuestionImage is true, questionImageCrop must be the bounding box of only that visual element, not the whole page and not the text/options.
- questionImageCrop values are percentages from 0 to 100 relative to the full uploaded image: x, y, width, height.
- Do not include markdown, explanations, or code fences.`
        }, 
        { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
      ] 
    }]
  };

  let response;
  let errorText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Calling Gemini ${model}, attempt ${attempt}/3`);

    response = await fetch(url, {
      method: "POST",
      agent: proxyAgent,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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
    throw new Error(`Google API Error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const responseText = result.candidates[0].content.parts[0].text
    .replace(/```json/g, '').replace(/```/g, '').trim();

  return normalizeExtractedData(JSON.parse(responseText));
};
