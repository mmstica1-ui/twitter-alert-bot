// Enhanced Twitter Bot - Integrates with Trumpet Trading System
import axios from "axios";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TRUMPET_WEBHOOK_URL = process.env.TRUMPET_WEBHOOK_URL || "https://your-app-name.railway.app/web/alert";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "mysecret123";

// Target accounts for monitoring
const TARGET_ACCOUNTS = ["FirstSquawk", "DeItaone"];

// Keywords that trigger alerts
const HIGH_IMPACT_KEYWORDS = [
  'breaking', 'urgent', 'alert', 'fed', 'fomc', 'emergency meeting', 
  'rate cut', 'rate hike', 'invasion', 'war', 'attack', 'sanctions',
  'bankruptcy', 'default', 'crisis', 'powell', 'trump', 'putin'
];

async function main() {
  console.log("🔍 Starting Twitter monitoring for Trumpet Trading System...");
  console.log(`📡 Target accounts: ${TARGET_ACCOUNTS.join(', ')}`);
  
  try {
    for (const account of TARGET_ACCOUNTS) {
      await monitorAccount(account);
      await sleep(2000); // Prevent rate limiting
    }
  } catch (err) {
    console.error("❌ Bot error:", err.message);
  }
}

async function monitorAccount(username) {
  try {
    console.log(`🐦 Checking tweets from @${username}...`);
    
    // Use Apify to scrape recent tweets
    const response = await axios.post('https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items', {
      startUrls: [`https://twitter.com/${username}`],
      maxTweets: 5,
      includeUserInfo: false,
      timeoutSeconds: 60
    }, {
      params: { token: APIFY_TOKEN },
      timeout: 30000
    });

    const tweets = response.data || [];
    
    for (const tweet of tweets) {
      await processTweet(tweet, username);
    }
    
    console.log(`✅ Processed ${tweets.length} tweets from @${username}`);
    
  } catch (error) {
    console.error(`❌ Error monitoring @${username}:`, error.message);
  }
}

async function processTweet(tweet, username) {
  try {
    const text = tweet.text || tweet.full_text || "";
    const tweetId = tweet.id_str || tweet.id || Date.now().toString();
    const url = tweet.url || `https://twitter.com/${username}/status/${tweetId}`;
    const createdAt = tweet.created_at || new Date().toISOString();
    
    // Check if tweet contains high-impact keywords
    const detectedKeywords = HIGH_IMPACT_KEYWORDS.filter(keyword => 
      text.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (detectedKeywords.length === 0) {
      console.log(`⏭️  Skipping tweet from @${username} - no key keywords`);
      return;
    }
    
    // Extract sectors based on content
    const sectors = extractSectors(text);
    
    // Prepare alert payload
    const alertPayload = {
      source: "twitter",
      handle: username,
      posted_at: createdAt,
      title: `Alert from @${username}`,
      original_text: text.slice(0, 500), // Limit text length
      original_url: url,
      tags: detectedKeywords.slice(0, 5), // Limit tags
      sectors: sectors,
      keyword: detectedKeywords[0], // Primary keyword for cross-match
      signature: `twitter-bot-${Date.now()}`
    };
    
    // Send to Trumpet Trading System
    const webhookResponse = await axios.post(TRUMPET_WEBHOOK_URL, alertPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': WEBHOOK_SECRET
      },
      timeout: 10000
    });
    
    const isCrossMatch = webhookResponse.data?.cross_match || false;
    const crossMatchIcon = isCrossMatch ? "🚨 CROSS-MATCH" : "📰";
    
    console.log(`${crossMatchIcon} Alert sent for @${username}: "${text.slice(0, 100)}..."`);
    
    if (isCrossMatch) {
      console.log("🚨🚨🚨 CROSS-MATCH DETECTED! Multiple accounts reporting on same topic 🚨🚨🚨");
    }
    
  } catch (error) {
    console.error(`❌ Error processing tweet from @${username}:`, error.message);
  }
}

function extractSectors(text) {
  const sectorKeywords = {
    'financials': ['bank', 'banks', 'financial', 'credit', 'loan'],
    'technology': ['tech', 'software', 'ai', 'artificial intelligence', 'meta', 'google', 'apple', 'microsoft'],
    'energy': ['oil', 'gas', 'energy', 'crude', 'petroleum', 'renewable'],
    'healthcare': ['pharma', 'drug', 'vaccine', 'medical', 'health'],
    'defense': ['defense', 'military', 'weapons', 'war', 'conflict'],
    'retail': ['retail', 'consumer', 'walmart', 'amazon', 'shopping'],
    'automotive': ['auto', 'car', 'tesla', 'ford', 'gm'],
    'real_estate': ['real estate', 'housing', 'reit', 'property']
  };
  
  const detected = [];
  const lowerText = text.toLowerCase();
  
  for (const [sector, keywords] of Object.entries(sectorKeywords)) {
    if (keywords.some(keyword => lowerText.includes(keyword))) {
      detected.push(sector);
    }
  }
  
  return detected.slice(0, 3); // Limit to 3 sectors
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the bot
main().catch(console.error);