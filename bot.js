const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const autoExec = require('./auto-executor.js');
const licenseNotifier = require('./license-notifier.js');

// Notification file for AI assistant
const NOTIFY_FILE = path.join(__dirname, '_new_for_ai.json');
function notifyAI(taskText, id) {
  try {
    fs.writeFileSync(NOTIFY_FILE, JSON.stringify({
      id, task: taskText, created: new Date().toISOString(), read: false
    }));
  } catch {}
}

// Build recent chat history for AI context
function buildChatHistory() {
  try {
    const recent = db.getChatHistory(8);
    const history = [];
    for (const r of recent.reverse()) {
      const user = (r.task || '').replace(/^\[(CHAT|ASK)\]\s*/, '');
      const assistant = r.result;
      if (user && assistant) history.push({ user, assistant });
    }
    return history;
  } catch { return []; }
}
const products = require('./products.json');
const db = require('./database.js');

db.init();

const token = config.bot_token;
if (!token || token === 'YOUR_BOT_TOKEN_HERE') {
  console.error('Please set your bot token in config.json');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const CHANNEL_USERNAME = (config.channel || '@ZELZAL_Security').replace('@', '');
const REMOTE_PORT = config.remote_port || 3456;
const newsAggregator = require('./news-aggregator.js');
const cveBot = require('./cve-bot.js');
const announceBot = require('./announce-bot.js');
const aiResponder = require('./ai-responder.js');
const REMOTE_TOKEN = crypto.createHash('sha256').update(token + ':remote').digest('hex').substring(0, 16);
const ADMIN_IDS = config.admin_ids || [];

function hmacSign(data) {
  return crypto.createHmac('sha256', config.hmac_secret).update(data).digest('hex').substring(0, 8);
}

function generateLicenseKey(product) {
  const prefix = product.prefix;
  const random = crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g).join('-');
  const expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const payload = `${prefix}-${random}-${expiry}`;
  const sig = hmacSign(payload);
  return `${prefix}-${random}-${expiry}-${sig}`;
}

function mainKeyboard(admin = false) {
  const rows = [
    [{ text: '🛒 المنتجات' }, { text: '💰 الأسعار' }],
    [{ text: '🛍️ كيف أشتري؟' }, { text: '🔑 تحقق من ترخيص' }],
    [{ text: '📋 اشتراكاتي' }, { text: '🤝 نظام الأفلييت' }],
    [{ text: '🎫 الدعم الفني' }, { text: '📞 تواصل معنا' }],
    [{ text: '📢 القناة' }]
  ];
  if (admin) {
    rows.push([{ text: '⚡ تشغيل سريع' }, { text: '💬 كلم المساعد' }]);
    rows.push([{ text: '🔑 إدارة التراخيص' }, { text: '📋 إدارة الاشتراكات' }]);
    rows.push([{ text: '🎫 التذاكر' }, { text: '🤝 المسوقين' }]);
  }
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}

function productInlineKeyboard() {
  const rows = products.map(p => [{
    text: `${p.name} ${p.type === 'tool' ? p.price : ''}`,
    callback_data: `product_${p.id}`
  }]);
  return { reply_markup: { inline_keyboard: rows } };
}

bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 معرفك: \`${msg.from.id}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/products/, (msg) => {
  db.trackUser(msg);
  bot.sendMessage(msg.chat.id, '🛒 *منتجات ZELZAL SECURITY:*\n\nاختر منتج للمزيد:', {
    parse_mode: 'Markdown', ...productInlineKeyboard()
  });
});

bot.on('callback_query', async (q) => {
  const msg = q.message;
  const data = q.data;
  if (!data) return bot.answerCallbackQuery(q.id, { text: '❌' });

  // ==== PRODUCT INFO ====
  if (data.startsWith('product_')) {
    const pid = data.replace('product_', '');
    const p = products.find(x => x.id === pid);
    if (!p) return bot.answerCallbackQuery(q.id, { text: '❌' });
    bot.answerCallbackQuery(q.id);
    let text = `${p.name}\n_${p.desc}_\n\n`;
    if (p.type === 'tool') {
      text += `💵 السعر: ${p.price} (مرة واحدة)\n\n🔖 البادئة: ${p.prefix}`;
    } else {
      text += `📅 شهري: ${p.monthly}\n📆 سنوي: ${p.yearly} (وفر 20%)\n\n🔖 البادئة: ${p.prefix}`;
    }
    text += '\n\n💳 للشراء اضغط /buy';
    return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }

  // ==== BROADCAST ====
  if (data === 'confirm_broadcast') {
    if (!broadcastPending) return bot.answerCallbackQuery(q.id, { text: 'لا توجد رسالة' });
    bot.answerCallbackQuery(q.id);
    const users = db.getAllUsers();
    const ids = users.map(u => u.telegram_id);
    let sent = 0, fail = 0;
    bot.sendMessage(msg.chat.id, `📤 جاري الإذاعة لـ ${ids.length} مستخدم...`);
    for (const uid of ids) {
      try { await bot.sendMessage(uid, broadcastPending, { parse_mode: 'Markdown' }); sent++; } catch { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    bot.sendMessage(msg.chat.id, `✅ الإذاعة تمت: ${sent} نجاح | ${fail} فشل`);
    broadcastPending = null;
    return;
  }

  if (data === 'cancel_broadcast') {
    broadcastPending = null;
    bot.answerCallbackQuery(q.id, { text: '❌ ألغيت' });
    return bot.sendMessage(msg.chat.id, '❌ ألغيت الإذاعة.');
  }

  // ==== QUICK ACTIONS (admin only) ====
  if (data.startsWith('q_')) {
    if (!config.admin_ids.includes(q.from.id)) return bot.answerCallbackQuery(q.id, { text: '❌ غير مصرح' });
    bot.answerCallbackQuery(q.id);
    const actionMap = {
      q_status: { cmd: 'status', label: '🖥 الحالة' },
      q_logs: { cmd: 'logs', label: '📋 السجلات' },
      q_disk: { cmd: 'disk', label: '💾 المساحة' },
      q_ls: { cmd: 'ls', label: '📂 الملفات' },
      q_deploy: { cmd: 'deploy', label: '🔄 تحديث' },
      q_keys: { cmd: 'keys', label: '🔑 التراخيص' },
      q_stats: { cmd: 'stats', label: '📊 الإحصائيات' },
      q_tools: { cmd: 'tools status', label: '🛠️ الأدوات' },
    };
    const action = actionMap[data];
    if (!action) return;
    const loading = await bot.sendMessage(msg.chat.id, `⏳ ${action.label}...`);
    try {
      const result = await autoExec.autoExecute(action.cmd);
      await bot.deleteMessage(msg.chat.id, loading.message_id).catch(() => {});
      if (result) {
        bot.sendMessage(msg.chat.id, result, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(msg.chat.id, `❌ استخدم /${action.cmd}`);
      }
    } catch (e) {
      await bot.deleteMessage(msg.chat.id, loading.message_id).catch(() => {});
      bot.sendMessage(msg.chat.id, `❌ خطأ: ${e.message.substring(0, 200)}`);
    }
    return;
  }

  // ==== ADMIN DASHBOARD (admn_ prefix) ====
  if (data.startsWith('admn_')) {
    if (!config.admin_ids.includes(q.from.id)) return bot.answerCallbackQuery(q.id, { text: '❌ غير مصرح' });
    bot.answerCallbackQuery(q.id);

    if (data === 'admn_users') {
      const users = db.getAllUsers();
      let text = `👥 *المستخدمين (${users.length}):*\n\n`;
      users.slice(0, 20).forEach((u, i) => {
        text += `${i + 1}. [${u.telegram_id}] ${u.first_name || ''}`;
        if (u.username) text += ` @${u.username}`;
        text += `\n   📅 ${(u.joined_at || '').split('T')[0]} | رسائل: ${u.msgs}\n\n`;
      });
      if (users.length > 20) text += `...و ${users.length - 20} آخرين`;
      return bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
    }

    if (data === 'admn_licenses') {
      const s = db.getDashboardStats();
      const expiring = db.getExpiringLicenses(7);
      let text = `🔑 *التراخيص*\n\n`;
      text += `كل التراخيص: ${s.licenses}\n`;
      text += `نشط: ${s.activeLicenses}\n`;
      text += `منتهي/ملغي: ${s.revoked + s.expired}\n\n`;
      if (expiring.length > 0) {
        text += `⚠️ *سينتهي قريباً (7 أيام):*\n`;
        expiring.slice(0, 5).forEach(l => {
          text += `• ${l.license_key.substring(0, 20)}... | ${l.product} | ${(l.expires_at || '').split('T')[0]}\n`;
        });
      }
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }

    if (data === 'admn_coupons') {
      const coupons = db.getAllCoupons();
      if (coupons.length === 0) return bot.sendMessage(msg.chat.id, '🎟️ لا توجد كوبونات.');
      let text = `🎟️ *الكوبونات (${coupons.length}):*\n\n`;
      coupons.forEach((c, i) => {
        text += `${i + 1}. \`${c.code}\` — خصم ${c.discount_percent}%\n`;
        if (c.product) text += `   لمنتج: ${c.product}\n`;
        text += `   استخدم ${c.used_count}/${c.max_uses}\n`;
        if (c.expires_at) text += `   ينتهي: ${(c.expires_at || '').split('T')[0]}\n`;
        text += '\n';
      });
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }

    if (data === 'admn_broadcast') {
      return bot.sendMessage(msg.chat.id, '📢 أرسل:\n/broadcast النص اللي عاوز تنشره لكل المستخدمين');
    }

    if (data === 'admn_report') {
      const revStats = db.getRevenueStats('month');
      const byProduct = db.getSalesByProduct();
      let text = `📊 *تقرير المبيعات (آخر 30 يوم)*\n\n`;
      text += `💰 الإيرادات: ${revStats.revenue} ج\n`;
      text += `📦 عدد المبيعات: ${revStats.paymentCount}\n`;
      text += `👥 مستخدمين جدد: ${revStats.newUsers}\n\n`;
      text += `📦 *المبيعات حسب المنتج:*\n`;
      byProduct.slice(0, 8).forEach(p => {
        const prod = products.find(pr => pr.id === p.product);
        text += `• ${prod ? prod.name : p.product}: ${p.count}\n`;
      });
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }

    if (data === 'admn_tickets') {
      const tickets = db.getAllTickets('open');
      if (tickets.length === 0) return bot.sendMessage(msg.chat.id, '🎫 مفيش تذاكر مفتوحة ✅', { parse_mode: 'Markdown' });
      let text = `🎫 *التذاكر المفتوحة (${tickets.length}):*\n\n`;
      tickets.slice(0, 10).forEach(t => {
        text += `#${t.id} ${t.subject.substring(0, 40)}\n`;
        text += `   👤 ${t.first_name || 'N/A'} | /ticket ${t.id}\n\n`;
      });
      if (tickets.length > 10) text += `...و ${tickets.length - 10} آخرين`;
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }

    if (data === 'admn_affiliates') {
      const affs = db.getAllAffiliates();
      if (affs.length === 0) return bot.sendMessage(msg.chat.id, '🤝 مفيش مسوقين.', { parse_mode: 'Markdown' });
      let text = `🤝 *المسوقين (${affs.length}):*\n\n`;
      affs.slice(0, 10).forEach(a => {
        const pending = db.getCommissions(a.id, 'pending').reduce((s, c) => s + c.amount, 0);
        text += `\`${a.code}\` — ${a.first_name || 'N/A'}\n`;
        text += `   💰 ${a.total_earned}ج | معلق: ${pending}ج | ${a.referral_count} إحالة\n\n`;
      });
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }

    return bot.answerCallbackQuery(q.id, { text: '❌' });
  }

  bot.answerCallbackQuery(q.id, { text: '❌' });
});

bot.onText(/\/pricing/, (msg) => {
  db.trackUser(msg);
  let text = '💰 *قائمة الأسعار:*\n\n';
  products.forEach(p => {
    if (p.type === 'tool') text += `${p.name}: ${p.price} (مرة واحدة)\n`;
    else text += `${p.name}\n   شهري: ${p.monthly}  |  سنوي: ${p.yearly}\n`;
    text += '\n';
  });
  text += '🎁 *خصم 20% على الباقات السنوية!*';
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/buy/, (msg) => {
  db.trackUser(msg);
  bot.sendMessage(msg.chat.id,
    '🛍️ *طريقة الشراء:*\n\n' +
    `1️⃣ حول المبلغ على *فودافون كاش* 📱 ${config.payment_phone}\n\n` +
    '2️⃣ صور الإيصال 📸\n\n' +
    `3️⃣ أرسله هنا أو على 👇\n${config.whatsapp}\n\n` +
    '4️⃣ هنبعتلك رابط التحميل + مفتاح الترخيص فوراً ✅',
    { parse_mode: 'Markdown' }
  );
});

bot.on('message', async (msg) => {
  if (!msg.text && !msg.photo) return;
  db.trackUser(msg);
  const text = msg.text || '';

  if (text === '🛒 المنتجات') return bot.sendMessage(msg.chat.id, '🛒 *منتجاتنا:*', { parse_mode: 'Markdown', ...productInlineKeyboard() });
  if (text === '💰 الأسعار') return bot.sendMessage(msg.chat.id, '💰 اختار الأمر /pricing', { parse_mode: 'Markdown' });
  if (text === '🛍️ كيف أشتري؟') return bot.sendMessage(msg.chat.id, '🛍️ /buy');
  if (text === '🔑 تحقق من ترخيص') return bot.sendMessage(msg.chat.id, '🔑 أرسل الأمر:\n/license KEY');
  if (text === '📞 تواصل معنا') return bot.sendMessage(msg.chat.id, '/contact');
  if (text === '📢 القناة') {
    return bot.sendMessage(msg.chat.id,
      '📢 *قناة ZELZAL SECURITY*\n\n' +
      'عروض حصرية، تحديثات، وأخبار الأمن السيبراني.\n\n' +
      `👉 @${CHANNEL_USERNAME}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📢 اشترك في القناة', url: `https://t.me/${CHANNEL_USERNAME}` }]] } }
    );
  }

  if (text === '📋 اشتراكاتي') {
    return bot.sendMessage(msg.chat.id, '📋 /mysubs');
  }

  if (text === '🤝 نظام الأفلييت') {
    return bot.sendMessage(msg.chat.id, '🤝 /affiliate');
  }

  if (text === '🎫 الدعم الفني') {
    return bot.sendMessage(msg.chat.id, '🎫 أرسل:\n/ticket عنوان المشكلة - وصف المشكلة');
  }

  // Admin-only buttons
  if (text === '🔑 إدارة التراخيص' && config.admin_ids.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id,
      '🔑 *إدارة التراخيص:*\n\n' +
      '/keys — عرض كل التراخيص\n' +
      '/genkey — توليد مفتاح جديد\n' +
      '/activate KEY — تفعيل ترخيص\n' +
      '/deactivate KEY — إلغاء ترخيص\n' +
      '/expiring — التراخيص المنتهية قريباً\n' +
      '/mykeys — تراخيصي',
      { parse_mode: 'Markdown' }
    );
  }

  if (text === '📋 إدارة الاشتراكات' && config.admin_ids.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id,
      '📋 *إدارة الاشتراكات:*\n\n' +
      '/subscriptions — كل الاشتراكات\n' +
      '/sub_stats — إحصائيات الاشتراكات\n' +
      '/renew <id> — تجديد اشتراك\n' +
      '/autorenew <id> on/off — تفعيل/تعطيل التجديد التلقائي\n' +
      '/payment <ref> — تأكيد دفع\n' +
      '/mysubs — اشتراكاتي',
      { parse_mode: 'Markdown' }
    );
  }

  if (text === '🎫 التذاكر' && config.admin_ids.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id,
      '🎫 *التذاكر:*\n\n' +
      '/tickets — كل التذاكر\n' +
      '/ticket <id> — عرض تذكرة\n' +
      '/ticket_reply <id> <رسالة> — رد على تذكرة\n' +
      '/ticket_close <id> — إغلاق تذكرة',
      { parse_mode: 'Markdown' }
    );
  }

  if (text === '🤝 المسوقين' && config.admin_ids.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id,
      '🤝 *المسوقين (الأفلييت):*\n\n' +
      '/affiliates — كل المسوقين\n' +
      '/affiliate_stats — إحصائيات الأفلييت\n' +
      '/affiliate_pay <id> — دفع عمولة',
      { parse_mode: 'Markdown' }
    );
  }

  // Admin quick buttons
  if (text === '⚡ تشغيل سريع' && config.admin_ids.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⚡ *تشغيل سريع:*\nاختر أمر:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🖥 الحالة', callback_data: 'q_status' }],
          [{ text: '📋 السجلات', callback_data: 'q_logs' }],
          [{ text: '💾 المساحة', callback_data: 'q_disk' }],
          [{ text: '📂 الملفات', callback_data: 'q_ls' }],
          [{ text: '🔄 تحديث', callback_data: 'q_deploy' }],
          [{ text: '🔑 التراخيص', callback_data: 'q_keys' }],
          [{ text: '📊 الإحصائيات', callback_data: 'q_stats' }],
          [{ text: '🛠️ الأدوات', callback_data: 'q_tools' }],
        ]
      }
    });
  }

  if (text === '💬 كلم المساعد' && config.admin_ids.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id,
      '💬 *راسل المساعد AI*\n\n' +
      'اكتب رسالتك هنا وهتوصله فوراً 👇\n\n' +
      'أو استخدم الأمر: `/ask رسالتك`',
      { parse_mode: 'Markdown' }
    );
  }

  if (msg.photo) {
    const caption = (msg.caption || '').toLowerCase();
    const isReceipt = caption.includes('ايصال') || caption.includes('receipt') || caption.includes('دفع') || caption.includes('تحويل') || caption.includes('فودافون');
    if (isReceipt) {
      bot.sendMessage(msg.chat.id,
        '✅ *تم استلام الإيصال!*\n\n' +
        'شكراً لشرائك. سيتم مراجعة طلبك وإرسال المفتاح والرابط خلال دقائق.\n\n' +
        '📌 *للتواصل السريع:*\n' + config.whatsapp,
        { parse_mode: 'Markdown' }
      );
      if (config.admin_ids.length > 0) {
        for (const adminId of config.admin_ids) {
          bot.sendMessage(adminId, `📩 *إيصال جديد من*\n${msg.from.first_name} (@${msg.from.username || 'N/A'}, ID: ${msg.from.id})`, { parse_mode: 'Markdown' });
          bot.forwardMessage(adminId, msg.chat.id, msg.message_id);
        }
      }
    }
  }

  // Catch-all: admin sends normal text → auto-executor → queue (auto-responder picks up)
  if (text && !text.startsWith('/') && config.admin_ids.includes(msg.from.id)) {
    const aeResult = await autoExec.autoExecute(text);
    if (aeResult) {
      return bot.sendMessage(msg.chat.id, aeResult, { parse_mode: 'Markdown' });
    }
    // Queue: auto-responder will pick up within 15s
    const id = db.addCommand('[CHAT] ' + text);
    bot.sendMessage(msg.chat.id,
      `⏳ *تم الاستلام!*\n\nAI بيحضر الرد ...\n🆔 \`${id}\``,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.onText(/\/license(?:\s+(.+))?/, async (msg, match) => {
  db.trackUser(msg);
  if (!match[1]) {
    return bot.sendMessage(msg.chat.id, '🔑 أرسل مفتاح الترخيص كاملاً:\nمثال: `/license CYBERSHIELD-XXXXX-XXXXX-XXXXX-XXXXX-20260615-XXXXXXXX`', { parse_mode: 'Markdown' });
  }
  const key = match[1].trim();
  const parts = key.split('-');
  if (parts.length !== 7) {
    return bot.sendMessage(msg.chat.id, '❌ صيغة المفتاح غير صحيحة. تأكد من كتابته كاملاً (7 أجزاء).');
  }
  const prefix = parts[0].toUpperCase();
  const validPrefixes = products.map(p => p.prefix);
  if (!validPrefixes.includes(prefix)) {
    return bot.sendMessage(msg.chat.id, `❌ بادئة غير معروفة: ${prefix}\nالبادئات: ${validPrefixes.join(', ')}`);
  }
  const data = parts.slice(0, -1).join('-');
  const expectedSig = hmacSign(data);
  if (parts[6] !== expectedSig) {
    return bot.sendMessage(msg.chat.id, '❌ مفتاح غير صالح — التوقيع غير متطابق.');
  }
  bot.sendMessage(msg.chat.id, '✅ *الترخيص صالح!*\nجاري التحقق من السيرفر...', { parse_mode: 'Markdown' });
  try {
    await verifyWithDashboard(key, msg.chat.id);
  } catch {
    bot.sendMessage(msg.chat.id, '⚠️ تعذر الاتصال بسيرفر التحقق. المفتاح صالح محلياً.');
  }
});

async function verifyWithDashboard(key, chatId) {
  return new Promise((resolve, reject) => {
    const url = new URL('/verify-license', config.dashboard_url);
    url.searchParams.set('key', key);
    https.get(url.toString(), { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.valid) {
            bot.sendMessage(chatId, `✅ *الترخيص نشط!*\nالمنتج: ${json.product}\nالحالة: ${json.status}\nتاريخ الانتهاء: ${json.expiry || 'غير محدد'}`);
          } else {
            bot.sendMessage(chatId, `❌ ${json.message || 'الترخيص غير نشط'}`);
          }
        } catch {
          bot.sendMessage(chatId, `⚠️ السيرفر: ${data.substring(0, 200)}`);
        }
        resolve();
      });
    }).on('error', (err) => reject(err));
  });
}

bot.onText(/\/contact/, (msg) => {
  db.trackUser(msg);
  bot.sendMessage(msg.chat.id,
    '📞 *تواصل معنا:*\n\n' +
    `📱 واتساب: ${config.whatsapp}\n` +
    `📢 تيليجرام: @${CHANNEL_USERNAME}\n` +
    `🌐 الموقع: ${config.website}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/channel/, (msg) => {
  db.trackUser(msg);
  bot.sendMessage(msg.chat.id, `📢 اشترك في قناتنا:\nhttps://t.me/${CHANNEL_USERNAME}`, {
    reply_markup: { inline_keyboard: [[{ text: '📢 اشترك', url: `https://t.me/${CHANNEL_USERNAME}` }]] }
  });
});

bot.onText(/\/invite/, async (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  try {
    const link = await bot.exportChatInviteLink(`@${CHANNEL_USERNAME}`);
    const users = db.getAllUsers();
    bot.sendMessage(msg.chat.id,
      `🔗 *رابط الدعوة:*\n${link}\n\n` +
      `📤 أرسلته لـ ${users.length} مستخدم في البوت؟ اكتب:\n/broadcast انضم لقناتنا: ${link}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔗 رابط الدعوة', url: link }]] } }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ فشل. تأكد أن البوت مشرف في القناة.\n${e.message}`);
  }
});

let broadcastPending = null;
bot.onText(/\/broadcast(?:\s+(.+))?/, async (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  if (!match[1]) return bot.sendMessage(msg.chat.id, 'أرسل: /broadcast النص');
  broadcastPending = match[1];
  bot.sendMessage(msg.chat.id,
    `📤 *معاينة الإذاعة:*\n\n${broadcastPending}\n\nهل تريد الإرسال للكل؟`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '✅ تأكيد', callback_data: 'confirm_broadcast' }],
        [{ text: '❌ إلغاء', callback_data: 'cancel_broadcast' }]
      ]}
    }
  );
});

// ═══════════════════════════════════════════════
//            ENHANCED STATS / DASHBOARD
// ═══════════════════════════════════════════════

bot.onText(/\/stats/, (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const s = db.getDashboardStats();
  bot.sendMessage(msg.chat.id,
    `📊 *إحصائيات ZELZAL:*\n\n` +
    `👥 المستخدمين: ${s.users} (اليوم: ${s.activeUsers})\n` +
    `🔑 التراخيص: ${s.licenses} (نشط: ${s.activeLicenses})\n` +
    `📆 شهري: ${s.monthly} | سنوي: ${s.yearly} | مدى الحياة: ${s.lifetime}\n` +
    `⛔ ملغي: ${s.revoked} | منتهي: ${s.expired}\n` +
    `🛒 المنتجات: ${s.mainCount} رئيسية + ${s.toolCount} أدوات`,
    { parse_mode: 'Markdown' }
  );
});



// ═══════════════════════════════════════════════
//              ADMIN PANEL
// ═══════════════════════════════════════════════

bot.onText(/\/admin/, (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, 
    '👑 *لوحة الإدارة:*\n\n' +
    '📊 */dashboard* — لوحة التحكم\n' +
    '📊 */reports* — تقارير مبيعات\n' +
    '🔑 */keys* — كل التراخيص\n' +
    '🎟️ */coupons* — الكوبونات\n' +
    '🔑 */genkey* — توليد مفتاح\n' +
    '📢 */broadcast* — إذاعة للكل\n' +
    '📢 */post* — نشر بالقناة\n' +
    '🎫 */tickets* — التذاكر\n' +
    '🤝 */affiliates* — المسوقين\n' +
    '📋 */subscriptions* — الاشتراكات', 
    { parse_mode: 'Markdown' }
  );
});

// ═══════════════════════════════════════════════
//              LICENSE MANAGEMENT
// ═══════════════════════════════════════════════

// /genkey <product_id> <plan> [telegram_id] [name] [phone]
bot.onText(/\/genkey(?:\s+(.+))?/, async (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const args = (match[1] || '').trim().split(/\s+/);
  if (args.length < 2) {
    let text = '🔑 *توليد مفتاح ترخيص*\n\n';
    text += '`/genkey <product> <plan> [telegram_id] [name] [phone]`\n\n';
    text += '*المنتجات:*\n';
    products.forEach(p => { text += `  \`${p.id}\` — ${p.name}\n`; });
    text += '\n*الخطط:* `monthly`, `yearly`, `lifetime`';
    return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }
  const productId = args[0];
  const plan = args[1].toLowerCase();
  const tgId = args[2] ? parseInt(args[2]) : null;
  const name = args[3] || '';
  const phone = args[4] || '';

  const product = products.find(p => p.id === productId);
  if (!product) return bot.sendMessage(msg.chat.id, `❌ منتج غير معروف: ${productId}`);
  if (!['monthly', 'yearly', 'lifetime'].includes(plan)) {
    return bot.sendMessage(msg.chat.id, '❌ خطة غير صحيحة. استخدم: monthly, yearly, lifetime');
  }

  const licenseKey = generateLicenseKey(product);
  const parts = licenseKey.split('-');
  const sig = parts.pop();
  const now = new Date();
  let expiresAt = null;
  if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();
  else if (plan === 'yearly') expiresAt = new Date(now.getTime() + 365 * 86400000).toISOString();

  db.addLicense({
    license_key: licenseKey,
    hmac_signature: sig,
    telegram_id: tgId,
    customer_name: name,
    phone: phone,
    email: '',
    product: product.id,
    plan_type: plan,
    status: 'active',
    created_at: now.toISOString(),
    expires_at: expiresAt,
    activated_at: now.toISOString(),
    payment_date: now.toISOString().split('T')[0],
    notes: '',
  });

  let reply = `✅ *تم توليد المفتاح!*\n\n`;
  reply += `📦 المنتج: ${product.name}\n`;
  reply += `📆 الخطة: ${plan}\n`;
  reply += `🔑 المفتاح:\n\`${licenseKey}\`\n`;
  if (tgId) reply += `👤 المستخدم: \`${tgId}\`\n`;
  if (expiresAt) reply += `⏳ ينتهي: ${expiresAt.split('T')[0]}\n`;
  reply += `\n📌 استخدم /keys لعرض كل المفاتيح`;
  bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
});

// /keys — List all licenses (admin)
bot.onText(/\/keys(?:\s+(\d+))?/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const tgFilter = match[1] ? parseInt(match[1]) : null;
  const licenses = tgFilter ? db.getLicensesByUser(tgFilter) : db.getAllLicenses();
  
  if (licenses.length === 0) {
    return bot.sendMessage(msg.chat.id, tgFilter ? `❌ لا توجد تراخيص للمستخدم ${tgFilter}` : '❌ لا توجد تراخيص.');
  }
  
  let text = `🔑 *التراخيص (${licenses.length}):*\n\n`;
  licenses.slice(0, 15).forEach((l, i) => {
    text += `${i + 1}. \`${l.license_key.substring(0, 20)}...\`\n`;
    text += `   📦 ${l.product} | ${l.plan_type}\n`;
    text += `   📊 ${l.status === 'active' ? '✅ نشط' : l.status === 'expired' ? '⏳ منتهي' : '⛔ ملغي'}`;
    if (l.telegram_id) text += ` | 👤 ${l.telegram_id}`;
    if (l.expires_at) text += `\n   ⏳ ${l.expires_at.split('T')[0]}`;
    text += '\n\n';
  });
  if (licenses.length > 15) text += `...و ${licenses.length - 15} آخرين`;
  text += '\n📌 للتفعيل/التعطيل:\n/activate KEY\n/deactivate KEY';
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

// /mykeys — User sees their licenses
bot.onText(/\/mykeys/, (msg) => {
  db.trackUser(msg);
  const licenses = db.getLicensesByUser(msg.from.id);
  if (licenses.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ لا توجد تراخيص مسجلة لحسابك.\nإذا اشتريت منتج، أرسل مفتاحك مع /license KEY');
  }
  let text = `🔑 *تراخيصك (${licenses.length}):*\n\n`;
  licenses.forEach((l, i) => {
    const p = products.find(x => x.id === l.product);
    text += `${i + 1}. ${p ? p.name : l.product}\n`;
    text += `   📆 ${l.plan_type}\n`;
    text += `   📊 ${l.status === 'active' ? '✅ نشط' : l.status === 'expired' ? '⏳ منتهي' : '⛔ ملغي'}\n`;
    if (l.expires_at) text += `   ⏳ ${l.expires_at.split('T')[0]}\n`;
    text += '\n';
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// /activate <key>
bot.onText(/\/activate\s+(.+)/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const key = match[1].trim();
  const license = db.getLicense(key);
  if (!license) return bot.sendMessage(msg.chat.id, '❌ المفتاح غير موجود.');
  db.updateLicenseStatus(key, 'active');
  bot.sendMessage(msg.chat.id, `✅ تم تفعيل المفتاح:\n\`${key.substring(0, 30)}...\``, { parse_mode: 'Markdown' });
});

// /deactivate <key>
bot.onText(/\/deactivate\s+(.+)/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const key = match[1].trim();
  const license = db.getLicense(key);
  if (!license) return bot.sendMessage(msg.chat.id, '❌ المفتاح غير موجود.');
  db.updateLicenseStatus(key, 'revoked');
  bot.sendMessage(msg.chat.id, `⛔ تم إلغاء المفتاح:\n\`${key.substring(0, 30)}...\``, { parse_mode: 'Markdown' });
});

// /expiring [days]
bot.onText(/\/expiring(?:\s+(\d+))?/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const days = match[1] ? parseInt(match[1]) : 7;
  const expiring = db.getExpiringLicenses(days);
  if (expiring.length === 0) {
    return bot.sendMessage(msg.chat.id, `✅ لا توجد تراخيص تنتهي خلال ${days} أيام.`);
  }
  let text = `⚠️ *التراخيص المنتهية خلال ${days} أيام (${expiring.length}):*\n\n`;
  expiring.slice(0, 10).forEach((l, i) => {
    text += `${i + 1}. \`${l.license_key.substring(0, 20)}...\`\n`;
    text += `   📦 ${l.product} | ينتهي: ${(l.expires_at || '').split('T')[0]}\n`;
    if (l.telegram_id) text += `   👤 ${l.telegram_id}\n`;
    text += '\n';
  });
  if (expiring.length > 10) text += `...و ${expiring.length - 10} آخرين\n`;
  text += '\n💡 استخدم:\n/renew KEY month/year';
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

// ═══════════════════════════════════════════════
//                COUPON SYSTEM
// ═══════════════════════════════════════════════

// /addcoupon <code> <discount%> [product] [max_uses]
bot.onText(/\/addcoupon(?:\s+(.+))?/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const args = (match[1] || '').trim().split(/\s+/);
  if (args.length < 2) {
    return bot.sendMessage(msg.chat.id,
      '🎟️ *إضافة كوبون:*\n\n' +
      '`/addcoupon <code> <discount%> [product] [max_uses]`\n\n' +
      'مثال: `/addcoupon WELCOME10 10 * 50`',
      { parse_mode: 'Markdown' }
    );
  }
  const code = args[0].toUpperCase();
  const discount = parseInt(args[1]);
  const product = args[2] || '*';
  const maxUses = parseInt(args[3]) || 1;

  if (isNaN(discount) || discount < 1 || discount > 100) {
    return bot.sendMessage(msg.chat.id, '❌ الخصم يجب أن يكون رقم بين 1 و 100.');
  }

  try {
    db.addCoupon({
      code, discount_percent: discount,
      product: product,
      max_uses: maxUses,
      expires_at: null,
      created_at: new Date().toISOString()
    });
    bot.sendMessage(msg.chat.id,
      `✅ *تمت إضافة الكوبون!*\n\n` +
      `🔖 الكود: \`${code}\`\n` +
      `🎯 الخصم: ${discount}%\n` +
      `📦 المنتج: ${product === '*' ? 'جميع المنتجات' : product}\n` +
      `🔄 الاستخدام: ${maxUses}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ فشل: ${e.message}`);
  }
});

// /coupons — List all coupons
bot.onText(/\/coupons/, (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const coupons = db.getAllCoupons();
  if (coupons.length === 0) {
    return bot.sendMessage(msg.chat.id, '🎟️ لا توجد كوبونات.\nلإضافة كوبون: /addcoupon');
  }
  let text = `🎟️ *الكوبونات (${coupons.length}):*\n\n`;
  coupons.forEach((c, i) => {
    text += `${i + 1}. \`${c.code}\` — خصم ${c.discount_percent}%\n`;
    text += `   📦 ${c.product === '*' ? 'الكل' : c.product}\n`;
    text += `   🔄 ${c.used_count}/${c.max_uses}\n`;
    if (c.expires_at) text += `   ⏳ ${c.expires_at.split('T')[0]}\n`;
    text += '\n';
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// /delcoupon <code>
bot.onText(/\/delcoupon\s+(.+)/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const code = match[1].trim().toUpperCase();
  const coupon = db.getCoupon(code);
  if (!coupon) return bot.sendMessage(msg.chat.id, '❌ الكوبون غير موجود.');
  db.deleteCoupon(code);
  bot.sendMessage(msg.chat.id, `🗑️ تم حذف الكوبون \`${code}\``, { parse_mode: 'Markdown' });
});

// ═══════════════════════════════════════════════
//              POST TO CHANNEL
// ═══════════════════════════════════════════════

bot.onText(/\/post(?:\s+(.+))?/, async (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  if (!match[1]) return bot.sendMessage(msg.chat.id, 'أرسل: /post النص');
  try {
    const sent = await bot.sendMessage(`@${CHANNEL_USERNAME}`, match[1], { parse_mode: 'Markdown' });
    bot.sendMessage(msg.chat.id, `✅ تم النشر في القناة:\n\n${match[1]}`, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ فشل النشر. تأكد من إضافة البوت كمشرف في القناة.\n\nالخطأ: ${e.message}`);
  }
});

bot.on('inline_query', (q) => {
  const query = (q.query || '').toLowerCase();
  const results = products
    .filter(p => p.name.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query))
    .slice(0, 10)
    .map(p => ({
      type: 'article', id: p.id,
      title: p.name,
      description: p.desc.substring(0, 80),
      input_message_content: { message_text: `${p.name}\n${p.desc}\n${fmtPrice(p)}\n\n🔗 ${config.website}` }
    }));
  bot.answerInlineQuery(q.id, results, { cache_time: 60 });
});

function fmtPrice(p) {
  if (p.type === 'tool') return `💵 ${p.price}`;
  return `📅 شهري: ${p.monthly}  |  📆 سنوي: ${p.yearly}`;
}

// ═══════════════════════════════════════════════
//              REMOTE CONTROL
// ═══════════════════════════════════════════════

function isAdmin(uid) { return ADMIN_IDS.includes(uid); }

function remoteRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: REMOTE_PORT,
      path: endpoint, method,
      headers: {
        'X-Auth-Token': REMOTE_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// /cmd — Queue task for auto-execution or AI
bot.onText(/\/cmd(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  if (!match[1]) return bot.sendMessage(msg.chat.id, '📝 أرسل: /cmd المهمة التي تريد تنفيذها');
  const taskText = match[1].trim();
  
  // Try auto-execute first
  bot.sendMessage(msg.chat.id, `⏳ جاري تنفيذ: ${taskText.substring(0, 100)}...`);
  const aeResult = await autoExec.autoExecute(taskText);
  
  if (aeResult) {
    return bot.sendMessage(msg.chat.id,
      `✅ *تم التنفيذ!*\n\n📝 ${taskText.substring(0, 200)}\n\n📋 ${aeResult.substring(0, 3000)}`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Queue: auto-responder picks up within 15s
  const id = db.addCommand(taskText);
  bot.sendMessage(msg.chat.id,
    `⏳ *تم الاستلام!*\n\nAI بيحضر الرد ...\n🆔 \`${id}\``,
    { parse_mode: 'Markdown' }
  );
});

// /ask — Send message to AI (queues for auto-responder)
bot.onText(/\/ask(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  if (!match[1]) return bot.sendMessage(msg.chat.id, '📝 أرسل: /ask رسالتك للمساعد AI');
  const text = match[1].trim();
  const id = db.addCommand('[ASK] ' + text);
  bot.sendMessage(msg.chat.id,
    `⏳ *تم الاستلام!*\n\nAI بيحضر الرد ...\n🆔 \`${id}\``,
    { parse_mode: 'Markdown' }
  );
});

// /tasks — View pending tasks
bot.onText(/\/tasks/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const pending = db.getPendingCommands();
  if (pending.length === 0) return bot.sendMessage(msg.chat.id, '✅ لا توجد أوامر معلقة.');
  let text = `📋 *الأوامر المعلقة (${pending.length}):*\n\n`;
  pending.forEach((t, i) => {
    text += `${i + 1}. [\`${t.id}\`] ${t.task.substring(0, 100)}\n   ⏰ ${t.created_at}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// Results polling (from DB)
setInterval(async () => {
  try {
    const newResults = db.getUnnotifiedResults();
    for (const r of newResults) {
      const task = (r.task || '').substring(0, 200);
      const result = (r.result || '').substring(0, 1000);
      for (const uid of ADMIN_IDS) {
        await bot.sendMessage(uid,
          `✅ اكتملت المهمة!\n\n📝 ${task}\n\n📋 ${result}`
        );
      }
      db.markNotified(r.id);
    }
  } catch {}
}, 15000);

// Immediate flush on startup
setTimeout(async () => {
  try {
    const pending = db.getUnnotifiedResults();
    for (const r of pending) {
      const task = (r.task || '').substring(0, 200).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      const result = (r.result || '').substring(0, 1000).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      for (const uid of ADMIN_IDS) {
        try {
          await bot.sendMessage(uid,
            `✅ *اكتملت المهمة!*\n\n📝 ${task}\n\n📋 ${result}`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          await bot.sendMessage(uid, `✅ اكتملت المهمة!\n\n📝 ${r.task?.substring(0, 200) || ''}\n\n📋 ${r.result?.substring(0, 1000) || ''}`);
        }
      }
      db.markNotified(r.id);
    }
  } catch {}
}, 2000);

// /status — System status
bot.onText(/\/status/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  try {
    const st = await remoteRequest('/api/status');
    bot.sendMessage(msg.chat.id,
      `🖥 *حالة النظام:*\n\n` +
      `⏱ التشغيل: ${Math.floor(st.uptime / 60)} دقيقة\n` +
      `🆔 PID: ${st.server_pid}\n` +
      `🤖 Node: ${st.node}\n` +
      `📦 البوت: ${st.bot_running ? '✅ شغال' : '❌ طافي'}\n` +
      `🖥 النظام: ${st.platform}`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    bot.sendMessage(msg.chat.id, '❌ السيرفر المحلي مش شغال. شغّل remote-server.js');
  }
});

// /shell — Execute shell command
bot.onText(/\/shell(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  if (!match[1]) return bot.sendMessage(msg.chat.id, 'أرسل: /shell الأمر');
  try {
    const result = await remoteRequest('/api/shell', 'POST', { command: match[1], timeout: 20000 });
    let reply = `💻 *Shell:* \`${match[1].substring(0, 50)}\`\n\n`;
    reply += `🔚 Exit: ${result.exit_code}\n`;
    if (result.stdout) reply += `\n📤 *Output:*\n\`\`\`\n${result.stdout.substring(0, 1500)}\n\`\`\``;
    if (result.stderr) reply += `\n📥 *Errors:*\n\`\`\`\n${result.stderr.substring(0, 500)}\n\`\`\``;
    if (result.error) reply += `\n❌ ${result.error}`;
    bot.sendMessage(msg.chat.id, reply.substring(0, 4000), { parse_mode: 'Markdown' });
  } catch {
    bot.sendMessage(msg.chat.id, '❌ السيرفر المحلي مش شغال.');
  }
});

// /deploy — Git pull + deploy
bot.onText(/\/deploy/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, '🔄 جاري تحديث الموقع...');
  try {
    const result = await remoteRequest('/api/deploy', 'POST');
    if (result.success) {
      bot.sendMessage(msg.chat.id, `✅ *تم التحديث!*\n\n${result.stdout?.substring(0, 500) || ''}`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `❌ فشل: ${result.error}`);
    }
  } catch {
    bot.sendMessage(msg.chat.id, '❌ السيرفر المحلي مش شغال.');
  }
});

// /restart-bot
bot.onText(/\/restart\-bot/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, '🔄 جاري إعادة تشغيل البوت...');
  try {
    await remoteRequest('/api/restart-bot', 'POST');
  } catch {}
  process.exit(0);
});

// /logs
bot.onText(/\/logs/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  try {
    const logs = fs.readFileSync(path.join(__dirname, 'remote-server.log'), 'utf8');
    const lines = logs.split('\n').filter(Boolean).slice(-20);
    bot.sendMessage(msg.chat.id, `📋 *آخر الأحداث:*\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch {
    bot.sendMessage(msg.chat.id, '❌ ما فيش سجلات.');
  }
});

// /ls
bot.onText(/\/ls(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  try {
    const result = await remoteRequest('/api/ls', 'POST', { dir: match[1] || '' });
    let text = `📂 *${match[1] || '/'}*\n\n`;
    result.files.forEach(f => {
      text += `${f.dir ? '📁' : '📄'} ${f.name}${f.dir ? '/' : ` (${(f.size / 1024).toFixed(1)}KB)`}\n`;
    });
    bot.sendMessage(msg.chat.id, text.substring(0, 4000), { parse_mode: 'Markdown' });
  } catch {
    bot.sendMessage(msg.chat.id, '❌ السيرفر المحلي مش شغال.');
  }
});

// /help
bot.onText(/\/help/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, 'الأوامر العامة:\n/start - بدء\n/products - المنتجات\n/pricing - الأسعار\n/buy - الشراء\n/license KEY - تحقق من ترخيص\n/mykeys - تراخيصي\n/mysubs - اشتراكاتي\n/contact - التواصل\n/help - المساعدة');
  bot.sendMessage(msg.chat.id,
    '👤 *أوامر التحكم:*\n\n' +
    '📝 `/cmd رسالة` — تنفيذ أمر مباشر (Auto-Execute)\n' +
    '💬 `/ask رسالة` — إرسال رسالة مباشرة للمساعد AI\n' +
    '📋 `/tasks` — عرض الأوامر المعلقة\n' +
    '🖥 `/status` — حالة النظام\n' +
    '💻 `/shell أمر` — تنفيذ أمر مباشر\n' +
    '📂 `/ls [مجلد]` — عرض الملفات\n' +
    '🔄 `/deploy` — تحديث الموقع\n' +
    '📋 `/logs` — آخر السجلات\n' +
    '🔄 `/restart-bot` — إعادة تشغيل البوت\n' +
    '📰 `/news` — أخبار أمن سيبراني للقناة\n' +
    '🛡️ `/cve CVE-ID` — بحث عن ثغرة\n' +
    '📊 `/channel_stats` — إحصائيات القناة\n' +
    '📢 `/announce` — نشر إعلان منتج\n' +
    '📧 `/send_email` — إرسال إيميل تفعيل\n' +
    '🛠️ `/tools` — إدارة أدوات القناة\n\n' +
    '📋 *الاشتراكات:*\n' +
    '📋 `/mysubs` — اشتراكاتي\n' +
    '📊 `/sub_stats` — إحصائيات الاشتراكات\n' +
    '📋 `/subscriptions` — كل الاشتراكات (آدمن)\n' +
    '🔄 `/renew <id>` — تجديد اشتراك\n' +
    '🔄 `/autorenew <id> on/off` — تفعيل/تعطيل التجديد التلقائي\n' +
    '💳 `/payment <ref>` — تأكيد دفع\n\n' +
    '🔑 *إدارة التراخيص:*\n' +
    '🔑 `/genkey` — توليد مفتاح ترخيص\n' +
    '📋 `/keys` — عرض كل التراخيص\n' +
    '✅ `/activate KEY` — تفعيل ترخيص\n' +
    '⛔ `/deactivate KEY` — إلغاء ترخيص\n' +
    '⚠️ `/expiring [days]` — تراخيص شاربة على الانتهاء\n' +
    '🔑 `/mykeys` — تراخيصي الشخصية\n\n' +
    '🎟️ *الكوبونات:*\n' +
    '🎟️ `/addcoupon` — إضافة كوبون\n' +
    '📋 `/coupons` — عرض الكوبونات\n' +
    '🗑️ `/delcoupon CODE` — حذف كوبون\n\n' +
    '⚡ *أوامر سريعة (Auto-Execute):*\n' +
    'استخدم `/cmd` لأي من هذه:\n' +
    '`status`, `logs`, `ls`, `disk`,\n' +
    '`read <file>`, `search <term>`,\n' +
    '`deploy`, `restart bot`, `shell <cmd>`\n' +
    'إذا التعليمة معقدة، بتتأجل للمساعد AI 🤖',
    { parse_mode: 'Markdown' }
  );
});

// /cve
bot.onText(/\/cve\s+(.+)/, async (msg, match) => {
  await cveBot.handleCveCommand(bot, msg, match[1]);
});

// /announce
bot.onText(/\/announce(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  if (match[1]) {
    const idx = parseInt(match[1]) - 1;
    const list = announceBot.list;
    if (idx < 0 || idx >= list.length) {
      return bot.sendMessage(msg.chat.id, `❌ رقم غير صالح. استخدم رقم من 1 إلى ${list.length}`);
    }
    const ok = await announceBot.postSpecific(bot, idx);
    bot.sendMessage(msg.chat.id, ok ? `✅ تم نشر: ${list[idx].title}` : '❌ فشل النشر');
    return;
  }
  let text = '📢 *الإعلانات المتاحة:*\n\n';
  announceBot.list.forEach((a, i) => {
    text += `${i + 1}. ${a.title}\n`;
  });
  text += `\nلنشر إعلان: \`/announce رقم\``;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// /channel_stats
bot.onText(/\/channel_stats/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  try {
    const chat = await bot.getChat(`@${CHANNEL_USERNAME}`);
    const admins = await bot.getChatAdministrators(`@${CHANNEL_USERNAME}`);
    const memberCount = await bot.getChatMemberCount(`@${CHANNEL_USERNAME}`);
    let text = `📊 *إحصائيات القناة:*\n\n`;
    text += `👥 المشتركين: ${memberCount}\n`;
    text += `👤 المشرفين: ${admins.length}\n`;
    text += `📝 الوصف: ${(chat.description || '').substring(0, 100)}\n`;
    if (chat.username) text += `🔗 @${chat.username}\n`;
    text += `🆔 ${chat.id}\n\n`;
    try {
      const ndb = JSON.parse(fs.readFileSync(path.join(__dirname, 'news-db.json'), 'utf8'));
      text += `📰 أخبار منشورة: ${Object.keys(ndb).length}\n`;
    } catch {}
    try {
      const cdb = JSON.parse(fs.readFileSync(path.join(__dirname, 'cve-db.json'), 'utf8'));
      text += `🛡️ CVEs منشورة: ${Object.keys(cdb).length}\n`;
    } catch {}
    const s = db.getDashboardStats();
    text += `🔑 تراخيص نشطة: ${s.activeLicenses}/${s.licenses}\n`;
    text += `👥 مستخدمين: ${s.users}\n\n`;
    text += `🟢 الأخبار: ${newsAggregator.isRunning() ? 'شغال' : 'متوقف'}\n`;
    text += `🔴 CVEs: ${cveBot.isRunning() ? 'شغال' : 'متوقف'}\n`;
    text += `📢 الإعلانات: ${announceBot.isRunning() ? 'شغال' : 'متوقف'}`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ فشل جلب الإحصائيات');
  }
});

// /tools
bot.onText(/\/tools(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const sub = (match[1] || '').trim().toLowerCase();

  if (sub === 'news on' || sub === 'news off') {
    const on = sub.includes('on');
    on ? newsAggregator.start(bot) : newsAggregator.stop();
    return bot.sendMessage(msg.chat.id, on ? '✅ الأخبار شغالة' : '🛑 الأخبار متوقفة');
  }
  if (sub === 'cve on' || sub === 'cve off') {
    const on = sub.includes('on');
    on ? cveBot.start(bot) : cveBot.stop();
    return bot.sendMessage(msg.chat.id, on ? '✅ CVE شغالة' : '🛑 CVE متوقفة');
  }
  if (sub === 'announce on' || sub === 'announce off') {
    const on = sub.includes('on');
    on ? announceBot.start(bot) : announceBot.stop();
    return bot.sendMessage(msg.chat.id, on ? '✅ الإعلانات شغالة' : '🛑 الإعلانات متوقفة');
  }

  if (sub === 'all on') {
    newsAggregator.start(bot); cveBot.start(bot); announceBot.start(bot);
    return bot.sendMessage(msg.chat.id, '✅ كل الأدوات شغالة');
  }
  if (sub === 'all off') {
    newsAggregator.stop(); cveBot.stop(); announceBot.stop();
    return bot.sendMessage(msg.chat.id, '🛑 كل الأدوات متوقفة');
  }

  let text = '🛠️ *التحكم في أدوات القناة:*\n\n';
  text += `📰 الأخبار: ${newsAggregator.isRunning() ? '🟢' : '🔴'}\n`;
  text += `🛡️ CVEs: ${cveBot.isRunning() ? '🟢' : '🔴'}\n`;
  text += `📢 الإعلانات: ${announceBot.isRunning() ? '🟢' : '🔴'}\n\n`;
  text += 'الأوامر:\n';
  text += '`/tools news on/off`\n';
  text += '`/tools cve on/off`\n';
  text += '`/tools announce on/off`\n';
  text += '`/tools all on/off`\n';
  text += '`/channel_stats` — الإحصائيات';
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// /send_email
const emailService = require('./email-service.js');

bot.onText(/\/send_email/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  
  const test = await emailService.testConnection();
  if (!test.success) {
    return bot.sendMessage(msg.chat.id,
      '❌ SMTP مش مظبوط.\n\n' +
      'عشان تضبطه:\n' +
      '1. اعمل إيميل Gmail جديد (مثلاً zelzal.security@gmail.com)\n' +
      '2. فعّل التحقق بخطوتين: https://myaccount.google.com/security\n' +
      '3. اعمل App Password: https://myaccount.google.com/apppasswords\n' +
      '4. حط البيانات في config.json:\n' +
      '   "smtp": { "user": "zelzal.security@gmail.com", "pass": "كلمة_التطبيق" }\n' +
      '5. أرسل /send_email تاني',
      { parse_mode: 'Markdown' }
    );
  }
  bot.sendMessage(msg.chat.id,
    '📧 *إرسال إيميل التفعيل*\n\nأرسل الأمر بالشكل ده:\n' +
    '`/send_email user@example.com cs KEY123 اسم_العميل`\n\n' +
    'المنتجات: `cs`, `ng`, `fv`, `wi`, `ug`, `both`',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/send_email\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const [, toEmail, product, licenseKey, customerName] = match;
  const validProducts = ['cs', 'ng', 'fv', 'wi', 'ug', 'both'];
  if (!validProducts.includes(product)) {
    return bot.sendMessage(msg.chat.id, '❌ منتج غير صحيح. استخدم: cs, ng, fv, wi, ug, both');
  }
  
  bot.sendMessage(msg.chat.id, `📧 جاري إرسال الإيميل إلى ${toEmail}...`);
  const result = await emailService.sendLicenseEmail(toEmail, product, licenseKey, (customerName || '').trim());
  if (result.success) {
    bot.sendMessage(msg.chat.id, `✅ تم إرسال الإيميل بنجاح!\n📬 ${toEmail}\n🆔 ${result.messageId}`);
  } else {
    bot.sendMessage(msg.chat.id, `❌ فشل الإرسال: ${result.error}`);
  }
});

// /news
bot.onText(/\/news(?:\s+(.+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const sub = (match[1] || '').trim().toLowerCase();
  
  if (sub === 'now' || sub === 'الآن') {
    bot.sendMessage(msg.chat.id, '📰 جاري جلب الأخبار...');
    const count = await newsAggregator.runCycle(bot);
    bot.sendMessage(msg.chat.id, count > 0 ? `✅ تم نشر ${count} خبر في القناة` : '✅ لا توجد أخبار جديدة');
    return;
  }
  
  if (sub === 'off' || sub === 'إيقاف') {
    newsAggregator.stop();
    bot.sendMessage(msg.chat.id, '🛑 تم إيقاف النشر التلقائي للأخبار');
    return;
  }
  
  if (sub === 'on' || sub === 'تشغيل') {
    newsAggregator.start(bot);
    bot.sendMessage(msg.chat.id, '✅ تم تشغيل النشر التلقائي (كل 3 ساعات)');
    return;
  }
  
  if (sub === 'status' || sub === 'حالة') {
    const running = newsAggregator.isRunning();
    bot.sendMessage(msg.chat.id, running ? '🟢 النشر التلقائي شغال' : '🔴 النشر التلقائي متوقف');
    return;
  }
  
  bot.sendMessage(msg.chat.id,
    '📰 *التحكم في أخبار الأمن السيبراني:*\n\n' +
    '/news — تعليمات\n' +
    '/news now — نشر أخبار الآن\n' +
    '/news on — تشغيل النشر التلقائي (كل 3 ساعات)\n' +
    '/news off — إيقاف النشر التلقائي\n' +
    '/news status — حالة النشر',
    { parse_mode: 'Markdown' }
  );
});

// ═══════════════════════════════════════════════
//           SUBSCRIPTION MANAGEMENT COMMANDS
// ═══════════════════════════════════════════════

const subManager = require('./subscription-manager.js');

bot.onText(/\/mysubs/, (msg) => {
  db.trackUser(msg);
  const subs = db.getSubscriptionsByUser(msg.from.id);
  if (subs.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ لا توجد اشتراكات نشطة.\nلشراء منتج: /products');
  }
  let text = `📋 *اشتراكاتي (${subs.length}):*\n\n`;
  subs.forEach((s, i) => {
    const p = products.find(x => x.id === s.product_id);
    text += `${i + 1}. ${p ? p.name : s.product_id}\n`;
    text += `   📆 ${s.plan_type}\n`;
    text += `   📊 ${s.status === 'active' ? '✅ نشط' : s.status === 'expired' ? '⏳ منتهي' : '⛔ ملغي'}\n`;
    text += `   📅 من: ${(s.current_period_start || '').split('T')[0]}\n`;
    text += `   📅 إلى: ${(s.current_period_end || '').split('T')[0]}\n`;
    text += `   🔄 التجديد التلقائي: ${s.auto_renew ? '✅ مفعل' : '❌ معطل'}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscriptions(?:\s+(\d+))?/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const tgFilter = match[1] ? parseInt(match[1]) : null;
  const subs = tgFilter ? db.getSubscriptionsByUser(tgFilter) : db.get().prepare('SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 20').all();

  if (subs.length === 0) {
    return bot.sendMessage(msg.chat.id, tgFilter ? `❌ لا توجد اشتراكات للمستخدم ${tgFilter}` : '❌ لا توجد اشتراكات.');
  }

  let text = `📋 *الاشتراكات (${subs.length}):*\n\n`;
  subs.slice(0, 15).forEach((s, i) => {
    const user = db.getUser(s.user_id);
    text += `${i + 1}. #${s.id} | ${s.product_id}\n`;
    text += `   👤 ${user ? user.first_name || '' : s.user_id} (${s.user_id})\n`;
    text += `   📆 ${s.plan_type} | ${s.status === 'active' ? '✅' : s.status === 'expired' ? '⏳' : '⛔'}\n`;
    text += `   📅 ${(s.current_period_end || '').split('T')[0]}\n`;
    text += `   🔄 ${s.auto_renew ? 'تلقائي' : 'يدوي'}\n\n`;
  });
  text += `📌 استخدم:\n/renew <id> — تجديد\n/autorenew <id> on/off — تفعيل/تعطيل التجديد التلقائي`;
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

bot.onText(/\/renew\s+(\d+)/, async (msg, match) => {
  db.trackUser(msg);
  const subId = parseInt(match[1]);
  const sub = db.getSubscription(subId);

  if (!sub) return bot.sendMessage(msg.chat.id, '❌ الاشتراك غير موجود.');
  if (sub.user_id !== msg.from.id && !isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '❌ هذا الاشتراك ليس لك.');
  }

  bot.sendMessage(msg.chat.id, `⏳ جاري تجديد الاشتراك #${subId}...`);

  const result = await subManager.processRenewal(subId);
  if (result.success) {
    bot.sendMessage(msg.chat.id,
      `✅ *تم التجديد بنجاح!*\n\n` +
      `📅 جديد حتى: ${result.newEnd.toISOString().split('T')[0]}\n` +
      `💰 قيمة التجديد: راجع /pricing`,
      { parse_mode: 'Markdown' }
    );
    if (isAdmin(msg.from.id)) {
      bot.sendMessage(msg.chat.id, `💡 اكتب /subscriptions لعرض كل الاشتراكات`);
    }
  } else {
    bot.sendMessage(msg.chat.id, `❌ فشل التجديد: ${result.error}`);
  }
});

bot.onText(/\/autorenew\s+(\d+)\s+(on|off)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const subId = parseInt(match[1]);
  const toggle = match[2] === 'on' ? 1 : 0;
  const sub = db.getSubscription(subId);

  if (!sub) return bot.sendMessage(msg.chat.id, '❌ الاشتراك غير موجود.');

  db.get().prepare('UPDATE subscriptions SET auto_renew = ?, updated_at = ? WHERE id = ?')
    .run(toggle, new Date().toISOString(), subId);

  bot.sendMessage(msg.chat.id,
    `✅ تم ${toggle ? 'تفعيل' : 'تعطيل'} التجديد التلقائي للاشتراك #${subId}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/sub_stats/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const s = subManager.getStats();
  let text = `📊 *إحصائيات الاشتراكات:*\n\n`;
  text += `📋 الإجمالي: ${s.total}\n`;
  text += `✅ النشط: ${s.active}\n`;
  text += `⏳ المنتهي: ${s.expired}\n`;
  text += `⛔ الملغي: ${s.cancelled}\n`;
  text += `🔄 التجديد التلقائي: ${s.autoRenew}\n`;
  text += `⚠️ ينتهي قريباً (7 أيام): ${s.expiring7}\n`;
  text += `━━━━━━━━━━━━━━\n`;
  text += `📆 شهري: ${s.monthlyRev}\n`;
  text += `📆 سنوي: ${s.yearlyRev}`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/payment\s+(\S+)\s+(\d+)?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const ref = match[1];
  const amount = match[2] ? parseInt(match[2]) : null;

  db.updatePaymentStatus(ref, 'completed', new Date().toISOString());
  bot.sendMessage(msg.chat.id, `✅ تم تأكيد الدفع: \`${ref}\`${amount ? ` (${amount} ج)` : ''}`,
    { parse_mode: 'Markdown' }
  );

  const payment = db.getPayment(ref);
  if (payment && payment.subscription_id) {
    const result = await subManager.processRenewal(payment.subscription_id);
    if (result.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *تم تجديد الاشتراك #${payment.subscription_id} تلقائياً!*`,
        { parse_mode: 'Markdown' }
      );
    }
  }
});

// ══════════════════════════════════════════════
// AFFILIATE SYSTEM
// ══════════════════════════════════════════════

bot.onText(/\/affiliate/, (msg) => {
  db.trackUser(msg);
  const userId = msg.from.id;
  const aff = db.getAffiliate(userId);
  if (aff) {
    const referralLink = `https://t.me/${config.bot_username || CHANNEL_USERNAME}?start=ref_${aff.code}`;
    const commissions = db.getCommissions(aff.id, 'pending').reduce((s, c) => s + c.amount, 0);
    let text = `🤝 *كودك الأفلييت:* \`${aff.code}\`\n\n`;
    text += `🔗 رابط الإحالة: ${referralLink}\n\n`;
    text += `📊 إحصائياتك:\n`;
    text += `• عدد المُحَالين: ${aff.referral_count}\n`;
    text += `• إجمالي الأرباح: ${aff.total_earned} ج\n`;
    text += `• تم الصرف: ${aff.total_paid} ج\n`;
    text += `• معلق: ${commissions} ج\n\n`;
    text += `💰 كل ما أحد يستخدم رابطك ويشتري، تكسب ${config.affiliate?.commission_percent || 10}% من قيمة الشراء!\n`;
    return bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  }
  // Generate new affiliate code
  const code = msg.from.username || 'user' + userId.toString().slice(-6);
  try {
    db.createAffiliate(userId, code.toUpperCase());
    const aff = db.getAffiliate(userId);
    const referralLink = `https://t.me/${config.bot_username || CHANNEL_USERNAME}?start=ref_${aff.code}`;
    bot.sendMessage(msg.chat.id,
      `✅ *تهانينا! كودك الأفلييت جاهز* 🎉\n\n` +
      `🔗 رابط الإحالة: ${referralLink}\n\n` +
      `\`${aff.code}\`\n\n` +
      `انشر الرابط في قناتك أو جروبك واكسب ${config.affiliate?.commission_percent || 10}% عمولة على كل عملية شراء!\n` +
      `🚀 أول عملية إحالة تكسبك ${config.affiliate?.referral_bonus || 20} ج مكافأة!`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ حصل خطأ، جرب بكود مختلف أو تواصل مع الدعم.', { parse_mode: 'Markdown' });
  }
});

// Handle referral in /start
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  db.trackUser(msg);
  const name = msg.from.first_name || 'صديقي';
  const isAdmin = config.admin_ids.includes(msg.from.id);

  // Check for referral code
  const param = match && match[1] ? match[1].trim() : '';
  if (param.startsWith('ref_')) {
    const code = param.replace('ref_', '').toUpperCase();
    const aff = db.getAffiliateByCode(code);
    if (aff && aff.user_id !== msg.from.id) {
      // Credit referral bonus to affiliate
      const existingCommissions = db.getCommissions(aff.id);
      const alreadyReferred = existingCommissions.some(c => c.referred_user_id === msg.from.id);
      if (!alreadyReferred) {
        db.addCommission(aff.id, msg.from.id, config.affiliate?.referral_bonus || 20);
        // Notify affiliate
        for (const adminId of config.admin_ids) {
          bot.sendMessage(adminId,
            `🎉 *إحالة جديدة!*\n\n@${msg.from.username || msg.from.first_name} (ID: ${msg.from.id})\nدخل عن طريق كود ${code}\nالمسوق: ${aff.user_id}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      }
    } else if (aff && aff.user_id === msg.from.id) {
      bot.sendMessage(msg.chat.id, '⚠️ لا يمكنك استخدام كودك الخاص!', { parse_mode: 'Markdown' }).catch(() => {});
    }
  }

  let text = `⚡ *مرحباً بك ${name} في ZELZAL SECURITY!* ⚡\n\n` + 'أنا البوت الرسمي لمنتجات الأمن السيبراني. استخدم الأزرار تحت عشان تتصفح 👇';
  if (isAdmin) text += '\n\n👑 أنت آدمن — الأزرار الإضافية ظهرتلك تحت';
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', ...mainKeyboard(isAdmin) });
});

// ══════════════════════════════════════════════
// SUPPORT TICKETS
// ══════════════════════════════════════════════

bot.onText(/\/ticket(?:\s+(.+))?/, async (msg, match) => {
  db.trackUser(msg);
  if (!match || !match[1]) {
    return bot.sendMessage(msg.chat.id,
      '🎫 *إنشاء تذكرة دعم فني*\n\nأرسل:\n`/Ticket عنوان المشكلة - وصف المشكلة`\n\nمثال:\n`/ticket مشكلة في التفعيل - مش عارف أفعل الترخيص`',
      { parse_mode: 'Markdown' }
    );
  }
  const parts = match[1].split('-');
  const subject = parts[0].trim();
  const message = parts.slice(1).join('-').trim() || 'بدون وصف';
  if (!subject) return bot.sendMessage(msg.chat.id, '❌ لازم تكتب عنوان للمشكلة.', { parse_mode: 'Markdown' });
  try {
    const ticket = db.createTicket(msg.from.id, subject, message);
    bot.sendMessage(msg.chat.id,
      `✅ *تم إنشاء التذكرة #${ticket.id}* 🎫\n\n` +
      `الموضوع: ${subject}\n` +
      `الحالة: 🟢 مفتوحة\n\n` +
      `هنتواصل معاك في أقرب وقت. استخدم:\n/ticket ${ticket.id} لمشاهدة التذكرة\n/mytickets لكل تذاكرك`,
      { parse_mode: 'Markdown' }
    );
    // Notify admins
    for (const adminId of config.admin_ids) {
      bot.sendMessage(adminId,
        `🎫 *تذكرة جديدة #${ticket.id}*\n\n` +
        `من: ${msg.from.first_name} (@${msg.from.username || 'N/A'})\n` +
        `الموضوع: ${subject}\n\n` +
        `/ticket ${ticket.id}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ حصل خطأ في إنشاء التذكرة. حاول تاني.', { parse_mode: 'Markdown' });
  }
});

bot.onText(/\/ticket\s+(\d+)/, async (msg, match) => {
  db.trackUser(msg);
  const ticketId = parseInt(match[1]);
  const ticket = db.getTicket(ticketId);
  if (!ticket) return bot.sendMessage(msg.chat.id, '❌ التذكرة مش موجودة.', { parse_mode: 'Markdown' });
  const isAdmin = config.admin_ids.includes(msg.from.id);
  if (ticket.user_id !== msg.from.id && !isAdmin) return bot.sendMessage(msg.chat.id, '❌ مش مسموح لك.', { parse_mode: 'Markdown' });
  const messages = db.getTicketMessages(ticketId);
  const statusIcon = ticket.status === 'open' ? '🟢' : ticket.status === 'pending' ? '🟡' : '🔴';
  let text = `🎫 *التذكرة #${ticketId}*\n\n`;
  text += `الموضوع: ${ticket.subject}\n`;
  text += `الحالة: ${statusIcon} ${ticket.status}\n`;
  text += `تاريخ: ${ticket.created_at.split('T')[0]}\n\n`;
  text += `*الرسائل:*\n`;
  messages.forEach((m, i) => {
    const sender = m.is_admin ? '🛡️ الدعم' : '👤 أنت';
    text += `\n${i + 1}. ${sender} (${m.created_at.split('T')[1].substring(0, 5)}):\n${m.message.substring(0, 200)}`;
  });
  if (ticket.status !== 'closed') {
    text += `\n\n📝 للرد أرسل:\n/ticket_msg ${ticketId} رسالتك`;
    if (isAdmin) text += `\n🔒 /ticket_close ${ticketId} — إغلاق`;
  }
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

bot.onText(/\/ticket_msg\s+(\d+)\s+(.+)/, async (msg, match) => {
  db.trackUser(msg);
  const ticketId = parseInt(match[1]);
  const message = match[2].trim();
  const ticket = db.getTicket(ticketId);
  if (!ticket) return bot.sendMessage(msg.chat.id, '❌ التذكرة مش موجودة.', { parse_mode: 'Markdown' });
  const isAdmin = config.admin_ids.includes(msg.from.id);
  if (ticket.user_id !== msg.from.id && !isAdmin) return bot.sendMessage(msg.chat.id, '❌ مش مسموح لك.', { parse_mode: 'Markdown' });
  if (ticket.status === 'closed') return bot.sendMessage(msg.chat.id, '❌ التذكرة مقفولة.', { parse_mode: 'Markdown' });
  db.addTicketMessage(ticketId, msg.from.id, message, isAdmin);
  bot.sendMessage(msg.chat.id, `✅ تم إرسال ردك في التذكرة #${ticketId}`, { parse_mode: 'Markdown' });
  // Notify other party
  if (isAdmin) {
    try { bot.sendMessage(ticket.user_id, `📩 *رد جديد على تذكرتك #${ticketId}*\n\n${message}\n\n/ticket ${ticketId}`, { parse_mode: 'Markdown' }); } catch {}
  } else {
    for (const adminId of config.admin_ids) {
      bot.sendMessage(adminId, `📩 *رد جديد على التذكرة #${ticketId}*\nمن: ${msg.from.first_name}\n\n${message}\n\n/ticket ${ticketId}`, { parse_mode: 'Markdown' }).catch(() => {});
    }
  }
});

bot.onText(/\/mytickets/, (msg) => {
  db.trackUser(msg);
  const tickets = db.getTicketsByUser(msg.from.id);
  if (tickets.length === 0) return bot.sendMessage(msg.chat.id, '🎫 معندكش أي تذاكر.', { parse_mode: 'Markdown' });
  let text = `🎫 *تذاكرك (${tickets.length}):*\n\n`;
  tickets.slice(0, 10).forEach(t => {
    const icon = t.status === 'open' ? '🟢' : t.status === 'pending' ? '🟡' : '🔴';
    text += `${icon} #${t.id} ${t.subject.substring(0, 40)}\n`;
    text += `   ${t.created_at.split('T')[0]} | /ticket ${t.id}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/tickets(?:\s+(.+))?/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  db.trackUser(msg);
  const status = match && match[1] ? match[1].trim() : null;
  const tickets = db.getAllTickets(status);
  if (tickets.length === 0) return bot.sendMessage(msg.chat.id, '🎫 مفيش تذاكر.', { parse_mode: 'Markdown' });
  let text = `🎫 *كل التذاكر (${tickets.length}):*\n\n`;
  tickets.slice(0, 20).forEach(t => {
    const icon = t.status === 'open' ? '🟢' : t.status === 'pending' ? '🟡' : '🔴';
    text += `${icon} #${t.id} ${t.subject.substring(0, 35)}\n`;
    text += `   👤 ${t.first_name || 'N/A'} @${t.username || 'N/A'} | ${t.created_at.split('T')[0]}\n`;
    text += `   /ticket ${t.id}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

bot.onText(/\/ticket_close\s+(\d+)/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const ticketId = parseInt(match[1]);
  const ticket = db.getTicket(ticketId);
  if (!ticket) return bot.sendMessage(msg.chat.id, '❌ التذكرة مش موجودة.', { parse_mode: 'Markdown' });
  db.updateTicketStatus(ticketId, 'closed');
  bot.sendMessage(msg.chat.id, `🔒 تم إغلاق التذكرة #${ticketId}`, { parse_mode: 'Markdown' });
  try { bot.sendMessage(ticket.user_id, `🔒 *تم إغلاق تذكرتك #${ticketId}*\n\nشكراً لتواصلك مع ZELZAL Security ❤️`, { parse_mode: 'Markdown' }); } catch {}
});

bot.onText(/\/ticket_reply\s+(\d+)\s+(.+)/, async (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const botMsg = msg;
  // Reuse ticket_msg handler logic
  const ticket = db.getTicket(parseInt(match[1]));
  if (!ticket) return bot.sendMessage(msg.chat.id, '❌ التذكرة مش موجودة.', { parse_mode: 'Markdown' });
  const message = match[2].trim();
  db.addTicketMessage(parseInt(match[1]), msg.from.id, message, true);
  bot.sendMessage(msg.chat.id, `✅ تم الرد على التذكرة #${match[1]}`, { parse_mode: 'Markdown' });
  try { bot.sendMessage(ticket.user_id, `📩 *رد من الدعم الفني على تذكرتك #${match[1]}*\n\n${message}\n\n/ticket ${match[1]}`, { parse_mode: 'Markdown' }); } catch {}
});

// ══════════════════════════════════════════════
// AFFILIATE ADMIN
// ══════════════════════════════════════════════

bot.onText(/\/affiliates/, (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const affs = db.getAllAffiliates();
  if (affs.length === 0) return bot.sendMessage(msg.chat.id, '🤝 مفيش مسوقين.', { parse_mode: 'Markdown' });
  let text = `🤝 *المسوقين (${affs.length}):*\n\n`;
  affs.slice(0, 20).forEach((a, i) => {
    const pending = db.getCommissions(a.id, 'pending').reduce((s, c) => s + c.amount, 0);
    text += `${i + 1}. \`${a.code}\` — ${a.first_name || 'N/A'} @${a.username || 'N/A'}\n`;
    text += `   💰 ${a.total_earned}ج | مصروف: ${a.total_paid}ج | معلق: ${pending}ج | أحالات: ${a.referral_count}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

bot.onText(/\/affiliate_stats/, (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const stats = db.getAffiliateStats();
  const allCommissions = db.getAllCommissions();
  const paidCommissions = allCommissions.filter(c => c.status === 'paid');
  const text = `🤝 *إحصائيات الأفلييت*\n\n` +
    `👥 عدد المسوقين: ${stats.total}\n` +
    `💰 إجمالي العمولات: ${stats.totalCommissions} ج\n` +
    `⏳ معلق: ${stats.pendingCommissions} ج\n` +
    `✅ مدفوع: ${stats.paidCommissions} ج\n` +
    `📊 عدد العمولات: ${allCommissions.length} (مدفوع: ${paidCommissions.length})`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/affiliate_pay\s+(\d+)/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const commissionId = parseInt(match[1]);
  const comm = db.getCommissions().find(c => c.id === commissionId);
  if (!comm) return bot.sendMessage(msg.chat.id, '❌ العمولة مش موجودة.', { parse_mode: 'Markdown' });
  if (comm.status === 'paid') return bot.sendMessage(msg.chat.id, '✅ العمولة مدفوعة مسبقاً.', { parse_mode: 'Markdown' });
  db.markCommissionPaid(commissionId);
  bot.sendMessage(msg.chat.id, `✅ تم تأكيد دفع العمولة #${commissionId} (${comm.amount} ج)`, { parse_mode: 'Markdown' });
});

// ══════════════════════════════════════════════
// ENHANCED DASHBOARD & REPORTS
// ══════════════════════════════════════════════

bot.onText(/\/reports(?:\s+(.+))?/, (msg, match) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  const period = match && match[1] ? match[1].trim() : 'month';
  const stats = db.getRevenueStats(period);
  const periodName = period === 'today' ? 'اليوم' : period === 'week' ? 'آخر 7 أيام' : period === 'month' ? 'آخر 30 يوم' : 'كل الفترات';
  let text = `📊 *تقرير المبيعات — ${periodName}*\n\n`;
  text += `💰 الإيرادات: ${stats.revenue} ج\n`;
  text += `📦 عدد المبيعات: ${stats.paymentCount}\n`;
  text += `👥 مستخدمين جدد: ${stats.newUsers}\n`;
  text += `🔑 تراخيص جديدة: ${stats.newLicenses}\n\n`;

  // Sales by product
  text += `📦 *المبيعات حسب المنتج:*\n`;
  const byProduct = db.getSalesByProduct();
  byProduct.slice(0, 8).forEach(p => {
    const prod = products.find(pr => pr.id === p.product);
    text += `• ${prod ? prod.name : p.product}: ${p.count}\n`;
  });

  // Monthly revenue
  text += `\n📆 *الإيرادات الشهرية:*\n`;
  const monthly = db.getMonthlyRevenue();
  monthly.slice(0, 6).forEach(m => {
    text += `• ${m.month}: ${m.revenue} ج (${m.count} عملية)\n`;
  });

  text += `\n💡 استخدم: /reports today | /reports week | /reports month`;
  bot.sendMessage(msg.chat.id, text.length > 4000 ? text.substring(0, 3900) + '...' : text, { parse_mode: 'Markdown' });
});

// Override /dashboard with enhanced version
bot.onText(/\/dashboard/, async (msg) => {
  if (!config.admin_ids.includes(msg.from.id)) return;
  db.trackUser(msg);
  const s = db.getDashboardStats();
  const revStats = db.getRevenueStats('month');
  const tickStats = db.getTicketStats();
  const affStats = db.getAffiliateStats();
  let text = `👑 *لوحة تحكم ZELZAL SECURITY*\n\n`;
  text += `┌─ 👥 *المستخدمين*\n`;
  text += `│ ${s.users} (نشط اليوم: ${s.activeUsers})\n\n`;
  text += `┌─ 🔑 *التراخيص*\n`;
  text += `│ الإجمالي: ${s.licenses} | نشط: ${s.activeLicenses}\n`;
  text += `│ شهري: ${s.monthly} | سنوي: ${s.yearly} | مدى الحياة: ${s.lifetime}\n`;
  text += `│ ملغي: ${s.revoked} | منتهي: ${s.expired}\n\n`;
  text += `┌─ 💰 *المبيعات (30 يوم)*\n`;
  text += `│ ${revStats.revenue} ج | ${revStats.paymentCount} عملية\n\n`;
  text += `┌─ 🎫 *الدعم الفني*\n`;
  text += `│ مفتوح: ${tickStats.open} | معلق: ${tickStats.pending} | مقفول: ${tickStats.closed}\n\n`;
  text += `┌─ 🤝 *الأفلييت*\n`;
  text += `│ المسوقين: ${affStats.total} | عمولات معلقة: ${affStats.pendingCommissions} ج\n\n`;
  text += `┌─ 🎟️ *الكوبونات*\n`;
  text += `│ ${db.getAllCoupons().length} كوبون\n\n`;
  text += `📌 /reports — تقرير مفصل\n`;
  text += `📌 /sub_stats — إحصائيات الاشتراكات\n`;
  text += `📌 /affiliate_stats — إحصائيات الأفلييت`;
  const dashKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👥 المستخدمين', callback_data: 'admn_users' }],
        [{ text: '🔑 التراخيص', callback_data: 'admn_licenses' }],
        [{ text: '🎟️ الكوبونات', callback_data: 'admn_coupons' }],
        [{ text: '📊 تقرير المبيعات', callback_data: 'admn_report' }],
        [{ text: '🎫 التذاكر', callback_data: 'admn_tickets' }],
        [{ text: '🤝 المسوقين', callback_data: 'admn_affiliates' }],
        [{ text: '📢 إذاعة', callback_data: 'admn_broadcast' }],
      ]
    }
  };
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', ...dashKeyboard });
});

// Start all channel tools on boot
newsAggregator.start(bot);
cveBot.start(bot);
announceBot.start(bot);
licenseNotifier.start();
subManager.start(bot);

console.log('ZELZAL Telegram Bot running: News + CVE + Announce + Remote Control + DB + License Notifier + Subscriptions + Affiliates + Tickets + Reports');
