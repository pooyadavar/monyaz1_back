const { normalizeExtractPayload } = require("../utils/normalizeQuestion");
const { HttpsProxyAgent } = require("https-proxy-agent");
const sharp = require("sharp");

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_GEMINI_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 64000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getExponentialBackoffMs = (attempt, retryAfterHeader) => {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }

  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
};

const SURYA_BASE_URL = "http://127.0.0.1:8001";
const MIN_OPENCV_CONFIDENCE = 0.87;

const normalizeAnswerKeyAnswers = (answers) => {
  if (!Array.isArray(answers) || answers.length === 0) {
    return answers;
  }

  let normalized = [...answers];

  // ۱۱ = ۱۰ سوال + ردیف برچسب ۱۲۳۴ بالای grid
  if (normalized.length === 11) {
    normalized = normalized.slice(1);
  }

  return normalized;
};

const callAnswerKeyExtraction = async (pages) => {
  let bestMatch = null;

  for (let i = pages.length - 1; i >= 0; i--) {
    try {
      const formData = new FormData();
      const blob = new Blob([pages[i].buffer], {
        type: pages[i].mimeType || "image/jpeg",
      });
      formData.append("file", blob, pages[i].name || `page_${i}.jpg`);

      const response = await fetch(`${SURYA_BASE_URL}/answer-key`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        console.error(`[OpenCV] Page ${i + 1} scan failed: HTTP ${response.status}`);
        continue;
      }

      const result = await response.json();
      console.log(
        `[OpenCV] Page ${i + 1}: is_answer_key=${result.is_answer_key}, confidence=${result.confidence}, bubbles=${result.bubble_count}, answers=${result.answers?.length ?? 0}`,
      );

      if (
        result.is_answer_key &&
        Array.isArray(result.answers) &&
        result.answers.length > 0 &&
        Number(result.confidence) >= MIN_OPENCV_CONFIDENCE
      ) {
        const candidate = {
          pageIndex: i,
          answers: normalizeAnswerKeyAnswers(result.answers),
          confidence: result.confidence,
        };

        if (
          !bestMatch ||
          candidate.confidence > bestMatch.confidence ||
          (candidate.confidence === bestMatch.confidence &&
            candidate.answers.length > bestMatch.answers.length)
        ) {
          bestMatch = candidate;
        }
      }
    } catch (error) {
      console.error(`[OpenCV] Page ${i + 1} scan error:`, error.message);
    }
  }

  if (bestMatch) {
    console.log(
      `[OpenCV] Using answer key from page ${bestMatch.pageIndex + 1} (confidence=${bestMatch.confidence}):`,
      bestMatch.answers,
    );
  } else {
    console.log(
      `[OpenCV] No answer key with confidence >= ${MIN_OPENCV_CONFIDENCE} — fallback to Gemini for correctOption`,
    );
  }

  return bestMatch;
};

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

      const response = await fetch(`${SURYA_BASE_URL}/ocr`, {
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

const buildMultiPagePrompt = (pageCount, hasAnswerKeySheet = false) => {
  const answerKeyRules = hasAnswerKeySheet
    ? `قوانین پاسخنامه:
- صفحه کلید سوالات جداگانه با OpenCV پردازش می‌شود
- برای همه سوالات correctOption را null بگذارید`
    : `قوانین پاسخنامه (کلید سوالات — بسیار مهم):
- آخرین صفحه معمولاً برگه پاسخنامه حبابی/تستی است
- هر ردیف = یک سوال. شماره سوال سمت چپ ردیف (۱، ۲، ۳، ...)
- هر ردیف ۴ حباب بیضی دارد، چیده از چپ به راست (LTR):
  * گزینه ۱ = حباب اول از چپ
  * گزینه ۲ = حباب دوم از چپ
  * گزینه ۳ = حباب سوم از چپ
  * گزینه ۴ = حباب چهارم از چپ (راست‌ترین)
- حباب پر/سیاه/پررنگ = گزینه صحیح آن سوال
- correctOption عدد ۱ تا ۴ (نه ۰). ردیف سوال N در پاسخنامه → correctOption سوال N در خروجی
- فقط حباب کاملاً پر شده را بخوان، نه حباب خالی یا کم‌رنگ
- اگر پاسخنامه نیست یا حباب مشخص نیست: null
- مثال: ردیف سوال ۱ → حباب دوم از چپ پر → correctOption = 2`;

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
        { "type": "image", "text": "", "imageCrop": [120, 400, 280, 520] },
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

${answerKeyRules}

قوانین عمومی:
- همه فرمول‌ها LaTeX معتبر و استاندارد باشند.
- متن فارسی
- options دقیقاً ۴ آیتم
- برای گزینه‌های تصویری: type="image" و فیلد imageCrop اجباری
- pageIndex از صفر شروع می‌شود
- بدون markdown یا code fence

قوانین استخراج عکس سوال (بسیار مهم):
- اگر سوالی دارای نمودار، شکل، جدول یا هر المان گرافیکی مربوطه است، حتماً فیلد "hasQuestionImage" را true کنید.
- لیست "Available Images" هر صفحه حاوی آرایه‌های مختصات [x1, y1, x2, y2] است که از مدل لایوت استخراج شده است. بررسی کنید کدام یک از این باکس‌ها متعلق به شکل یا نمودار این سوال است و آن آرایه ۴ عددی را دقیقاً و بدون تغییر در فیلد "questionImageCrop" کپی کنید.
- اگر سوال هیچ شکل یا نموداری ندارد، "hasQuestionImage" برابر false و "questionImageCrop" برابر null باشد.

قوانین استخراج عکس گزینه‌ها (بسیار مهم):
- اگر یک گزینه شکل، نمودار، جدول یا تصویر است (نه متن)، type="image" بگذارید و text را خالی بگذارید.
- bbox مربوط به همان گزینه را از Available Images پیدا کنید و آرایه [x1, y1, x2, y2] را در فیلد "imageCrop" همان گزینه کپی کنید.
- هر گزینه تصویری باید imageCrop داشته باشد؛ بدون imageCrop گزینه تصویری معتبر نیست.
- گزینه متنی: type="text" و imageCrop نداشته باشد.`;
};

const buildGeminiRequest = (apiKey) => {
  const base =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  // AQ.* و AIza* هر دو با x-goog-api-key (روش رسمی REST Gemini)
  return {
    url: base,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
  };
};

const callGemini = async (parts, logLabel = "Gemini") => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const proxyAgent = new HttpsProxyAgent("http://192.168.31.174:10807");
  const { url, headers } = buildGeminiRequest(apiKey);

  let lastError;
  for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt++) {
    try {
      console.log(`[${logLabel}] Attempt ${attempt}/${MAX_GEMINI_ATTEMPTS}...`);

      const response = await fetch(url, {
        method: "POST",
        headers,
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
        lastError = new Error(`Gemini API error: ${status}`);

        if (RETRYABLE_STATUS_CODES.has(status) && attempt < MAX_GEMINI_ATTEMPTS) {
          const backoff = getExponentialBackoffMs(
            attempt,
            response.headers.get("retry-after"),
          );
          console.log(
            `[${logLabel}] Exponential backoff: retry in ${backoff}ms (attempt ${attempt})...`,
          );
          await wait(backoff);
          continue;
        }

        throw lastError;
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

      const httpStatus = Number(
        String(error.message || "").replace("Gemini API error: ", ""),
      );
      const isNonRetryableHttp =
        error.message?.startsWith("Gemini API error:") &&
        !RETRYABLE_STATUS_CODES.has(httpStatus);

      if (isNonRetryableHttp || attempt >= MAX_GEMINI_ATTEMPTS) {
        throw error;
      }

      const backoff = getExponentialBackoffMs(attempt);
      console.log(
        `[${logLabel}] Exponential backoff: retry in ${backoff}ms (attempt ${attempt})...`,
      );
      await wait(backoff);
    }
  }

  throw lastError;
};

const extractPixelBbox = (rawCrop) => {
  if (!rawCrop) return null;

  if (Array.isArray(rawCrop) && rawCrop.length === 4) {
    const bbox = rawCrop.map(Number);
    return bbox.every(Number.isFinite) ? bbox : null;
  }

  if (Array.isArray(rawCrop?.bbox) && rawCrop.bbox.length === 4) {
    const bbox = rawCrop.bbox.map(Number);
    return bbox.every(Number.isFinite) ? bbox : null;
  }

  return null;
};

const cropBboxToDataUrl = async (pageBuffer, bbox) => {
  const [x1, y1, x2, y2] = bbox;
  const width = x2 - x1;
  const height = y2 - y1;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const croppedBuffer = await sharp(pageBuffer)
    .extract({
      left: Math.max(0, Math.round(x1)),
      top: Math.max(0, Math.round(y1)),
      width: Math.round(width),
      height: Math.round(height),
    })
    .toBuffer();

  return `data:image/jpeg;base64,${croppedBuffer.toString("base64")}`;
};

const applyQuestionImageCrops = async (rawQuestions, pages) => {
  if (!Array.isArray(rawQuestions)) return;

  for (const question of rawQuestions) {
    const pageIndex = Number.isFinite(Number(question.pageIndex))
      ? Number(question.pageIndex)
      : 0;
    const targetPage = pages[pageIndex];
    if (!targetPage) continue;

    if (question.hasQuestionImage && question.questionImageCrop) {
      try {
        const bbox = extractPixelBbox(question.questionImageCrop);
        if (bbox) {
          const dataUrl = await cropBboxToDataUrl(targetPage.buffer, bbox);
          if (dataUrl) {
            question.questionImageCrop = dataUrl;
            question.questionImage = dataUrl;
            question.image = dataUrl;
          }
        }
      } catch (cropError) {
        console.error(
          `[Crop Engine] Failed to crop question image: ${cropError.message}`,
        );
        question.questionImageCrop = null;
      }
    }

    if (!Array.isArray(question.options)) continue;

    for (const option of question.options) {
      const isImageOption =
        option?.type === "image" || option?.isImage === true || option?.imageCrop;

      if (!isImageOption || !option.imageCrop) continue;

      option.type = "image";

      try {
        const bbox = extractPixelBbox(option.imageCrop);
        if (!bbox) continue;

        const dataUrl = await cropBboxToDataUrl(targetPage.buffer, bbox);
        if (dataUrl) {
          option.imageCrop = dataUrl;
        }
      } catch (cropError) {
        console.error(
          `[Crop Engine] Failed to crop option image: ${cropError.message}`,
        );
        option.imageCrop = null;
      }
    }
  }
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
    return { questions: [], answerKey: { source: "gemini" } };
  }

  const answerKeyResult = await callAnswerKeyExtraction(pages);
  const promptText = buildMultiPagePrompt(
    pages.length,
    Boolean(answerKeyResult),
  );
  const ocrData = await callSuryaOCR(pages);
  const parts = buildPartsFromPages(pages, promptText, ocrData);

  const parsed = await callGemini(parts, "ExtractFromPages");
  const rawQuestions = parsed.questions || parsed;

  await applyQuestionImageCrops(rawQuestions, pages);

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
        if (Array.isArray(rawQ.options) && Array.isArray(q.options)) {
          rawQ.options.forEach((rawOpt, optIdx) => {
            const normalizedOpt = q.options[optIdx];
            if (!normalizedOpt || normalizedOpt.type !== "image") return;
            if (rawOpt?.imageCrop) {
              normalizedOpt.imageCrop = rawOpt.imageCrop;
            }
          });
        }
        if (q.correctOption === null && rawQ.correctOption !== undefined) {
          q.correctOption = rawQ.correctOption;
        }
      }
    });
  }

  if (answerKeyResult && Array.isArray(finalQuestions)) {
    let cvAnswers = normalizeAnswerKeyAnswers([...answerKeyResult.answers]);
    const questionCount = finalQuestions.length;

    if (cvAnswers.length > questionCount) {
      const extraRows = cvAnswers.length - questionCount;
      console.log(
        `[OpenCV] Trimming ${extraRows} extra row(s) (${cvAnswers.length} → ${questionCount})`,
      );
      cvAnswers = cvAnswers.slice(extraRows);
    }

    finalQuestions.forEach((q, idx) => {
      const cvAnswer = cvAnswers[idx];
      if (cvAnswer >= 1 && cvAnswer <= 4) {
        q.correctOption = cvAnswer;
      }
    });
    console.log(
      `[OpenCV] Merged correctOptions from page ${answerKeyResult.pageIndex + 1}:`,
      finalQuestions.map((q) => q.correctOption),
    );
  } else {
    console.log(
      "Extracted correctOptions (Gemini):",
      Array.isArray(finalQuestions)
        ? finalQuestions.map((q) => q.correctOption)
        : [],
    );
  }

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

  const questions = Array.isArray(normalized)
    ? normalized
    : normalized.questions || normalized;

  return {
    questions,
    answerKey: answerKeyResult
      ? {
          source: "opencv",
          pageIndex: answerKeyResult.pageIndex,
          confidence: answerKeyResult.confidence,
          answers: answerKeyResult.answers,
        }
      : { source: "gemini" },
  };
};

exports.extractQuestionData = async (imageBuffer, mimeType = "image/jpeg") => {
  const pages = [{ buffer: imageBuffer, mimeType }];
  return exports.extractFromPages(pages);
};
