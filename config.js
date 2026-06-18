// ZELZAL Config Loader
// Reads from environment variables (Railway/cloud) or falls back to config.json

const fs = require('fs');
const path = require('path');

let fileConfig = {};
try {
  fileConfig = require('./config.json');
} catch {}

const env = (key, fallback) => process.env[key] !== undefined ? process.env[key] : fallback;
const envNum = (key, fallback) => process.env[key] !== undefined ? Number(process.env[key]) : fallback;
const envArr = (key, fallback) => process.env[key] !== undefined ? process.env[key].split(',').map(Number) : fallback;
const envBool = (key, fallback) => process.env[key] !== undefined ? process.env[key] === 'true' || process.env[key] === '1' : fallback;

const config = {
  bot_token: env('BOT_TOKEN', fileConfig.bot_token || ''),
  admin_ids: envArr('ADMIN_IDS', fileConfig.admin_ids || [1231848867]),
  hmac_secret: env('HMAC_SECRET', fileConfig.hmac_secret || 'Z3lzYWxTZWN1cml0eTIwMjU='),
  dashboard_url: env('DASHBOARD_URL', fileConfig.dashboard_url || ''),
  whatsapp: env('WHATSAPP_URL', fileConfig.whatsapp || 'https://wa.me/201034085168'),
  payment_phone: env('PAYMENT_PHONE', fileConfig.payment_phone || '01034085168'),
  website: env('WEBSITE_URL', fileConfig.website || 'https://mohamedameer99999.github.io/zelzal-security/'),
  channel: env('CHANNEL', fileConfig.channel || '@ZELZAL_Security'),
  bot_username: env('BOT_USERNAME', fileConfig.bot_username || 'ZELZAL_Security_Bot'),
  translate_news: envBool('TRANSLATE_NEWS', fileConfig.translate_news !== false),
  openai_api_key: env('OPENAI_API_KEY', fileConfig.openai_api_key || ''),
  openai_model: env('OPENAI_MODEL', fileConfig.openai_model || 'gpt-4o'),
  gemini_api_key: env('GEMINI_API_KEY', fileConfig.gemini_api_key || ''),
  gemini_model: env('GEMINI_MODEL', fileConfig.gemini_model || 'gemini-2.0-flash'),
  groq_api_key: env('GROQ_API_KEY', fileConfig.groq_api_key || ''),
  groq_model: env('GROQ_MODEL', fileConfig.groq_model || 'llama-3.3-70b-versatile'),
  smtp: {
    host: env('SMTP_HOST', (fileConfig.smtp || {}).host || 'smtp.sendgrid.net'),
    port: envNum('SMTP_PORT', (fileConfig.smtp || {}).port || 587),
    user: env('SMTP_USER', (fileConfig.smtp || {}).user || 'apikey'),
    pass: env('SMTP_PASS', (fileConfig.smtp || {}).pass || ''),
    from: env('SMTP_FROM', (fileConfig.smtp || {}).from || 'ZELZAL Security <zelzalcybershield@gmail.com>')
  },
  subscription: {
    reminder_days: env('REMINDER_DAYS', JSON.stringify((fileConfig.subscription || {}).reminder_days || [7, 3, 1])).split(',').map(Number),
    grace_period_days: envNum('GRACE_PERIOD_DAYS', (fileConfig.subscription || {}).grace_period_days || 3),
    check_interval_minutes: envNum('CHECK_INTERVAL_MIN', (fileConfig.subscription || {}).check_interval_minutes || 60),
    auto_renew_default: envBool('AUTO_RENEW_DEFAULT', (fileConfig.subscription || {}).auto_renew_default !== false)
  },
  webhook: {
    port: envNum('WEBHOOK_PORT', (fileConfig.webhook || {}).port || 3457),
    secret: env('WEBHOOK_SECRET', (fileConfig.webhook || {}).secret || 'zelzal-webhook-secret-2026'),
    allowed_ips: env('WEBHOOK_ALLOWED_IPS', JSON.stringify((fileConfig.webhook || {}).allowed_ips || ['127.0.0.1', '::1'])).split(',').map(s => s.trim())
  },
  affiliate: {
    commission_percent: envNum('COMMISSION_PERCENT', (fileConfig.affiliate || {}).commission_percent || 10),
    min_payout: envNum('MIN_PAYOUT', (fileConfig.affiliate || {}).min_payout || 100),
    referral_bonus: envNum('REFERRAL_BONUS', (fileConfig.affiliate || {}).referral_bonus || 20)
  },
  db_path: env('DB_PATH', path.join(__dirname, 'zelzal.db'))
};

module.exports = config;
