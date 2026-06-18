const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const CONFIG = require('./config.json');

const URL_FILE = path.join(__dirname, 'tunnel-url.txt');
const PID_FILE = path.join(__dirname, 'tunnel.pid');
const LOG_FILE = path.join(__dirname, 'tunnel.log');

function log(m) {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sendTelegram(msg) {
  try {
    const token = CONFIG.bot_token;
    const adminId = (CONFIG.admin_ids || [])[0];
    if (!adminId) return;
    const data = JSON.stringify({ chat_id: adminId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org', port: 443, method: 'POST',
      path: `/bot${token}/sendMessage`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    });
    req.write(data);
    req.end();
  } catch {}
}

// Kill old SSH
try { process.kill(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch {}
try { require('child_process').execSync('taskkill /F /IM ssh.exe 2>nul', { stdio: 'ignore' }); } catch {}

log('Starting tunnel...');

const TUNNEL_HOST = 'serveo.net';
const ssh = spawn('ssh', [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ServerAliveInterval=30',
  '-R', '80:127.0.0.1:3456',
  TUNNEL_HOST
], { stdio: ['ignore', 'pipe', 'pipe'] });

fs.writeFileSync(PID_FILE, String(ssh.pid));
log(`SSH PID: ${ssh.pid}`);

let urlFound = false;

ssh.stdout.on('data', (data) => {
  const text = data.toString();
  log('OUT: ' + text.trim());
  if (!urlFound) {
    const match = text.match(/https:\/\/[^\s]+/);
    if (match) {
      urlFound = true;
      const url = match[0];
      fs.writeFileSync(URL_FILE, url);
      log(`Tunnel URL: ${url}`);
      const msg = `✅ <b>تم تفعيل التوصيل العام!</b>\n\n<b>الرابط:</b> ${url}\n\n<b>لوحة التحكم:</b> ${url}/app/admin.html\n<b>بوابة التحميل:</b> ${url}/app/portal.html\n<b>الموقع:</b> ${url}/\n\n🔐 <b>Token الدخول:</b> <code>4b39ae197e5da4b5</code>`;
      sendTelegram(msg);
    }
  }
});

ssh.stderr.on('data', (data) => {
  const text = data.toString();
  if (text.includes('https://')) {
    log('ERR: ' + text.trim());
    if (!urlFound) {
      const match = text.match(/https:\/\/[^\s]+/);
      if (match) {
        urlFound = true;
        const url = match[0];
        fs.writeFileSync(URL_FILE, url);
        log(`Tunnel URL: ${url}`);
        const msg = `✅ <b>تم تفعيل التوصيل العام!</b>\n\n<b>الرابط:</b> ${url}\n\n<b>لوحة التحكم:</b> ${url}/app/admin.html\n<b>بوابة التحميل:</b> ${url}/app/portal.html\n<b>الموقع:</b> ${url}/\n\n🔐 <b>Token الدخول:</b> <code>4b39ae197e5da4b5</code>`;
        sendTelegram(msg);
      }
    }
  } else if (text.includes('Warning') || text.includes('warning')) {
    // ignore warnings
  } else {
    log('ERR: ' + text.trim());
  }
});

ssh.on('exit', (code) => {
  log(`SSH exited with code ${code}`);
  if (urlFound) {
    log('URL was found - tunnel was working');
    sendTelegram('⚠️ <b>تم قطع التوصيل العام</b>\nتم قطع tunnel. أعد تشغيل tunnel.bat');
  }
  setTimeout(() => process.exit(0), 1000);
});

process.on('SIGINT', () => { ssh.kill(); process.exit(0); });
process.on('SIGTERM', () => { ssh.kill(); process.exit(0); });
