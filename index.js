// index.js  — גרסת UI+Webhook+Trade (פשוטה ומעשית)
// Trumpet Labs inspired trading system
import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());
app.use(express.static('public')); // הגשת קבצים סטטיים

// ===== ENV =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;   // חובה
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;     // חובה
const APIFY_WEBHOOK_SECRET = process.env.APIFY_WEBHOOK_SECRET || "mysecret123";

const TRADE_PANEL_SECRET = process.env.TRADE_PANEL_SECRET || APIFY_WEBHOOK_SECRET; // לאותו שימוש
const RISK_SCORING = (process.env.RISK_SCORING || "on").toLowerCase() === "on";

const WINDOW_SEC = Number(process.env.WINDOW_SEC || 300);
const MIN_UNIQUE_ACCOUNTS = Number(process.env.MIN_UNIQUE_ACCOUNTS || 2);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // אופציונלי (RISK_SCORING)
const PORT = process.env.PORT || 8080;

// Twitter accounts to monitor
const MONITORED_ACCOUNTS = ["FirstSquawk", "DeItaone"];

// ===== Helpers =====
async function tgSend(html) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Telegram envs missing");
    return;
  }
  try {
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }, { timeout: 15000 });
    console.log("✅ Telegram message sent successfully");
    return response.data;
  } catch (e) {
    console.error("⚠️ Telegram send error:", e?.response?.data || e.message);
    throw e;
  }
}

async function tgSendWithButtons(html, alertId) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Telegram envs missing");
    return;
  }
  
  try {
    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "🟢 BUY CALL (+0.5%)",
            callback_data: JSON.stringify({
              action: "trade",
              side: "CALL",
              alertId: alertId,
              distance: 0.5
            })
          },
          {
            text: "🔴 BUY PUT (-0.5%)",
            callback_data: JSON.stringify({
              action: "trade", 
              side: "PUT",
              alertId: alertId,
              distance: 0.5
            })
          }
        ],
        [
          {
            text: "💰 $10K CALL",
            callback_data: JSON.stringify({
              action: "trade",
              side: "CALL", 
              alertId: alertId,
              budget: 10000
            })
          },
          {
            text: "💸 $10K PUT",
            callback_data: JSON.stringify({
              action: "trade",
              side: "PUT",
              alertId: alertId, 
              budget: 10000
            })
          }
        ],
        [
          {
            text: "📊 SPX Price",
            callback_data: JSON.stringify({
              action: "price"
            })
          },
          {
            text: "📈 Market Analysis", 
            callback_data: JSON.stringify({
              action: "analysis",
              alertId: alertId
            })
          }
        ]
      ]
    };

    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: keyboard
    }, { timeout: 15000 });
    
    console.log("✅ Telegram message with buttons sent successfully");
    return response.data;
  } catch (e) {
    console.error("⚠️ Telegram send with buttons error:", e?.response?.data || e.message);
    // Fallback to regular message if buttons fail
    return await tgSend(html);
  }
}

function getSentimentDisplay(sentiment) {
  switch(sentiment?.toLowerCase()) {
    case 'positive': return '📈';
    case 'negative': return '📉';  
    case 'neutral': return '➖';
    default: return '❓';
  }
}

function getImpactDisplay(impact) {
  switch(impact?.toLowerCase()) {
    case 'high': return '🚨';
    case 'medium': return '⚠️';
    case 'low': return '🔔';
    default: return '❓';
  }
}

function getUrgencyDisplay(urgency) {
  switch(urgency?.toLowerCase()) {
    case 'high': return '⚡';
    case 'medium': return '🕒';
    case 'low': return '🐌';
    default: return '❓';
  }
}

async function tgSendWithTradeButtons(html, tradeData) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Telegram envs missing");
    return;
  }
  
  try {
    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✅ CONFIRM TRADE",
            callback_data: JSON.stringify({
              action: "confirm_trade",
              tradeId: tradeData.id,
              side: tradeData.side,
              strike: tradeData.suggestedStrike
            })
          },
          {
            text: "❌ CANCEL",
            callback_data: JSON.stringify({
              action: "cancel_trade",
              tradeId: tradeData.id
            })
          }
        ],
        [
          {
            text: "📊 Current SPX Price",
            callback_data: JSON.stringify({
              action: "spx_price"
            })
          },
          {
            text: "⚙️ Modify Trade",
            callback_data: JSON.stringify({
              action: "modify_trade", 
              tradeId: tradeData.id
            })
          }
        ],
        [
          {
            text: "💡 Strategy Analysis",
            callback_data: JSON.stringify({
              action: "strategy_analysis",
              side: tradeData.side,
              strike: tradeData.suggestedStrike,
              spot: tradeData.currentSpot
            })
          }
        ]
      ]
    };

    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: html,
      parse_mode: "HTML", 
      disable_web_page_preview: true,
      reply_markup: keyboard
    }, { timeout: 15000 });
    
    console.log("✅ Telegram trade message with buttons sent successfully");
    return response.data;
  } catch (e) {
    console.error("⚠️ Telegram trade buttons error:", e?.response?.data || e.message);
    // Fallback to regular message
    return await tgSend(html);
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// RISK scoring (אופציונלי) עם Gemini REST
async function riskScoreWithGemini({ text, title = "" }) {
  if (!RISK_SCORING || !GEMINI_API_KEY) {
    return { impact: "medium", urgency: "medium", sentiment: "neutral", confidence: 50, reasons: ["ניתוח AI כבוי"] };
  }
  try {
    const content = title ? `${title}\n\n${text}` : text;
    const prompt = [
      "You are a professional market analyst. Rate this news/social media post for trading impact.",
      "Consider: market moving potential, time sensitivity, sector impact, volatility implications.",
      "",
      "Return ONLY valid JSON with these exact keys:",
      '{"impact":"low|medium|high","urgency":"low|medium|high","sentiment":"negative|neutral|positive","confidence_pct":0-100,"reasons":["reason1","reason2","reason3"]}',
      "",
      "Content to analyze:",
      content.slice(0, 4000)
    ].join("\n");

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_API_KEY;
    const body = {
      contents: [{ parts: [{ text: prompt }]}],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512
      }
    };
    
    const { data } = await axios.post(url, body, { timeout: 20000 });
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    // נסה לחלץ JSON מהתשובה
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    let parsed;
    try { 
      parsed = JSON.parse(jsonStr); 
    } catch { 
      console.log("Gemini raw response:", raw);
      parsed = {}; 
    }

    return {
      impact: (parsed.impact || "medium"),
      urgency: (parsed.urgency || "medium"),
      sentiment: (parsed.sentiment || "neutral"),
      confidence: Number(parsed.confidence_pct || 50),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0,4) : ["ניתוח AI זמין"],
    };
  } catch (e) {
    console.error("Gemini error:", e?.response?.data || e.message);
    return { impact: "medium", urgency: "medium", sentiment: "neutral", confidence: 25, reasons: ["שגיאת AI"] };
  }
}

// ===== Memory for "echo" logic (2+ חשבונות באותו חלון זמן) =====
const hitsByKeyword = new Map(); // keyword -> [{account, ts, text}]
const alertHistory = []; // שמירת היסטוריית ידיעות

function registerHit(keyword, account, text = "") {
  const now = Date.now();
  const arr = (hitsByKeyword.get(keyword) || []).filter(r => now - r.ts <= WINDOW_SEC*1000);
  arr.push({ account, ts: now, text });
  hitsByKeyword.set(keyword, arr);
  const uniqAccounts = new Set(arr.map(a => a.account)).size;
  return { count: uniqAccounts, matches: arr };
}

// חילוץ מילות מפתח מטקסט
function extractKeywords(text) {
  const keywords = [
    // Geopolitical Events
    'invasion', 'attack', 'war', 'missile launch', 'cyberattack',
    'sanctions', 'embargo', 'tariffs', 'nuclear', 'naval blockade',
    'escalation', 'terrorist attack', 'assassination',
    
    // Fed & Central Bank
    'fed', 'fomc', 'emergency meeting', 'emergency cut',
    'rate hike', 'rate cut', 'powell',
    
    // Financial Crisis
    'financial crisis', 'credit crisis', 'contagion', 'default',
    'bankruptcy', 'sovereign downgrade', 'halts trading',
    
    // Health & Natural Disasters  
    'pandemic', 'outbreak', 'grid failure', 'earthquake',
    'tsunami', 'volcanic eruption',
    
    // Key Figures
    'trump', 'xi jinping', 'putin',
    
    // Market Keywords
    'breaking', 'urgent', 'alert', 'spy', 'qqq', 'vix'
  ];
  
  const lowerText = text.toLowerCase();
  return keywords.filter(keyword => lowerText.includes(keyword));
}

// ===== SPX Options Calculator =====
async function getCurrentSPXPrice() {
  try {
    // Try to get real SPX price from Yahoo Finance
    const response = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ESPX', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const data = response.data;
    if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
      const price = data.chart.result[0].meta.regularMarketPrice;
      console.log(`📊 Real SPX price: $${price}`);
      return Number(price.toFixed(2));
    }
    
    throw new Error('No price data in response');
  } catch (e) {
    console.error("Error getting real SPX price:", e.message);
    console.log("📉 Falling back to simulated price");
    
    // Fallback to simulated price with more realistic movement
    const basePrice = 5500;
    const mockPrice = basePrice + (Math.random() * 100 - 50);
    return Number(mockPrice.toFixed(2));
  }
}

function calculateStrike(spotPrice, side, distancePct = 0.5) {
  const move = spotPrice * (distancePct / 100);
  const strikeFloat = side === "PUT" ? (spotPrice - move) : (spotPrice + move);
  // עיגול סטרייק ל־5 נק' הקרוב (נהוג ב-SPX)
  return Math.round(strikeFloat / 5) * 5;
}

function getNextExpiry() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentHour = now.getHours();
  
  // אם אחרי 4 PM EST, עבור למחרת
  if (currentHour >= 16) {
    today.setDate(today.getDate() + 1);
  }
  
  // SPX options expire Monday, Wednesday, Friday + end of month
  const dayOfWeek = today.getDay();
  let daysToAdd = 0;
  
  if (dayOfWeek === 0) daysToAdd = 1; // Sunday -> Monday
  else if (dayOfWeek === 1) daysToAdd = 0; // Monday
  else if (dayOfWeek === 2) daysToAdd = 1; // Tuesday -> Wednesday  
  else if (dayOfWeek === 3) daysToAdd = 0; // Wednesday
  else if (dayOfWeek === 4) daysToAdd = 1; // Thursday -> Friday
  else if (dayOfWeek === 5) daysToAdd = 0; // Friday
  else if (dayOfWeek === 6) daysToAdd = 2; // Saturday -> Monday
  
  today.setDate(today.getDate() + daysToAdd);
  
  const expiry = today.toISOString().split('T')[0];
  const dte = Math.max(0, Math.ceil((today - now) / (24 * 60 * 60 * 1000)));
  
  return { date: expiry, dte: dte === 0 ? "0DTE" : `${dte}DTE` };
}

// ===== Routes =====

// בריאות / דיאגנוסטיקה
app.get("/", (req, res) => {
  res.sendFile('index.html', { root: './public' });
});

app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    version: "Trumpet-Style Trading System v3.1",
    env: {
      TELEGRAM_BOT_TOKEN: TELEGRAM_BOT_TOKEN ? "set" : "missing",
      TELEGRAM_CHAT_ID: TELEGRAM_CHAT_ID ? "set" : "missing",
      RISK_SCORING: RISK_SCORING ? "on" : "off",
      GEMINI_API_KEY: GEMINI_API_KEY ? "set" : "missing",
      APIFY_WEBHOOK_SECRET: APIFY_WEBHOOK_SECRET ? "set" : "missing",
      TRADE_PANEL_SECRET: TRADE_PANEL_SECRET ? "set" : "missing",
    },
    config: {
      monitored_accounts: MONITORED_ACCOUNTS,
      window_seconds: WINDOW_SEC,
      min_unique_accounts: MIN_UNIQUE_ACCOUNTS
    },
    memory: {
      active_keywords: hitsByKeyword.size,
      alert_history: alertHistory.length
    },
    now: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    ok: true, 
    status: "healthy",
    timestamp: new Date().toISOString() 
  });
});

// 1) קליטת ידיעה מהבוט / Apify / Wized → מציג בטלגרם ומחזיר נתונים ל-UI
app.post("/web/alert", async (req, res) => {
  try {
    const token = req.headers["x-auth-token"];
    if (!token || token !== APIFY_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const {
      source = "twitter",
      handle = "",
      posted_at = new Date().toISOString(),
      title = "",
      original_text = "",
      original_url = "",
      tags = [],
      sectors = [],
      signature = "",
      keyword = "",     // אם יש מילה מרכזית – טוב לאקו
    } = req.body || {};

    // חילוץ מילות מפתח מהטקסט
    const detectedKeywords = extractKeywords(original_text + " " + title);
    const primaryKeyword = keyword || detectedKeywords[0] || "alert";

    // ציור "echo" (2+ חשבונות מעידים על אותו keyword בזמן קצר)
    let echoNote = "";
    let crossMatch = false;
    if (primaryKeyword && handle && MONITORED_ACCOUNTS.includes(handle)) {
      const result = registerHit(primaryKeyword.toLowerCase(), handle.toLowerCase(), original_text);
      if (result.count >= MIN_UNIQUE_ACCOUNTS) {
        echoNote = `\n<b>🚨 CROSS-MATCH ALERT!</b> זוהו ${result.count} חשבונות מנטורים מדברים על "${esc(primaryKeyword)}" ב-${WINDOW_SEC}s האחרונים.`;
        crossMatch = true;
      }
    }

    // ניתוח AI (אופציונלי)
    const risk = await riskScoreWithGemini({ text: original_text, title });

    // הרכבת הודעת טלגרם עם כפתורי מסחר
    const icon = source === "x" || source === "twitter" ? "🐦" : source === "news" ? "📰" : "📣";
    
    // שיפור הצגת סנטימנט עם אייקונים
    const sentimentDisplay = getSentimentDisplay(risk.sentiment);
    const impactDisplay = getImpactDisplay(risk.impact);
    const urgencyDisplay = getUrgencyDisplay(risk.urgency);
    
    const html = [
      `<b>${icon} ${esc(title || "Market Alert")}</b>`,
      handle ? `<b>@${esc(handle)}</b> — <i>${esc(posted_at)}</i>` : `<i>${esc(posted_at)}</i>`,
      "",
      `<i>"${esc(original_text)}"</i>`,
      original_url ? `\n🔗 <a href="${original_url}">View Source</a>` : "",
      "",
      `🧠 <b>AI ANALYSIS:</b>`,
      `${impactDisplay} Impact: <b>${risk.impact.toUpperCase()}</b>`,
      `${urgencyDisplay} Urgency: <b>${risk.urgency.toUpperCase()}</b>`,
      `${sentimentDisplay} Sentiment: <b>${risk.sentiment.toUpperCase()}</b> (${risk.confidence}%)`,
      "",
      risk.reasons?.length ? (`💡 <b>Analysis:</b>\n• ${risk.reasons.join("\n• ")}`) : "",
      "",
      detectedKeywords?.length ? `🔑 <b>Keywords:</b> ${detectedKeywords.join(", ")}` : "",
      tags?.length ? `🏷️ <b>Tags:</b> ${tags.map(t => "#"+t).join(" ")}` : "",
      sectors?.length ? `🏭 <b>Sectors:</b> ${sectors.join(", ")}` : "",
      echoNote,
      "",
      `<i>⚠️ Analysis for informational purposes only</i>`,
    ].filter(Boolean).join("\n");

    // שמירה בהיסטוריה
    const alertData = {
      id: Date.now().toString(),
      title, source, handle, posted_at,
      analysis_summary: risk.reasons?.join(" • "),
      impact_level: risk.impact, 
      urgency_level: risk.urgency,
      sentiment: risk.sentiment, 
      confidence_pct: risk.confidence,
      tags, sectors, original_text, original_url, signature,
      keywords: detectedKeywords,
      echo_accounts: crossMatch ? "yes" : "no",
      cross_match: crossMatch,
      timestamp: Date.now()
    };
    
    alertHistory.unshift(alertData);
    if (alertHistory.length > 100) alertHistory.pop(); // שמירת 100 ידיעות אחרונות

    // שליחת הודעה (מתחילים עם גרסה פשוטה)
    try {
      await tgSendWithButtons(html, alertData.id);
    } catch (error) {
      console.log("⚠️ Button message failed, sending regular message:", error.message);
      await tgSend(html);
    }

    console.log(`📰 Alert processed: ${title} from @${handle} - Cross-match: ${crossMatch}`);

    // מחזירים למי שקרא אותנו (Wized / CMS) כדי שידע לשמור/להציג
    return res.json({
      ok: true,
      alert: alertData,
      cross_match: crossMatch
    });
  } catch (e) {
    console.error("Alert processing error:", e);
    return res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

// 2) שליחת "בקשת מסחר ידנית" מה-UI (Preview בלבד בבסיס)
app.post("/trade", async (req, res) => {
  try {
    const token = req.headers["x-auth-token"];
    if (!token || token !== TRADE_PANEL_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const {
      symbol = "SPX",
      side = "CALL",            // PUT / CALL
      distancePct = 0.5,       // אחוז מהכסף (למשל 0.5)
      expiryHint = "auto",     // auto / 0DTE / 1DTE
      budgetUsd = 10000,       // תקציב כולל
      spot = null,             // אם תשלח ספוט מה-UI — טוב, אחרת נבקש אוטומטית
      alertId = null,          // ID של הידיעה שמבוססים עליה
      reason = ""              // סיבה למסחר
    } = req.body || {};

    if (symbol !== "SPX") {
      return res.status(400).json({ ok:false, error:"only_spx_supported" });
    }

    // קבלת מחיר SPX נוכחי
    const currentSpot = spot || await getCurrentSPXPrice();
    
    if (!currentSpot || currentSpot <= 0) {
      return res.status(400).json({ ok:false, error:"unable_to_get_spx_price" });
    }

    // חישוב סטרייק מוצע
    const suggestedStrike = calculateStrike(currentSpot, side, distancePct);
    
    // קביעת פקיעה
    const expiryInfo = getNextExpiry();
    const finalExpiry = expiryHint === "auto" ? expiryInfo : { date: expiryHint, dte: expiryHint };

    // "כמות משוערת" — כאן רק הצגה סימלית. 
    // בפועל צריך פרמיית שוק כדי לחשב כמות מדויקת.
    const estPremium = side === "CALL" ? 
      Math.max(0, suggestedStrike - currentSpot + 50) : 
      Math.max(0, currentSpot - suggestedStrike + 50);
    const estQuantity = Math.floor(budgetUsd / (estPremium * 100));

    // שליחת אישור לטלגרם (Audit Trail) עם כפתורי אישור
    const sideEmoji = side === 'CALL' ? '🟢📈' : '🔴📉';
    const profitPotential = side === 'CALL' ? 'Bullish Position' : 'Bearish Position';
    
    const msg = [
      `${sideEmoji} <b>SPX ${side} Trade Preview</b>`,
      ``,
      `🎯 <b>Contract Details:</b>`,
      `Symbol: <b>${symbol}</b>`,
      `Direction: <b>${side} ${profitPotential}</b>`,
      `Current Spot: <b>$${currentSpot.toLocaleString()}</b>`,
      `Target Strike: <b>${suggestedStrike}</b> (${distancePct}% ${side === 'CALL' ? 'OTM' : 'ITM'})`,
      `Expiration: <b>${finalExpiry.date} (${finalExpiry.dte})</b>`,
      ``,
      `💰 <b>Order Details:</b>`,
      `Budget: <b>$${budgetUsd.toLocaleString()}</b>`,
      `Est. Premium: <b>$${estPremium.toFixed(2)}</b> per contract`,
      `Est. Quantity: <b>${Math.max(1, estQuantity)} contracts</b>`,
      `Total Est. Cost: <b>$${(Math.max(1, estQuantity) * estPremium * 100).toLocaleString()}</b>`,
      ``,
      alertId ? `📰 <b>Based on Alert:</b> #${alertId}` : "",
      reason ? `🎯 <b>Strategy:</b> ${esc(reason)}` : "",
      ``,
      `⚠️ <b>PREVIEW MODE</b> — No live order sent`,
      `🔗 Connect IBKR Gateway for live execution`
    ].filter(Boolean).join("\n");
    
    await tgSendWithTradeButtons(msg, tradeRecord);

    // שמירת רשומת המסחר
    const tradeRecord = {
      id: Date.now().toString(),
      symbol, side, currentSpot, suggestedStrike, distancePct,
      expiry: finalExpiry,
      budgetUsd, estPremium, estQuantity,
      alertId, reason,
      timestamp: Date.now(),
      status: "preview",
      mode: "manual"
    };

    console.log(`💰 Trade preview: ${side} ${symbol} ${suggestedStrike} ${finalExpiry.dte} - $${budgetUsd}`);

    // מחזירים ל-UI
    return res.json({
      ok: true,
      preview: tradeRecord,
      message: "Trade preview generated successfully"
    });
  } catch (e) {
    console.error("Trade processing error:", e);
    return res.status(500).json({ ok:false, error:"server_error", message: e.message });
  }
});

// 3) קבלת היסטוריית ידיעות
app.get("/alerts", (req, res) => {
  const { limit = 50, cross_match_only = false } = req.query;
  
  let filtered = alertHistory;
  if (cross_match_only === 'true') {
    filtered = alertHistory.filter(a => a.cross_match === true);
  }
  
  const results = filtered.slice(0, parseInt(limit));
  
  res.json({
    ok: true,
    alerts: results,
    total: filtered.length,
    cross_matches: alertHistory.filter(a => a.cross_match).length,
    timestamp: new Date().toISOString()
  });
});

// 4) בדיקת טלגרם
app.get("/test/telegram", async (req, res) => {
  const message = req.query.message || "🧪 Test message from Trumpet-Style Trading System";
  
  try {
    const result = await tgSend(`<b>System Test</b>\n\n${esc(message)}\n\nTime: ${new Date().toISOString()}`);
    res.json({ 
      ok: true, 
      message: "Telegram test successful",
      result 
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: "Telegram test failed",
      message: error.message 
    });
  }
});

// 5) קבלת מחיר SPX נוכחי
app.get("/spx/price", async (req, res) => {
  try {
    const price = await getCurrentSPXPrice();
    const expiry = getNextExpiry();
    
    res.json({
      ok: true,
      price,
      next_expiry: expiry,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 6) חישוב strikes לפי פרמטרים
app.get("/spx/strikes", async (req, res) => {
  try {
    const { distances = "0.25,0.5,1.0" } = req.query;
    const price = await getCurrentSPXPrice();
    const distanceList = distances.split(',').map(d => parseFloat(d.trim()));
    
    const strikes = {
      spot: price,
      calls: {},
      puts: {}
    };
    
    distanceList.forEach(dist => {
      strikes.calls[`${dist}%`] = calculateStrike(price, "CALL", dist);
      strikes.puts[`${dist}%`] = calculateStrike(price, "PUT", dist);
    });
    
    res.json({
      ok: true,
      strikes,
      expiry: getNextExpiry(),
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 7) Telegram Webhook לטיפול בלחיצות כפתורים
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    
    // טיפול בלחיצות על כפתורים (callback_query)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = JSON.parse(callbackQuery.data);
      const chatId = callbackQuery.message.chat.id;
      
      console.log(`🔘 Button pressed: ${data.action}`);
      
      let responseText = "";
      
      switch (data.action) {
        case "trade":
          const currentPrice = await getCurrentSPXPrice();
          const strike = calculateStrike(currentPrice, data.side, data.distance || 0.5);
          const budget = data.budget || 10000;
          
          responseText = `🎯 <b>${data.side} Trade Prepared</b>\n\nSPX: $${currentPrice}\nStrike: ${strike}\nBudget: $${budget.toLocaleString()}\n\n<i>Use /trade endpoint for execution</i>`;
          break;
          
        case "price":
          const spxPrice = await getCurrentSPXPrice();
          const expiry = getNextExpiry();
          responseText = `📊 <b>Current SPX Price</b>\n\nPrice: <b>$${spxPrice.toLocaleString()}</b>\nNext Expiry: <b>${expiry.date} (${expiry.dte})</b>\nTime: ${new Date().toISOString()}`;
          break;
          
        case "analysis":
          responseText = `📈 <b>Market Analysis</b>\n\nBased on Alert #${data.alertId}\n\n• Monitor price action around key levels\n• Watch for volume confirmation\n• Consider risk management\n\n<i>This is general guidance only</i>`;
          break;
          
        case "confirm_trade":
          responseText = `✅ <b>Trade Confirmed</b>\n\nTrade ID: ${data.tradeId}\n${data.side} ${data.strike}\n\n⚠️ <b>PREVIEW MODE</b>\nConnect IBKR for live execution`;
          break;
          
        case "cancel_trade":
          responseText = `❌ <b>Trade Cancelled</b>\n\nTrade ID: ${data.tradeId} cancelled successfully`;
          break;
          
        case "spx_price":
          const price = await getCurrentSPXPrice();
          responseText = `📊 <b>Live SPX Price</b>\n\n<b>$${price.toLocaleString()}</b>\n\nUpdated: ${new Date().toLocaleString()}`;
          break;
          
        default:
          responseText = `❓ Unknown action: ${data.action}`;
      }
      
      // שליחת תשובה למשתמש
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id,
        text: `Processing ${data.action}...`,
        show_alert: false
      });
      
      // שליחת הודעה חדשה עם התוצאה
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: responseText,
        parse_mode: "HTML"
      });
    }
    
    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Trumpet-Style Trading System running on port ${PORT}`);
  console.log(`📊 Monitoring accounts: ${MONITORED_ACCOUNTS.join(', ')}`);
  console.log(`🔑 Risk Scoring: ${RISK_SCORING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📱 Telegram: ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(`⏰ Cross-match window: ${WINDOW_SEC} seconds`);
  console.log(`🎯 Endpoints: /web/alert, /trade, /alerts, /spx/price, /debug, /telegram/webhook`);
});