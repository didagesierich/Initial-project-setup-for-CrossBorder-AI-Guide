export async function handler(event) {

  const API_KEY = process.env.GEMINI_API_KEY;

  const body = JSON.parse(event.body);

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + API_KEY,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  return {
    statusCode: 200,
    body: JSON.stringify(data)
  };
}
