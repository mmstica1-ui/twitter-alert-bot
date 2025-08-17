#!/usr/bin/env node

// ===============================
// Quick Setup Script for Trading System
// Sets up critical environment variables
// ===============================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 מערכת הגדרה מהירה למסחר אוטומטי');
console.log('=====================================\n');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

let envContent = '';
if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✅ נמצא קובץ .env קיים\n');
} else if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf8');
    console.log('📋 יוצר קובץ .env חדש מהתבנית\n');
} else {
    console.log('❌ לא נמצא קובץ .env או .env.example');
    process.exit(1);
}

// Function to update or add environment variable
function updateEnvVar(content, key, value) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
        return content.replace(regex, `${key}=${value}`);
    } else {
        return content + `\n${key}=${value}`;
    }
}

// Interactive setup (simplified for demo - would use readline for real input)
console.log('⚠️  הכנס את הפרטים הבאים לחתרהדר (השאר ריק לדילוג):');
console.log('-----------------------------------------------------------\n');

// Get command line arguments for quick setup
const args = process.argv.slice(2);
const setupMode = args.includes('--quick') ? 'quick' : 'interactive';

if (setupMode === 'quick') {
    console.log('🔧 מצב הגדרה מהיר - משתמש בערכי ברירת מחדל בטוחים\n');
    
    // Quick safe setup
    envContent = updateEnvVar(envContent, 'DRY_RUN', 'true');
    envContent = updateEnvVar(envContent, 'REQUIRE_CONFIRMATION', 'true');
    envContent = updateEnvVar(envContent, 'MAX_DAILY_LOSS', '1000');
    envContent = updateEnvVar(envContent, 'SPX_CONTRACT_SIZE', '1');
    envContent = updateEnvVar(envContent, 'OPTION_TYPE', 'CALL');
    
    console.log('✅ הוגדר במצב בטוח:');
    console.log('   - DRY_RUN=true (מצב סימולציה)');
    console.log('   - REQUIRE_CONFIRMATION=true (דרוש אישור)');
    console.log('   - MAX_DAILY_LOSS=1000 (הפסד מקסימלי נמוך)');
    
} else {
    console.log('📝 מצב אינטראקטיבי (בפיתוח - השתמש ב--quick לעת עתה)');
    console.log('💡 הרץ: node setup-trading.js --quick');
    process.exit(0);
}

// Write the updated .env file
fs.writeFileSync(envPath, envContent);
console.log(`\n✅ קובץ .env עודכן בהצלחה: ${envPath}`);

// Create a safety checklist
const safetyChecklist = `
🛡️  רשימת בדיקות בטיחות למסחר
=====================================

לפני הפעלת מסחר אמיתי, ודא:

□ חשבון IBKR מוגדר ומחובר
□ TWS או Gateway רץ על ${process.env.IBKR_HOST || 'localhost'}:${process.env.IBKR_PORT || '5000'}
□ 2 חשבונות טוויטר מוגדרים: ${process.env.TWITTER_ACCOUNT_1 || '[לא מוגדר]'}, ${process.env.TWITTER_ACCOUNT_2 || '[לא מוגדר]'}
□ מילות מפתח מוגדרות נכון
□ הגבלות בטיחות מוגדרות (MAX_DAILY_LOSS, MAX_ORDERS_PER_HOUR)
□ בדקת בסימולציה (DRY_RUN=true) לפני מסחר אמיתי
□ יש מספיק מאזן בחשבון לעסקאות
□ הבנת הסיכונים - זה כולל הפסדים פוטנציאליים

⚠️  אזהרה: מסחר באופציות כרוך בסיכון הפסד מלא!

נתיבי גישה:
- ממשק ראשי: https://your-domain/
- פאנל מסחר: https://your-domain/trading-dashboard.html
- API מסחר: https://your-domain/trading/status

הפעלה:
npm start
`;

fs.writeFileSync(path.join(__dirname, 'SAFETY-CHECKLIST.md'), safetyChecklist);
console.log('📋 נוצר SAFETY-CHECKLIST.md - קרא בעיון לפני מסחר!\n');

console.log('🎯 מערכת מוכנה! הרץ npm start להפעלה');
console.log('🌐 גש ל-/trading-dashboard.html לממשק מסחר');
console.log('⚠️  זכור: המערכת במצב DRY_RUN - לא יתבצעו עסקאות אמיתיות\n');