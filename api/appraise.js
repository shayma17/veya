// Veya value engine — DIAGNOSTIC VERSION
// Visit /api/appraise in a browser to run a self-test and see the real error.
// Once everything works, we'll swap this for the clean version.

const MODEL = "gemini-2.5-flash";

const SYSTEM = `You are Veya, a discreet, exacting value-for-money product analyst with refined, understated British prose. Given a product name (and optionally the price the user would pay), judge whether it is worth the money and suggest cheaper alternatives that do the same job as well or better.

worthScore 0-100: higher = better value at its typical price. Penalise heavily where most of the cost is brand or marketing premium over near-identical cheaper options. Reward things genuinely hard to beat on price for performance.

Use your own knowledge for typical UK prices; approximate is fine. Default currency to GBP (the pound). Keep every string tight and specific, with no marketing fluff.

Respond ONLY as JSON in exactly this shape, nothing else:
{"product":"string","category":"string","worthScore":0,"typicalPrice":"string","priceVerdict":"string","summary":"string","payingFor":["string"],"alternatives":[{"name":"string","price":"string","savings":"string","verdict":"same","why":"string"}]}

"verdict" is either "same" or "better". Provide 2 to 4 alternatives, best value first. If you cannot identify the product, set worthScore to 0, briefly explain in summary, and return an empty alternatives array.`;

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;

  // ---- SELF-TEST: just visit /api/appraise in a browser ----
  if (req.method === "GET") {
    const report = {
      step1_keyFound: !!key,
      step1_keyLength: key ? key.length : 0,
      step1_keyStartsWith: key ? key.slice(0, 6) + "..." : "(none)",
      step2_modelBeingUsed: MODEL
    };

    if (!key) {
      report.verdict = "PROBLEM: No key found. Check the name is exactly GEMINI_API_KEY in Vercel, then REDEPLOY.";
      res.status(200).json(report);
      return;
    }

    try {
      const listRes = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models?key=" + key
      );
      const listData = await listRes.json();

      if (!listRes.ok) {
        report.step3_googleStatus = listRes.status;
        report.step3_googleSaid = (listData && listData.error && listData.error.message) || "unknown error";
        report.verdict = "PROBLEM: Google rejected the key. See step3_googleSaid above.";
        res.status(200).json(report);
        return;
      }

      const usable = (listData.models || [])
        .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") !== -1; })
        .map(function (m) { return m.name.replace("models/", ""); });

      report.step3_keyWorks = true;
      report.step3_modelsAvailableToYou = usable;
      report.step4_yourModelIsAvailable = usable.indexOf(MODEL) !== -1;

      if (!report.step4_yourModelIsAvailable) {
        report.verdict =
          "PROBLEM: The model '" + MODEL + "' isn't in your list. Send Claude the models listed above and he'll switch it.";
        res.status(200).json(report);
        return;
      }

      const testRes = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + key,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Say OK" }] }] })
        }
      );
      const testData = await testRes.json();

      if (!testRes.ok) {
        report.step5_googleSaid = (testData && testData.error && testData.error.message) || "unknown";
        report.verdict = "PROBLEM: Model call failed. See step5_googleSaid above.";
        res.status(200).json(report);
        return;
      }

      report.step5_testGeneration = "SUCCESS";
      report.verdict = "ALL GOOD — the engine and key work. Veya should be appraising now.";
      res.status(200).json(report);
      return;
    } catch (e) {
      report.step3_networkError = String(e && e.message ? e.message : e);
      report.verdict = "PROBLEM: Couldn't reach Google at all.";
      res.status(200).json(report);
      return;
    }
  }

  // ---- NORMAL APPRAISAL ----
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

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
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + key,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ parts: [{ text: userText }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
        })
      }
    );

    const data = await r.json();

    if (!r.ok) {
      res.status(502).json({
        error: "AI service error",
        googleSaid: (data && data.error && data.error.message) || "unknown"
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
      res.status(502).json({ error: "Couldn't read the AI response", raw: text.slice(0, 200) });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: "Couldn't reach the AI service", detail: String(e && e.message ? e.message : e) });
  }
}
