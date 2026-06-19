const assert = require('assert');
const config = require('../config');

function testConfigHasKeys() {
  assert(config.bot_token, 'should have bot_token');
  assert(Array.isArray(config.admin_ids), 'admin_ids should be an array');
  assert(config.hmac_secret, 'should have hmac_secret');
  assert(config.whatsapp, 'should have whatsapp');
  assert(config.payment_phone, 'should have payment_phone');
  assert(config.website, 'should have website');
  assert(config.channel, 'should have channel');
  console.log('  ✓ Config has all required keys');
}

function testSmtpConfig() {
  assert(config.smtp, 'should have smtp config');
  assert(config.smtp.host, 'smtp should have host');
  assert(config.smtp.port, 'smtp should have port');
  console.log('  ✓ SMTP config valid');
}

function testSubscriptionConfig() {
  assert(config.subscription, 'should have subscription config');
  assert(Array.isArray(config.subscription.reminder_days), 'reminder_days should be an array');
  assert(config.subscription.grace_period_days > 0, 'grace_period_days should be positive');
  assert(config.subscription.check_interval_minutes > 0, 'check_interval_minutes should be positive');
  console.log('  ✓ Subscription config valid');
}

function testAffiliateConfig() {
  assert(config.affiliate, 'should have affiliate config');
  assert(config.affiliate.commission_percent > 0, 'commission_percent should be positive');
  assert(config.affiliate.referral_bonus > 0, 'referral_bonus should be positive');
  console.log('  ✓ Affiliate config valid');
}

testConfigHasKeys();
testSmtpConfig();
testSubscriptionConfig();
testAffiliateConfig();
