const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const SITE_DIR = path.join(__dirname, '..', 'ZELZAL-ISO-Build');
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(SITE_DIR)) app.use(express.static(SITE_DIR));
if (fs.existsSync(PUBLIC_DIR)) {
  app.use('/app', express.static(PUBLIC_DIR));
  app.use(express.static(PUBLIC_DIR));
  // Serve index.html and buy.html at root
  if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
    app.get('/', (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }
  // Serve buy page at /buy
  if (fs.existsSync(path.join(PUBLIC_DIR, 'buy.html'))) {
    app.get('/buy', (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'buy.html'));
    });
  }
}

const CONFIG = require('./config');
const AUTH_TOKEN = crypto.createHash('sha256').update('ADMIN!ZELZAL_8980473162@2026_SECURE').digest('hex').substring(0, 16);
const PORT = process.env.PORT || 3456;
const PENDING_FILE = path.join(__dirname, 'pending-commands.json');
const RESULTS_FILE = path.join(__dirname, 'command-results.json');

function auth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, 'remote-server.log'), line + '\n'); } catch {}
}

// ==== Status ====
app.get('/api/status', auth, (req, res) => {
  const botRunning = fs.existsSync(path.join(__dirname, 'bot.pid'));
  const uptime = process.uptime();
  res.json({
    status: 'ok', uptime: Math.floor(uptime), server_pid: process.pid,
    bot_running: botRunning, node: process.version, platform: process.platform
  });
});

// ==== Execute Shell Command ====
app.post('/api/shell', auth, (req, res) => {
  const { command, timeout = 30000 } = req.body;
  if (!command) return res.status(400).json({ error: 'Command required' });
  log(`Shell: ${command}`);
  exec(command, { timeout, cwd: path.join(__dirname, '..', 'ZELZAL-ISO-Build') }, (err, stdout, stderr) => {
    res.json({
      exit_code: err ? err.code || 1 : 0,
      stdout: stdout?.substring(0, 5000) || '',
      stderr: stderr?.substring(0, 2000) || '',
      error: err ? err.message : null
    });
  });
});

// ==== Spawn (long running) ====
app.post('/api/spawn', auth, (req, res) => {
  const { command, args = [] } = req.body;
  if (!command) return res.status(400).json({ error: 'Command required' });
  log(`Spawn: ${command} ${args.join(' ')}`);
  const proc = spawn(command, args, {
    detached: true, stdio: 'ignore',
    cwd: path.join(__dirname, '..', 'ZELZAL-ISO-Build')
  });
  proc.unref();
  res.json({ spawned: true, pid: proc.pid });
});

// ==== Read file ====
app.post('/api/read-file', auth, (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'File path required' });
  const safePath = path.resolve(path.join(__dirname, '..', 'ZELZAL-ISO-Build'), file);
  if (!safePath.startsWith(path.resolve(__dirname, '..', 'ZELZAL-ISO-Build')))
    return res.status(403).json({ error: 'Path outside project' });
  try {
    const content = fs.readFileSync(safePath, 'utf8');
    res.json({ content, size: content.length });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ==== Write file ====
app.post('/api/write-file', auth, (req, res) => {
  const { file, content } = req.body;
  if (!file || content === undefined) return res.status(400).json({ error: 'File and content required' });
  const safePath = path.resolve(path.join(__dirname, '..', 'ZELZAL-ISO-Build'), file);
  if (!safePath.startsWith(path.resolve(__dirname, '..', 'ZELZAL-ISO-Build')))
    return res.status(403).json({ error: 'Path outside project' });
  try {
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, 'utf8');
    log(`Wrote file: ${file}`);
    res.json({ success: true, size: content.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== Git pull ====
app.post('/api/deploy', auth, async (req, res) => {
  log('Deploying...');
  const repoDir = 'F:\\zelzal prog-AI\\ZELZAL-ISO-Build';
  exec('git pull', { cwd: repoDir, timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.json({ error: err.message, stdout, stderr });
    res.json({ success: true, stdout: stdout.substring(0, 2000) });
  });
});

// ==== Restart bot ====
app.post('/api/restart-bot', auth, (req, res) => {
  log('Restarting bot...');
  res.json({ success: true, message: 'Bot restart initiated' });
  setTimeout(() => process.exit(0), 500);
});

// ==== AI Task Queue ====
app.post('/api/queue-task', auth, (req, res) => {
  const { task, type = 'ai' } = req.body;
  if (!task) return res.status(400).json({ error: 'Task description required' });
  let pending = [];
  try { pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch {}
  pending.push({
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    task, type, status: 'pending',
    created: new Date().toISOString()
  });
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
  log(`Task queued: ${task.substring(0, 100)}`);
  res.json({ success: true, queue_length: pending.length });
});

app.get('/api/pending-tasks', auth, (req, res) => {
  try {
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    res.json({ tasks: pending.filter(t => t.status === 'pending') });
  } catch { res.json({ tasks: [] }); }
});

app.get('/api/results', auth, (req, res) => {
  try {
    const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    res.json({ results });
  } catch { res.json({ results: [] }); }
});

app.post('/api/clear-results', auth, (req, res) => {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify([], null, 2));
  res.json({ success: true });
});

// ==== List directory ====
app.post('/api/ls', auth, (req, res) => {
  const { dir = '' } = req.body;
  const target = path.resolve(path.join(__dirname, '..', 'ZELZAL-ISO-Build'), dir);
  if (!target.startsWith(path.resolve(__dirname, '..', 'ZELZAL-ISO-Build')))
    return res.status(403).json({ error: 'Path outside project' });
  try {
    const items = fs.readdirSync(target, { withFileTypes: true });
    res.json({ files: items.map(i => ({ name: i.name, dir: i.isDirectory(), size: i.isFile() ? fs.statSync(path.join(target, i.name)).size : 0 })) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════
//            SUBSCRIPTION & PAYMENT WEBHOOK
// ═══════════════════════════════════════════════

const subManager = require('./subscription-manager.js');
const db = require('./database.js');
const WEBHOOK_SECRET = CONFIG.webhook?.secret || 'zelzal-webhook-secret';
const ALLOWED_IPS = CONFIG.webhook?.allowed_ips || ['127.0.0.1', '::1'];

function webhookAuth(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress;
  if (!ALLOWED_IPS.includes(ip) && !ALLOWED_IPS.includes('*')) {
    const provided = req.headers['x-webhook-secret'];
    if (provided !== WEBHOOK_SECRET) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
}

app.post('/api/webhook/payment', webhookAuth, async (req, res) => {
  try {
    const { payment_ref, amount, phone, status, notes } = req.body;

    if (!payment_ref) {
      return res.status(400).json({ error: 'payment_ref مطلوب' });
    }

    const existing = db.getPayment(payment_ref);
    if (existing) {
      return res.json({ success: true, message: 'تم استلام الدفع مسبقاً', payment: existing });
    }

    const paymentId = db.addPayment({
      subscription_id: req.body.subscription_id || null,
      user_id: req.body.user_id || null,
      product_id: req.body.product_id || 'unknown',
      amount: amount || 0,
      currency: 'EGP',
      payment_method: 'vodafone_cash',
      payment_ref: payment_ref,
      status: status || 'completed',
      phone: phone || '',
      notes: notes || 'Webhook payment',
      created_at: new Date().toISOString()
    });

    if (status === 'completed' || status === 'confirmed') {
      if (req.body.subscription_id) {
        const renewResult = await subManager.processRenewal(req.body.subscription_id);
        if (renewResult.success) {
          log(`Payment webhook: renewed sub #${req.body.subscription_id}`);
          return res.json({ success: true, payment_id: paymentId, renewed: true, new_end: renewResult.newEnd });
        }
      }
    }

    log(`Payment webhook: recorded payment ${payment_ref} (${amount})`);
    res.json({ success: true, payment_id: paymentId });
  } catch (err) {
    log(`Payment webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/webhook/payment/:ref', auth, (req, res) => {
  const payment = db.getPayment(req.params.ref);
  if (!payment) return res.status(404).json({ error: 'الدفع غير موجود' });
  res.json(payment);
});

app.post('/api/webhook/confirm-payment', auth, async (req, res) => {
  try {
    const { payment_ref, subscription_id } = req.body;
    if (!payment_ref) return res.status(400).json({ error: 'payment_ref مطلوب' });

    db.updatePaymentStatus(payment_ref, 'completed', new Date().toISOString());

    let result = null;
    if (subscription_id) {
      result = await subManager.processRenewal(subscription_id);
    }

    log(`Payment confirmed: ${payment_ref}`);
    res.json({ success: true, renewed: result?.success || false, details: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/subscriptions/stats', auth, (req, res) => {
  const stats = subManager.getStats();
  res.json(stats);
});

app.post('/api/subscriptions/renew/:id', auth, async (req, res) => {
  try {
    const result = await subManager.processRenewal(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
//              PUBLIC API (no auth)
// ═══════════════════════════════════════════════

// Rate limiter middleware for public endpoints
const rateLimitStore = {};
function rateLimitMiddleware(maxReqs = 20, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    if (!rateLimitStore[ip]) rateLimitStore[ip] = [];
    rateLimitStore[ip] = rateLimitStore[ip].filter(t => now - t < windowMs);
    if (rateLimitStore[ip].length >= maxReqs) {
      return res.status(429).json({ error: `طلبات كثيرة — حاول بعد ${Math.ceil(windowMs / 1000)} ثانية` });
    }
    rateLimitStore[ip].push(now);
    next();
  };
}

// Higher limit for authenticated endpoints
function authRateLimit(maxReqs = 60, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.headers['x-auth-token'] || req.ip || 'unknown';
    const now = Date.now();
    if (!rateLimitStore['auth_' + key]) rateLimitStore['auth_' + key] = [];
    rateLimitStore['auth_' + key] = rateLimitStore['auth_' + key].filter(t => now - t < windowMs);
    if (rateLimitStore['auth_' + key].length >= maxReqs) {
      return res.status(429).json({ error: 'طلبات كثيرة' });
    }
    rateLimitStore['auth_' + key].push(now);
    next();
  };
}

// ── Public Stats ──
app.get('/api/public-stats', rateLimitMiddleware(10, 60000), (req, res) => {
  try {
    const stats = db.getDashboardStats();
    const revenue = db.getRevenueStats('month');
    res.json({
      users: stats.users,
      activeUsers: stats.activeUsers,
      licenses: stats.licenses,
      activeLicenses: stats.activeLicenses,
      revenue: revenue.revenue,
      paymentCount: revenue.paymentCount
    });
  } catch (err) {
    res.json({ users: 0, activeUsers: 0, licenses: 0, activeLicenses: 0, revenue: 0, paymentCount: 0 });
  }
});

// ── Verify License ──
app.post('/api/verify-license', rateLimitMiddleware(20, 60000), (req, res) => {
  try {
    const { license_key } = req.body;
    if (!license_key) return res.json({ valid: false, reason: 'مفتاح الترخيص مطلوب' });
    const lic = db.getLicense(license_key.trim().toUpperCase());
    if (!lic) return res.json({ valid: false, reason: 'مفتاح الترخيص غير موجود' });
    const isExpired = lic.expires_at && new Date(lic.expires_at) < new Date();
    res.json({
      valid: lic.status === 'active' && !isExpired,
      status: isExpired ? 'expired' : lic.status,
      product: lic.product,
      plan_type: lic.plan_type,
      customer_name: lic.customer_name,
      phone: lic.phone,
      created_at: lic.created_at,
      expires_at: lic.expires_at,
      activated_at: lic.activated_at
    });
  } catch (err) {
    res.status(500).json({ valid: false, reason: 'خطأ في الخادم' });
  }
});

// ── Contact Form ──
function sendTelegramNotify(message) {
  try {
    const token = CONFIG.bot_token;
    const admins = CONFIG.admin_ids || [];
    const postData = JSON.stringify({ chat_id: admins[0], text: message, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org', port: 443, method: 'POST',
      path: `/bot${token}/sendMessage`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options);
    req.write(postData);
    req.end();
  } catch {}
}

app.post('/api/contact', rateLimitMiddleware(5, 60000), (req, res) => {
  try {
    const { name, phone, message, _honeypot } = req.body;
    if (_honeypot) return res.json({ success: true });
    if (!name || !message) return res.status(400).json({ error: 'الاسم والرسالة مطلوبان' });
    if (name.length > 100 || message.length > 2000) return res.status(400).json({ error: 'نص طويل جداً' });
    const contactId = db.saveContact({ name, phone, message });
    const notify = `📩 <b>رسالة جديدة من الموقع</b>\n👤 ${name}\n📞 ${phone || '—'}\n💬 ${message.substring(0, 500)}`;
    sendTelegramNotify(notify);
    log(`Contact from ${name} (${phone || 'no phone'})`);
    res.json({ success: true, id: contactId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
//              ADMIN API (with auth)
// ═══════════════════════════════════════════════

// ── Admin Dashboard Stats ──
app.get('/api/admin/stats', auth, authRateLimit(), (req, res) => {
  try {
    const stats = db.getDashboardStats();
    const revenue = db.getRevenueStats('month');
    const ticketStats = db.getTicketStats();
    const salesByProduct = db.getSalesByProduct();
    const monthlyRevenue = db.getMonthlyRevenue();
    const unreadContacts = db.getUnreadContactCount();
    res.json({
      users: stats.users,
      activeUsers: stats.activeUsers,
      licenses: stats.licenses,
      activeLicenses: stats.activeLicenses,
      revenue: revenue.revenue,
      paymentCount: revenue.paymentCount,
      openTickets: ticketStats.open,
      unreadContacts,
      salesByProduct,
      monthlyRevenue
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Tickets (with pagination + search) ──
app.get('/api/admin/tickets', auth, (req, res) => {
  try {
    const status = req.query.status || null;
    const offset = parseInt(req.query.offset) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const search = req.query.search || '';
    let tickets = db.getAllTickets(status);
    // Filter by search
    if (search) {
      const s = search.toLowerCase();
      tickets = tickets.filter(t =>
        (t.subject && t.subject.toLowerCase().includes(s)) ||
        (t.first_name && t.first_name.toLowerCase().includes(s)) ||
        (t.username && t.username.toLowerCase().includes(s))
      );
    }
    const total = tickets.length;
    const page = tickets.slice(offset, offset + limit);
    res.json({ tickets: page, total, offset, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Payments (with pagination + search) ──
app.get('/api/admin/payments', auth, (req, res) => {
  try {
    const dbc = db.get();
    const offset = parseInt(req.query.offset) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const search = req.query.search || '';
    let allPayments = dbc.prepare('SELECT * FROM payments ORDER BY created_at DESC').all();
    if (search) {
      const s = search.toLowerCase();
      allPayments = allPayments.filter(p =>
        (p.payment_ref && p.payment_ref.toLowerCase().includes(s)) ||
        (p.product_id && p.product_id.toLowerCase().includes(s)) ||
        (p.phone && p.phone.includes(s))
      );
    }
    const total = allPayments.length;
    const payments = allPayments.slice(offset, offset + limit);
    res.json({ payments, total, offset, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Affiliates ──
app.get('/api/admin/affiliates', auth, (req, res) => {
  try {
    const affiliates = db.getAllAffiliates();
    res.json({ affiliates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Contacts ──
app.get('/api/admin/contacts', auth, (req, res) => {
  try {
    const contacts = db.getContacts(50);
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Products ──
app.get('/api/admin/products', auth, authRateLimit(), (req, res) => {
  try {
    const prods = require('./products.json');
    res.json({ products: prods });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/products', auth, authRateLimit(), (req, res) => {
  try {
    const { id, name, desc, monthly, yearly, price, prefix, type } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id و name مطلوبان' });
    const prods = require('./products.json');
    const idx = prods.findIndex(p => p.id === id);
    const entry = { id, name, desc: desc || '', monthly, yearly, price, prefix: prefix || id.toUpperCase().replace(/-/g, '').substring(0, 10), type: type || 'main' };
    if (idx >= 0) prods[idx] = entry; else prods.push(entry);
    require('fs').writeFileSync(require('path').join(__dirname, 'products.json'), JSON.stringify(prods, null, 2));
    log(`Product ${idx >= 0 ? 'updated' : 'added'}: ${id}`);
    res.json({ success: true, product: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/products/:id', auth, authRateLimit(), (req, res) => {
  try {
    const id = req.params.id;
    const prods = require('./products.json');
    const idx = prods.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: 'المنتج غير موجود' });
    prods.splice(idx, 1);
    require('fs').writeFileSync(require('path').join(__dirname, 'products.json'), JSON.stringify(prods, null, 2));
    log(`Product deleted: ${id}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==== Telegram Webhook proxy ====
app.post('/webhook', (req, res) => {
  // When bot.js is in webhook mode, this forwards updates
  // If bot.js is in polling mode, this is a no-op
  const body = req.body;
  if (body && body.message) {
    log(`Webhook received: ${body.message.text ? body.message.text.substring(0, 50) : '(non-text)'}`);
  }
  res.sendStatus(200);
});

// ==== Health check (no auth) ====
app.get('/api/ping', (req, res) => res.json({ pong: true, time: Date.now() }));

// ═══════════════════════════════════════════════
//          ERROR MONITORING & NOTIFICATIONS
// ═══════════════════════════════════════════════

const ERROR_LOG_FILE = path.join(__dirname, 'error-monitor.log');
let errorCount = 0;
let lastNotifyTime = 0;

function logError(err) {
  errorCount++;
  const line = `[${new Date().toISOString()}] ${err.message || err}\n${err.stack || ''}`;
  try { fs.appendFileSync(ERROR_LOG_FILE, line + '\n'); } catch {}
  console.error('[MONITOR]', err.message || err);
}

function sendAdminAlert(msg) {
  try {
    const token = CONFIG.bot_token;
    if (!token) return;
    const admins = CONFIG.admin_ids || [];
    if (!admins.length) return;
    const postData = JSON.stringify({ chat_id: admins[0], text: msg, parse_mode: 'Markdown' });
    const req = https.request({
      hostname: 'api.telegram.org', port: 443, method: 'POST',
      path: `/bot${token}/sendMessage`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    });
    req.write(postData);
    req.end();
  } catch {}
}

process.on('uncaughtException', (err) => {
  logError(err);
  const now = Date.now();
  if (now - lastNotifyTime > 600000) { // max once per 10 min
    lastNotifyTime = now;
    sendAdminAlert(`🚨 *خطأ في السيرفر*\n\n\`${(err.message || '').substring(0, 200)}\``);
  }
});

process.on('unhandledRejection', (err) => {
  logError(err);
});

// Health monitoring endpoint
app.get('/api/health/errors', auth, (req, res) => {
  try {
    const logs = fs.existsSync(ERROR_LOG_FILE) ? fs.readFileSync(ERROR_LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-50) : [];
    res.json({ totalErrors: errorCount, recentLogs: logs });
  } catch (e) { res.json({ totalErrors: errorCount, recentLogs: [] }); }
});

app.post('/api/health/clear-errors', auth, (req, res) => {
  try { fs.unlinkSync(ERROR_LOG_FILE); } catch {}
  errorCount = 0;
  res.json({ success: true });
});

// Periodic health check (every 30 min)
setInterval(() => {
  try {
    const dbCheck = db.get().prepare('SELECT COUNT(*) as c FROM users').get();
    if (!dbCheck) throw new Error('DB not responding');
  } catch (err) {
    logError(new Error('Health check failed: ' + err.message));
    sendAdminAlert(`⚠️ *Health Check فشل*\n\n${err.message.substring(0, 200)}`);
  }
}, 1800000);

app.listen(PORT, '0.0.0.0', () => {
  log(`Remote control server running on port ${PORT}`);
  log(`Auth token: ${AUTH_TOKEN.substring(0, 8)}...`);
  // Init files
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, JSON.stringify([], null, 2));
  // Notify admin on startup
  sendAdminAlert(`✅ *السيرفر بدأ*\n🆔 PID: ${process.pid}\n⏰ ${new Date().toLocaleString('ar-EG')}`);
});
