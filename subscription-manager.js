const db = require('./database.js');
const config = require('./config');

db.init();

const REMINDER_DAYS = config.subscription?.reminder_days || [7, 3, 1];
const GRACE_DAYS = config.subscription?.grace_period_days || 3;
const CHECK_INTERVAL = (config.subscription?.check_interval_minutes || 60) * 60 * 1000;

let botRef = null;
let notifiedExpiring = new Set();
let notifiedExpired = new Set();
let notifiedGrace = new Set();

function setBot(bot) {
  botRef = bot;
}

function getProductPrice(productId, planType) {
  const products = require('./products.json');
  const p = products.find(x => x.id === productId);
  if (!p) return null;
  if (planType === 'monthly') return p.monthly ? parseInt(p.monthly) : null;
  if (planType === 'yearly') return p.yearly ? parseInt(p.yearly) : null;
  if (planType === 'lifetime') return 0;
  return null;
}

function getPlanDurationDays(planType) {
  if (planType === 'monthly') return 30;
  if (planType === 'yearly') return 365;
  if (planType === 'lifetime') return 36500;
  return 30;
}

async function checkExpiring() {
  try {
    const subscriptions = db.getExpiringSubscriptions(REMINDER_DAYS[0]);
    const now = new Date();

    for (const sub of subscriptions) {
      const endDate = new Date(sub.current_period_end);
      const daysLeft = Math.ceil((endDate - now) / 86400000);

      if (daysLeft <= 0) continue;

      const reminderKey = `${sub.id}_${daysLeft}`;
      if (notifiedExpiring.has(reminderKey)) continue;

      const shouldRemind = REMINDER_DAYS.includes(daysLeft);
      if (!shouldRemind) continue;

      notifiedExpiring.add(reminderKey);
      await notifyExpiring(sub, daysLeft);
    }
  } catch (err) {
    console.error('[Subscription] checkExpiring error:', err.message);
  }
}

async function notifyExpiring(sub, daysLeft) {
  const user = db.getUser(sub.user_id);
  if (!user || !botRef) return;

  const msg =
    `⚠️ *تنبيه: اشتراكك على وشك الانتهاء!*\n\n` +
    `🆔 الاشتراك: #${sub.id}\n` +
    `📦 المنتج: ${sub.product_id}\n` +
    `📆 الخطة: ${sub.plan_type}\n` +
    `⏳ متبقي: ${daysLeft} أيام\n` +
    `📅 ينتهي: ${(sub.current_period_end || '').split('T')[0]}\n\n` +
    `💰 للتجديد: /renew ${sub.id}\n` +
    `🔄 تفعيل التجديد التلقائي: /autorenew ${sub.id} on`;

  try {
    await botRef.sendMessage(user.telegram_id, msg, { parse_mode: 'Markdown' });
    console.log(`[Subscription] Reminded user ${user.telegram_id} about sub #${sub.id} (${daysLeft}d left)`);
  } catch (e) {
    console.error(`[Subscription] Failed to notify user ${user.telegram_id}:`, e.message);
  }
}

async function checkExpired() {
  try {
    const now = new Date().toISOString();

    db.get().prepare(`
      SELECT * FROM subscriptions
      WHERE status = 'active' AND current_period_end <= ?
    `).all(now).forEach(async (sub) => {
      const graceEnd = new Date(sub.current_period_end);
      graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

      if (new Date() < graceEnd) {
        if (notifiedGrace.has(sub.id)) return;
        notifiedGrace.add(sub.id);
        await notifyGracePeriod(sub, graceEnd);
        return;
      }

      if (notifiedExpired.has(sub.id)) return;
      notifiedExpired.add(sub.id);

      db.updateSubscriptionStatus(sub.id, 'expired');

      const licenseKey = db.get().prepare(`
        SELECT license_key FROM licenses WHERE telegram_id = ? AND product = ? AND status = 'active'
      `).get(sub.user_id, sub.product_id);

      if (licenseKey) {
        db.updateLicenseStatus(licenseKey.license_key, 'expired');
      }

      await notifyExpired(sub);
    });
  } catch (err) {
    console.error('[Subscription] checkExpired error:', err.message);
  }
}

async function notifyGracePeriod(sub, graceEnd) {
  const user = db.getUser(sub.user_id);
  if (!user || !botRef) return;

  const msg =
    `⏳ *انتهى اشتراكك! فترة سماح ${GRACE_DAYS} أيام*\n\n` +
    `🆔 الاشتراك: #${sub.id}\n` +
    `📦 المنتج: ${sub.product_id}\n` +
    `📆 الخطة: ${sub.plan_type}\n` +
    `⏳ آخر موعد للتجديد: ${graceEnd.toISOString().split('T')[0]}\n\n` +
    `💰 جدد الآن: /renew ${sub.id}\n` +
    `📞 للتواصل: ${config.whatsapp}`;

  try {
    await botRef.sendMessage(user.telegram_id, msg, { parse_mode: 'Markdown' });
    const admins = config.admin_ids || [];
    for (const aid of admins) {
      await botRef.sendMessage(aid,
        `⚠️ *اشتراك منتهي في فترة السماح*\nالمستخدم: ${user.first_name} (${user.telegram_id})\nالمنتج: ${sub.product_id}\nرقم الاشتراك: #${sub.id}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {
    console.error(`[Subscription] Grace notify error:`, e.message);
  }
}

async function notifyExpired(sub) {
  const user = db.getUser(sub.user_id);
  if (!user || !botRef) return;

  const msg =
    `❌ *تم إنهاء اشتراكك*\n\n` +
    `🆔 الاشتراك: #${sub.id}\n` +
    `📦 المنتج: ${sub.product_id}\n\n` +
    `للتجديد: /renew ${sub.id}\n` +
    `📞 ${config.whatsapp}`;

  try {
    await botRef.sendMessage(user.telegram_id, msg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(`[Subscription] Expired notify error:`, e.message);
  }
}

async function autoRenew(sub) {
  if (!sub.auto_renew) return null;

  const durationDays = getPlanDurationDays(sub.plan_type);
  const newStart = sub.current_period_end;
  const newEnd = new Date(newStart);
  newEnd.setDate(newEnd.getDate() + durationDays);

  const paymentRef = 'auto_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  db.addPayment({
    subscription_id: sub.id,
    user_id: sub.user_id,
    product_id: sub.product_id,
    amount: sub.plan_type === 'monthly' ? 0 : 0,
    currency: 'EGP',
    payment_method: 'auto_renew',
    payment_ref: paymentRef,
    status: 'pending',
    phone: '',
    notes: 'Auto-renewal pending payment confirmation',
    created_at: new Date().toISOString()
  });

  db.updateSubscriptionPeriod(sub.id, newStart.toISOString(), newEnd.toISOString(), paymentRef);

  const user = db.getUser(sub.user_id);
  if (user && botRef) {
    try {
      await botRef.sendMessage(user.telegram_id,
        `🔄 *تم تجديد اشتراكك تلقائياً!*\n\n` +
        `🆔 الاشتراك: #${sub.id}\n` +
        `📅 جديد حتى: ${newEnd.toISOString().split('T')[0]}\n` +
        `💳 في انتظار تأكيد الدفع\n` +
        `📞 للاستفسار: ${config.whatsapp}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error(`[Subscription] Auto-renew notify error:`, e.message);
    }
  }

  const admins = config.admin_ids || [];
  for (const aid of admins) {
    try {
      await botRef.sendMessage(aid,
        `🔄 *تجديد تلقائي - ينتظر الدفع*\n` +
        `المستخدم: ${user ? user.first_name : sub.user_id}\n` +
        `المنتج: ${sub.product_id}\n` +
        `المدة: ${sub.plan_type}\n` +
        `مرجع الدفع: \`${paymentRef}\``,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }

  return { newStart, newEnd, paymentRef };
}

async function processRenewal(subId) {
  const sub = db.getSubscription(subId);
  if (!sub) return { success: false, error: 'الاشتراك غير موجود' };

  const productPrice = getProductPrice(sub.product_id, sub.plan_type);
  if (productPrice === null) return { success: false, error: 'سعر المنتج غير معروف' };

  const durationDays = getPlanDurationDays(sub.plan_type);
  const now = new Date();
  const currentEnd = new Date(sub.current_period_end);
  const newStart = currentEnd > now ? currentEnd : now;
  const newEnd = new Date(newStart);
  newEnd.setDate(newEnd.getDate() + durationDays);

  const licenseKey = db.get().prepare(`
    SELECT license_key FROM licenses WHERE telegram_id = ? AND product = ?
  `).get(sub.user_id, sub.product_id);

  if (licenseKey) {
    db.updateLicenseStatus(licenseKey.license_key, 'active');
    db.get().prepare('UPDATE licenses SET expires_at = ? WHERE license_key = ?')
      .run(newEnd.toISOString(), licenseKey.license_key);
  }

  db.updateSubscriptionStatus(sub.id, 'active');
  db.updateSubscriptionPeriod(sub.id, newStart.toISOString(), newEnd.toISOString(), 'renew_' + Date.now().toString(36));

  const user = db.getUser(sub.user_id);
  if (user && botRef) {
    try {
      await botRef.sendMessage(user.telegram_id,
        `✅ *تم تجديد اشتراكك!*\n\n` +
        `📦 المنتج: ${sub.product_id}\n` +
        `📅 جديد حتى: ${newEnd.toISOString().split('T')[0]}\n` +
        `🔑 الترخيص نشط`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }

  return { success: true, newEnd };
}

function getStats() {
  const dbc = db.get();
  const total = dbc.prepare('SELECT COUNT(*) as c FROM subscriptions').get().c;
  const active = dbc.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'").get().c;
  const expired = dbc.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'expired'").get().c;
  const cancelled = dbc.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'cancelled'").get().c;
  const autoRenew = dbc.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE auto_renew = 1 AND status = 'active'").get().c;
  const expiring7 = db.getExpiringSubscriptions(7).length;
  const monthlyRev = dbc.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE plan_type = 'monthly' AND status = 'active'").get().c;
  const yearlyRev = dbc.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE plan_type = 'yearly' AND status = 'active'").get().c;

  return { total, active, expired, cancelled, autoRenew, expiring7, monthlyRev, yearlyRev };
}

function start(bot) {
  setBot(bot);

  checkExpiring();
  checkExpired();

  setInterval(checkExpiring, CHECK_INTERVAL);
  setInterval(checkExpired, CHECK_INTERVAL);

  console.log(`[Subscription Manager] Started — checking every ${CHECK_INTERVAL / 60000} min`);
}

module.exports = { start, setBot, processRenewal, autoRenew, getStats, checkExpiring, checkExpired };
