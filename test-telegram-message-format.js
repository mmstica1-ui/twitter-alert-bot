#!/usr/bin/env node
/**
 * Demonstration of Telegram Message Format with Verification Features
 * Shows what the enhanced messages look like with verification links and credibility scores
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the verification functions from index.js
const indexContent = fs.readFileSync(join(__dirname, 'index.js'), 'utf8');

// Extract and simulate the verification functions
function extractSearchTerms(text, title = "") {
  const combinedText = `${title} ${text}`.toLowerCase();
  
  // Extract key financial terms
  const financialTerms = combinedText.match(/\b(fed|federal reserve|rate|inflation|powell|market|spx|nasdaq|dow|earnings|gdp|cpi|employment|jobs|treasury|bond|yield)\b/g) || [];
  
  // Extract company names (capitalized words)
  const companyNames = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  
  // Extract numbers with context
  const numbers = text.match(/\b\d+\.?\d*%?(?:\s*(?:billion|million|trillion|basis points|bps))?\b/g) || [];
  
  // Combine and clean
  const allTerms = [...new Set([...financialTerms, ...companyNames, ...numbers])];
  return allTerms.slice(0, 5).join(' '); // Limit to top 5 terms
}

async function generateVerificationLinks(text, handle, title) {
  const searchTerms = extractSearchTerms(text, title);
  const encodedSearch = encodeURIComponent(searchTerms);
  
  return {
    reuters: `https://www.reuters.com/search/news?blob=${encodedSearch}`,
    bloomberg: `https://www.bloomberg.com/search?query=${encodedSearch}`,
    google: `https://news.google.com/search?q=${encodedSearch}&hl=en-US&gl=US&ceid=US:en`,
    factcheck: `https://www.google.com/search?q="${encodedSearch}"+site:snopes.com+OR+site:factcheck.org+OR+site:politifact.com`
  };
}

function getCredibilityIndicator(score) {
  if (score >= 90) return '🟢'; // Green - Very High
  if (score >= 75) return '🟡'; // Yellow - High  
  if (score >= 50) return '🟠'; // Orange - Medium
  if (score >= 25) return '🔴'; // Red - Low
  return '⚫'; // Black - Very Low
}

async function checkSourceCredibility(handle, text) {
  const credibilityDB = {
    'firstsquawk': { score: 85, level: 'HIGH', type: 'financial_news' },
    'deitaone': { score: 80, level: 'HIGH', type: 'financial_news' },
    'reuters': { score: 95, level: 'VERY HIGH', type: 'news_agency' },
    'bloomberg': { score: 90, level: 'VERY HIGH', type: 'financial_news' },
    'cnbc': { score: 75, level: 'HIGH', type: 'financial_tv' },
    'unknown_source': { score: 20, level: 'VERY LOW', type: 'unknown' }
  };
  
  const sourceInfo = credibilityDB[handle.toLowerCase()] || { score: 30, level: 'LOW', type: 'unknown' };
  
  return {
    score: sourceInfo.score,
    level: sourceInfo.level,
    type: sourceInfo.type,
    indicator: getCredibilityIndicator(sourceInfo.score)
  };
}

async function simulateTelegramMessage(handle, text, title, crossMatch = false) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📱 SIMULATED TELEGRAM MESSAGE`);
  console.log(`${'='.repeat(60)}`);
  
  // Generate verification data
  const verificationLinks = await generateVerificationLinks(text, handle, title);
  const credibilityScore = await checkSourceCredibility(handle, text);
  
  // Simulate the formatted message
  const emoji = crossMatch ? "🔥" : "📰";
  const crossMatchText = crossMatch ? "🎯 CROSS-MATCH DETECTED!" : "";
  
  const message = `${emoji} <b>${title}</b>
  
${crossMatchText ? crossMatchText + '\n' : ''}📊 Source: @${handle}
${credibilityScore.indicator} Credibility: ${credibilityScore.score}/100 (${credibilityScore.level})

📝 <i>${text}</i>

🔍 <b>Verification Links:</b>
• <a href="${verificationLinks.reuters}">Reuters Search</a>
• <a href="${verificationLinks.bloomberg}">Bloomberg Search</a>  
• <a href="${verificationLinks.google}">Google News</a>
• <a href="${verificationLinks.factcheck}">Fact Check</a>

⚠️ <b>Trading Safety:</b> Always verify news before trading
🕐 ${new Date().toLocaleString()}`;

  console.log('📄 Message Content:');
  console.log(message);
  
  console.log('\n🔘 Interactive Buttons:');
  console.log('┌─────────────────┬─────────────────┐');
  console.log('│   🔍 Verify News │ ⚠️ Report Fake  │');
  console.log('├─────────────────┼─────────────────┤');
  console.log('│  📈 CALL Options │ 📉 PUT Options   │');
  console.log('└─────────────────┴─────────────────┘');
  
  console.log('\n📊 Verification Analysis:');
  console.log(`• Search Terms: "${extractSearchTerms(text, title)}"`);
  console.log(`• Credibility Score: ${credibilityScore.score} (${credibilityScore.level})`);
  console.log(`• Source Type: ${credibilityScore.type}`);
  console.log(`• Visual Indicator: ${credibilityScore.indicator}`);
  
  return {
    message,
    credibility: credibilityScore,
    verificationLinks,
    crossMatch
  };
}

// Test different scenarios
async function runDemonstration() {
  console.log('🚀 TELEGRAM MESSAGE FORMAT DEMONSTRATION');
  console.log('Showing how verification features appear in Telegram messages');
  
  // High credibility news
  await simulateTelegramMessage(
    'firstsquawk',
    'BREAKING: Federal Reserve announces 0.50% rate cut following FOMC meeting. Powell cites economic data supporting monetary easing.',
    'Fed Rate Cut Announcement',
    false
  );
  
  // Cross-match scenario
  await simulateTelegramMessage(
    'deitaone', 
    'FLASH: Federal Reserve cuts rates by 50 basis points after emergency session. Markets surge on dovish pivot.',
    'Fed Emergency Rate Cut',
    true
  );
  
  // Low credibility suspicious news
  await simulateTelegramMessage(
    'unknown_source',
    '🚨🚨🚨 URGENT!!! STOCK MARKET WILL CRASH 90% TOMORROW!!! SELL EVERYTHING NOW!!!',
    'Market Crash Warning',
    false
  );
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ DEMONSTRATION COMPLETED');
  console.log('📋 Features Shown:');
  console.log('• ✅ Credibility scoring with visual indicators (🟢🟡🟠🔴⚫)');
  console.log('• ✅ Automatic verification links generation');
  console.log('• ✅ Source reliability assessment');
  console.log('• ✅ Cross-match detection alerts'); 
  console.log('• ✅ Interactive verification buttons');
  console.log('• ✅ Trading safety warnings');
  console.log(`${'='.repeat(60)}`);
  
  console.log('\n💡 To Enable Full Telegram Integration:');
  console.log('1. Set TELEGRAM_BOT_TOKEN in .env');
  console.log('2. Set TELEGRAM_CHAT_ID in .env'); 
  console.log('3. Configure webhook with @BotFather');
  console.log('4. Test with real Telegram messages');
}

runDemonstration().catch(console.error);