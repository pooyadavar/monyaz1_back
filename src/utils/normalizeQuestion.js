const clampPercent = (value) => Math.max(0, Math.min(100, Number(value)));

const normalizeCrop = (rawCrop) => {
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

exports.normalizeQuestion = (raw, pageIndex = 0) => {
  const hasQuestionImage = Boolean(raw.hasQuestionImage);
  const optionsSource = Array.isArray(raw.options) ? raw.options : [];

  const options = [0, 1, 2, 3].map((index) =>
    normalizeOption(optionsSource[index], index),
  );

  return {
    questionText: raw.questionText || "",
    options,
    correctOption: Math.min(4, Math.max(1, Number(raw.correctOption) || 1)),
    hasQuestionImage,
    questionImageCrop: hasQuestionImage
      ? normalizeCrop(raw.questionImageCrop || raw.imageCrop)
      : null,
    pageIndex,
  };
};

exports.normalizeExtractPayload = (data, pageIndex = 0) => {
  if (Array.isArray(data.questions)) {
    return data.questions.map((question) =>
      exports.normalizeQuestion(question, pageIndex),
    );
  }

  if (Array.isArray(data)) {
    return data.map((question) => exports.normalizeQuestion(question, pageIndex));
  }

  return [exports.normalizeQuestion(data, pageIndex)];
};
