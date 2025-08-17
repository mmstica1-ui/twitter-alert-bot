import axios from "axios";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// URL של API של אפיפיי (Actor רץ)
const ACTOR_RUN_URL = "https://api.apify.com/v2/actor-tasks/apidojo~tweet-scraper-v2/run-sync-get-dataset-items";

async function main() {
  try {
    // קריאה לאפיפיי כדי להביא ציוצים חדשים
    const res = await axios.get(ACTOR_RUN_URL, {
      params: { token: APIFY_TOKEN, limit: 5 },
    });

    const tweets = res.data;

    if (!tweets || tweets.length === 0) {
      console.log("No new tweets found.");
      return;
    }

    for (const tweet of tweets) {
      const text = tweet.text || "(no text)";
      const url = tweet.url || tweet.twitterUrl;

      const message = `🚨 New Tweet Alert 🚨\n${text}\n${url}`;

      // שליחת הודעה לטלגרם
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
      });

      console.log("Sent to Telegram:", message);
    }
  } catch (err) {
    console.error("Error running bot:", err.message);
  }
}

main();
