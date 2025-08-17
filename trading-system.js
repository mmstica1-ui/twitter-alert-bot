// ===============================
// High-Frequency Trading System for Twitter Alerts + SPX Options
// Critical: Real money trading system - Maximum reliability required
// ===============================

import axios from 'axios';
import crypto from 'crypto';

// Trading configuration
const TRADING_CONFIG = {
  // Twitter accounts to monitor (ADD YOUR SPECIFIC ACCOUNTS)
  MONITORED_ACCOUNTS: [
    process.env.TWITTER_ACCOUNT_1 || 'account1', // Replace with actual usernames
    process.env.TWITTER_ACCOUNT_2 || 'account2'
  ],
  
  // Polling frequency for Twitter (every minute = 60000ms)
  POLL_INTERVAL_MS: 60000,
  
  // Time window for cross-account keyword matching (seconds)
  CROSS_MATCH_WINDOW_SEC: 300, // 5 minutes window
  
  // SPX Options Configuration
  SPX_OPTIONS: {
    symbol: 'SPX',
    contractSize: process.env.SPX_CONTRACT_SIZE || 1, // Number of contracts
    strikeOffset: 0.005, // 0.5% from current price
    optionType: process.env.OPTION_TYPE || 'CALL', // 'CALL' or 'PUT'
    timeToExpiry: 'NEAREST' // Use nearest expiry
  },
  
  // IBKR Configuration
  IBKR: {
    host: process.env.IBKR_HOST || 'localhost',
    port: process.env.IBKR_PORT || 5000,
    accountId: process.env.IBKR_ACCOUNT_ID,
    clientId: process.env.IBKR_CLIENT_ID || 1
  },
  
  // Safety limits
  SAFETY: {
    maxOrdersPerHour: 10,
    maxDailyLoss: process.env.MAX_DAILY_LOSS || 5000,
    requireConfirmation: process.env.REQUIRE_CONFIRMATION === 'true',
    dryRun: process.env.DRY_RUN !== 'false' // Default to dry run for safety
  }
};

// In-memory storage for real-time tracking
class TradingMemory {
  constructor() {
    this.recentTweets = new Map(); // account -> Array of recent tweets
    this.crossMatches = new Map(); // keyword -> Array of matching tweets from different accounts
    this.orderHistory = [];
    this.dailyStats = {
      orders: 0,
      pnl: 0,
      alerts: 0,
      date: new Date().toDateString()
    };
    this.safetyLocks = {
      tradingEnabled: true,
      lastOrderTime: 0,
      orderCount: 0
    };
  }
  
  // Add new tweet and check for cross-matches
  addTweet(account, tweet) {
    const accountTweets = this.recentTweets.get(account) || [];
    accountTweets.push({
      ...tweet,
      timestamp: Date.now(),
      processed: false
    });
    
    // Keep only recent tweets (within window)
    const cutoff = Date.now() - (TRADING_CONFIG.CROSS_MATCH_WINDOW_SEC * 1000);
    const filteredTweets = accountTweets.filter(t => t.timestamp >= cutoff);
    this.recentTweets.set(account, filteredTweets);
    
    return this.checkCrossMatches(tweet);
  }
  
  // Check if keywords appear across multiple accounts
  checkCrossMatches(newTweet) {
    const keywords = extractKeywords(newTweet.text);
    const crossMatches = [];
    
    for (const keyword of keywords) {
      const matchingAccounts = new Set();
      
      // Check all accounts for this keyword
      for (const [account, tweets] of this.recentTweets.entries()) {
        const hasKeyword = tweets.some(t => 
          extractKeywords(t.text).includes(keyword) && 
          !t.processed
        );
        if (hasKeyword) {
          matchingAccounts.add(account);
        }
      }
      
      // If keyword appears in multiple accounts = CROSS MATCH!
      if (matchingAccounts.size >= 2) {
        crossMatches.push({
          keyword,
          accounts: Array.from(matchingAccounts),
          confidence: matchingAccounts.size / TRADING_CONFIG.MONITORED_ACCOUNTS.length,
          timestamp: Date.now()
        });
        
        console.log(`🚨 CROSS MATCH DETECTED: "${keyword}" across accounts: ${Array.from(matchingAccounts).join(', ')}`);
      }
    }
    
    return crossMatches;
  }
  
  // Mark tweets as processed to avoid duplicate triggers
  markProcessed(keyword) {
    for (const tweets of this.recentTweets.values()) {
      tweets.forEach(tweet => {
        if (extractKeywords(tweet.text).includes(keyword)) {
          tweet.processed = true;
        }
      });
    }
  }
  
  // Safety check before trading
  canTrade() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    // Check hourly order limit
    const recentOrders = this.orderHistory.filter(o => o.timestamp >= hourAgo);
    if (recentOrders.length >= TRADING_CONFIG.SAFETY.maxOrdersPerHour) {
      console.log('🛑 TRADING BLOCKED: Hourly order limit exceeded');
      return false;
    }
    
    // Check daily loss limit
    if (Math.abs(this.dailyStats.pnl) >= TRADING_CONFIG.SAFETY.maxDailyLoss) {
      console.log('🛑 TRADING BLOCKED: Daily loss limit exceeded');
      return false;
    }
    
    // Check trading enabled flag
    if (!this.safetyLocks.tradingEnabled) {
      console.log('🛑 TRADING BLOCKED: Safety lock enabled');
      return false;
    }
    
    return true;
  }
}

// Global trading memory instance
const tradingMemory = new TradingMemory();

// Extract keywords from tweet text (enhanced version)
function extractKeywords(text) {
  const tradingKeywords = [
    // Market moving events
    'fed', 'fomc', 'powell', 'rates', 'inflation', 'cpi', 'ppi',
    'earnings', 'guidance', 'revenue', 'eps',
    'breaking', 'alert', 'urgent',
    'merger', 'acquisition', 'deal',
    'sec', 'regulation', 'investigation',
    'bankruptcy', 'default', 'crisis',
    
    // Market indicators
    'spy', 'spx', 'qqq', 'vix', 'dxy',
    'tesla', 'apple', 'microsoft', 'nvidia', 'amazon',
    'oil', 'gold', 'bitcoin', 'crypto',
    
    // Action words
    'buy', 'sell', 'calls', 'puts', 'options',
    'bullish', 'bearish', 'pump', 'dump',
    'moon', 'crash', 'squeeze', 'rally'
  ];
  
  const lowerText = text.toLowerCase();
  return tradingKeywords.filter(keyword => 
    lowerText.includes(keyword.toLowerCase())
  );
}

// IBKR Trading Interface
class IBKRTrader {
  constructor() {
    this.baseUrl = `http://${TRADING_CONFIG.IBKR.host}:${TRADING_CONFIG.IBKR.port}`;
    this.isConnected = false;
  }
  
  async connect() {
    try {
      // Check IBKR Gateway connection
      const response = await axios.get(`${this.baseUrl}/v1/api/iserver/accounts`);
      this.isConnected = response.status === 200;
      console.log('📡 IBKR Connection:', this.isConnected ? '✅ Connected' : '❌ Failed');
      return this.isConnected;
    } catch (error) {
      console.error('❌ IBKR Connection Error:', error.message);
      this.isConnected = false;
      return false;
    }
  }
  
  async getCurrentSPXPrice() {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/api/iserver/marketdata/snapshot`, {
        params: {
          conids: '416904', // SPX contract ID
          fields: '31' // Last price field
        }
      });
      
      const price = response.data?.[0]?.['31'];
      return price ? parseFloat(price) : null;
    } catch (error) {
      console.error('❌ SPX Price Error:', error.message);
      return null;
    }
  }
  
  async findNearestOptionContract(spxPrice, isCall = true) {
    try {
      const strikePrice = isCall 
        ? Math.round(spxPrice * (1 + TRADING_CONFIG.SPX_OPTIONS.strikeOffset))
        : Math.round(spxPrice * (1 - TRADING_CONFIG.SPX_OPTIONS.strikeOffset));
      
      // Search for option contracts
      const response = await axios.get(`${this.baseUrl}/v1/api/iserver/secdef/search`, {
        params: {
          symbol: 'SPX',
          name: true,
          secType: 'OPT'
        }
      });
      
      // Find nearest expiry with target strike
      // This is simplified - real implementation would need more complex filtering
      const contracts = response.data || [];
      const targetContract = contracts.find(c => 
        c.description?.includes(strikePrice.toString()) &&
        c.description?.includes(isCall ? 'C' : 'P')
      );
      
      return targetContract?.conid || null;
    } catch (error) {
      console.error('❌ Option Contract Search Error:', error.message);
      return null;
    }
  }
  
  async placeOptionOrder(contractId, quantity = 1, action = 'BUY') {
    if (TRADING_CONFIG.SAFETY.dryRun) {
      console.log('🧪 DRY RUN - Would place order:', { contractId, quantity, action });
      return { orderId: 'DRY_RUN_' + Date.now(), status: 'SIMULATED' };
    }
    
    try {
      const orderData = {
        orders: [{
          acctId: TRADING_CONFIG.IBKR.accountId,
          conid: contractId,
          secType: 'OPT',
          orderType: 'MKT', // Market order for speed
          side: action,
          quantity: quantity,
          tif: 'IOC' // Immediate or Cancel for fast execution
        }]
      };
      
      const response = await axios.post(
        `${this.baseUrl}/v1/api/iserver/account/${TRADING_CONFIG.IBKR.accountId}/orders`,
        orderData
      );
      
      console.log('📊 Order Placed:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Order Placement Error:', error.message);
      throw error;
    }
  }
}

// Global IBKR trader instance
const ibkrTrader = new IBKRTrader();

// Main trading logic - triggered on cross-match detection
async function executeTradingSignal(crossMatch) {
  console.log('🎯 EXECUTING TRADING SIGNAL:', crossMatch.keyword);
  
  if (!tradingMemory.canTrade()) {
    console.log('🛑 Trading blocked by safety checks');
    return null;
  }
  
  try {
    // 1. Connect to IBKR if not connected
    if (!ibkrTrader.isConnected) {
      await ibkrTrader.connect();
    }
    
    // 2. Get current SPX price
    const spxPrice = await ibkrTrader.getCurrentSPXPrice();
    if (!spxPrice) {
      throw new Error('Could not get SPX price');
    }
    
    console.log('📈 Current SPX Price:', spxPrice);
    
    // 3. Find appropriate option contract
    const isCall = TRADING_CONFIG.SPX_OPTIONS.optionType === 'CALL';
    const contractId = await ibkrTrader.findNearestOptionContract(spxPrice, isCall);
    
    if (!contractId) {
      throw new Error('Could not find suitable option contract');
    }
    
    // 4. Place the order
    const orderResult = await ibkrTrader.placeOptionOrder(
      contractId,
      TRADING_CONFIG.SPX_OPTIONS.contractSize,
      'BUY'
    );
    
    // 5. Record the trade
    const tradeRecord = {
      timestamp: Date.now(),
      keyword: crossMatch.keyword,
      accounts: crossMatch.accounts,
      spxPrice,
      contractId,
      orderResult,
      confidence: crossMatch.confidence
    };
    
    tradingMemory.orderHistory.push(tradeRecord);
    tradingMemory.dailyStats.orders++;
    tradingMemory.markProcessed(crossMatch.keyword);
    
    console.log('✅ TRADE EXECUTED:', tradeRecord);
    return tradeRecord;
    
  } catch (error) {
    console.error('❌ TRADING ERROR:', error.message);
    return { error: error.message, timestamp: Date.now() };
  }
}

// Enhanced Twitter monitoring for specific accounts
async function monitorSpecificTwitterAccounts() {
  console.log('👀 Monitoring Twitter accounts:', TRADING_CONFIG.MONITORED_ACCOUNTS);
  
  // This would integrate with Twitter API v2 or Apify
  // For now, we'll use a placeholder that integrates with your existing webhook system
  
  return {
    start: () => {
      console.log('🚀 Twitter monitoring started - checking every minute');
      setInterval(async () => {
        // In real implementation, this would fetch latest tweets
        // from the specified accounts using Twitter API or Apify
        console.log('🔍 Checking for new tweets...');
      }, TRADING_CONFIG.POLL_INTERVAL_MS);
    },
    
    processTweet: (account, tweetData) => {
      if (!TRADING_CONFIG.MONITORED_ACCOUNTS.includes(account)) {
        return; // Ignore tweets from non-monitored accounts
      }
      
      const crossMatches = tradingMemory.addTweet(account, tweetData);
      
      // Execute trades for any cross matches
      crossMatches.forEach(async (match) => {
        await executeTradingSignal(match);
      });
    }
  };
}

// Mobile push notification system
async function sendTradingAlert(tradeData) {
  // This would integrate with FCM, OneSignal, or similar for mobile push
  const alertData = {
    title: '🚨 SPX Trade Executed',
    body: `Cross-match detected: ${tradeData.keyword}\nSPX @ ${tradeData.spxPrice}`,
    data: {
      tradeId: tradeData.timestamp,
      action: 'BUY_SPX_OPTION',
      price: tradeData.spxPrice,
      keyword: tradeData.keyword
    }
  };
  
  console.log('📱 Sending mobile alert:', alertData);
  
  // Send to Telegram as backup
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const telegramMessage = `
🚨 <b>SPX AUTO-TRADE EXECUTED</b>

🔑 <b>Trigger:</b> ${tradeData.keyword}
📊 <b>SPX Price:</b> $${tradeData.spxPrice}
⏰ <b>Time:</b> ${new Date(tradeData.timestamp).toLocaleString()}
🎯 <b>Accounts:</b> ${tradeData.accounts.join(', ')}
📈 <b>Action:</b> BUY SPX ${TRADING_CONFIG.SPX_OPTIONS.optionType}
⚡ <b>Status:</b> ${tradeData.orderResult.status || 'EXECUTED'}
`;

      await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: telegramMessage,
        parse_mode: 'HTML'
      });
    } catch (error) {
      console.error('Telegram notification error:', error.message);
    }
  }
  
  return alertData;
}

// Emergency trading controls
const TradingControls = {
  enableTrading: () => {
    tradingMemory.safetyLocks.tradingEnabled = true;
    console.log('✅ Trading ENABLED');
  },
  
  disableTrading: () => {
    tradingMemory.safetyLocks.tradingEnabled = false;
    console.log('🛑 Trading DISABLED');
  },
  
  getStatus: () => ({
    enabled: tradingMemory.safetyLocks.tradingEnabled,
    dailyStats: tradingMemory.dailyStats,
    recentOrders: tradingMemory.orderHistory.slice(-10),
    canTrade: tradingMemory.canTrade()
  }),
  
  setDryRun: (enabled) => {
    TRADING_CONFIG.SAFETY.dryRun = enabled;
    console.log(`🧪 Dry run ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
};

export {
  TradingMemory,
  IBKRTrader,
  tradingMemory,
  ibkrTrader,
  executeTradingSignal,
  monitorSpecificTwitterAccounts,
  sendTradingAlert,
  TradingControls,
  TRADING_CONFIG
};