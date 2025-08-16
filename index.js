import axios from "axios";

// ------- env -------
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const KEYWORDS = (process.env.KEYWORDS || "tariff,tariffs,breaking,0dte")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// נקבל כל פורמט ונתקן ל-~ אם צריך
const APIFY_TWITTER_ACTOR_RAW = process.env.APIFY_TWITTER_ACTOR || "apidojo/tweet-scraper";
const APIFY_TRUTH_ACTOR_RAW   = process.env.APIFY_TRUTH_ACTOR   || "muhammetakkurt/truth-social-scraper";

function normalizeActorId(id) {
  // Apify API expects user~actorName (לא user/actorName)
  return (id || "").replace("/", "~");
}

const APIFY_TWITTER_ACTOR = normalizeActorId(APIFY_TWITTER_ACTOR_RAW);
const APIFY_TRUTH_ACTOR   = normalizeActorId(APIFY_TRUTH_ACTOR_RAW);

const TWITTER_HANDLES = (process.env.TWITTER_HANDLES || "realDonaldTrump,FirstSquawk,Deltaone")
  .split(",").map((s) => s.trim()).filter(Boolean);

const TRUTH_USERNAME = process.env.TRUTH_USERNAME || "realDonaldTrump";
const POLL_MS = Number(process.env.POLL_MS || 15000);

if (!APIFY_TOKEN) {
  console.error("❌ Missing APIFY_TOKEN env var");
  process.exit(1);
}
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID env vars");
  process.exit(1);
}

async function sendTelegram(html) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  try {
    await axios.post(url, body, { timeout: 15000 });
  } catch (err) {
    console.error("⚠️ Telegram send error", err?.response?.data || err.message);
  }
}

// נשתמש בגרסת v2 היציבה
async function runActor(actorId, input) {
  const id = normalizeActorId(actorId);
  const startUrl = `https://api.apify.com/v2/acts/${id}/runs?token=${APIFY_TOKEN}`;
  let run;
  try {
    const res = await axios.post(startUrl, { input }, { timeout: 20000 });
    run = res.data?.data;
  } catch (err) {
    console.error(`❌ Failed to start actor ${id}`, err?.response?.data || err.message);
    throw new Error("ACTOR_START_FAILED");
  }

  const { id: runId } = run || {};
  if (!runId) throw new Error(`No run id from actor ${id}`);

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollUrl = `https://api.apify.com/v2/acts/${id}/runs/${runId}?token=${APIFY_TOKEN}`;
    const r = await axios.get(pollUrl, { timeout: 15000 });
    const status = r.data?.data?.status;
    if (status === "SUCCEEDED" || status === "FAILED" || status === "TIMED_OUT") {
      if (status !== "SUCCEEDED") console.error(`⚠️ Actor ${id} ended with status: ${status}`);
      const datasetId = r.data?.data?.defaultDatasetId;
      return datasetId || null;
    }
  }
}

async function fetchDatasetItems(datasetId, limit = 50) {
  if (!datasetId) return [];
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=${limit}&desc=1`;
  try {
    const res = await axios.get(url, { timeout: 20000 });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("⚠️ Dataset fetch error", err?.response?.data || err.message);
    return [];
  }
}

function matchKeywords(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return KEYWORDS.some((k) => t.includes(k));
}

function formatMessage(item, sourceTag) {
  const text = item.text || item.content || item.full_text || item.title || "";
  const url = item.url || item.link || item.tweetUrl || item.twitterUrl || item.permalink || "";
  const handle = item.username || item.screen_name || item.author || item.account || "";
  const created = item.created_at || item.date || item.createdAt || item.timestamp || "";

  const safe = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return (
    `<b>${sourceTag}</b> ` +
    (handle ? `<b>@${handle}</b>\n` : "") +
    (created ? `<i>${created}</i>\n` : "") +
    `${safe}\n` +
    (url ? `<a href="${url}">Link</a>` : "")
  );
}

const sentIds = new Set();

async function pollOnce() {
  console.log(`🔎 Polling… keywords=[${KEYWORDS.join(", ")}] | twitter=${APIFY_TWITTER_ACTOR} | truth=${APIFY_TRUTH_ACTOR}`);

  try {
    const twitterInput = { handles: TWITTER_HANDLES, maxItems: 30 };
    const ds1 = await runActor(APIFY_TWITTER_ACTOR, twitterInput);
    const items1 = await fetchDatasetItems(ds1, 50);
    for (const it of items1) {
      const id = it.id || it.tweet_id || it.tweetId || it.uniqueId || it.permalink || it.url;
      const txt = it.text || it.content || it.full_text || it.title || "";
      if (!id || sentIds.has(id)) continue;
      if (!matchKeywords(txt)) continue;
      await sendTelegram(formatMessage(it, "🐦 X"));
      sentIds.add(id);
      console.log("✅ Sent X:", id);
    }
  } catch (err) {
    console.error("❌ X polling error:", err.message);
  }

  try {
    const truthInput = { username: TRUTH_USERNAME, maxItems: 20, cleanContent: true };
    const ds2 = await runActor(APIFY_TRUTH_ACTOR, truthInput);
    const items2 = await fetchDatasetItems(ds2, 50);
    for (const it of items2) {
      const id = it.id || it.postId || it.uniqueId || it.url || it.link;
      const txt = it.text || it.content || it.title || "";
      if (!id || sentIds.has(id)) continue;
      if (!matchKeywords(txt)) continue;
      await sendTelegram(formatMessage(it, "📣 Truth Social"));
      sentIds.add(id);
      console.log("✅ Sent Truth:", id);
    }
  } catch (err) {
    console.error("❌ Truth polling error:", err.message);
  }
}

(async () => {
  console.log(`🚀 Bot started. Poll=${POLL_MS}ms | Twitter=${APIFY_TWITTER_ACTOR} | Truth=${APIFY_TRUTH_ACTOR}`);
  await pollOnce();
  setInterval(pollOnce, POLL_MS);
})();
