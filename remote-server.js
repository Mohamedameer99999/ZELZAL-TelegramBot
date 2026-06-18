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
  // Serve index.html from public directory at root
  if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
    app.get('/', (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  } else {
    // Fallback to admin.html if index.html not found
    app.get('/', (req, res) => {
      res.redirect('/app/admin.html');
    });
  }
}

const CONFIG = require('./config');
const AUTH_TOKEN = crypto.createHash('sha256').update(CONFIG.bot_token + ':remote').digest('hex').substring(0, 16);
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

// In-memory rate limiter for public endpoints
const rateLimit = {};
function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => now - t < 60000);
  if (rateLimit[ip].length >= 20) return false;
  rateLimit[ip].push(now);
  return true;
}

// ── Public Stats ──
app.get('/api/public-stats', (req, res) => {
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
app.post('/api/verify-license', (req, res) => {
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

app.post('/api/contact', (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'طلبات كثيرة — حاول بعد دقيقة' });
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
app.get('/api/admin/stats', auth, (req, res) => {
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

// ── Admin Tickets ──
app.get('/api/admin/tickets', auth, (req, res) => {
  try {
    const status = req.query.status || null;
    const tickets = db.getAllTickets(status);
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Payments ──
app.get('/api/admin/payments', auth, (req, res) => {
  try {
    const dbc = db.get();
    const limit = parseInt(req.query.limit) || 50;
    const payments = dbc.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT ?').all(limit);
    res.json({ payments });
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

// ==== Health check (no auth) ====
app.get('/api/ping', (req, res) => res.json({ pong: true, time: Date.now() }));

app.listen(PORT, '0.0.0.0', () => {
  log(`Remote control server running on port ${PORT}`);
  log(`Auth token: ${AUTH_TOKEN.substring(0, 8)}...`);
  // Init files
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, JSON.stringify([], null, 2));
});
