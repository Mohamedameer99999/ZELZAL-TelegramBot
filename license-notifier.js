const db = require('./database.js');
const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(config.bot_token, { polling: false });

const WARNING_HOURS = [72, 24, 1];
const CHECK_INTERVAL = 60 * 60 * 1000;

function formatExpiry(expiryStr) {
  const date = new Date(expiryStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  return date.toLocaleDateString('ar-EG', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

function getHoursUntil(expiryStr) {
  const date = new Date(expiryStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60));
}

async function sendExpiryNotification(license, hoursLeft) {
  const userId = license.user_id;
  const product = license.product;
  const expiryDate = formatExpiry(license.expires_at);
  const key = license.license_key.substring(0, 20) + '...';
  
  let urgency = '';
  if (hoursLeft <= 1) urgency = '🚨 **عاجل جداً!**';
  else if (hoursLeft <= 24) urgency = '⚠️ **تنبيه مهم!**';
  else urgency = '📅 **تذكير:**';
  
  const text = `${urgency}\n\n` +
    `ترخيص **${product}** هينتهي خلال **${hoursLeft} ساعة**.\n\n` +
    `🔑 المفتاح: \`${key}\`\n` +
    `📅 تاريخ الانتهاء: ${expiryDate}\n\n` +
    `💳 **لتجديد الترخيص:**\n` +
    `1. ادفع فودافون كاش: **01034085168**\n` +
    `2. ابعت الإيصال للبوت\n` +
    `3. هيتجدد تلقائياً ✅\n\n` +
    `🔗 أو تواصل معنا: ${config.whatsapp}`;

  try {
    await bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
    console.log(`[License Notifier] Sent ${hoursLeft}h notification to ${userId} for ${product}`);
    return true;
  } catch (err) {
    console.error(`[License Notifier] Failed to send to ${userId}:`, err.message);
    return false;
  }
}

async function checkExpiringLicenses() {
  try {
    db.init();
    const licenses = db.getActiveLicenses();
    let sentCount = 0;
    
    for (const license of licenses) {
      const hoursLeft = getHoursUntil(license.expires_at);
      
      for (const warningHour of WARNING_HOURS) {
        if (hoursLeft === warningHour) {
          const sent = await sendExpiryNotification(license, warningHour);
          if (sent) sentCount++;
          
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
    
    if (sentCount > 0) {
      console.log(`[License Notifier] Sent ${sentCount} expiry notifications`);
    }
  } catch (err) {
    console.error('[License Notifier] Error:', err.message);
  }
}

function start() {
  console.log('[License Notifier] Started - checking every hour');
  checkExpiringLicenses();
  setInterval(checkExpiringLicenses, CHECK_INTERVAL);
}

function stop() {
  console.log('[License Notifier] Stopped');
}

module.exports = { start, stop, checkExpiringLicenses };