import express from "express";
import axios from "axios";

// ------------ ENV ------------
const PORT = process.env.PORT || 8080;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // יעד ברירת מחדל להתראות
const TELEGRAM_ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean); // מי רשאי לשלוח פקודות

const APIFY_WEBHOOK_SECRET = process.env.APIFY_WEBHOOK_SECRET || ""; // לאימות webhook
const KEYWORDS = (process.env.KEYWORDS || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);

// סף “אותה מילה ב-N חשבונות” (אם לא עובדים עם זה, אפשר להשאיר ברירת מחדל)
const WINDOW_SEC = Number(process.env.WINDOW_SEC || 300);
const MIN_UNIQUE_ACCOUNTS = Number(process.env.MIN_UNIQUE_ACCOUNTS || 2);
const MAX_ITEMS_FETCH = Number(process.env.MAX_ITEMS_FETCH || 50);

// ------------ STATE & ERROR CODES ------------
/**
 * קודי שגיאה מקוצרים שנחזיר ב-/diag וב-/status:
 * T01 – חסר TELEGRAM env
 * T02 – שליחת טלגרם נכשלה
 * W01 – קריאת webhook נדחתה (secret לא תואם)
 * W02 – webhook נקלט בלי dataset id תקין
 * A01 – כשל בקריאת dataset מ-Apify (אם משתמשים)
 * F01 – לא נמצאו התאמות מילות מפתח (מידע/Info, לא בהכרח תקלה)
 * S01 – כשל פנימי לא מטופל
 */
const ERROR_CODES = {
  TELEGRAM_ENV_MISSING: "T01",
  TELEGRAM_SEND_FAILED: "T02",
  WEBHOOK_REJECTED: "W01",
  WEBHOOK_NO_DATASET: "W02",
  APIFY_DATASET_FAIL: "A01",
  NO_KEYWORD_MATCH: "F01",
  INTERNAL_ERROR: "S01",
};

let lastError = null; // { code, at, detail }
let lastWebhookAt = null;
let lastOkAt = null;
let lastDiag = null; // נשמור תוצאת בדיקה אחרונה
let processStart = Date.now();

// זיכרון לצבירת הופעות מילים בחלון הזמן
// map: keyword -> map(accountId => timestamp)
const keywordWindow = new Map();

// ------------ HELPERS ------------
function setLastError(code, detail) {
  lastError = { code, at: new Date().toISOString(), detail };
  console.error("❌", code, detail || "");
}

function setLastOk(note) {
  lastOkAt = new Date().toISOString();
  if (note) console.log("✅", note);
}

async function sendTelegram({ chatId = TELEGRAM_CHAT_ID, text, html=false }) {
  if (!TELEGRAM_TOKEN || !chatId) {
    setLastError(ERROR_CODES.TELEGRAM_ENV_MISSING, "Missing TELEGRAM_TOKEN or chat id");
    return { ok: false, code: ERROR_CODES.TELEGRAM_ENV_MISSING };
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    [html ? "parse_mode" : "disable_web_page_preview"]: html ? "HTML" : true,
    text,
    ...(html ? { parse_mode: "HTML", disable_web_page_preview: true } : {})
  };
  try {
    const res = await axios.post(url, body, { timeout: 15000 });
    return { ok: true, result: res.data };
  } catch (err) {
    setLastError(ERROR_CODES.TELEGRAM_SEND_FAILED, err?.response?.data || err.message);
    return { ok: false, code: ERROR_CODES.TELEGRAM_SEND_FAILED, err: err?.response?.data || err.message };
  }
}

function withinWindowPurge() {
  const cutoff = Date.now() - WINDOW_SEC * 1000;
  for (const [kw, mapAcc] of keywordWindow) {
    for (const [acc, ts] of mapAcc) {
      if (ts < cutoff) mapAcc.delete(acc);
    }
    if (mapAcc.size === 0) keywordWindow.delete(kw);
  }
}

function noteKeyword(keyword, account) {
  const kw = keyword.toLowerCase();
  if (!keywordWindow.has(kw)) keywordWindow.set(kw, new Map());
  keywordWindow.get(kw).set(account, Date.now());
  withinWindowPurge();
  return keywordWindow.get(kw).size;
}

function matchKeywords(text) {
  if (!KEYWORDS.length) return null;
  const t = (text || "").toLowerCase();
  const hit = KEYWORDS.find(k => k && t.includes(k));
  return hit || null;
}

// ------------ EXPRESS APP ------------
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  return res.status(200).send("OK");
});

// דף סטטוס JSON (לבדיקה מהדפדפן/פינג)
app.get("/diag", (req, res) => {
  const now = new Date();
  const payload = {
    ok: true,
    now: now.toISOString(),
    uptime_sec: Math.floor((Date.now() - processStart) / 1000),
    env: {
      telegramConfigured: !!(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID),
      hasWebhookSecret: !!APIFY_WEBHOOK_SECRET,
      keywordsCount: KEYWORDS.length,
      windowSec: WINDOW_SEC,
      minUniqueAccounts: MIN_UNIQUE_ACCOUNTS,
      maxItemsFetch: MAX_ITEMS_FETCH
    },
    lastWebhookAt,
    lastOkAt,
    lastError
  };
  lastDiag = payload;
  res.json(payload);
});

// Webhook מ-Apify: /apify/webhook?src=x|truth&secret=...
app.post("/apify/webhook", async (req, res) => {
  try {
    const { src, secret } = req.query;
    if (!APIFY_WEBHOOK_SECRET || secret !== APIFY_WEBHOOK_SECRET) {
      setLastError(ERROR_CODES.WEBHOOK_REJECTED, `Bad secret from src=${src}`);
      return res.status(403).json({ ok: false, code: ERROR_CODES.WEBHOOK_REJECTED });
    }

    lastWebhookAt = new Date().toISOString();

    // שים לב: כש-Run מצליח, Apify שולח אובייקט run עם defaultDatasetId
    const runData = req.body?.data;
    const datasetId = runData?.defaultDatasetId;
    if (!datasetId) {
      setLastError(ERROR_CODES.WEBHOOK_NO_DATASET, `src=${src} no datasetId`);
      return res.status(200).json({ ok: true, note: "no dataset id" });
    }

    // משיכת פריטים (אפשר להשאיר כאן כ-stub אם כבר מושכים בצד אחר)
    try {
      const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=${MAX_ITEMS_FETCH}&desc=1`;
      const { data } = await axios.get(url, { timeout: 20000 });
      if (!Array.isArray(data) || data.length === 0) {
        setLastError(ERROR_CODES.NO_KEYWORD_MATCH, `src=${src} empty dataset`);
        return res.status(200).json({ ok: true, note: "empty dataset" });
      }

      // לולאה על הפריטים – דוגמה בסיסית: חיפוש מילות מפתח ושקלול חשבונות
      let triggered = [];
      for (const it of data) {
        const text = it.text || it.content || it.full_text || it.title || "";
        const hit = matchKeywords(text);
        if (!hit) continue;

        // משוך שם חשבון/יוזר מהשדות השונים
        const account =
          it.username || it.screen_name || it.author ||
          it.account || it.user || it.handle || "unknown";

        const n = noteKeyword(hit, `${src}:${account}`);
        if (n >= MIN_UNIQUE_ACCOUNTS) {
          triggered.push({ keyword: hit, accounts: n, sampleAccount: account });
        }
      }

      if (triggered.length === 0) {
        setLastError(ERROR_CODES.NO_KEYWORD_MATCH, `src=${src} no quorum`);
        return res.status(200).json({ ok: true, note: "no quorum" });
      }

      // שליחת התראה מסכמת (אפשר לעצב יפה יותר)
      const lines = triggered.map(t =>
        `⬆️ המילה "${t.keyword}" הופיעה אצל ${t.accounts}+ חשבונות (${src})`
      );
      const msg = [
        `<b>🚨 טריגר קולקטיבי הופעל</b>`,
        ...lines,
        ``,
        `<i>חלון: ${WINDOW_SEC}s | סף חשבונות: ${MIN_UNIQUE_ACCOUNTS} | מקור: ${src}</i>`
      ].join("\n");

      await sendTelegram({ text: msg, html: true });
      setLastOk("collective trigger sent");
      return res.status(200).json({ ok: true, triggered });
    } catch (err) {
      setLastError(ERROR_CODES.APIFY_DATASET_FAIL, err?.response?.data || err.message);
      return res.status(200).json({ ok: true, code: ERROR_CODES.APIFY_DATASET_FAIL });
    }
  } catch (e) {
    setLastError(ERROR_CODES.INTERNAL_ERROR, e?.message);
    return res.status(500).json({ ok: false, code: ERROR_CODES.INTERNAL_ERROR });
  }
});

// ------------ TELEGRAM COMMANDS (polling קטן) ------------
let tgOffset = 0;
const ALLOWED = new Set(TELEGRAM_ALLOWED_CHAT_IDS.concat(TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : []));

async function handleTgCommand(upd) {
  const msg = upd.message || upd.edited_message;
  if (!msg) return;

  const chatId = String(msg.chat?.id || "");
  const text = (msg.text || "").trim();

  // אם לא מורשה – נתעלם בשקט
  if (!ALLOWED.has(chatId)) return;

  if (text === "/ping") {
    await sendTelegram({ chatId, text: "pong ✅" });
    return;
  }

  if (text === "/status" || text === "/diag") {
    const uptime = Math.floor((Date.now() - processStart) / 1000);
    const parts = [
      "מצב המערכת ✅",
      `זמן ריצה: ${uptime}s`,
      `Webhook Secret: ${APIFY_WEBHOOK_SECRET ? "מוגדר" : "חסר"}`,
      `Keywords: ${KEYWORDS.length ? KEYWORDS.join(", ") : "לא הוגדרו"}`,
      `חלון: ${WINDOW_SEC}s | סף חשבונות: ${MIN_UNIQUE_ACCOUNTS}`,
      `בדיקה אחרונה: ${lastDiag ? lastDiag.now : "—"}`,
      `Webhook אחרון: ${lastWebhookAt || "—"}`,
      `OK אחרון: ${lastOkAt || "—"}`,
      `שגיאה אחרונה: ${lastError ? `${lastError.code} @ ${lastError.at}` : "—"}`,
      lastError?.detail ? `פרטים: ${typeof lastError.detail === "string" ? lastError.detail : JSON.stringify(lastError.detail)}` : ""
    ].filter(Boolean);

    await sendTelegram({ chatId, text: parts.join("\n") });
    return;
  }

  if (text.startsWith("/echo ")) {
    await sendTelegram({ chatId, text: text.slice(6) });
    return;
  }
}

async function pollTelegram() {
  if (!TELEGRAM_TOKEN) return; // אין בוט – לא נבצע polling
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
    const { data } = await axios.post(url, { timeout: 30, allowed_updates: ["message"], offset: tgOffset, timeout: 25 });
    const results = data?.result || [];
    for (const upd of results) {
      tgOffset = Math.max(tgOffset, (upd.update_id || 0) + 1);
      await handleTgCommand(upd);
    }
  } catch (e) {
    // לא מפילים את התהליך – רק לוג
    console.warn("Telegram polling warn:", e?.response?.data || e.message);
  }
}

// כל 3 שניות – קליל
setInterval(pollTelegram, 3000);

// ------------ START ------------
app.listen(PORT, () => {
  console.log(`Webhook bot running on :${PORT}`);
});
