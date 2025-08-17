// ===============================
// Trading Configuration Manager
// Dynamic configuration for real-money trading
// ===============================

import fs from 'fs';
import path from 'path';

class ConfigManager {
  constructor() {
    this.configPath = path.join(process.cwd(), 'trading-config.json');
    this.defaultConfig = {
      // Twitter Monitoring
      twitter: {
        accounts: ['FirstSquawk', 'DeItaone'],
        pollInterval: 60000, // 1 minute
        keywords: [
          // Geopolitical Events
          'Invasion', 'Attack', 'War', 'Missile Launch', 'Cyberattack',
          'Sanctions', 'Embargo', 'Tariffs', 'Nuclear', 'Naval Blockade',
          'Escalation', 'Terrorist Attack', 'Assassination',
          
          // Fed & Central Bank
          'Fed', 'FOMC', 'Emergency Meeting', 'Emergency Cut',
          'Rate Hike', 'Rate Cut', 'Powell',
          
          // Financial Crisis
          'Financial Crisis', 'Credit Crisis', 'Contagion', 'Default',
          'Bankruptcy', 'Sovereign Downgrade', 'Halts Trading',
          
          // Health & Natural Disasters
          'Pandemic', 'Outbreak', 'Grid Failure', 'Earthquake',
          'Tsunami', 'Volcanic Eruption',
          
          // Key Figures
          'Trump', 'Xi Jinping', 'Putin',
          
          // Market Keywords (existing)
          'Breaking', 'Urgent', 'Alert', 'SPY', 'QQQ', 'VIX'
        ]
      },
      
      // IBKR Configuration
      ibkr: {
        host: 'localhost',
        port: 5000,
        accountId: '',
        clientId: 1,
        paperTrading: true // Start with paper trading for safety
      },
      
      // SPX Trading Configuration
      spx: {
        tradeAmount: 10000, // $10,000 per trade
        strikeOffset: 0.005, // 0.5% from current price
        enableCalls: true,
        enablePuts: true,
        timeToExpiry: 'NEAREST'
      },
      
      // Safety Controls
      safety: {
        dryRun: true,
        requireConfirmation: true,
        maxDailyLoss: 50000, // $50k max daily loss
        maxOrdersPerHour: 20,
        maxOrdersPerDay: 100,
        tradingHours: {
          start: '09:30', // EST
          end: '16:00'   // EST
        },
        pauseOnLoss: 25000 // Pause trading after $25k loss
      },
      
      // Alert Configuration
      alerts: {
        telegram: {
          enabled: false,
          botToken: '',
          chatId: ''
        },
        email: {
          enabled: false,
          smtp: {
            host: '',
            port: 587,
            user: '',
            pass: ''
          },
          to: ''
        },
        pushNotifications: {
          enabled: true,
          service: 'telegram' // fallback to telegram
        }
      },
      
      // Advanced Settings
      advanced: {
        crossMatchWindow: 300, // 5 minutes
        minConfidenceScore: 0.7,
        enableAIAnalysis: true,
        logLevel: 'info'
      }
    };
    
    this.loadConfig();
  }
  
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        this.config = { ...this.defaultConfig, ...JSON.parse(configData) };
        console.log('📋 Configuration loaded from trading-config.json');
      } else {
        this.config = { ...this.defaultConfig };
        this.saveConfig();
        console.log('📋 Created new configuration file');
      }
    } catch (error) {
      console.error('❌ Error loading config:', error.message);
      this.config = { ...this.defaultConfig };
    }
  }
  
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('💾 Configuration saved');
      return true;
    } catch (error) {
      console.error('❌ Error saving config:', error.message);
      return false;
    }
  }
  
  get(path) {
    const keys = path.split('.');
    let value = this.config;
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) break;
    }
    return value;
  }
  
  set(path, value) {
    const keys = path.split('.');
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    return this.saveConfig();
  }
  
  // Convenience methods for common operations
  getTwitterAccounts() {
    return this.get('twitter.accounts') || [];
  }
  
  setTwitterAccounts(accounts) {
    return this.set('twitter.accounts', accounts);
  }
  
  getKeywords() {
    return this.get('twitter.keywords') || [];
  }
  
  addKeyword(keyword) {
    const keywords = this.getKeywords();
    if (!keywords.includes(keyword)) {
      keywords.push(keyword);
      return this.set('twitter.keywords', keywords);
    }
    return true;
  }
  
  removeKeyword(keyword) {
    const keywords = this.getKeywords();
    const index = keywords.indexOf(keyword);
    if (index > -1) {
      keywords.splice(index, 1);
      return this.set('twitter.keywords', keywords);
    }
    return true;
  }
  
  getTradeAmount() {
    return this.get('spx.tradeAmount') || 10000;
  }
  
  setTradeAmount(amount) {
    return this.set('spx.tradeAmount', amount);
  }
  
  isDryRun() {
    return this.get('safety.dryRun') !== false;
  }
  
  enableLiveTrading() {
    return this.set('safety.dryRun', false);
  }
  
  enableDryRun() {
    return this.set('safety.dryRun', true);
  }
  
  // Validation methods
  validateConfig() {
    const errors = [];
    
    // Check IBKR settings
    if (!this.get('ibkr.accountId')) {
      errors.push('IBKR Account ID is required');
    }
    
    // Check Twitter accounts
    const accounts = this.getTwitterAccounts();
    if (!accounts || accounts.length === 0) {
      errors.push('At least one Twitter account must be configured');
    }
    
    // Check trade amount
    const tradeAmount = this.getTradeAmount();
    if (!tradeAmount || tradeAmount <= 0) {
      errors.push('Trade amount must be greater than 0');
    }
    
    // Check keywords
    const keywords = this.getKeywords();
    if (!keywords || keywords.length === 0) {
      errors.push('At least one keyword must be configured');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  // Export/Import configuration
  exportConfig() {
    return JSON.stringify(this.config, null, 2);
  }
  
  importConfig(configString) {
    try {
      const newConfig = JSON.parse(configString);
      this.config = { ...this.defaultConfig, ...newConfig };
      return this.saveConfig();
    } catch (error) {
      console.error('❌ Error importing config:', error.message);
      return false;
    }
  }
  
  // Reset to defaults
  resetToDefaults() {
    this.config = { ...this.defaultConfig };
    return this.saveConfig();
  }
}

// Global instance
const configManager = new ConfigManager();

export default configManager;
export { ConfigManager };