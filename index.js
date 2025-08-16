// index.js — Webhook-first alerts (no polling)
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ===== ENV =====
const APIFY_TOKEN        = process.env.APIFY_TOKEN;
const TELEGRAM_TOKEN     = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const KEYWORDS           = (process.env.KEYWORDS || "tariff,tariffs,breaking,0dte")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// אבטחת ה-webhook (אות סודי שתשים/י ב-Apify)
const APIFY_WEBHOOK_SECRET = process.env.APIFY_WEBHOOK_SECRET || "";

// פרמטרים להתנהגות
const WINDOW_SEC            = Number(process.env.WINDOW_SEC || 300);   // חלון 5 דקות
const MIN_UNIQUE_ACCOUNTS   = Number(process.env.MIN_UNIQUE_ACCOUNTS || 2);
const MAX_ITEMS_FETCH       = Number(process.env.MAX_ITEMS_FETCH || 50);

// ===== עזר =====
function kwMatch(text) {
  if (!text) return [];
  const t = String(text).toLowerCase();
  return KEYWORDS.filter(k => t.includes(k));
}
function nowSec() { return Math.floor(Date.now() / 1000); }

async function sendTelegram(html) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  try { await axios.post(url, body, { timeout: 15000 }); }
  catch (e) { console.error("Telegram error:", e?.response?.data || e.message); }
}

// מאגר זיכרון קצר: מילה => {חשבון => timestamp אחרון}
const windowStore = new Map(); // Map<string, Map<string, number>>
// אנטי-ספאם: מילה => timestamp של האיתות האחרון
const lastAlertAt = new Map();
// אנטי-דופלקייט לפי מזהי פוסטים
const seenIds = new Set();

function pruneOld() {
  const cutoff = nowSec() - WINDOW_SEC;
  for (const [kw, acctMap] of windowStore) {
    for (const [acct, ts] of acctMap) {
      if (ts < cutoff) acctMap.delete(acct);
    }
    if (acctMap.size === 0) windowStore.delete(kw);
  }
}

function noteHit(keyword, account) {
  if (!windowStore.has(keyword)) windowStore.set(keyword, new Map());
  windowStore.get(keyword).set(account, nowSec());
}

function shouldAlert(keyword) {
  const acctCount = windowStore.get(keyword)?.size || 0;
  if (acctCount < MIN_UNIQUE_ACCOUNTS) return false;
  const last = lastAlertAt.get(keyword) || 0;
  if (nowSec() - last < Math.ceil(WINDOW_SEC / 2)) return false; // לא יותר מפעם בחצי חלון
  lastAlertAt.set(keyword, nowSec());
  return true;
}

function sanitize(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// נורמליזציה של אייטמים מ-X ו-Truth
function normalizeItem(it, sourceTag) {
  const id =
    it.id || it.tweet_id || it.tweetId || it.postId || it.status_id || it.uniqueId || it.permalink || it.url;
  const text = it.text || it.full_text || it.content || it.title || it.body || "";
  const url  = it.url || it.link || it.tweetUrl || it.twitterUrl || it.permalink || it.uri || "";
  const account =
    it.username || it.user || it.screen_name || it.account || it.handle || it.author || it.account_name || "";
  const created =
    it.created_at || it.date || it.createdAt || it.timestamp || it.created_at_text || "";

  return { id, text, url, account, created, sourceTag };
}

// הורדת תוצאות מהריצה (dataset)
async function fetchDatasetItems(datasetId) {
  if (!datasetId) return [];
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=${MAX_ITEMS_FETCH}&desc=1`;
  try {
    const res = await axios.get(url, { timeout: 20000 });
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    console.error("Dataset fetch error:", e?.response?.data || e.message);
    return [];
  }
}

// ===== Webhook endpoint =====
app.post("/apify/webhook", async (req, res) => {
  try {
    // אימות חתימה פשוט (Header X-Apify-Signature או query secret)
    const provided = req.header("X-Apify-Signature") || req.query.secret || "";
    if (APIFY_WEBHOOK_SECRET && provided !== APIFY_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad signature" });
    }

    const { eventData } = req.body || req.query || {};
    // בפאנל "HTTP webhook" ב-Apify בחרי Payload: "Run object" (ברירת מחדל)
    // הפורמט הנפוץ:
    const run = req.body?.data || req.body?.resource || eventData || {};
    const datasetId = run?.defaultDatasetId || run?.data?.defaultDatasetId;
    const actId     = run?.actId || run?.actRunId || "";
    const src       = req.query?.src || req.body?.src || ""; // נזין ?src=x / ?src=truth ב-URL

    // מורידים פריטים
    const items = await fetchDatasetItems(datasetId);

    // מנרמלים ומטפלים
    pruneOld();
    const hitsForAlertText = []; // נשמור דוגמאות לאיתות

    for (const raw of items) {
      const item = normalizeItem(raw, src === "truth" ? "📣 Truth Social" : "🐦 X");
      if (!item.id || seenIds.has(item.id)) continue;
      seenIds.add(item.id);

      const matches = kwMatch(item.text);
      if (matches.length === 0) continue;

      for (const kw of matches) {
        if (!item.account) continue;
        noteHit(kw, item.account);
        if (shouldAlert(kw)) {
          hitsForAlertText.push({ kw, item });
        }
      }
    }

    // אם יש טריגר – בונים הודעה
    if (hitsForAlertText.length > 0) {
      // נאחד לפי מילת מפתח (ייתכן כמה טריגרים שונים)
      const byKw = new Map();
      for (const h of hitsForAlertText) {
        if (!byKw.has(h.kw)) byKw.set(h.kw, []);
        byKw.get(h.kw).push(h.item);
      }

      for (const [kw, samples] of byKw) {
        // ניקח עד 3 דוגמאות ליפה
        const parts = samples.slice(0, 3).map(s =>
          `<b>${s.sourceTag}</b> <b>@${sanitize(s.account)}</b>\n${sanitize(s.text)}\n${s.url ? `<a href="${s.url}">Link</a>` : ""}`
        ).join("\n\n— — —\n\n");

        const accounts = [...(windowStore.get(kw)?.keys() || [])];
        const msg =
          `<b>⚡ אות מילה משותפת</b>\n` +
          `<b>מילה:</b> <code>${sanitize(kw)}</code>\n` +
          `<b>מס' חשבונות בחלון ${WINDOW_SEC/60} דק':</b> ${accounts.length} (${accounts.map(a => '@'+sanitize(a)).join(", ")})\n\n` +
          parts;

        await sendTelegram(msg);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    res.status(500).json({ ok: false });
  }
});

// health
app.get("/", (_, res) => res.send("OK"));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook bot running on :${PORT}`);
});
