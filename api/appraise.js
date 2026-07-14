// Veya value engine — runs on Vercel's server, holds your secret key safely.
// The app never sees the key; it just asks this file for a verdict.

// If Google ever renames the free model, THIS is the one line to change:
const MODEL = "gemini-2.5-flash";

const SYSTEM = `You are Veya, a discreet, exacting value-for-money product analyst with refined, understated British prose. Given a product name (and optionally the price the user would pay), judge whether it is worth the money and suggest cheaper alternatives that do the same job as well or better.

worthScore 0-100: higher = better value at its typical price. Penalise heavily where most of the cost is brand or marketing premium over near-identical cheaper options. Reward things genuinely hard to beat on price for performance.

Use your own knowledge for typical UK prices; approximate is fine. Default currency to GBP (the pound). Keep every string tight and specific, with no marketing fluff.

Respond ONLY as JSON in exactly this shape, nothing else:
{"product":"string","category":"string","worthScore":0,"typicalPrice":"string","priceVerdict":"string","summary":"string","payingFor":["string"],"alternatives":[{"name":"string","price":"string","savings":"string","verdict":"same","why":"string"}]}

"verdict" is either "same" or "better". Provide 2 to 4 alternatives, best value first. If you cannot identify the product, set worthScore to 0, briefly explain in summary, and return an empty alternatives array.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({ error: "Missing GEMINI_API_KEY in Vercel settings." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const product = body && body.product ? String(body.product).trim() : "";
  const price = body && body.price ? String(body.price).trim() : "";
  if (!product) {
    res.status(400).json({ error: "No product provided" });
    return;
  }

  const userText = "Product: " + product + (price ? "\nPrice I'd pay: " + price : "");

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL + ":generateContent?key=" + key;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
      })
    });

    const data = await r.json();

    if (!r.ok) {
      res.status(502).json({
        error: "AI service error",
        detail: (data && data.error && data.error.message) || ""
      });
      return;
    }

    let text = "";
    try { text = data.candidates[0].content.parts[0].text; } catch (e) {}

    let parsed;
    try {
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      parsed = JSON.parse(text.slice(a, b + 1));
    } catch (e) {
      res.status(502).json({ error: "Couldn't read the AI response" });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: "Couldn't reach the AI service" });
  }
}
