const clampPercent = (value) => Math.max(0, Math.min(100, Number(value)));

const isDataUrl = (value) =>
  typeof value === "string" && value.startsWith("data:image");

const normalizeCrop = (rawCrop) => {
  if (isDataUrl(rawCrop)) {
    return rawCrop;
  }

  if (
    !rawCrop ||
    !Number.isFinite(Number(rawCrop.x)) ||
    !Number.isFinite(Number(rawCrop.y)) ||
    !Number.isFinite(Number(rawCrop.width)) ||
    !Number.isFinite(Number(rawCrop.height))
  ) {
    return null;
  }

  const x = clampPercent(rawCrop.x);
  const y = clampPercent(rawCrop.y);

  return {
    x,
    y,
    width: Math.max(0, Math.min(100 - x, Number(rawCrop.width))),
    height: Math.max(0, Math.min(100 - y, Number(rawCrop.height))),
  };
};

const parseCorrectOption = (raw) => {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const n = Number(raw);

  if (!Number.isFinite(n)) {
    return null;
  }

  const rounded = Math.round(n);

  if (rounded >= 1 && rounded <= 4) {
    return rounded;
  }

  if (rounded >= 0 && rounded <= 3) {
    return rounded + 1;
  }

  return null;
};

const normalizeOption = (option, index) => {
  if (typeof option === "string") {
    return { type: "text", text: option };
  }

  const isImage =
    option?.type === "image" ||
    option?.isImage === true ||
    Boolean(option?.imageCrop);

  if (isImage) {
    return {
      type: "image",
      text: option?.text || option?.value || "",
      imageCrop: normalizeCrop(option?.imageCrop),
    };
  }

  return {
    type: "text",
    text: option?.text || option?.value || `گزینه ${index + 1}`,
  };
};

exports.parseCorrectOption = parseCorrectOption;

exports.normalizeQuestion = (raw, fallbackPageIndex = 0) => {
  const hasQuestionImage = Boolean(raw.hasQuestionImage);
  const optionsSource = Array.isArray(raw.options) ? raw.options : [];

  const options = [0, 1, 2, 3].map((index) =>
    normalizeOption(optionsSource[index], index),
  );

  let pageIndex = fallbackPageIndex;
  if (Number.isFinite(Number(raw.pageIndex)) && Number(raw.pageIndex) >= 0) {
    pageIndex = Number(raw.pageIndex);
  }

  return {
    questionText: raw.questionText || "",
    options,
    correctOption: parseCorrectOption(raw.correctOption),
    hasQuestionImage,
    questionImageCrop: hasQuestionImage
      ? normalizeCrop(raw.questionImageCrop || raw.imageCrop)
      : null,
    pageIndex,
  };
};

exports.normalizeExtractPayload = (data, fallbackPageIndex = 0) => {
  if (Array.isArray(data.questions)) {
    return data.questions.map((question) =>
      exports.normalizeQuestion(question, fallbackPageIndex),
    );
  }

  if (Array.isArray(data)) {
    return data.map((question) => exports.normalizeQuestion(question, fallbackPageIndex));
  }

  return [exports.normalizeQuestion(data, fallbackPageIndex)];
};
