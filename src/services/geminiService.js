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
        { text: "Extract question and 4 options in JSON format { \"questionText\": \"...\", \"options\": [...], \"correctOption\": 1 }. Persian language. Raw JSON only." }, 
        { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
      ] 
    }]
  };

  const response = await fetch(url, {
    method: "POST",
    agent: proxyAgent,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API Error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const responseText = result.candidates[0].content.parts[0].text
    .replace(/```json/g, '').replace(/```/g, '').trim();

  return JSON.parse(responseText);
};