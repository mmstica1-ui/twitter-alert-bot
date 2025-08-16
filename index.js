// ===============================
// Simple Alert Bot (Express + Telegram + Gemini Scoring)
// ===============================

import express from "express";
import crypto from "crypto";

// ------- ENV -------
const {
  PORT = 8080,

  // Telegram
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,

  // Optional scoring
  RISK_SCORING = "off",
  GEMINI_API_KEY,

  // Keywords and rules
  KEYWORDS = "tariff,tariffs,breaking,0dte,embargo,sanctions,trade war,customs,duty",
  WINDOW_SEC = "300",              // חלון זמן שניות לצבירת אירועים
  MIN_UNIQUE_ACCOUNTS = "2",       // כמה חשבונות שונים לפחות כדי לטריגר
  MAX_ITEMS_FETCH = "50",          // לא בשימוש כאן (רלוונטי אם תוסיף polling)

  // Webhook security
  APIFY_WEBHOOK_SECRET,            // נדרש: אותו secret ששמת ב-?secret=...
} = process.env;

// ------- Guards -------
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
}
if (!APIFY_WEBHOOK_SECRET) {
  console.warn("⚠️ APIFY_WEBHOOK_SECRET is missing. Webhook will reject requests without correct ?secret.");
}

// ------- Globals -------
const app = express();
app.use(express.json({ limit: "2mb" }));

// טבלת “אירועים אחרונים” לזיהוי חפיפה של מילים בין כמה חשבונות
// מבנה: { keywordLc: Map<keywordLc, Array<{account, text, url, ts, source}>> }
const recentByKeyword = new Map();
// דה-דופליקציה: מזהים שנשלחו
const sentIds = new Set();

// פענוח/חלוקה של מילות מפתח
const KEYWORDS_LIST = KEYWORDS.split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// הגדרות חלון / ספים
const WINDOW_MS = Math.max(1, Number(WINDOW_SEC)) * 1000;
const MIN_ACCOUNTS = Math.max(1, Number(MIN_UNIQUE_ACCOUNTS));

// ------- Utilities -------

function nowTs() {
  return Date.now();
}

function htmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function uniq(arr) {
  return [...new Set(arr)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// מחלצים טקסט/לינק/חשבון מכל מבנה אפשרי (X/Truth/כללי)
function normalizeItem(raw = {}) {
  const text =
    raw.text ||
    raw.content ||
    raw.full_text ||
    raw.title ||
    "";

  const url =
    raw.url ||
    raw.link ||
    raw.permalink ||
    raw.tweetUrl ||
    raw.twitterUrl ||
    "";

  const account =
    raw.username ||
    raw.screen_name ||
    raw.author ||
    raw.account ||
    raw.user ||
    "";

  const created =
    raw.created_at ||
    raw.createdAt ||
    raw.date ||
    raw.timestamp ||
    "";

  // מזהה דדופ
  const id = raw.id || raw.tweet_id || raw.tweetId || raw.postId || raw.uniqueId || url || (created + ":" + account + ":" + text.slice(0, 50));

  return { id, text, url, account, created };
}

// מחפשים אילו מילות מפתח מופיעות בטקסט
function extractMatchedKeywords(text = "") {
  const lc = text.toLowerCase();
  const hits = KEYWORDS_LIST.filter(k => lc.includes(k));
  return uniq(hits);
}

// ניקוי חלון ישן
function cleanupOldWindow() {
  const cutoff = nowTs() - WINDOW_MS;
  for (const [kw, arr] of recentByKeyword.entries()) {
    const filtered = arr.filter(it => it.ts >= cutoff);
    if (filtered.length === 0) {
      recentByKeyword.delete(kw);
    } else {
      recentByKeyword.set(kw, filtered);
    }
  }
}

// הוספת אירוע ושאילתה האם חצינו את הסף (≥ MIN_UNIQUE_ACCOUNTS)
function registerAndCheck(keywordLc, entry) {
  const list = recentByKeyword.get(keywordLc) || [];
  list.push(entry);
  recentByKeyword.set(keywordLc, list);

  const uniqueAccounts = uniq(list.map(x => x.account || "unknown")).filter(Boolean);
  return uniqueAccounts.length >= MIN_ACCOUNTS;
}

// שליחת הודעה לטלגרם (HTML)
async function sendTelegram(html, extra = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Telegram envs missing");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error("⚠️ Telegram send error:", data);
    }
    return data;
  } catch (err) {
    console.error("⚠️ Telegram send exception:", err.message);
  }
}

// דירוג השפעה עם Gemini (אופציונלי)
async function getRiskScoring(text) {
  if (RISK_SCORING !== "on") return "🔍 ניתוח כבוי (RISK_SCORING=off)";
  if (!GEMINI_API_KEY) return "⚠️ חסר GEMINI_API_KEY";

  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
`Analyze this financial/social post and rate its expected *short-term* market impact (S&P/major indices):
"${text}"

Return EXACTLY one of the following options (no extra text):
❌ No Impact
⚠️ Basic Impact
🚨 High Impact
`
                }
              ]
            }
          ]
        }),
      }
    );
    const data = await resp.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!out) {
      return "⚠️ Gemini: " + (data?.error?.message || "No result");
    }
    // נוודא שזה אחד הערכים
    if (["❌ No Impact", "⚠️ Basic Impact", "🚨 High Impact"].includes(out)) {
      return out;
    }
    return "⚠️ Gemini: " + out;
  } catch (err) {
    return "⚠️ Gemini error: " + err.message;
  }
}

// בונים הודעת טלגרם יפה
async function buildTelegramMessage({ source, account, created, text, url, keyword }) {
  const risk = await getRiskScoring(text);
  const safeText = htmlEscape(text);
  const srcIcon = source === "truth" ? "📣 Truth Social" : source === "twitter" ? "🐦 X" : "📰 Source";
  const when = created ? `<i>${htmlEscape(created)}</i>\n` : "";
  const handle = account ? `<b>@${htmlEscape(account)}</b>\n` : "";
  const kw = keyword ? `<code>#${htmlEscape(keyword)}</code>\n` : "";
  const link = url ? `<a href="${htmlEscape(url)}">Link</a>` : "";

  return (
    `🔔 <b>Keyword cross-hit</b>\n` +
    `${kw}${srcIcon}\n` +
    handle +
    when +
    `${safeText}\n\n` +
    `${link}\n\n` +
    `Impact: ${risk}`
  );
}

// כאשר יש לנו צבירה של ≥2 חשבונות עבור מילה מסוימת—נשלח סיכום קצר
async function maybeSendSummary(keywordLc) {
  const arr = recentByKeyword.get(keywordLc) || [];
  const accounts = uniq(arr.map(x => x.account || "unknown")).filter(Boolean);
  if (accounts.length < MIN_ACCOUNTS) return;

  // נבחר את הפריט הכי “חדש” ל-message הראשי
  const latest = arr.slice().sort((a, b) => b.ts - a.ts)[0];

  const msg = await buildTelegramMessage({
    source: latest.source,
    account: latest.account,
    created: latest.created,
    text: latest.text,
    url: latest.url,
    keyword: keywordLc,
  });

  await sendTelegram(msg);
}

// ------- Web server routes -------

// דף בית קצר
app.get("/", (req, res) => {
  res.type("text/plain").send("OK - Alert bot is running.\nSee /health, /debug");
});

// בריאות
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    window_sec: Number(WINDOW_SEC),
    min_unique_accounts: MIN_ACCOUNTS,
    keywords_count: KEYWORDS_LIST.length,
  });
});

// דיבאג (לא חושף סודות!)
app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    env: {
      TELEGRAM_BOT_TOKEN: TELEGRAM_BOT_TOKEN ? "set" : "missing",
      TELEGRAM_CHAT_ID: TELEGRAM_CHAT_ID ? "set" : "missing",
      RISK_SCORING,
      GEMINI_API_KEY: GEMINI_API_KEY ? "set" : "missing",
      APIFY_WEBHOOK_SECRET: APIFY_WEBHOOK_SECRET ? "set" : "missing",
      KEYWORDS: KEYWORDS_LIST,
      WINDOW_SEC: Number(WINDOW_SEC),
      MIN_UNIQUE_ACCOUNTS: MIN_ACCOUNTS,
    },
    memory: {
      recentByKeywordSize: recentByKeyword.size,
      sentIdsSize: sentIds.size,
    },
    now: new Date().toISOString(),
  });
});

// בדיקת טלגרם ידנית
app.get("/test/telegram", async (req, res) => {
  const text = req.query.text || "בדיקת בוט ✅";
  const r = await sendTelegram(`Test: ${htmlEscape(text)}\n\nTime: ${new Date().toISOString()}`);
  res.json({ ok: true, result: r || null });
});

// נקודת Webhook לאפיפיי / משימות אחרות
// שימוש: https://<your-domain>/apify/webhook?secret=MYSECRET&source=twitter
app.post("/apify/webhook", async (req, res) => {
  try {
    // אימות סוד
    const given = String(req.query.secret || "");
    if (!APIFY_WEBHOOK_SECRET || given !== APIFY_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "Bad secret" });
    }

    // מקור (twitter | truth | other)
    const source = String(req.query.source || "other").toLowerCase();

    // אפיפיי שולחת בדרך כלל body עם שדה data / items / או webhookPayload
    // ננסה להוציא מערך פריטים בצורה סלחנית
    const body = req.body || {};
    const items =
      body.items ||
      body.data ||
      body.results ||
      body?.webhookPayload?.items ||
      (Array.isArray(body) ? body : []);

    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ ok: true, received: 0 });
    }

    // ננקה חלון ישן
    cleanupOldWindow();

    let processed = 0;
    for (const raw of items) {
      const it = normalizeItem(raw);
      if (!it.text) continue;

      // דה-דופ
      const hash = crypto
        .createHash("md5")
        .update(it.id || it.account + it.text)
        .digest("hex");
      if (sentIds.has(hash)) continue;
      sentIds.add(hash);

      // התאמות מילות מפתח
      const hits = extractMatchedKeywords(it.text);
      if (hits.length === 0) continue;

      // לכל מילת מפתח—נרשום אירוע
      for (const kw of hits) {
        const entry = {
          account: it.account || "unknown",
          text: it.text,
          url: it.url,
          created: it.created,
          ts: nowTs(),
          source,
        };
        const crossed = registerAndCheck(kw, entry);
        if (crossed) {
          await maybeSendSummary(kw);
        }
      }

      processed++;
    }

    return res.json({ ok: true, processed });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ------- Start -------
app.listen(PORT, () => {
  console.log(`🚀 Webhook bot running on :${PORT}`);
});
