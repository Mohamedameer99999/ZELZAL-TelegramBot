const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
app.use(express.json({ limit: '1mb' }));

const CONFIG = require('./config.json');
const AUTH_TOKEN = crypto.createHash('sha256').update(CONFIG.bot_token + ':remote').digest('hex').substring(0, 16);
const PORT = 3456;
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

// ==== Health check (no auth) ====
app.get('/api/ping', (req, res) => res.json({ pong: true, time: Date.now() }));

app.listen(PORT, '127.0.0.1', () => {
  log(`Remote control server running on port ${PORT}`);
  log(`Auth token: ${AUTH_TOKEN.substring(0, 8)}...`);
  // Init files
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, JSON.stringify([], null, 2));
});
