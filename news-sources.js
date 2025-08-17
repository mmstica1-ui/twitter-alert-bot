// מודול לאיסוף חדשות ממקורות מגוונים
import axios from 'axios';

// רשימת מקורות RSS לחדשות כלכליות
const RSS_FEEDS = [
  {
    name: "Reuters Business",
    url: "https://feeds.reuters.com/reuters/businessNews",
    category: "business"
  },
  {
    name: "Bloomberg Markets", 
    url: "https://feeds.bloomberg.com/markets/news.rss",
    category: "markets"
  },
  {
    name: "MarketWatch",
    url: "https://feeds.marketwatch.com/marketwatch/topstories/",
    category: "markets"
  },
  {
    name: "Financial Times",
    url: "https://www.ft.com/rss/home",
    category: "finance"
  },
  {
    name: "CNBC Business",
    url: "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    category: "business"
  },
  {
    name: "Yahoo Finance",
    url: "https://feeds.finance.yahoo.com/rss/2.0/headline",
    category: "finance"
  }
];

// API endpoints לחדשות (דורשים מפתחות API)
const NEWS_APIS = {
  newsapi: {
    baseUrl: "https://newsapi.org/v2/everything",
    params: {
      q: "stock market OR trading OR earnings OR fed OR interest rates OR inflation",
      language: "en",
      sortBy: "publishedAt",
      pageSize: 20
    }
  },
  polygon: {
    baseUrl: "https://api.polygon.io/v2/reference/news",
    params: {
      limit: 20,
      order: "desc"
    }
  }
};

// פונקציה לניתוח RSS Feed
async function parseRSSFeed(feedUrl) {
  try {
    // בהיעדר parser RSS מובנה, נשתמש בשירות חיצוני או נוסיף dependency
    const response = await axios.get(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`);
    
    if (response.data.status !== 'ok') {
      throw new Error('RSS parsing failed');
    }

    return response.data.items.map(item => ({
      id: item.guid || item.link,
      title: item.title,
      text: item.description || item.content,
      url: item.link,
      created: item.pubDate,
      source: "rss",
      account: response.data.feed.title || "RSS Feed"
    }));
  } catch (error) {
    console.error(`RSS Feed Error for ${feedUrl}:`, error.message);
    return [];
  }
}

// פונקציה לאיסוף חדשות מ-NewsAPI
async function fetchNewsAPI(apiKey) {
  if (!apiKey) return [];
  
  try {
    const response = await axios.get(NEWS_APIS.newsapi.baseUrl, {
      params: {
        ...NEWS_APIS.newsapi.params,
        apiKey: apiKey
      }
    });

    return response.data.articles.map(article => ({
      id: article.url,
      title: article.title,
      text: article.description || article.content,
      url: article.url,
      created: article.publishedAt,
      source: "newsapi",
      account: article.source.name
    }));
  } catch (error) {
    console.error('NewsAPI Error:', error.message);
    return [];
  }
}

// איסוף חדשות כלכליות בזמן אמת מ-Yahoo Finance
async function fetchYahooFinanceNews() {
  try {
    // נשתמש ב-Yahoo Finance API לא רשמי או scraping
    const response = await axios.get('https://query1.finance.yahoo.com/v1/finance/search', {
      params: {
        q: 'market news',
        lang: 'en-US',
        region: 'US',
        quotesCount: 0,
        newsCount: 10
      }
    });

    const news = response.data.news || [];
    return news.map(item => ({
      id: item.uuid,
      title: item.title,
      text: item.summary,
      url: item.link,
      created: new Date(item.providerPublishTime * 1000).toISOString(),
      source: "yahoo_finance",
      account: item.publisher
    }));
  } catch (error) {
    console.error('Yahoo Finance Error:', error.message);
    return [];
  }
}

// פונקציה ראשית לאיסוף חדשות מכל המקורות
export async function collectNewsFromAllSources(config = {}) {
  const {
    newsApiKey = process.env.NEWS_API_KEY,
    includeRSS = true,
    includeNewsAPI = true,
    includeYahoo = true,
    maxItemsPerSource = 10
  } = config;

  let allNews = [];

  // איסוף מ-RSS feeds
  if (includeRSS) {
    console.log('🔄 Collecting from RSS feeds...');
    for (const feed of RSS_FEEDS) {
      const items = await parseRSSFeed(feed.url);
      const limitedItems = items.slice(0, maxItemsPerSource).map(item => ({
        ...item,
        category: feed.category,
        feedName: feed.name
      }));
      allNews.push(...limitedItems);
      
      // הפסקה קטנה בין requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // איסוף מ-NewsAPI
  if (includeNewsAPI && newsApiKey) {
    console.log('🔄 Collecting from NewsAPI...');
    const newsApiItems = await fetchNewsAPI(newsApiKey);
    allNews.push(...newsApiItems.slice(0, maxItemsPerSource));
  }

  // איסוף מ-Yahoo Finance
  if (includeYahoo) {
    console.log('🔄 Collecting from Yahoo Finance...');
    const yahooItems = await fetchYahooFinanceNews();
    allNews.push(...yahooItems.slice(0, maxItemsPerSource));
  }

  // סינון והסרת כפילויות
  const uniqueNews = [];
  const seenUrls = new Set();
  
  for (const item of allNews) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueNews.push(item);
    }
  }

  // מיון לפי תאריך
  uniqueNews.sort((a, b) => new Date(b.created) - new Date(a.created));

  console.log(`✅ Collected ${uniqueNews.length} unique news items from ${allNews.length} total items`);
  return uniqueNews;
}

// פונקציה לפילטור חדשות לפי מילות מפתח
export function filterNewsByKeywords(newsItems, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return newsItems;
  }

  return newsItems.filter(item => {
    const searchText = `${item.title} ${item.text}`.toLowerCase();
    return keywords.some(keyword => 
      searchText.includes(keyword.toLowerCase())
    );
  });
}

// פונקציה לאיסוף תקופתי (polling)
export function startNewsPolling(intervalMinutes = 5, onNewNews = null) {
  let lastCheck = Date.now();
  
  const pollFunction = async () => {
    try {
      console.log('🔄 Starting news polling cycle...');
      const news = await collectNewsFromAllSources();
      
      // פילטור רק חדשות חדשות מאז הבדיקה האחרונה
      const newNews = news.filter(item => {
        const itemTime = new Date(item.created).getTime();
        return itemTime > lastCheck;
      });

      if (newNews.length > 0 && onNewNews) {
        console.log(`📰 Found ${newNews.length} new items`);
        await onNewNews(newNews);
      }

      lastCheck = Date.now();
    } catch (error) {
      console.error('❌ News polling error:', error.message);
    }
  };

  // הפעלה ראשונית
  pollFunction();
  
  // הפעלה תקופתית
  const intervalId = setInterval(pollFunction, intervalMinutes * 60 * 1000);
  
  console.log(`📡 News polling started - checking every ${intervalMinutes} minutes`);
  
  return {
    stop: () => {
      clearInterval(intervalId);
      console.log('📡 News polling stopped');
    }
  };
}

export { RSS_FEEDS, NEWS_APIS };