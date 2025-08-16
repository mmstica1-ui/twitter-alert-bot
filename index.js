// index.js — Webhook server + Telegram alerts + Gemini scoring + keyword consensus
// ES Modules

import express from "express";
import axios from "axios";

// ====== ENV ======
const PORT = process.env.PORT || 8080;

const TELEGRAM_TOKEN  = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID= process.env.TELEGRAM_CHAT_ID || "";

const MODEL_PROVIDER  = (process.env.MODEL_PROVIDER || "").toLowerCase(); // "gemini"|"openai"|"anthropic"
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL    = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL    = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const APIFY_TOKEN     = process.env.APIFY_TOKEN || ""; // optional: if you want to fetch dataset items by id
const APIFY_WEBHOOK_SECRET = process.env.APIFY_WEBHOOK_SECRET || ""; // shared secret with Apify webhook

const KEYWORDS = (process.env.KEYWORDS ||
  "invasion, attack, war, missile launch, cyberattack, sanctions, embargo, tariffs, nuclear, naval blockade, escalation, fed, fomc, emergency meeting, emergency cut, rate hike, rate cut, financial crisis, credit crisis, contagion, default, bankruptcy, sovereign downgrade, halts trading, pandemic, outbreak, terrorist attack, assassination, grid failure, earthquake, tsunami, volcanic eruption, trump, powell, xi jinping, putin"
)
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const WINDOW_SEC = Number(process.env.WINDOW_SEC || 300);
const MIN_UNIQUE_ACCOUNTS = Number(process.env.MIN_UNIQUE_ACCOUNTS || 2);
const MAX_ITEMS_FETCH = Number(process.env.MAX_ITEMS_FETCH || 50);

// ====== LLM SYSTEM PROMPT ======
const SYSTEM_PROMPT = `
You are a market-impact triage model. Input is 1-5 short posts about fast-breaking macro/geopolitical/US policy/market structure events.
Respond ONLY in strict JSON with fields: { "level": "none|low|medium|high", "reason": "short" }.
Rules:
- "high" only for material, surprise, market-moving headlines (e.g., broad US tariffs, Fed emergency action, war escalation, cyberattack on infra).
- "medium" for plausible market impact but uncertain scope/timing.
- "low" for minor/incremental updates.
- "none" for noise/irrelevant.
Keep "reason" under 180 chars.
`;

// ====== APP ======
const app = express();
app.use(express.json({ limit: "1mb" }));

// Memory buckets for “consensus” within time window
const buckets = new Map(); // key: keyword -> { firstAt, accounts:Set, items:[], lastSentAt? }

// ====== HELPERS ======
function normText(x) {
  return String(x || "").trim();
}

function matchKeywords(text) {
  const t = normText(text).toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const k of KEYWORDS) {
    if (k && t.includes(k)) hits.push(k);
  }
  return hits;
}

function nowMs() { return Date.now(); }

function accountFromItem(it) {
  return (
    it.username || it.screen_name || it.author || it.account || it.user ||
    (it.profile && it.profile.username) || ""
  );
}

function textFromItem(it) {
  return it.text || it.content || it.full_text || it.title || it.body || "";
}

function urlFromItem(it) {
  return it.url || it.link || it.permalink || it.tweetUrl || it.twitterUrl || it.permalinkUrl || "";
}

function createdFromItem(it) {
  return it.created_at || it.createdAt || it.date || it.timestamp || "";
}

function idFromItem(it) {
  return it.id || it.tweet_id || it.tweetId || it.postId || it.uniqueId || urlFromItem(it) ||
    `${accountFromItem(it)}-${createdFromItem(it)}-${textFromItem(it).slice(0,32)}`;
}

async function sendTelegram(html) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ TELEGRAM env missing");
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
  } catch (e) {
    console.error("⚠️ Telegram error:", e?.response?.data || e.message);
  }
}

function levelEmoji(level) {
  switch (String(level).toLowerCase()) {
    case "high": return "🟥";
    case "medium": return "🟧";
    case "low": return "🟨";
    case "none": return "⬜";
    default: return "⬜";
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ====== LLM scoring (OpenAI/Anthropic/Gemini supported, we’ll use Gemini) ======
async function llmImpactScore(text) {
  // OpenAI
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
  }

  // Anthropic
  if (MODEL_PROVIDER === "anthropic" && ANTHROPIC_API_KEY) {
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
  }

  // Gemini
  if (MODEL_PROVIDER === "gemini" && GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
      const body = {
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: `${SYSTEM_PROMPT}\n\nPosts:\n${text}` }],
          },
        ],
      };
      const resp = await axios.post(url, body, { timeout: 15000 });
      const textOut = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(textOut);
      const level = String(parsed.level || "").toLowerCase();
      const reason = String(parsed.reason || "").slice(0, 180);
      if (!["none","low","medium","high"].includes(level)) return null;
      return { level, reason };
    } catch (e) {
      console.error("⚠️ LLM(Gemini) error:", e?.response?.data || e.message);
      return null;
    }
  }

  return null;
}

// Format Telegram message
function formatTelegramMessage(keyword, bucket, score) {
  const header = `<b>🔔 קונצנזוס על "${escapeHtml(keyword)}"</b>\n` +
    `מקורות ייחודיים: <b>${bucket.accounts.size}</b> בחלון ${WINDOW_SEC}s\n`;

  const lines = [];
  const take = Math.min(bucket.items.length, 4);
  for (let i = 0; i < take; i++) {
    const it = bucket.items[i];
    const acc = accountFromItem(it);
    const txt = escapeHtml(textFromItem(it)).slice(0, 220);
    const url = urlFromItem(it);
    lines.push(
      (acc ? `<b>@${escapeHtml(acc)}</b>: ` : "") +
      `${txt}${url ? `\n<a href="${url}">Link</a>` : ""}`
    );
  }

  let llmLine = "";
  if (score) {
    llmLine = `\n\n<b>LLM:</b> ${levelEmoji(score.level)} <b>${score.level.toUpperCase()}</b> — ${escapeHtml(score.reason)}`;
  }

  return `${header}\n${lines.join("\n\n")}${llmLine}`;
}

// ====== APIFY helpers (optional dataset fetch) ======
async function fetchDatasetItems(datasetId, limit = MAX_ITEMS_FETCH) {
  if (!datasetId || !APIFY_TOKEN) return [];
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=${limit}&desc=1`;
  try {
    const res = await axios.get(url, { timeout: 20000 });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error("⚠️ Dataset fetch error", err?.response?.data || err.message);
    return [];
  }
}

// Normalize item (works for Twitter/Truth/Generic)
function normalizeItem(raw, sourceTag) {
  return {
    id: idFromItem(raw),
    account: accountFromItem(raw),
    text: textFromItem(raw),
    url: urlFromItem(raw),
    created_at: createdFromItem(raw),
    source: sourceTag || (raw.source || ""),
  };
}

// Process items: fill buckets by keyword and fire alerts if threshold met
async function processItems(items = []) {
  const ts = nowMs();

  for (const raw of items) {
    const item = normalizeItem(raw, raw.source);
    const hits = matchKeywords(item.text);
    if (hits.length === 0) continue;

    for (const kw of hits) {
      let b = buckets.get(kw);
      if (!b) {
        b = { firstAt: ts, accounts: new Set(), items: [], lastSentAt: 0 };
        buckets.set(kw, b);
      }
      b.items.unshift(item); // newest first
      if (item.account) b.accounts.add(item.account);

      // Clean old (beyond window)
      if (ts - b.firstAt > WINDOW_SEC * 1000) {
        // reset bucket window
        b.firstAt = ts;
        b.accounts = new Set(item.account ? [item.account] : []);
        b.items = [item];
      }

      const enoughAccounts = b.accounts.size >= MIN_UNIQUE_ACCOUNTS;
      const inWindow = (ts - b.firstAt) <= WINDOW_SEC * 1000;
      const cooldownPassed = (ts - (b.lastSentAt || 0)) > 30 * 1000; // avoid spam

      if (enoughAccounts && inWindow && cooldownPassed) {
        // LLM score on the combined top items text
        const joined = b.items.slice(0, 5).map(i => `@${i.account}: ${i.text}`).join("\n");
        let score = null;
        try {
          score = await llmImpactScore(joined);
        } catch (e) {
          console.error("LLM score error", e.message);
        }

        const msg = formatTelegramMessage(kw, b, score);
        await sendTelegram(msg);

        b.lastSentAt = ts;
      }
    }
  }
}

// ====== ROUTES ======

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    window_sec: WINDOW_SEC,
    min_unique_accounts: MIN_UNIQUE_ACCOUNTS,
    keywords: KEYWORDS.slice(0, 20),
    llm: {
      provider: MODEL_PROVIDER || "disabled",
      openai: Boolean(OPENAI_API_KEY),
      anthropic: Boolean(ANTHROPIC_API_KEY),
      gemini: Boolean(GEMINI_API_KEY),
      model: MODEL_PROVIDER === "gemini" ? GEMINI_MODEL :
             MODEL_PROVIDER === "openai" ? OPENAI_MODEL :
             MODEL_PROVIDER === "anthropic" ? ANTHROPIC_MODEL : null,
    },
  });
});

// Simple debug (in-memory buckets)
app.get("/debug", (req, res) => {
  const out = {};
  for (const [k,v] of buckets.entries()) {
    out[k] = {
      firstAt: new Date(v.firstAt).toISOString(),
      accounts: Array.from(v.accounts),
      items: v.items.slice(0, 3).map(i => ({ account: i.account, text: i.text.slice(0,80), url: i.url })),
      lastSentAt: v.lastSentAt ? new Date(v.lastSentAt).toISOString() : null,
    };
  }
  res.json(out);
});

// Test: telegram
app.get("/test/telegram", async (req, res) => {
  const msg = req.query.msg || "בדיקת טלגרם ✅";
  await sendTelegram(`<b>Test</b>\n${escapeHtml(msg)}`);
  res.json({ ok: true, sent: true });
});

// Test: LLM score
app.get("/test/score", async (req, res) => {
  const txt = req.query.text || "TRUMP ANNOUNCES BROAD TARIFFS ON IMPORTS";
  const s = await llmImpactScore(txt);
  res.json({ ok: true, input: txt, score: s });
});

// Main Apify webhook endpoint
// URL לדוגמה שכדאי להגדיר ב-Apify Task Webhook:
// https://YOURDOMAIN/apify/webhook?secret=MYSECRET&source=twitter
app.post("/apify/webhook", async (req, res) => {
  try {
    // 1) אימות סוד (פשוט): ?secret= או Header x-hook-secret או body.secret
    const qSecret = req.query.secret || req.headers["x-hook-secret"] || req.body?.secret;
    if (APIFY_WEBHOOK_SECRET && qSecret !== APIFY_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad secret" });
    }

    const source = (req.query.source || req.body?.source || "").toLowerCase() || "apify";

    let items = [];
    // 2) אם ה-Task שולח items ישירות
    if (Array.isArray(req.body?.items)) {
      items = req.body.items.map(it => ({ ...it, source }));
    }
    // 3) Payload מסוג ריצה (run) עם datasetId
    else if (req.body?.resource?.defaultDatasetId && APIFY_TOKEN) {
      const dsid = req.body.resource.defaultDatasetId;
      items = (await fetchDatasetItems(dsid, MAX_ITEMS_FETCH)).map(it => ({ ...it, source }));
    }
    // 4) Payload דוגמה אחרת
    else if (Array.isArray(req.body?.data?.items)) {
      items = req.body.data.items.map(it => ({ ...it, source }));
    }

    if (!items.length) {
      console.log("Webhook received but no items parsed. Body keys:", Object.keys(req.body || {}));
      return res.json({ ok: true, parsed: 0 });
    }

    await processItems(items);

    return res.json({ ok: true, parsed: items.length });
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Root
app.get("/", (req, res) => {
  res.send("OK");
});

// Start
app.listen(PORT, () => {
  console.log(`Webhook bot running on :${PORT}`);
});