// index.js
// Webhook + Telegram bot with LLM "market impact" scoring
import express from "express";
import axios from "axios";
import crypto from "crypto";
import bodyParser from "body-parser";

// ----------- ENV -----------
const PORT = process.env.PORT || 8080;

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const KEYWORDS = (process.env.KEYWORDS || "tariff,tariffs,breaking,fed,fomc")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const APIFY_WEBHOOK_SECRET = process.env.APIFY_WEBHOOK_SECRET || "";

const WINDOW_SEC          = Number(process.env.WINDOW_SEC || 300);
const MIN_UNIQUE_ACCOUNTS = Number(process.env.MIN_UNIQUE_ACCOUNTS || 2);
const MAX_ITEMS_FETCH     = Number(process.env.MAX_ITEMS_FETCH || 50);

// LLM provider (optional)
const MODEL_PROVIDER   = (process.env.MODEL_PROVIDER || "").toLowerCase(); // "openai" | "anthropic"
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL     = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ANTHROPIC_API_KEY= process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL  = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";

// ----------- Validate base env -----------
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ חסרים משתני סביבה: TELEGRAM_TOKEN / TELEGRAM_CHAT_ID");
}
if (!KEYWORDS.length) {
  console.warn("⚠️ KEYWORDS ריק — מומלץ להגדיר מילות מפתח רלוונטיות");
}

// ----------- App init -----------
const app = express();

// raw body for signature verification (Apify webhook)
app.use("/webhook/apify", bodyParser.raw({ type: "*/*", limit: "2mb" }));
app.use(bodyParser.json({ limit: "2mb" }));

// ----------- State / Cache -----------
const windowStore = new Map(); // { kw -> { accounts:Set, firstAt, lastAt, samples:[...] } }
const seenIds = new Set();

setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [kw, obj] of windowStore.entries()) {
    if (now - obj.lastAt > WINDOW_SEC * 1000) {
      windowStore.delete(kw);
      removed++;
    }
  }
  if (removed > 0) console.log(`🧹 ניקוי זיכרון: ${removed} קבוצות`);
}, 60 * 1000);

// ----------- Helpers -----------
function hmacEquals(apifySig, rawBody, secret) {
  try {
    if (!secret) return false;
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const cleanSig = String(apifySig || "").replace(/^sha256=/i, "").trim();
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(cleanSig));
  } catch {
    return false;
  }
}

function matchKeywords(text) {
  if (!text) return [];
  const t = String(text).toLowerCase();
  return KEYWORDS.filter((k) => t.includes(k));
}

async function sendTelegram(html) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ שליחת טלגרם נכשלה: חסר TELEGRAM_TOKEN או TELEGRAM_CHAT_ID");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  try {
    await axios.post(url, body, { timeout: 15000 });
  } catch (err) {
    console.error("⚠️ שגיאה בשליחת טלגרם:", err?.response?.data || err.message);
  }
}

function fmtHtmlSafe(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pushToWindow(keyword, account, sample) {
  const now = Date.now();
  if (!windowStore.has(keyword)) {
    windowStore.set(keyword, { accounts: new Set(), firstAt: now, lastAt: now, samples: [] });
  }
  const obj = windowStore.get(keyword);
  obj.accounts.add(account);
  obj.lastAt = now;
  if (obj.samples.length < 5) obj.samples.push(sample);
  return obj.accounts.size;
}

function samplesToPlainText(samples) {
  // טקסט תמציתי שמזין את ה-LLM (עד ~800 תווים)
  let out = "";
  for (const s of samples.slice(0, 5)) {
    const line = `@${s._account}: ${String(s._text || "").replace(/\s+/g, " ").trim()}`;
    if ((out + "\n" + line).length > 800) break;
    out += (out ? "\n" : "") + line;
  }
  return out;
}

// ----------- LLM Impact Scoring -----------
function formatImpactLabel(level) {
  switch (level) {
    case "none":      return "🟢 אין השפעה";
    case "low":       return "🟡 השפעה קלה";
    case "medium":    return "🟠 השפעה בינונית";
    case "high":      return "🔴 השפעה חזקה";
    default:          return "⚪️ ללא שיפוט";
  }
}

// פרומפט קצר וברור: החזר JSON בלבד
const SYSTEM_PROMPT = `
You are a finance event triage assistant. Given several short social posts about a potential macro/market event, you must OUTPUT STRICT JSON ONLY with this schema:
{"level":"none|low|medium|high","reason":"one short sentence in English about why"}
Guidelines:
- "high" only for likely market-moving (e.g., broad tariffs, surprise Fed action, war escalation, terrorist attack, major sanctions).
- "medium" for material but uncertain/sector-specific.
- "low" for routine or low-confidence signals.
- "none" for noise/irrelevant.
Do not include any other text. JSON only.
`.trim();

async function llmImpactScore(text) {
  // אם אין ספק/מפתח — לא מפעילים
  if (MODEL_PROVIDER === "openai" && OPENAI_API_KEY) {
    try {
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: OPENAI_MODEL,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Posts:\n${text}` },
          ],
        },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 15000 }
      );
      const raw = resp.data?.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);
      const level = String(parsed.level || "").toLowerCase();
      const reason = String(parsed.reason || "").slice(0, 180);
      if (!["none","low","medium","high"].includes(level)) return null;
      return { level, reason };
    } catch (e) {
      console.error("⚠️ LLM(OpenAI) error:", e?.response?.data || e.message);
      return null;
    }
  } else if (MODEL_PROVIDER === "anthropic" && ANTHROPIC_API_KEY) {
    try {
      const resp = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: ANTHROPIC_MODEL,
          max_tokens: 200,
          temperature: 0.1,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Posts:\n${text}` }],
        },
        {
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          timeout: 15000,
        }
      );
      const content = resp.data?.content?.[0]?.text || "{}";
      const parsed = JSON.parse(content);
      const level = String(parsed.level || "").toLowerCase();
      const reason = String(parsed.reason || "").slice(0, 180);
      if (!["none","low","medium","high"].includes(level)) return null;
      return { level, reason };
    } catch (e) {
      console.error("⚠️ LLM(Anthropic) error:", e?.response?.data || e.message);
      return null;
    }
  } else {
    // ספק לא קונפג — מדלגים
    return null;
  }
}

// ----------- Routes -----------

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "alert-bot",
    time: new Date().toISOString(),
    hasTelegram: Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID),
    llm: {
      provider: MODEL_PROVIDER || "disabled",
      openai: Boolean(OPENAI_API_KEY),
      anthropic: Boolean(ANTHROPIC_API_KEY),
    },
  });
});

// Debug
app.get("/debug", (req, res) => {
  const w = {};
  for (const [kw, obj] of windowStore.entries()) {
    w[kw] = {
      uniqueAccounts: obj.accounts.size,
      ageSec: Math.round((Date.now() - obj.firstAt) / 1000),
      lastUpdateSec: Math.round((Date.now() - obj.lastAt) / 1000),
      samples: obj.samples.map((s) => ({
        id: s._id,
        account: s._account,
        textPreview: (s._text || "").slice(0, 120),
      })),
    };
  }
  res.json({
    ok: true,
    env: {
      port: PORT,
      keywords: KEYWORDS,
      windowSec: WINDOW_SEC,
      minUniqueAccounts: MIN_UNIQUE_ACCOUNTS,
      maxItemsFetch: MAX_ITEMS_FETCH,
      hasTelegram: Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID),
      hasApifySecret: Boolean(APIFY_WEBHOOK_SECRET),
      llmProvider: MODEL_PROVIDER || "disabled",
    },
    store: w,
  });
});

// Send test Telegram
app.get("/test/telegram", async (req, res) => {
  const msg = req.query.msg || "בדיקת טלגרם ✅";
  await sendTelegram(`<b>Test</b>\n${fmtHtmlSafe(String(msg))}`);
  res.json({ ok: true, sent: true });
});

// Test LLM scoring
app.get("/test/score", async (req, res) => {
  const text = String(req.query.text || "").slice(0, 1000);
  if (!text) return res.status(400).json({ ok: false, error: "missing text" });
  const score = await llmImpactScore(text);
  res.json({ ok: true, score: score || { level: "n/a", reason: "no-llm-or-error" } });
});

// Simulate error for monitoring
app.get("/simulate-error", (req, res) => {
  const code = Number(req.query.code || 500);
  const reason = String(req.query.reason || "manual_test_error");
  console.error(`❌ simulate-error: code=${code} reason=${reason}`);
  res.status(code).json({ ok: false, code, reason });
});

// Apify Webhook
app.post("/webhook/apify", async (req, res) => {
  try {
    const sigHeader =
      req.header("x-apify-signature") || req.header("X-Apify-Signature");
    const rawBody = req.body; // Buffer
    const verified = APIFY_WEBHOOK_SECRET
      ? hmacEquals(sigHeader, rawBody, APIFY_WEBHOOK_SECRET)
      : true;

    if (!verified) {
      console.warn("⚠️ חתימת Webhook לא אומתה");
      return res.status(401).json({ ok: false, error: "invalid_signature" });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (e) {
      console.error("❌ Webhook JSON parse error:", e.message);
      return res.status(400).json({ ok: false, error: "invalid_json" });
    }

    const sourceTag =
      payload?.actorId || payload?.actorRunId || payload?.eventType || "Apify";

    let items =
      payload?.items ||
      payload?.results ||
      payload?.data?.items ||
      payload?.data ||
      [];
    if (!Array.isArray(items)) items = [];
    if (items.length > MAX_ITEMS_FETCH) items = items.slice(0, MAX_ITEMS_FETCH);

    let triggers = 0;

    for (const it of items) {
      const id =
        it.id ||
        it.tweet_id ||
        it.tweetId ||
        it.postId ||
        it.uniqueId ||
        it.url ||
        it.link ||
        crypto.createHash("md5").update(JSON.stringify(it)).digest("hex");

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const text =
        it.text || it.content || it.full_text || it.title || it.body || "";
      const hits = matchKeywords(text);
      if (!hits.length) continue;

      const account =
        it.username || it.screen_name || it.account || it.author || "unknown";

      const sample = { _id: id, _text: text, _account: account };

      for (const kw of hits) {
        const distinct = pushToWindow(kw, account, sample);
        if (distinct >= MIN_UNIQUE_ACCOUNTS) {
          const group = windowStore.get(kw);
          const uCount = group?.accounts?.size || distinct;

          // --- LLM scoring on aggregated sample ---
          const plain = samplesToPlainText(group?.samples || [sample]);
          const score = await llmImpactScore(plain); // may be null

          const impactLine = score
            ? `${formatImpactLabel(score.level)} — <i>${fmtHtmlSafe(score.reason)}</i>`
            : `⚪️ ללא שיפוט (LLM לא זמין)`;

          const title = `🚨 התאמה מרובה: "${kw}" הופיע אצל ${uCount} חשבונות ב-${WINDOW_SEC} שניות`;
          const samplesHtml = (group?.samples || [])
            .slice(0, 3)
            .map((s) => {
              const safe = fmtHtmlSafe(s._text || "").slice(0, 240);
              return `• <b>@${fmtHtmlSafe(s._account)}</b>: ${safe}`;
            })
            .join("\n");

          const html =
            `<b>${title}</b>\n\n` +
            `${samplesHtml || "(ללא דוגמאות)"}\n\n` +
            `<b>הערכת השפעה:</b> ${impactLine}\n` +
            `<i>מקור: ${fmtHtmlSafe(sourceTag)}</i>`;

          await sendTelegram(html);

          windowStore.delete(kw);
          triggers++;
        }
      }
    }

    console.log(`✅ Webhook: items=${items.length}, triggers=${triggers}, source=${sourceTag}`);
    return res.json({ ok: true, items: items.length, triggers });
  } catch (err) {
    console.error("❌ Webhook handler error:", err.message);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Home
app.get("/", (req, res) => {
  res.send("Alert bot is up. Try /health, /debug, /test/telegram, /test/score.");
});

app.listen(PORT, () => {
  console.log(`✅ Webhook bot running on :${PORT}`);
});
