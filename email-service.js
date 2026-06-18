const nodemailer = require('nodemailer');
const CONFIG = require('./config.json');

let transporter = null;

function init() {
  const s = CONFIG.smtp;
  if (!s || !s.user || !s.pass) {
    console.log('[Email] SMTP not configured');
    return false;
  }
  try {
    transporter = nodemailer.createTransport({
      host: s.host || 'smtp.gmail.com',
      port: s.port || 587,
      secure: false,
      auth: { user: s.user, pass: s.pass },
    });
    console.log('[Email] SMTP configured');
    return true;
  } catch (e) {
    console.log('[Email] Config error:', e.message);
    return false;
  }
}

function buildHtml(product, licenseKey, customerName) {
  const products = {
    cs: { name: '🛡️ CYBER SHIELD v5.0.0', icon: '🛡️' },
    ng: { name: '📡 NetGuard Monitor v1.2.0', icon: '📡' },
    fv: { name: '🔐 File Vault v1.0.0', icon: '🔐' },
    wi: { name: '📶 Wi-Fi Inspector v1.0.0', icon: '📶' },
    ug: { name: '🔌 USB Guardian v1.0.0', icon: '🔌' },
    both: { name: '🔥 الباقة المزدوجة (CYBER SHIELD + NetGuard)', icon: '🔥' },
  };
  const p = products[product] || products.cs;
  const site = CONFIG.website || 'https://mohamedameer99999.github.io/zelzal-security/';
  const wa = CONFIG.whatsapp || 'https://wa.me/201034085168';

  return `<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="utf-8"><style>
body{background:#0a0a15;color:#e0e0e0;font-family:'Segoe UI',sans-serif;margin:0;padding:0}
.container{max-width:600px;margin:30px auto;background:#12122a;border-radius:16px;padding:40px;border:1px solid #00f5a020}
.header{text-align:center;margin-bottom:30px}
.header h1{color:#00f5a0;font-size:24px;margin:0}
.header p{color:#667;font-size:14px}
.key-box{background:#0a0a15;border:2px dashed #00f5a0;border-radius:12px;padding:20px;text-align:center;margin:25px 0;direction:ltr}
.key-box .label{color:#667;font-size:12px;display:block;margin-bottom:8px}
.key-box .key{color:#00f5a0;font-size:18px;font-weight:bold;letter-spacing:2px;word-break:break-all}
.product-name{text-align:center;font-size:20px;color:#00d9f5;margin:20px 0}
.details{background:#0a0a15;border-radius:10px;padding:20px;margin:20px 0;line-height:2}
.details strong{color:#00f5a0}
.btn{display:block;background:linear-gradient(135deg,#00f5a0,#00d9f5);color:#050508;text-decoration:none;padding:14px;border-radius:50px;text-align:center;font-weight:bold;margin:20px 0}
.footer{text-align:center;color:#667;font-size:12px;margin-top:30px;padding-top:20px;border-top:1px solid #00f5a010}
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>${p.icon} ZELZAL Security</h1>
    <p>تم تفعيل اشتراكك بنجاح ✅</p>
  </div>

  <div class="product-name">${p.name}</div>

  <div class="key-box">
    <span class="label">🔑 مفتاح التفعيل (License Key)</span>
    <div class="key">${licenseKey}</div>
  </div>

  <div class="details">
    <strong>👤 العميل:</strong> ${customerName || 'قيد التفعيل'}<br>
    <strong>📅 تاريخ التفعيل:</strong> ${new Date().toLocaleDateString('ar-EG')}<br>
    <strong>📦 المنتج:</strong> ${p.name}<br>
  </div>

  <a class="btn" href="${site}guide.html" target="_blank">📖 دليل التثبيت والاستخدام</a>
  <a class="btn" href="${site}" target="_blank">🌐 موقع ZELZAL Security</a>

  <div class="details">
    <strong>📱 الدعم الفني:</strong><br>
    واتساب: <a href="${wa}" style="color:#00f5a0">${wa}</a><br>
    بوت تيليجرام: @zelzal_security_bot<br>
    قناة التحديثات: @ZELZAL_Security
  </div>

  <div class="footer">
    ZELZAL Security © ${new Date().getFullYear()} — جميع الحقوق محفوظة<br>
    هذا الإيميل مرسل تلقائياً، يرجى عدم الرد عليه.
  </div>
</div>
</body>
</html>`;
}

async function sendLicenseEmail(toEmail, product, licenseKey, customerName = '') {
  if (!transporter) {
    if (!init()) return { success: false, error: 'SMTP not configured' };
  }

  const pNames = { cs: 'CYBER SHIELD', ng: 'NetGuard Monitor', fv: 'File Vault', wi: 'Wi-Fi Inspector', ug: 'USB Guardian', both: 'الباقة المزدوجة' };
  const pName = pNames[product] || 'ZELZAL Security';

  try {
    const info = await transporter.sendMail({
      from: CONFIG.smtp.from,
      to: toEmail,
      subject: `✅ تفعيل اشتراك ${pName} - ZELZAL Security`,
      html: buildHtml(product, licenseKey, customerName),
    });
    console.log(`[Email] Sent to ${toEmail}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (e) {
    console.log(`[Email] Failed to ${toEmail}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function testConnection() {
  if (!transporter) init();
  if (!transporter) return { success: false, error: 'Not configured' };
  try {
    await transporter.verify();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { init, sendLicenseEmail, testConnection };
