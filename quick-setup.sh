#!/bin/bash

# 🎺 Trumpet Trading System - Quick Setup Script
echo "🎺 Welcome to Trumpet Trading System Setup!"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'EOF'
# Trumpet Trading System Configuration

# === TELEGRAM CONFIGURATION (REQUIRED) ===
# Get these from @BotFather
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# === AI ANALYSIS (HIGHLY RECOMMENDED) ===
RISK_SCORING=on
# Get from https://aistudio.google.com/apikey
GEMINI_API_KEY=

# === WEBHOOK SECURITY (ALREADY SET) ===
APIFY_WEBHOOK_SECRET=mysecret123
TRADE_PANEL_SECRET=mysecret123

# === TWITTER BOT (IF USING APIFY) ===
APIFY_TOKEN=
TRUMPET_WEBHOOK_URL=https://your-app-name.railway.app/web/alert
WEBHOOK_SECRET=mysecret123

# === CROSS-MATCH SETTINGS ===
WINDOW_SEC=300
MIN_UNIQUE_ACCOUNTS=2

# === SYSTEM ===
LOG_LEVEL=info
PORT=8080
EOF
    echo "✅ Created .env file - please edit with your values"
else
    echo "⚠️  .env file already exists"
fi

echo ""
echo "🔧 Next steps to complete setup:"
echo ""
echo "1. 📱 TELEGRAM SETUP (Critical):"
echo "   • Open @BotFather in Telegram"
echo "   • Send: /newbot"
echo "   • Choose name: TrumpetTradingBot"
echo "   • Copy Bot Token to TELEGRAM_BOT_TOKEN in .env"
echo "   • Send message to your bot, then run:"
echo "     curl -s \"https://api.telegram.org/bot<TOKEN>/getUpdates\" | jq '.result[0].message.chat.id'"
echo "   • Copy Chat ID to TELEGRAM_CHAT_ID in .env"
echo ""
echo "2. 🧠 GEMINI AI SETUP (Recommended):"
echo "   • Visit: https://aistudio.google.com/apikey"
echo "   • Create API Key"
echo "   • Add to GEMINI_API_KEY in .env"
echo ""
echo "3. 🤖 TWITTER BOT SETUP (Optional):"
echo "   • Get Apify token from https://console.apify.com/account/integrations"
echo "   • Add to APIFY_TOKEN in .env"
echo "   • Update TRUMPET_WEBHOOK_URL with your Railway app URL"
echo ""
echo "4. 🚀 RESTART SYSTEM:"
echo "   pm2 restart trumpet-trading-system"
echo ""
echo "5. 🧪 TEST SYSTEM:"
echo "   curl https://your-app-name.railway.app/debug"
echo "   curl \"https://your-app-name.railway.app/test/telegram?message=Hello\""
echo ""
echo "📚 For detailed instructions, see: SETUP-GUIDE.md"
echo ""
echo "🎯 System Status:"
curl -s "http://localhost:8080/debug" | jq '.env' 2>/dev/null || echo "System not running on localhost"