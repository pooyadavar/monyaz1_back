const { normalizeExtractPayload } = require("../utils/normalizeQuestion");
const { HttpsProxyAgent } = require("https-proxy-agent");
const sharp = require("sharp");

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callSuryaOCR = async (pages) => {
  console.log(`Calling Surya OCR for ${pages.length} pages...`);

  try {
    const ocrResults = [];

    for (let i = 0; i < pages.length; i++) {
      const formData = new FormData();
      const blob = new Blob([pages[i].buffer], {
        type: pages[i].mimeType || "image/jpeg",
      });
      formData.append("file", blob, pages[i].name || `page_${i}.jpg`);

      const response = await fetch("http://127.0.0.1:8001/ocr", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        console.error(`Surya OCR failed for page ${i + 1}: ${response.status}`);
        ocrResults.push(null);
        continue;
      }

      const result = await response.json();
      ocrResults.push(result);
      console.log(`Page ${i + 1} OCR completed`);
    }

    return ocrResults;
  } catch (error) {
    console.error("Error calling Surya OCR:", error);
    return pages.map(() => null);
  }
};

const buildMultiPagePrompt = (pageCount) => {
  return `شما یک استخراج‌کننده سوالات امتحانی هستید. ${pageCount} صفحه تصویری از یک آزمون دریافت می‌کنید.
به همراه هر صفحه، مختصات اشکال، نمودارها و جدول‌های موجود در آن صفحه (تحت عنوان Available Images) به شما داده می‌شود.

**مهم**: فقط JSON خام برگردانید. هیچ توضیح، markdown، یا code fence استفاده نکنید.

ساختار خروجی:
{
  "questions": [
    {
      "questionText": "متن سوال به فارسی",
      "options": [
        { "type": "text", "text": "گزینه ۱" },
        { "type": "text", "text": "گزینه ۲" },
        { "type": "text", "text": "گزینه ۳" },
        { "type": "text", "text": "گزینه ۴" }
      ],
      "correctOption": 1,
      "hasQuestionImage": false,
      "questionImageCrop": null,
      "pageIndex": 0
    }
  ]
}

قوانین:
- صفحه آخر معمولاً برگه پاسخنامه حبابی است
- نقشه حبابی RTL:
  * گزینه ۱ = حباب سمت راست
  * گزینه ۲ = دومی از راست
  * گزینه ۳ = سومی از راست
  * گزینه ۴ = حباب سمت چپ
- حباب تیره/پر شده = correctOption
- اگر پاسخنامه یا علامت وجود ندارد: null
- همه فرمول‌ها LaTeX معتبر و استاندارد باشند.
- متن فارسی
- options دقیقاً ۴ آیتم
- برای گزینه‌های تصویری: type="image"
- pageIndex از صفر شروع می‌شود
- بدون markdown یا code fence

قوانین استخراج عکس سوال (بسیار مهم):
- اگر سوالی دارای نمودار، شکل، جدول یا هر المان گرافیکی مربوطه است، حتماً فیلد "hasQuestionImage" را true کنید.
- لیست "Available Images" هر صفحه حاوی آرایه‌های مختصات [x1, y1, x2, y2] است که از مدل لایوت استخراج شده است. بررسی کنید کدام یک از این باکس‌ها متعلق به شکل یا نمودار این سوال است و آن آرایه ۴ عددی را دقیقاً و بدون تغییر در فیلد "questionImageCrop" کپی کنید.
- اگر سوال هیچ شکل یا نموداری ندارد، "hasQuestionImage" برابر false و "questionImageCrop" برابر null باشد.`;
};

const callGemini = async (parts, logLabel = "Gemini") => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const proxyAgent = new HttpsProxyAgent("http://192.168.31.174:10807");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[${logLabel}] Attempt ${attempt}/3...`);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
        }),
        agent: proxyAgent,
      });

      if (!response.ok) {
        const status = response.status;
        const text = await response.text();
        console.error(`[${logLabel}] HTTP ${status}: ${text}`);

        if (RETRYABLE_STATUS_CODES.has(status) && attempt < 3) {
          const backoff = Math.pow(2, attempt) * 1000;
          console.log(`[${logLabel}] Retrying in ${backoff}ms...`);
          await wait(backoff);
          continue;
        }
        throw new Error(`Gemini API error: ${status}`);
      }

      const result = await response.json();
      if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error("Invalid Gemini response structure");
      }
      let rawText = result.candidates[0].content.parts[0].text.trim();
      rawText = rawText.replace(/^`{3}json\s*/i, "").replace(/`{3}\s*$/i, "");

      const parsed = JSON.parse(rawText);
      console.log(`[${logLabel}] Success`);
      return parsed;
    } catch (error) {
      lastError = error;
      console.error(`[${logLabel}] Attempt ${attempt} failed:`, error.message);
      if (attempt < 3) {
        await wait(2000 * attempt);
      }
    }
  }

  throw lastError;
};

const buildPartsFromPages = (pages, promptText, ocrData) => {
  const parts = [{ text: promptText }];

  for (let i = 0; i < pages.length; i++) {
    parts.push({ text: `\n--- صفحه ${i + 1} ---\n` });

    if (ocrData[i]) {
      let ocrMessage = `OCR Text:\n${ocrData[i].full_text || ""}\n`;
      if (ocrData[i].page_images && ocrData[i].page_images.length > 0) {
        ocrMessage += `Available Images in this page:\n${JSON.stringify(ocrData[i].page_images, null, 2)}\n`;
      }
      parts.push({ text: ocrMessage });
    }

    const base64 = pages[i].buffer.toString("base64");
    parts.push({
      inlineData: {
        mimeType: pages[i].mimeType || "image/jpeg",
        data: base64,
      },
    });
  }

  return parts;
};

exports.extractFromPages = async (pages) => {
  if (!pages || pages.length === 0) {
    return [];
  }

  const promptText = buildMultiPagePrompt(pages.length);
  const ocrData = await callSuryaOCR(pages);
  const parts = buildPartsFromPages(pages, promptText, ocrData);

  const parsed = await callGemini(parts, "ExtractFromPages");
  const rawQuestions = parsed.questions || parsed;

  if (Array.isArray(rawQuestions)) {
    for (const question of rawQuestions) {
      if (question.hasQuestionImage && question.questionImageCrop) {
        try {
          if (
            Array.isArray(question.questionImageCrop) &&
            question.questionImageCrop.length === 4
          ) {
            const [x1, y1, x2, y2] = question.questionImageCrop;
            const width = x2 - x1;
            const height = y2 - y1;

            const targetPage = pages[question.pageIndex || 0];

            if (targetPage && width > 0 && height > 0) {
              const croppedBuffer = await sharp(targetPage.buffer)
                .extract({
                  left: Math.max(0, Math.round(x1)),
                  top: Math.max(0, Math.round(y1)),
                  width: Math.round(width),
                  height: Math.round(height),
                })
                .toBuffer();

              const base64Image = `data:image/jpeg;base64,${croppedBuffer.toString("base64")}`;

              question.questionImageCrop = base64Image;
              question.questionImage = base64Image;
              question.image = base64Image;
            }
          }
        } catch (cropError) {
          console.error(
            `[Crop Engine] Failed to crop image for question: ${cropError.message}`,
          );
          question.questionImageCrop = null;
        }
      }
    }
  }

  const normalized = normalizeExtractPayload(parsed, 0);
  const finalQuestions = normalized.questions || normalized;

  if (Array.isArray(finalQuestions) && Array.isArray(rawQuestions)) {
    finalQuestions.forEach((q, idx) => {
      const rawQ = rawQuestions[idx];
      if (rawQ) {
        if (rawQ.hasQuestionImage) {
          q.hasQuestionImage = true;
          q.questionImageCrop = rawQ.questionImageCrop;
          q.questionImage = rawQ.questionImage;
          q.image = rawQ.image;
        }
        if (q.correctOption === null && rawQ.correctOption !== undefined) {
          q.correctOption = rawQ.correctOption;
        }
      }
    });
  }

  console.log(
    "Extracted correctOptions:",
    Array.isArray(finalQuestions)
      ? finalQuestions.map((q) => q.correctOption)
      : [],
  );

  // تمیزکاری دقیق و بدون نقص بک‌آس‌لش‌های اضافه فقط روی فیلدهای متنی سوال و گزینه برای رندر فرمول‌ها در کاتک
  if (Array.isArray(finalQuestions)) {
    finalQuestions.forEach((q) => {
      if (q.questionText) {
        q.questionText = q.questionText.replace(/\\\\/g, "\\");
      }
      if (Array.isArray(q.options)) {
        q.options.forEach((opt) => {
          if (opt.text) {
            opt.text = opt.text.replace(/\\\\/g, "\\");
          }
        });
      }
    });
  }

  return normalized;
};

exports.extractQuestionData = async (imageBuffer, mimeType = "image/jpeg") => {
  const pages = [{ buffer: imageBuffer, mimeType }];
  return exports.extractFromPages(pages);
};
