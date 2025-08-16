// index.js
// --- Bot Web Server for alerts ---
// Endpoints: /health, /debug, /test/telegram, /simulate-error, /webhook/apify

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

const APIFY_WEBHOOK_SECRET = process.env.APIFY_WEBHOOK_SECRET || ""; // מומלץ להגדיר

const WINDOW_SEC          = Number(process.env.WINDOW_SEC || 300); // חלון זמן לצבירה (ברירת מחדל 5 דק')
const MIN_UNIQUE_ACCOUNTS = Number(process.env.MIN_UNIQUE_ACCOUNTS || 2);
const MAX_ITEMS_FETCH     = Number(process.env.MAX_ITEMS_FETCH || 50); // תקרת פריטים לעיבוד בבקשה

// ----------- Validation of basic env -----------
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ חסרים משתני סביבה: TELEGRAM_TOKEN / TELEGRAM_CHAT_ID");
}
if (!KEYWORDS.length) {
  console.warn("⚠️ KEYWORDS ריק — מומלץ להגדיר מילות מפתח רלוונטיות");
}

// ----------- App init -----------
const app = express();

// חשוב: כדי לוודא אימות חתימה, צריך לקבל את ה-raw body.
// נשתמש גם ב-raw וגם ב-json, כדי לאפשר אימות חתימה ולגשת ל-req.body אחרי זה.
app.use(
  "/webhook/apify",
  bodyParser.raw({ type: "*/*", limit: "2mb" }) // raw עבור אימות חתימה
);

// לשאר הראוטים JSON רגיל
app.use(bodyParser.json({ limit: "2mb" }));

// ----------- State / Cache -----------
// זיכרון חולף לצבירת מופעים בחלון הזמן.
// מבנה: { keyword -> { accounts: Set<string>, firstAt: number, lastAt: number, samples: Array<item> } }
const windowStore = new Map();
// דה-דופליקציה כללית לזמן החלון: שמירת מזהי פריטים שכבר טופלו
const seenIds = new Set();

// ניקוי זיכרון מדי פעם
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  // מחיקת ids ישנים
  for (const id of seenIds) {
    // אין לנו timestamps ל-id ב-Set, אז נשמור בינארי קטן בתוך windowStore בלבד
    // לכן כאן לא מנקים seenIds, כדי לא להדליף כפילויות; אם רוצים מחיקה אגרסיבית, אפשר לאפס כל N דקות.
  }
  // מחיקת אירועים שיצאו מחלון הזמן
  for (const [kw, obj] of windowStore.entries()) {
    if (now - obj.lastAt > WINDOW_SEC * 1000) {
      windowStore.delete(kw);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`🧹 ניקוי זיכרון: נמחקו ${removed} קבוצות מחלון הזמן`);
  }
}, 60 * 1000);

// ----------- Helpers -----------
function hmacEquals(apifySig, rawBody, secret) {
  try {
    if (!secret) return false;
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    // חלק מהשירותים שולחים בפורמט "sha256=...", ננקה אם יש prefix
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
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  try {
    await axios.post(url, body, { timeout: 15000 });
  } catch (err) {
    console.error("⚠️ שגיאה בשליחת טלגרם:", err?.response?.data || err.message);
  }
}

function fmtHtmlSafe(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatItemForTg(item, sourceTag = "📰") {
  const text =
    item.text || item.content || item.full_text || item.title || item.body || "";
  const url =
    item.url || item.link || item.permalink || item.tweetUrl || item.postUrl || "";
  const handle =
    item.username || item.screen_name || item.account || item.author || "";
  const created =
    item.created_at || item.createdAt || item.timestamp || item.date || "";

  const safe = fmtHtmlSafe(text);
  return (
    `<b>${sourceTag}</b> ` +
    (handle ? `<b>@${fmtHtmlSafe(handle)}</b>\n` : "") +
    (created ? `<i>${fmtHtmlSafe(created)}</i>\n` : "") +
    `${safe}\n` +
    (url ? `<a href="${fmtHtmlSafe(url)}">Link</a>` : "")
  );
}

function pushToWindow(keyword, account, sample) {
  const now = Date.now();
  if (!windowStore.has(keyword)) {
    windowStore.set(keyword, {
      accounts: new Set(),
      firstAt: now,
      lastAt: now,
      samples: [],
    });
  }
  const obj = windowStore.get(keyword);
  obj.accounts.add(account);
  obj.lastAt = now;
  if (obj.samples.length < 5) obj.samples.push(sample); // נשמור מדגם לתצוגה
  return obj.accounts.size;
}

// ----------- Routes -----------

// 1) Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "alert-bot",
    time: new Date().toISOString(),
    hasTelegram: Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID),
  });
});

// 2) Debug
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
    },
    store: w,
  });
});

// 3) test/telegram
app.get("/test/telegram", async (req, res) => {
  const msg = req.query.msg || "בדיקת טלגרם ✅";
  await sendTelegram(`<b>Test</b>\n${fmtHtmlSafe(String(msg))}`);
  res.json({ ok: true, sent: true });
});

// 4) simulate-error
app.get("/simulate-error", (req, res) => {
  const code = Number(req.query.code || 500);
  const reason = String(req.query.reason || "manual_test_error");
  console.error(`❌ simulate-error: code=${code} reason=${reason}`);
  res.status(code).json({ ok: false, code, reason });
});

// 5) נקודת Webhook מאפיפיי
app.post("/webhook/apify", async (req, res) => {
  try {
    // אימות חתימה (אם הוגדר סוד)
    // אפיפיי שולחת header "X-Apify-Signature" עם HMAC SHA256 על גוף הבקשה הגולמי
    const sigHeader =
      req.header("x-apify-signature") || req.header("X-Apify-Signature");
    const rawBody = req.body; // Buffer כי זה raw
    const verified = APIFY_WEBHOOK_SECRET
      ? hmacEquals(sigHeader, rawBody, APIFY_WEBHOOK_SECRET)
      : true; // אם אין secret — נתיר אך נדפיס אזהרה

    if (!verified) {
      console.warn("⚠️ חתימת Webhook לא אומתה. בדוק APIFY_WEBHOOK_SECRET / הגדרות וובהוק באפיפיי");
      return res.status(401).json({ ok: false, error: "invalid_signature" });
    }

    // אחרי שאימתנו, ננסה לפרש JSON מגוף raw
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (e) {
      console.error("❌ Webhook JSON parse error:", e.message);
      return res.status(400).json({ ok: false, error: "invalid_json" });
    }

    // מבנה טיפוסי של Apify webhook: payload.resource.defaultDatasetId או payload.resource.defaultKeyValueStoreId וכו'
    const src = payload?.resource || {};
    const sourceTag =
      payload?.actorId || payload?.actorRunId || payload?.eventType || "Apify";

    // ננסה להוציא פריטים ישירות אם השולח כבר שם אותם בבקשה,
    // או לחלופין נעשה פיענוח שטחי לסכמה נפוצה (results/items)
    let items =
      payload?.items ||
      payload?.results ||
      payload?.data?.items ||
      payload?.data ||
      [];

    // אם אין פריטים — לא נכשלים; נחזיר ok כדי לא להטריד את אפיפיי
    if (!Array.isArray(items)) items = [];
    if (items.length > MAX_ITEMS_FETCH) {
      items = items.slice(0, MAX_ITEMS_FETCH);
    }

    let triggers = 0;

    for (const it of items) {
      // נזהה מזהה ייחודי
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

      // טקסט לחיפוש מילות מפתח
      const text =
        it.text || it.content || it.full_text || it.title || it.body || "";
      const hits = matchKeywords(text);
      if (!hits.length) continue;

      // חשבון / יוזר למניין ייחודיות
      const account =
        it.username || it.screen_name || it.account || it.author || "unknown";

      // נשמור מדגם פנימי להצגה ב-/debug
      const sample = {
        _id: id,
        _text: text,
        _account: account,
      };

      // לכל מילת מפתח שנמצאה באייטם — נעדכן חלון
      for (const kw of hits) {
        const distinct = pushToWindow(kw, account, sample);

        // אם כמות החשבונות הייחודיים במילת המפתח ≥ הסף — שולחים התראה
        if (distinct >= MIN_UNIQUE_ACCOUNTS) {
          const group = windowStore.get(kw);
          const uCount = group?.accounts?.size || distinct;

          const title = `🚨 התאמה מרובה: "${kw}" הופיע אצל ${uCount} חשבונות ב-${WINDOW_SEC} שניות`;
          // נוסיף עד 3 דוגמאות
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
            `<i>מקור: ${fmtHtmlSafe(sourceTag)}</i>`;

          await sendTelegram(html);

          // כדי שלא נשלח שוב על אותה מילת מפתח ברצף, ננקה את הקבוצה אחרי שליחה
          windowStore.delete(kw);
          triggers++;
        }
      }
    }

    console.log(
      `✅ Webhook התקבל: items=${items.length}, triggers=${triggers}, source=${sourceTag}`
    );
    return res.json({ ok: true, items: items.length, triggers });

  } catch (err) {
    console.error("❌ Webhook handler error:", err.message);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// --- Home ---
app.get("/", (req, res) => {
  res.send("Alert bot is up. Try /health or /debug.");
});

// ----------- Start -----------
app.listen(PORT, () => {
  console.log(`✅ Webhook bot running on :${PORT}`);
});
