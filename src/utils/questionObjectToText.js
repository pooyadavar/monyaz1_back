const normalizeText = (value) => String(value || "").trim();

const findQuestions = (payload) => {
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.questions,
    payload.result?.questions,
    payload.document?.questions,
    payload.result?.document?.questions,
  ];
  return candidates.find(Array.isArray) || [];
};

const getAnswerKey = (question) =>
  question.answer_key || question.answerKey || question.correct_answer || question.correctOption || "";

const optionLine = (option) => {
  const key = normalizeText(option.key || "");
  const text = normalizeText(option.text_fa || option.text || "");
  const latex = normalizeText(option.latex || "");
  const body = latex && latex !== text ? `${text} ${latex}`.trim() : text || latex;
  return `${key || "-"} ) ${body}`.trim();
};

const questionObjectToText = (payload) => {
  const questions = findQuestions(payload);
  if (!questions.length) return "";

  return questions
    .map((question, index) => {
      const lines = [];
      const number = question.question_number || question.questionNumber || index + 1;
      const stem = normalizeText(question.stem_fa || question.questionText || "");
      const stemLatex = normalizeText(question.stem_latex || "");

      lines.push(`${number}. ${stem}`.trim());
      if (stemLatex && !stem.includes(stemLatex)) {
        lines.push(`فرمول صورت سوال: ${stemLatex}`);
      }

      const options = Array.isArray(question.options) ? question.options : [];
      options.forEach((option) => {
        lines.push(optionLine(option));
      });

      const answerKey = getAnswerKey(question);
      if (answerKey) lines.push(`پاسخ: ${answerKey}`);

      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
};

module.exports = {
  findQuestions,
  questionObjectToText,
};
