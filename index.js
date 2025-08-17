// ===============================
// Advanced News Analyzer (Express + Telegram + Gemini + Multi-Source)
// Inspired by Trumpet Labs methodology
// ===============================

import express from "express";
import crypto from "crypto";
import cors from "cors";
import { collectNewsFromAllSources, startNewsPolling, filterNewsByKeywords } from './news-sources.js';

// ------- ENV -------
const {
  PORT = 8080,

  // Telegram
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,

  // AI Analysis
  RISK_SCORING = "on",             // שונה ל-on כברירת מחדל
  GEMINI_API_KEY,

  // News Sources
  NEWS_API_KEY,                    // NewsAPI key
  ENABLE_RSS = "true",             // איסוף מ-RSS feeds
  ENABLE_POLLING = "true",         // איסוף תקופתי
  POLLING_INTERVAL = "5",          // דקות בין איסופים

  // Keywords and rules  
  KEYWORDS = "tariff,tariffs,breaking,fed,interest rates,inflation,earnings,stock,market,trading,SEC,regulation,sanctions,trade war,merger,acquisition,ipo,crypto,bitcoin,ethereum",
  MARKET_KEYWORDS = "S&P,SPY,QQQ,NASDAQ,DOW,VIX,treasury,bond,yield,dollar,EUR,oil,gold,silver", // מילות מפתח נוספות לשוק
  WINDOW_SEC = "300",              // חלון זמן שניות לצבירת אירועים
  MIN_UNIQUE_ACCOUNTS = "2",       // כמה חשבונות שונים לפחות כדי לטריגר
  MAX_ITEMS_FETCH = "50",          

  // Webhook security
  APIFY_WEBHOOK_SECRET,            // נדרש: אותו secret ששמת ב-?secret=...
  
  // Filtering
  MIN_IMPACT_SCORE = "2",          // ציון השפעה מינימלי לשליחת התרעה
  MIN_URGENCY_SCORE = "2",         // ציון דחיפות מינימלי
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
app.use(cors()); // הוספת CORS support

// הגשת קבצים סטטיים
app.use(express.static('public'));

// טבלת “אירועים אחרונים” לזיהוי חפיפה של מילים בין כמה חשבונות
// מבנה: { keywordLc: Map<keywordLc, Array<{account, text, url, ts, source}>> }
const recentByKeyword = new Map();
// דה-דופליקציה: מזהים שנשלחו
const sentIds = new Set();

// פענוח/חלוקה של מילות מפתח
const KEYWORDS_LIST = KEYWORDS.split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const MARKET_KEYWORDS_LIST = MARKET_KEYWORDS.split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const ALL_KEYWORDS = [...KEYWORDS_LIST, ...MARKET_KEYWORDS_LIST];

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

// מחלצים טקסט/לינק/חשבון מכל מבנה אפשרי (X/Truth/RSS/News API)
function normalizeItem(raw = {}) {
  const title = 
    raw.title ||
    "";

  const text =
    raw.text ||
    raw.content ||
    raw.full_text ||
    raw.description ||
    raw.summary ||
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
    raw.publisher ||
    raw.feedName ||
    "";

  const created =
    raw.created_at ||
    raw.createdAt ||
    raw.date ||
    raw.timestamp ||
    raw.publishedAt ||
    raw.pubDate ||
    "";

  // מזהה דדופ
  const id = raw.id || raw.tweet_id || raw.tweetId || raw.postId || raw.uniqueId || raw.guid || url || (created + ":" + account + ":" + (title || text).slice(0, 50));

  return { id, title, text, url, account, created };
}

// מחפשים אילו מילות מפתח מופיעות בטקסט
function extractMatchedKeywords(text = "", title = "") {
  const searchText = `${text} ${title}`.toLowerCase();
  const hits = ALL_KEYWORDS.filter(k => searchText.includes(k));
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

// מערכת ניתוח מתקדמת בהשראת Trumpet Labs
async function getAdvancedAnalysis(text, source, account) {
  if (RISK_SCORING !== "on") return {
    impact: "🔍 ניתוח כבוי (RISK_SCORING=off)",
    urgency: "N/A",
    sentiment: "N/A",
    tickers: [],
    summary: "ניתוח כבוי"
  };
  
  if (!GEMINI_API_KEY) return {
    impact: "⚠️ חסר GEMINI_API_KEY",
    urgency: "N/A", 
    sentiment: "N/A",
    tickers: [],
    summary: "חסר מפתח API"
  };

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
`Analyze this financial/market-related post from ${source} by @${account} and provide a comprehensive analysis:

POST TEXT: "${text}"

Please analyze and return a JSON object with the following structure (return ONLY valid JSON, no extra text):
{
  "impact_score": "1-5 scale where 5=highest market impact",
  "impact_label": "one of: No Impact|Low Impact|Medium Impact|High Impact|Critical Impact",
  "urgency_level": "1-5 scale where 5=most urgent",
  "urgency_label": "one of: Low|Medium|High|Critical|Emergency", 
  "sentiment": "one of: Very Negative|Negative|Neutral|Positive|Very Positive",
  "confidence": "1-10 scale for analysis confidence",
  "tickers": ["array of relevant stock symbols mentioned or implied"],
  "sectors": ["array of relevant market sectors affected"],
  "summary": "brief 1-2 sentence summary of market implications",
  "reasoning": "brief explanation of the analysis"
}

Focus on:
- Market moving potential (earnings, policy changes, trade, regulations)
- Time sensitivity (breaking news vs regular updates)
- Sentiment impact on markets
- Specific companies/sectors mentioned or implied
- Economic indicators and policy implications`
                }
              ]
            }
          ]
        }),
      }
    );
    
    const data = await resp.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!rawText) {
      throw new Error(data?.error?.message || "No result from Gemini");
    }

    // ננסה לחלץ JSON מהתשובה
    let analysis;
    try {
      // אם יש backticks או טקסט נוסף, ננסה לחלץ רק את ה-JSON
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : rawText;
      analysis = JSON.parse(jsonText);
    } catch (parseErr) {
      // אם לא הצלחנו לפרסר, נחזיר ניתוח בסיסי
      return {
        impact: "⚠️ שגיאת פרסור",
        urgency: "N/A",
        sentiment: "N/A", 
        tickers: [],
        summary: rawText.substring(0, 100) + "..."
      };
    }

    // נבנה תשובה מובנית
    const impactEmoji = {
      "No Impact": "❌", 
      "Low Impact": "🔵",
      "Medium Impact": "🟡", 
      "High Impact": "🟠",
      "Critical Impact": "🚨"
    };

    const urgencyEmoji = {
      "Low": "🔽",
      "Medium": "➡️", 
      "High": "🔼",
      "Critical": "⚠️",
      "Emergency": "🚨"
    };

    const sentimentEmoji = {
      "Very Negative": "📉📉",
      "Negative": "📉", 
      "Neutral": "➖",
      "Positive": "📈",
      "Very Positive": "📈📈"
    };

    return {
      impact: `${impactEmoji[analysis.impact_label] || "❓"} ${analysis.impact_label} (${analysis.impact_score}/5)`,
      urgency: `${urgencyEmoji[analysis.urgency_label] || "❓"} ${analysis.urgency_label} (${analysis.urgency_level}/5)`,
      sentiment: `${sentimentEmoji[analysis.sentiment] || "❓"} ${analysis.sentiment}`,
      confidence: `🎯 ${analysis.confidence}/10`,
      tickers: analysis.tickers || [],
      sectors: analysis.sectors || [],
      summary: analysis.summary || "ללא סיכום",
      reasoning: analysis.reasoning || "ללא הסבר",
      raw_scores: {
        impact: analysis.impact_score,
        urgency: analysis.urgency_level,
        confidence: analysis.confidence
      }
    };
    
  } catch (err) {
    return {
      impact: "⚠️ Gemini error: " + err.message,
      urgency: "N/A",
      sentiment: "N/A",
      tickers: [],
      summary: "שגיאה בניתוח"
    };
  }
}

// בונים הודעת טלגרם מתקדמת בהשראת Trumpet Labs
async function buildTelegramMessage({ source, account, created, text, url, keyword, title }) {
  const contentForAnalysis = title ? `${title}\n${text || ''}` : text;
  const analysis = await getAdvancedAnalysis(contentForAnalysis, source, account);
  
  const safeTitle = title ? htmlEscape(title) : "";
  const safeText = htmlEscape(text || "");
  
  // איקונים לפי מקור
  const srcIcon = {
    "truth": "📣 Truth Social",
    "twitter": "🐦 X", 
    "news_polling": "📰 News Feed",
    "rss": "📡 RSS",
    "newsapi": "📰 NewsAPI",
    "yahoo_finance": "💰 Yahoo Finance"
  }[source] || "📰 News Source";

  const when = created ? `<i>${htmlEscape(created)}</i>\n` : "";
  const handle = account ? `<b>@${htmlEscape(account)}</b>\n` : "";
  const kw = keyword ? `<code>#${htmlEscape(keyword)}</code>\n` : "";
  const link = url ? `<a href="${htmlEscape(url)}">🔗 Link</a>` : "";

  // כותרת אם יש
  const titleText = safeTitle ? `<b>"${safeTitle}"</b>\n` : "";
  const bodyText = safeText ? `${safeText}\n` : "";

  // בניית רשימת טיקרים אם יש
  const tickersText = analysis.tickers && analysis.tickers.length > 0 
    ? `\n📊 <b>Tickers:</b> ${analysis.tickers.map(t => `$${t}`).join(', ')}`
    : "";
  
  // בניית רשימת סקטורים אם יש  
  const sectorsText = analysis.sectors && analysis.sectors.length > 0
    ? `\n🏭 <b>Sectors:</b> ${analysis.sectors.join(', ')}`
    : "";

  return (
    `🚨 <b>Market Alert - Multi-Source Detection</b>\n` +
    `${kw}${srcIcon}\n` +
    handle +
    when +
    titleText +
    bodyText +
    `\n📈 <b>MARKET ANALYSIS:</b>\n` +
    `• <b>Impact:</b> ${analysis.impact}\n` +
    `• <b>Urgency:</b> ${analysis.urgency}\n` +
    `• <b>Sentiment:</b> ${analysis.sentiment}\n` +
    `• <b>Confidence:</b> ${analysis.confidence}\n` +
    tickersText +
    sectorsText +
    `\n\n💡 <b>Summary:</b> ${htmlEscape(analysis.summary)}\n` +
    `🧠 <b>Analysis:</b> ${htmlEscape(analysis.reasoning)}\n\n` +
    `${link}`
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
    title: latest.title
  });

  await sendTelegram(msg);
}

// עיבוד ידיעות מכל המקורות (לא רק webhook)
async function processNewsItems(newsItems, source = "news") {
  if (!Array.isArray(newsItems) || newsItems.length === 0) return 0;

  cleanupOldWindow();
  let processed = 0;

  for (const raw of newsItems) {
    const it = normalizeItem(raw);
    if (!it.text && !it.title) continue;

    // דה-דופ
    const hash = crypto
      .createHash("md5")
      .update(it.id || `${it.account}-${it.text}-${it.title}`)
      .digest("hex");
    if (sentIds.has(hash)) continue;

    // התאמות מילות מפתח (כולל title)
    const hits = extractMatchedKeywords(it.text, it.title);
    if (hits.length === 0) continue;

    // קבלת ניתוח מתקדם לפני שליחה
    let shouldSend = false;
    if (RISK_SCORING === "on" && GEMINI_API_KEY) {
      const analysis = await getAdvancedAnalysis(it.text || it.title, source, it.account);
      
      // בדיקה האם עובר את הסף המינימלי
      const impactScore = analysis.raw_scores?.impact || 1;
      const urgencyScore = analysis.raw_scores?.urgency || 1;
      
      if (impactScore >= Number(MIN_IMPACT_SCORE) || urgencyScore >= Number(MIN_URGENCY_SCORE)) {
        shouldSend = true;
      }
    } else {
      shouldSend = true; // אם אין ניתוח, נשלח הכל
    }

    if (shouldSend) {
      sentIds.add(hash);

      // לכל מילת מפתח—נרשום אירוע
      for (const kw of hits) {
        const entry = {
          account: it.account || "unknown",
          text: it.text,
          title: it.title,
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
  }

  return processed;
}

// פונקציה להתחלת איסוף חדשות תקופתי
function startNewsCollection() {
  if (ENABLE_POLLING !== "true") {
    console.log("📰 News polling disabled (ENABLE_POLLING=false)");
    return null;
  }

  const intervalMinutes = Number(POLLING_INTERVAL) || 5;
  
  const polling = startNewsPolling(intervalMinutes, async (newNews) => {
    console.log(`📰 Processing ${newNews.length} new news items...`);
    
    // פילטור לפי מילות מפתח
    const relevantNews = filterNewsByKeywords(newNews, ALL_KEYWORDS);
    
    if (relevantNews.length > 0) {
      const processed = await processNewsItems(relevantNews, "news_polling");
      console.log(`✅ Processed ${processed} relevant news items`);
    }
  });

  console.log(`📡 Started news collection with ${intervalMinutes} min intervals`);
  return polling;
}

// ------- Web server routes -------

// דף בית - הפניה לממשק הויזואלי או מידע API
app.get("/api", (req, res) => {
  res.type("text/plain").send("Advanced News Analyzer API - Inspired by Trumpet Labs\n\nEndpoints:\n/health - System status\n/debug - Configuration\n/test/telegram - Test telegram\n/collect/news - Manual news collection\n/analyze/text - Analyze specific text\n\nVisual Interface: /");
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
    version: "2.0.0 - Advanced News Analyzer",
    env: {
      TELEGRAM_BOT_TOKEN: TELEGRAM_BOT_TOKEN ? "set" : "missing",
      TELEGRAM_CHAT_ID: TELEGRAM_CHAT_ID ? "set" : "missing",
      RISK_SCORING,
      GEMINI_API_KEY: GEMINI_API_KEY ? "set" : "missing",
      NEWS_API_KEY: NEWS_API_KEY ? "set" : "missing",
      APIFY_WEBHOOK_SECRET: APIFY_WEBHOOK_SECRET ? "set" : "missing",
      ENABLE_RSS,
      ENABLE_POLLING,
      POLLING_INTERVAL: Number(POLLING_INTERVAL),
      MIN_IMPACT_SCORE: Number(MIN_IMPACT_SCORE),
      MIN_URGENCY_SCORE: Number(MIN_URGENCY_SCORE),
      PRIMARY_KEYWORDS: KEYWORDS_LIST,
      MARKET_KEYWORDS: MARKET_KEYWORDS_LIST,
      TOTAL_KEYWORDS: ALL_KEYWORDS.length,
      WINDOW_SEC: Number(WINDOW_SEC),
      MIN_UNIQUE_ACCOUNTS: MIN_ACCOUNTS,
    },
    memory: {
      recentByKeywordSize: recentByKeyword.size,
      sentIdsSize: sentIds.size,
    },
    features: {
      multiSourceCollection: true,
      advancedAnalysis: RISK_SCORING === "on" && !!GEMINI_API_KEY,
      rssFeeds: ENABLE_RSS === "true",
      newsPolling: ENABLE_POLLING === "true",
      impactFiltering: true,
      tickerDetection: true,
      sentimentAnalysis: true
    },
    now: new Date().toISOString(),
  });
});

// בדיקת טלגרם ידנית
app.get("/test/telegram", async (req, res) => {
  const text = req.query.text || "בדיקת בוט מתקדם ✅";
  const r = await sendTelegram(`Test: ${htmlEscape(text)}\n\nTime: ${new Date().toISOString()}`);
  res.json({ ok: true, result: r || null });
});

// איסוף חדשות ידני
app.get("/collect/news", async (req, res) => {
  try {
    console.log("🔄 Manual news collection triggered...");
    const news = await collectNewsFromAllSources({
      newsApiKey: NEWS_API_KEY,
      includeRSS: ENABLE_RSS === "true",
      includeNewsAPI: !!NEWS_API_KEY,
      includeYahoo: true,
      maxItemsPerSource: 20
    });

    const relevantNews = filterNewsByKeywords(news, ALL_KEYWORDS);
    const processed = await processNewsItems(relevantNews, "manual_collection");

    res.json({
      ok: true,
      total_collected: news.length,
      relevant_items: relevantNews.length,
      processed_items: processed,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Manual collection error:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ניתוח טקסט ספציפי
app.post("/analyze/text", async (req, res) => {
  try {
    const { text, source = "manual", account = "user" } = req.body;
    
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text parameter" });
    }

    const analysis = await getAdvancedAnalysis(text, source, account);
    const keywords = extractMatchedKeywords(text);

    res.json({
      ok: true,
      input: { text, source, account },
      analysis,
      matched_keywords: keywords,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Text analysis error:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// GET version של ניתוח טקסט
app.get("/analyze/text", async (req, res) => {
  try {
    const { text, source = "manual", account = "user" } = req.query;
    
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text parameter" });
    }

    const analysis = await getAdvancedAnalysis(text, source, account);
    const keywords = extractMatchedKeywords(text);

    res.json({
      ok: true,
      input: { text, source, account },
      analysis,
      matched_keywords: keywords,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Text analysis error:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
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

// משתנה גלובלי לשמירת הפולינג
let newsPollingInstance = null;

app.listen(PORT, () => {
  console.log(`🚀 Advanced News Analyzer running on :${PORT}`);
  console.log(`📊 Analysis Mode: ${RISK_SCORING === "on" ? "ENABLED" : "DISABLED"}`);
  console.log(`🔑 Keywords: ${ALL_KEYWORDS.length} total`);
  console.log(`📡 RSS Collection: ${ENABLE_RSS === "true" ? "ENABLED" : "DISABLED"}`);
  console.log(`⏱️ Polling: ${ENABLE_POLLING === "true" ? `ENABLED (${POLLING_INTERVAL} min)` : "DISABLED"}`);
  
  // הפעלת איסוף חדשות תקופתי
  if (ENABLE_POLLING === "true") {
    newsPollingInstance = startNewsCollection();
  }
});

// טיפול בסגירה נקייה
process.on('SIGTERM', () => {
  console.log('📴 Shutting down gracefully...');
  if (newsPollingInstance) {
    newsPollingInstance.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Shutting down gracefully...');
  if (newsPollingInstance) {
    newsPollingInstance.stop();
  }
  process.exit(0);
});
