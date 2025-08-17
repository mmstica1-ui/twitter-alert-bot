# Advanced News Analyzer 🚨📈

מערכת ניתוח חדשות מתקדמת בהשראת Trumpet Labs - מנטרת ומנתחת חדשות ממקורות מגוונים ומדרגת אותן לפי השפעה על השוק.

## ✨ תכונות מתקדמות

### 🧠 ניתוח AI מתקדם
- **דירוג השפעה**: ציון 1-5 לפוטנציאל השפעה על השוק
- **רמת דחיפות**: ציון 1-5 לזמן התגובה הנדרש
- **ניתוח סנטימנט**: זיהוי גישה חיובית/שלילית
- **זיהוי טיקרים**: חילוץ אוטומטי של סמלי מניות רלוונטיים
- **זיהוי סקטורים**: זיהוי תחומי שוק מושפעים

### 📰 מקורות חדשות מגוונים
- **RSS Feeds**: Reuters, Bloomberg, MarketWatch, CNBC, Yahoo Finance
- **NewsAPI**: גישה למגוון רחב של מקורות חדשות
- **רשתות חברתיות**: תמיכה ב-Twitter/X ו-Truth Social (via webhooks)
- **איסוף תקופתי**: בדיקה אוטומטית כל מספר דקות

### 🎯 פילטור חכם
- **מילות מפתח מתקדמות**: כלכלה, שוק הון, מדיניות, רגולציה
- **סינון לפי השפעה**: רק חדשות עם ציון השפעה מינימלי
- **הסרת כפילויות**: מניעת התרעות חוזרות
- **צבירת אירועים**: התרעה כאשר מספר מקורות מדווחים על אותו נושא

## 🚀 התקנה והפעלה

### 1. הכנת הסביבה
```bash
npm install
cp .env.example .env
# ערוך את .env עם הערכים שלך
```

### 2. משתני סביבה נדרשים
```env
# חובה
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# מומלץ לניתוח מתקדם
RISK_SCORING=on
GEMINI_API_KEY=your_gemini_key

# אופציונלי למקורות נוספים
NEWS_API_KEY=your_newsapi_key
```

### 3. הפעלה
```bash
npm start
```

## 🔧 API Endpoints

### בסיסי
- `GET /` - מידע כללי
- `GET /health` - בדיקת מצב המערכת
- `GET /debug` - מידע על תצורה וזיכרון

### בדיקות
- `GET /test/telegram?text=Hello` - בדיקת שליחת הודעה לטלגרם
- `GET /collect/news` - איסוף ידני של חדשות
- `POST /analyze/text` - ניתוח טקסט ספציפי

### Webhooks
- `POST /apify/webhook?secret=YOUR_SECRET&source=twitter` - webhook לרשתות חברתיות

## 📊 דוגמת ניתוח

כאשר המערכת מוצאת חדשה רלוונטית, היא שולחת הודעה מפורטת:

```
🚨 Market Alert - Multi-Source Detection

#interest_rates 📰 Reuters Business
@reuters
2024-01-15T10:30:00Z

"Fed officials signal potential rate cuts in Q2 amid inflation concerns"

📈 MARKET ANALYSIS:
• Impact: 🚨 Critical Impact (5/5)
• Urgency: ⚠️ Critical (5/5)  
• Sentiment: 📈 Positive
• Confidence: 🎯 9/10

📊 Tickers: $SPY, $QQQ, $TLT
🏭 Sectors: Banking, Technology, Real Estate

💡 Summary: Fed rate cut signals could boost equity markets significantly
🧠 Analysis: This represents a major policy shift with immediate market implications

🔗 Link
```

## ⚙️ התאמה אישית

### מילות מפתח
ערוך את `KEYWORDS` ו-`MARKET_KEYWORDS` ב-.env:
```env
KEYWORDS=your,custom,keywords,here
MARKET_KEYWORDS=SPY,QQQ,your,tickers
```

### ספי ניתוח
```env
MIN_IMPACT_SCORE=3    # רק השפעה בינונית ומעלה
MIN_URGENCY_SCORE=2   # רק דחיפות בסיסית ומעלה
```

### תדירות איסוף
```env
POLLING_INTERVAL=10   # בדיקה כל 10 דקות
```

## 🔒 אבטחה

- Webhook secrets למניעת גישה לא מורשית
- סינון קלט למניעת injection attacks
- הגבלת גודל בקשות
- לוגים מפורטים לניטור

## 📈 השוואה ל-Trumpet Labs

המערכת מיישמת עקרונות דומים:
- ✅ דירוג השפעה רב-ממדי
- ✅ ניתוח דחיפות  
- ✅ זיהוי סנטימנט
- ✅ תיוג טיקרים ברורים
- ✅ מקורות מידע מגוונים
- ✅ עיבוד בזמן אמת

## 🚀 Deploy

### Railway
```bash
# פשוט חבר את הריפו ל-Railway
# הגדר את משתני הסביבה בפאנל
```

### Docker
```bash
docker build -t news-analyzer .
docker run -p 8080:8080 --env-file .env news-analyzer
```

## 📞 תמיכה

למידע נוסף או תמיכה טכנית, בדוק את הלוגים או השתמש ב-`/debug` endpoint.
