const db = require('./database.js');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

db.init();

const BOT_DIR = __dirname;
const CONFIG = require('./config.json');

const HANDLERS = [
  {
    match: /^(عرض|أظهر|اقرأ|شوف|read|show|cat|display)\s+(محتوى|محتويات|ملف|content|file)?\s*(.+)/i,
    async run(task, match) {
      const target = (match[3] || match[2] || '').trim();
      const filePath = resolvePath(target);
      if (!filePath || !fs.existsSync(filePath)) return `❌ الملف غير موجود: ${target}`;
      if (fs.statSync(filePath).size > 100000) return '❌ الملف كبير جداً (أكثر من 100KB)';
      const content = fs.readFileSync(filePath, 'utf8');
      return `📄 محتوى ${target}:\n\`\`\`\n${content.substring(0, 3000)}\n\`\`\``;
    }
  },
  {
    match: /^(list|ls|اعرض|عرض)\s*(files?|ملفات?)?\s*(.+)?/i,
    async run(task, match) {
      const dir = match[3] ? resolvePath(match[3].trim()) : BOT_DIR;
      if (!dir || !fs.existsSync(dir)) return `❌ المجلد غير موجود: ${match[3]}`;
      const items = fs.readdirSync(dir, { withFileTypes: true });
      let text = `📂 ${dir}\n\n`;
      items.slice(0, 30).forEach(f => {
        const size = f.isFile() ? ` (${(fs.statSync(path.join(dir, f.name)).size / 1024).toFixed(1)}KB)` : '/';
        text += `${f.isDirectory() ? '📁' : '📄'} ${f.name}${size}\n`;
      });
      if (items.length > 30) text += `\n...و ${items.length - 30} آخرين`;
      return text;
    }
  },
  {
    match: /^(deploy|انشر|حدث|تحديث|نشر|git\s+pull)/i,
    async run() {
      try {
        const out = execSync('git pull', { cwd: BOT_DIR, timeout: 30000 }).toString();
        return `✅ تم التحديث:\n\`\`\`\n${out.substring(0, 1000)}\n\`\`\``;
      } catch (e) { return `❌ فشل: ${e.message.substring(0, 500)}`; }
    }
  },
  {
    match: /^(restart|اعادة تشغيل|إعادة تشغيل)\s+(bot|البوت)/i,
    async run() {
      require('http').get(`http://127.0.0.1:${CONFIG.remote_port || 3456}/api/restart-bot`);
      return '🔄 جاري إعادة تشغيل البوت...';
    }
  },
  {
    match: /^(status|حالة|حاله)/i,
    async run() {
      const s = db.getDashboardStats();
      const uptime = Math.floor(process.uptime() / 60);
      let text = `🖥 *حالة ZELZAL*\n\n`;
      text += `👥 المستخدمين: ${s.users}\n`;
      text += `🔑 التراخيص: ${s.licenses} (نشط: ${s.activeLicenses})\n`;
      text += `🎟️ الكوبونات: ${db.getAllCoupons().length}\n`;
      text += `⏱ شغال منذ: ${uptime} دقيقة\n`;
      text += `📦 الإصدار: ${process.version}`;
      return text;
    }
  },
  {
    match: /^(logs|سجلات|لوجات)/i,
    async run() {
      try {
        const logFile = path.join(BOT_DIR, 'remote-server.log');
        if (!fs.existsSync(logFile)) return '❌ ما فيش سجلات.';
        const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-20);
        return `📋 آخر 20 سطر:\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
      } catch { return '❌ فشل قراءة السجلات.'; }
    }
  },
  {
    match: /^(shell|cmd|تنفيذ|شغال|شغل)\s+(.+)/i,
    async run(task, match) {
      const cmd = match[2].trim();
      try {
        const out = execSync(cmd, { cwd: BOT_DIR, timeout: 15000, encoding: 'utf8' });
        return `💻 \`${cmd}\`\n\`\`\`\n${out.substring(0, 2000)}\n\`\`\``;
      } catch (e) {
        return `❌ ${e.message.substring(0, 500)}`;
      }
    }
  },
  {
    match: /^tools\s+(.+)/i,
    async run(task, match) {
      const sub = match[1].trim().toLowerCase();
      const commands = {
        'news on': 'start news',
        'news off': 'stop news',
        'cve on': 'start cve',
        'cve off': 'stop cve',
        'announce on': 'start announce',
        'announce off': 'stop announce',
        'all on': 'start all',
        'all off': 'stop all'
      };
      if (commands[sub]) return `⏳ تم استلام الأمر. استخدم /tools ${sub} في البوت للتنفيذ.`;
      return 'الأمر متاح: tools news on/off, tools cve on/off, tools announce on/off';
    }
  },
  {
    match: /^(news|اخبار).*(now|الآن)/i,
    async run() {
      return '⏳ لأجل الأخبار الآن، استخدم /news now في البوت.';
    }
  },
  {
    match: /^(search|دور|بحث|find|grep)\s+(.+)/i,
    async run(task, match) {
      const pattern = match[2].trim();
      try {
        const out = execSync(`rg -l "${pattern}" --max-depth 3`, { cwd: BOT_DIR, timeout: 10000, encoding: 'utf8' });
        if (!out.trim()) return '❌ ما لقيتش نتائج.';
        const files = out.trim().split('\n').slice(0, 15);
        return `🔍 نتائج لـ "${pattern}":\n${files.map(f => `• ${f}`).join('\n')}`;
      } catch { return `❌ ما لقيتش نتائج لـ "${pattern}"`; }
    }
  },
  {
    match: /^(generate|genkey|توليد)\s+(key|license|مفتاح)\s+(\S+)\s+(\S+)/i,
    async run(task, match) {
      return `⏳ استخدم الأمر في البوت:\n/genkey ${match[3]} ${match[4]}`;
    }
  },
  {
    match: /^(keys|تراخيص|licenses)/i,
    async run() {
      const s = db.getDashboardStats();
      const expiring = db.getExpiringLicenses(7);
      let text = `🔑 *التراخيص:*\n\n`;
      text += `الإجمالي: ${s.licenses}\n`;
      text += `نشط: ${s.activeLicenses}\n`;
      text += `منتهي/ملغي: ${s.revoked + s.expired}\n`;
      if (expiring.length > 0) {
        text += `\n⚠️ ${expiring.length} ترخيص ينتهي خلال 7 أيام`;
      }
      text += `\n\n📌 استخدم /keys للتفاصيل`;
      return text;
    }
  },
  {
    match: /^(stats|إحصائيات|احصائيات)/i,
    async run() {
      const s = db.getDashboardStats();
      return `📊 *الإحصائيات:*\n\n` +
        `👥 المستخدمين: ${s.users} (اليوم: ${s.activeUsers})\n` +
        `🔑 التراخيص: ${s.licenses} (نشط: ${s.activeLicenses})\n` +
        `📆 شهري: ${s.monthly} | سنوي: ${s.yearly} | مدى الحياة: ${s.lifetime}\n` +
        `⛔ ملغي: ${s.revoked} | منتهي: ${s.expired}`;
    }
  },
  {
    match: /^(disk|مساحة|space|storage)/i,
    async run() {
      try {
        const df = execSync('wmic logicaldisk get size,freespace,caption', { timeout: 5000, encoding: 'utf8' });
        return `💾 المساحة:\n\`\`\`\n${df.substring(0, 1000)}\n\`\`\``;
      } catch {
        try {
          const df = execSync('powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free | ConvertTo-Json"', { timeout: 5000, encoding: 'utf8' });
          return `💾 المساحة:\n\`\`\`\n${df.substring(0, 1000)}\n\`\`\``;
        } catch { return '❌ فشل.'; }
      }
    }
  },
  {
    match: /^(help|مساعدة|اوامر|commands)/i,
    async run() {
      return `🤖 *الأوامر التلقائية:*
      
• status — حالة النظام
• logs — آخر السجلات
• ls [مجلد] — عرض الملفات
• disk — مساحة التخزين
• shell <أمر> — تنفيذ أمر
• search <كلمة> — بحث في الملفات
• read <ملف> — عرض محتوى ملف
• deploy — تحديث الموقع
• restart bot — إعادة تشغيل البوت

*للأوامر المعقدة:* افتح CLI وقلي عاوز إيه`;
    }
  }
];

function resolvePath(p) {
  if (!p) return null;
  const candidates = [
    p, path.join(BOT_DIR, p),
    path.join(BOT_DIR, p.replace(/^[/\\]+/, ''))
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function autoExecute(taskText) {
  for (const h of HANDLERS) {
    const match = taskText.match(h.match);
    if (match) {
      try {
        return await h.run(taskText, match);
      } catch (e) {
        return `❌ خطأ: ${e.message.substring(0, 500)}`;
      }
    }
  }
  return null;
}

async function poll() {
  const pending = db.getPendingCommands();
  for (const cmd of pending) {
    console.log(`[AutoExec] Processing: ${cmd.id} — ${cmd.task.substring(0, 80)}`);
    const result = await autoExecute(cmd.task);
    if (result) {
      db.markCommandDone(cmd.id, result);
      console.log(`[AutoExec] ✅ Done: ${cmd.id}`);
    } else {
      db.markCommandDone(cmd.id, `❌ هذا الأمر يحتاج مساعد AI. افتح CLI وقلي المطلوب.\n\nالأمر: ${cmd.task}`);
      console.log(`[AutoExec] ⏳ Deferred to AI: ${cmd.id}`);
    }
  }
}

function start(intervalMs = 10000) {
  console.log(`[AutoExec] Started (polling every ${intervalMs / 1000}s)`);
  poll();
  setInterval(poll, intervalMs);
}

if (require.main === module) {
  console.log('🤖 ZELZAL Auto-Executor starting...');
  start();
}

module.exports = { start, autoExecute };
