const fs = require('fs');
const path = require('path');
const config = require('./config');

const DB_FILE = path.join(__dirname, 'announce-db.json');

let postedAnnounces = {};
let botInstance = null;
let timer = null;

const ANNOUNCEMENTS = [
  {
    title: '🛡️ CYBER SHIELD v5.0.0',
    body: 'حماية متكاملة للجهاز:\n• جدار ناري ذكي\n• VPN مدمج\n• تشفير الملفات\n• حماية من الاختراق\n\n📦 متوفر الآن مع الدعم الفني الكامل.',
    tag: '#CYBER_SHIELD #منتجات_ZELZAL',
  },
  {
    title: '📡 NetGuard Monitor v1.2.0',
    body: 'راقب شبكتك بالكامل:\n• كشف الأجهزة المتصلة\n• مراقبة الباندويث\n• تنبيهات الاختراق\n• تقارير أسبوعية\n\n🏢 مناسب للشركات والمكاتب.',
    tag: '#NetGuard #منتجات_ZELZAL',
  },
  {
    title: '🔐 File Vault v1.0.0',
    body: 'تشفير الملفات الحساسة:\n• تشفير AES-256\n• حماية بكلمة مرور\n• مجلدات آمنة\n• تشغيل من USB\n\n📁 ملفاتك في أمان تام.',
    tag: '#FileVault #منتجات_ZELZAL',
  },
  {
    title: '📶 Wi-Fi Inspector v1.0.0',
    body: 'افحص شبكات الواي فاي:\n• كشف الشبكات المخفية\n• اختبار قوة الإشارة\n• فحص الاختراقات\n• تحليل القنوات\n\n📱 يدعم الكمبيوتر والموبايل.',
    tag: '#WiFiInspector #منتجات_ZELZAL',
  },
  {
    title: '🔌 USB Guardian v1.0.0',
    body: 'احمِ جهازك من USB:\n• فحص تلقائي للUSB\n• منع التشغيل التلقائي\n• كشف الفيروسات\n• نسخ احتياطي آمن\n\n💾 أول خط دفاع ضد هجمات USB.',
    tag: '#USBGuardian #منتجات_ZELZAL',
  },
  {
    title: '💡 نصيحة أمنية',
    body: '⚡ استخدم كلمات مرور قوية لكل حساب، وفعّل المصادقة الثنائية (2FA).\n\n🔑 ZELZAL Security يوصي بتغيير كلمات المرور كل 3 شهور.',
    tag: '#نصائح_أمنية',
  },
  {
    title: '💡 نصيحة أمنية',
    body: '🌐 تجنب استخدام شبكات Wi-Fi العامة بدون VPN.\n\n🛡️ اشتراك NetGuard Monitor يشمل VPN مدمج لحماية اتصالك أينما كنت.',
    tag: '#نصائح_أمنية',
  },
  {
    title: '💡 نصيحة أمنية',
    body: '📁 قم بتشفير الملفات الحساسة حتى لو الجهاز معاك.\n\n🔐 File Vault من ZELZAL يشفر ملفاتك بـ AES-256 — أعلى معيار تشفير عالمي.',
    tag: '#نصائح_أمنية',
  },
  {
    title: '🔥 عرض خاص',
    body: '💥 الباقة المزدوجة: CYBER SHIELD + NetGuard Monitor\nبخصم 30%!\n\n📅 شهري: 600 ج.م بدلاً من 850\n📆 سنوي: 5000 ج.م بدلاً من 7000\n\n⏳ العرض لفترة محدودة.',
    tag: '#عروض #ZELZAL',
  },
  {
    title: '🎯 لماذا ZELZAL؟',
    body: '✅ منتجات مصرية 100%\n✅ دعم فني عربي\n✅ تحديثات مستمرة\n✅ أسعار تنافسية\n✅ ضمان استعادة الأموال 7 أيام\n\nانضم لأكثر من 100 عميل يثقون في ZELZAL Security.',
    tag: '#ZELZAL #لماذا_نحن',
  },
];

function loadDb() {
  try { postedAnnounces = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { postedAnnounces = {}; }
}
function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(postedAnnounces, null, 2));
}

async function postOne(bot, idx) {
  if (idx >= ANNOUNCEMENTS.length) return false;
  const ann = ANNOUNCEMENTS[idx];
  const text = `${ann.title}\n━━━━━━━━━━━━━━━━━━\n${ann.body}\n\n${ann.tag}`;
  try {
    await bot.sendMessage(`@${config.channel.replace('@', '')}`, text, { parse_mode: 'Markdown' });
    return true;
  } catch {
    // Try without markdown
    try {
      await bot.sendMessage(`@${config.channel.replace('@', '')}`, text);
      return true;
    } catch {}
    return false;
  }
}

async function runCycle(bot) {
  loadDb();
  const today = new Date().toISOString().substring(0, 10);
  const todayKey = `day_${today}`;
  let idx = postedAnnounces[todayKey] || 0;
  if (idx >= ANNOUNCEMENTS.length) idx = 0; // Reset if all posted
  
  const ok = await postOne(bot, idx);
  if (ok) {
    postedAnnounces[todayKey] = idx + 1;
    saveDb();
    console.log(`[Announce] Posted #${idx + 1}`);
    return true;
  }
  return false;
}

async function postSpecific(bot, idx) {
  if (idx < 0 || idx >= ANNOUNCEMENTS.length) return false;
  return await postOne(bot, idx);
}

function start(bot) {
  botInstance = bot;
  loadDb();
  console.log('[Announce] Module started');
  // Post one announcement every 24 hours (at 6 PM)
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
  let msUntil = target.getTime() - now.getTime();
  if (msUntil < 0) msUntil += 86400000;
  setTimeout(() => {
    runCycle(bot);
    timer = setInterval(() => runCycle(bot), 86400000);
  }, msUntil);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  console.log('[Announce] Module stopped');
}

function isRunning() { return timer !== null; }

module.exports = { start, stop, isRunning, runCycle, postSpecific, list: ANNOUNCEMENTS };
