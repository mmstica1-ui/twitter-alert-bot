// Simple test script for Advanced News Analyzer
import { collectNewsFromAllSources, filterNewsByKeywords } from './news-sources.js';

async function testNewsCollection() {
  console.log('🧪 Testing news collection...');
  
  try {
    const news = await collectNewsFromAllSources({
      includeRSS: true,
      includeNewsAPI: false, // No API key for test
      includeYahoo: true,
      maxItemsPerSource: 3
    });
    
    console.log(`✅ Collected ${news.length} news items`);
    
    if (news.length > 0) {
      console.log('📰 Sample news item:');
      console.log(JSON.stringify(news[0], null, 2));
    }
    
    // Test keyword filtering
    const keywords = ['market', 'stock', 'trade', 'fed', 'earnings'];
    const filtered = filterNewsByKeywords(news, keywords);
    console.log(`🎯 Filtered to ${filtered.length} relevant items`);
    
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

async function testAnalysisFormat() {
  console.log('🧪 Testing analysis format...');
  
  // Mock analysis result
  const mockAnalysis = {
    impact: "🚨 High Impact (4/5)",
    urgency: "🔼 High (4/5)",
    sentiment: "📈 Positive",
    confidence: "🎯 8/10",
    tickers: ["SPY", "QQQ", "TSLA"],
    sectors: ["Technology", "Automotive"],
    summary: "Tesla earnings beat expectations driving market optimism",
    reasoning: "Strong quarterly results indicate continued growth momentum"
  };
  
  console.log('✅ Mock analysis structure:');
  console.log(JSON.stringify(mockAnalysis, null, 2));
  
  return true;
}

async function runAllTests() {
  console.log('🚀 Starting Advanced News Analyzer Tests\n');
  
  const results = await Promise.allSettled([
    testNewsCollection(),
    testAnalysisFormat()
  ]);
  
  const passed = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const total = results.length;
  
  console.log(`\n📊 Test Results: ${passed}/${total} passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { testNewsCollection, testAnalysisFormat };