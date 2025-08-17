# 🎺 Trumpet Labs Trading System - Setup Guide

## 📋 סקירה כללית

המערכת מבוססת על Express.js קליל ומיועדת לניטור Twitter (@FirstSquawk, @DeItaone), ניתוח AI, וזיהוי התאמות צולבות עם יכולות מסחר ב-SPX Options.

---

## 🚂 שלב 1: הגדרת Railway

### 1.1 פרסום לRailway
```bash
# Connect your repo to Railway
# The system will auto-deploy from your git commits
```

### 1.2 הגדרת משתני סביבה
ב-Railway Dashboard → Variables, הוסף:

```env
# חובה לטלגרם (Audit Trail)
TELEGRAM_BOT_TOKEN=6123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456789
TELEGRAM_CHAT_ID=-1001234567890

# מומלץ מאוד - ניתוח AI
RISK_SCORING=on
GEMINI_API_KEY=your_gemini_api_key_here

# אבטחה (חובה)
APIFY_WEBHOOK_SECRET=your_secure_secret_123
TRADE_PANEL_SECRET=your_secure_secret_456

# הגדרות Cross-Match
WINDOW_SEC=300
MIN_UNIQUE_ACCOUNTS=2

# אופציונלי
NEWS_API_KEY=your_newsapi_key
LOG_LEVEL=info
```

---

## 🤖 שלב 2: הגדרת Telegram Bot

### 2.1 יצירת הבוט
1. פתח את [**@BotFather**](https://t.me/botfather) בטלגרם
2. שלח: `/newbot`
3. בחר שם: `TrumpetTradingBot`
4. בחר username: `@YourTrumpetTradingBot`
5. העתק את **Bot Token**

### 2.2 קבלת Chat ID
```bash
# שלח הודעה כלשהי לבוט שלך, ואז הרץ:
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
```

### 2.3 בדיקת חיבור
```bash
curl "https://your-app-name.railway.app/test/telegram?message=Hello from Trumpet!"
```

---

## 🧠 שלב 3: הגדרת Gemini AI

### 3.1 קבלת API Key
1. עבור ל-[Google AI Studio](https://aistudio.google.com/apikey)
2. התחבר עם חשבון Google
3. לחץ **Create API Key**
4. העתק את המפתח

### 3.2 בדיקת פונקציונליות
המערכת תתחיל לנתח חדשות עם:
- **Impact Level**: Low/Medium/High
- **Urgency Level**: Low/Medium/High  
- **Sentiment**: Negative/Neutral/Positive
- **Confidence %**: 0-100

---

## 📊 שלב 4: חיבור בוטי Twitter

### 4.1 Endpoint URL
```
https://your-app-name.railway.app/web/alert
```

### 4.2 פורמט הקריאה
```bash
curl -X POST "https://your-app-name.railway.app/web/alert" \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: your_secure_secret_123" \
  -d '{
    "source": "twitter",
    "handle": "FirstSquawk",
    "posted_at": "2025-08-17T16:30:00Z", 
    "title": "Market Alert",
    "original_text": "BREAKING: Fed announces emergency meeting tomorrow at 2PM EST",
    "original_url": "https://twitter.com/FirstSquawk/status/123",
    "tags": ["fed", "rates", "breaking"],
    "sectors": ["financials"],
    "keyword": "fed"
  }'
```

### 4.3 Cross-Match Logic
המערכת תזהה **Cross-Match Alert** כאשר:
- 2+ חשבונות מנטורים (@FirstSquawk, @DeItaone)
- מזכירים אותו keyword
- בתוך חלון זמן של 5 דקות

---

## 🎯 שלב 5: ממשק המסחר

### 5.1 גישה לממשק
```
https://your-app-name.railway.app/
```

### 5.2 תכונות זמינות
- **Live SPX Price**: מחיר אמיתי מ-Yahoo Finance
- **Strike Calculator**: חישוב אוטומטי של strikes (±0.5% מהמחיר)  
- **Expiry Logic**: בחירת תפוגה קרובה (0DTE/1DTE)
- **CALL/PUT Buttons**: בחירת כיוון מסחר
- **Budget Selection**: $5K - $25K
- **Trade Preview**: הצגת פרטי העסקה לפני שליחה

### 5.3 בדיקת מסחר
```bash
curl -X POST "https://your-app-name.railway.app/trade" \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: your_secure_secret_456" \
  -d '{
    "symbol": "SPX",
    "side": "CALL",
    "distancePct": 0.5,
    "budgetUsd": 10000,
    "reason": "Fed rate cut expectations"
  }'
```

---

## 🏦 שלב 6: אינטגרציה עם IBKR (עתידי)

### 6.1 דרישות
- Interactive Brokers Account
- TWS או IB Gateway
- Paper Trading (מומלץ לתחילת דרך)

### 6.2 הגדרה
```env
# הוסף למשתני סביבה:
IBKR_ENABLED=true
IBKR_HOST=localhost
IBKR_PORT=7497  # Paper Trading
IBKR_CLIENT_ID=1
IBKR_PAPER_TRADING=true
```

### 6.3 ספריות נדרשות
```bash
npm install @stoqey/ib
# או
npm install node-ib
```

---

## 🔧 שלב 7: endpoints זמינים

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Trumpet Labs UI |
| `/health` | GET | בדיקת מצב המערכת |
| `/debug` | GET | מידע על הגדרות |
| `/web/alert` | POST | קליטת ידיעות מבוטים |
| `/trade` | POST | שליחת בקשת מסחר |
| `/alerts` | GET | היסטוריית ידיעות |
| `/spx/price` | GET | מחיר SPX נוכחי |
| `/spx/strikes` | GET | חישוב strikes |
| `/test/telegram` | GET | בדיקת טלגרם |

---

## 🚨 שלב 8: בדיקת המערכת

### 8.1 בדיקת חיבורים
```bash
# בדיקת מצב
curl https://your-app-name.railway.app/debug

# בדיקת טלגרם  
curl "https://your-app-name.railway.app/test/telegram?message=System Test"

# בדיקת מחיר SPX
curl https://your-app-name.railway.app/spx/price
```

### 8.2 סימולציית Alert
```bash
curl -X POST "https://your-app-name.railway.app/web/alert" \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: your_secret" \
  -d '{
    "source": "twitter",
    "handle": "FirstSquawk", 
    "original_text": "BREAKING: Fed emergency meeting announced",
    "keyword": "fed"
  }'
```

---

## 📱 שלב 9: ניטור וDebug

### 9.1 לוגים
```bash
# Railway logs (בדאשבורד)
# או עם Railway CLI:
railway logs --follow
```

### 9.2 מדדי ביצועים
- **Cross-Match Rate**: כמה התאמות צולבות זוהו
- **Alert Volume**: כמות ידיעות מעובדות
- **Response Time**: זמן תגובת API
- **Telegram Success Rate**: שיעור הצלחה של הודעות

---

## ⚠️ אבטחה וזהירות

### 🔒 אבטחה
- **Never commit .env files**
- **Use strong webhook secrets**  
- **Monitor API usage** (Gemini, Yahoo Finance)
- **Set up proper logging**

### 💰 זהירות כספית
- **Start with Paper Trading**
- **Set position size limits**
- **Monitor daily P&L**
- **Have stop-loss logic**

---

## 🎉 מערכת מוכנה!

אחרי ההגדרה המלאה תקבל:
- ✅ ניטור אוטומטי של @FirstSquawk + @DeItaone  
- ✅ זיהוי Cross-Match על keywords חשובים
- ✅ ניתוח AI של כל ידיעה
- ✅ ממשק מסחר מקצועי
- ✅ Audit trail מלא בטלגרם
- ✅ מחירי SPX בזמן אמת
- ✅ חישוב strikes אוטומטי

**Happy Trading! 🚀📈**