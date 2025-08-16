// server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

// ===== Env =====
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const KEYWORDS = (process.env.KEYWORDS || "tariff,tariffs,breaking,0dte")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// IDs של ה־Actors כפי שמופיעים ב־Apify (user/actor)
const APIFY_TWITTER_ACTOR = (process.env.APIFY_TWITTER_ACTOR || "apidojo/tweet-scraper").replace("/", "~");
const APIFY_TRUTH_ACTOR   = (process.env.APIFY_TRUTH_ACTOR   || "muhammetakkurt/truth-social-scraper").replace("/", "~");

if (!APIFY_TOKEN)  throw new Error("Missing APIFY_TOKEN");
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) throw new Error("Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID");

// ===== Helpers =====
function matchKeywords(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return KEYWORDS.some(k => t.includes(k));
}

async function sendTelegram(html) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  try {
    await axios.post(url, body, { timeout: 15000 });
  } catch (err) {
    console.error("Telegram error:", err?.response?.data || err.message);
  }
}

function formatMessage(item, sourceTag) {
  const text = item.text || item.content || item.full_text || item.title || "";
  const url  = item.url || item.link || item.tweetUrl || item.twitterUrl || item.permalink || "";
  const user = item.username || item.screen_name || item.author || item.account || "";
  const time = item.created_at || item.date || item.createdAt || item.timestamp || "";

  const safe = String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  return (
    `<b>${sourceTag}</b> ` +
    (user ? `<b>@${user}</b>\n` : "") +
    (time ? `<i>${time}</i>\n` : "") +
    `${safe}\n` +
    (url ? `<a href="${url}">Link</a>` : "")
  );
}

async function fetchDatasetItems(datasetId, limit = 50) {
  if (!datasetId) return [];
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=${limit}&desc=1`;
  try {
    const res = await axios.get(url, { timeout: 20000 });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("Dataset fetch error:", err?.response?.data || err.message);
    return [];
  }
}

// זיכרון קצר למניעת כפילויות
const sentIds = new Set();

// ===== App =====
const app = express();
app.use(bodyParser.json());

// בריאות
app.get("/", (_req, res) => res.send("OK"));

// נקודת ה-webhook מאפיפיי
app.post("/apify/webhook", async (req, res) => {
  try {
    // Apify שולח payload עם resource.defaultDatasetId (בדיפולט)
    const body = req.body || {};
    const q = req.query || {};

    // נזהה מקור (X / Truth) רק בשביל האייקון
    const sourceTag = q.src === "x" ? "🐦 X" :
                      q.src === "truth" ? "📣 Truth Social" : "🔔";

    const datasetId =
      body?.resource?.defaultDatasetId ||
      body?.resource?.datasetId ||
      body?.datasetId;

    if (!datasetId) {
      console.log("Webhook without datasetId", JSON.stringify(body).slice(0,300));
      return res.status(200).json({ ok: true, note: "no datasetId" });
    }

    const items = await fetchDatasetItems(datasetId, 50);

    for (const it of items) {
      const id  = it.id || it.tweet_id || it.tweetId || it.postId || it.uniqueId || it.permalink || it.url;
      const txt = it.text || it.content || it.full_text || it.title || "";
      if (!id || sentIds.has(id)) continue;
      if (!matchKeywords(txt)) continue;

      await sendTelegram(formatMessage(it, sourceTag));
      sentIds.add(id);
      if (sentIds.size > 5000) {
        // ניקוי זיכרון פעם ב...
        const first = sentIds.values().next().value;
        sentIds.delete(first);
      }
    }

    res.json({ ok: true, received: items.length });
  } catch (e) {
    console.error("Webhook handler error:", e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on :${PORT}`);
});
