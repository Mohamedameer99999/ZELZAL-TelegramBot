# ZELZAL Telegram Bot - Deployment Configuration

## Overview
يقوم ZELZAL Telegram Bot بإدارة تراخيص المنتجات الأمنية وتفعيلها، مع لوحة تحكم ويب، وإحصائيات مباشرة، ونسخ احتياطي تلقائي.

## النشر في الإنتاج

### 1. Railway App (موصى به)
**الوصول:** https://accomplished-recreation-production.up.railway.app/

- 🌐 **الموقع الرئيسي:** يعرض صفحة ترحيبية وزر للوحة التحكم
- ⚡ **لوحة التحكم:** https://accomplished-recreation-production.up.railway.app/app/admin.html
  (محمية بتوكن)
- 📦 **بوابة التحميل:** https://accomplished-recreation-production.up.railway.app/app/portal.html
- 📈 **API:** https://accomplished-recreation-production.up.railway.app/api/ping, https://accomplished-recreation-production.up.railway.app/api/public-stats

**مميزات النشر:**
- ✅ خدمة خاصة بمتغيرات البيئة (بدون config.json)
- ✅ Persistent Volume لقاعدة بيانات SQLite (zelzal.db)
- ✅ عملية رئيسية تشغل 3 خدمات: bot.js + remote-server.js + auto-responder.js
- ✅ بناء تلقائي مع Node.js 20 + Python + gcc + gnumake (nixpacks)
- ✅自動更新 آمن عبر التبعيات (نظام Git)

### 2. الإعداد المحلي (اختياري)
```bash
# استنساخ المستودع
git clone https://github.com/Mohamedameer99999/ZELZAL-TelegramBot.git
cd ZELZAL-TelegramBot

# تشغيل الخدمات الثلاثة في عملية واحدة
node start.js
```

## ملفات التكوين

### config.json (للاستخدام المحلي)
قم بتعديل `config.json` مع توكنات البوت، والمفاتيح السرية، وإعدادات SMTP، وغيرها.

### config.js (للتشغيل السحابي)
يقرأ `config.js` من متغيرات بيئة Railway مع config.json المحلي كـ fallback.
متغيرات بيئة Railway:
- `BOT_TOKEN` - توكن بوت تيليجرام
- `ADMIN_IDS` - معرفات الآدمنز مفصولة بفاصلة
- `HMAC_SECRET` - سر توقيع التراخيص
- `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` - مفاتيح AI
- `SMTP_USER`, `SMTP_PASS` - مفاتيح SMTP
- `DB_PATH` - مسار قاعدة البيانات (يمكن استخدام persistent volume)

### config.example.json
نموذج آمن لـ config.json (لا يحتوي على توكنات حقيقية).

## الاختبارات

### اختبار ping API
```bash
curl https://accomplished-recreation-production.up.railway.app/api/ping
# ✅ { "pong": true, "time": 1781762334879 }
```

### اختبار الإحصائيات العامة
```bash
curl https://accomplished-recreation-production.up.railway.app/api/public-stats
# ✅ يعيد { "users": 5, "activeUsers": 3, "licenses": 12, "activeLicenses": 8, ... }
```

### اختبار لوحة التحكم
1. افتح https://accomplished-recreation-production.up.railway.app/app/admin.html
2. أدخل توكن المصادقة (من remote-server.js:AUTH_TOKEN)
3. قم بتسجيل الدخول باستخدام التوكن (الافتراضي: أول 16 حرف من SHA256(bot_token + ":remote"))

## النسخ الاحتياطي والاستعادة

### نظام النسخ الاحتياطي التلقائي
- يتم تشغيل `backup-db.py` يوميًا عبر جدول مهام Windows
- يحافظ على آخر 30 نسخة احتياطية (حذف تلقائي)
- يتم ضغط قواعد البيانات وملفات الكود باستخدام gzip
- اختياري: تحميل إلى Google Drive عبر rclone
- اختياري: إرسال إلى الآدمن عبر تيليجرام

### النسخ الاحتياطي اليدوي
```bash
cd ZELZAL-TelegramBot
python backup-db.py
```

### ملفات النسخ الاحتياطي
- `backups/zelzal_YYYYMMDD_HHMMSS.db.gz` - قاعدة البيانات المضغوطة
- `backups/code/*.js` - نسخ الكود المؤقتة

### الإعداد لـ Google Drive
1. قم بتشغيل `setup-google-drive.bat` أو اتبع الخطوات:
   - احصل على مفتاح Google Drive JSON
   - احفظه كـ `F:\zelzal prog-AI\Telegram-Bot\google-drive-key.json`
   - قم بتشغيل `setup-google-drive.bat` لتكوين rclone
   - سيطلب الرمز ثم يربط Google Drive كـ "ZELZAL_Backup"
2. تأكد من وجود `rclone.exe` (من https://rclone.org/downloads/)
3. سيتم تحميل النسخ الاحتياطية تلقائيًا إلى `ZELZAL_Backup:/ZELZAL_Backups`

### استعادة النسخة الاحتياطية
```bash
# قم باستخراج قاعدة البيانات المضغوطة
python -c "import gzip, shutil; shutil.unpack_file('backups/zelzal_20260618_090322.db.gz', 'zelzal.db')"
```
أو استخدم SQLite للاستعادة:
```sql
-- استبدل ملف zelzal.db بالنسخة الاحتياطية
-- أعد تشغيل الخدمات
```

## تكوين البنية

### package.json
```json
{
  "name": "zelzal-telegram-bot",
  "main": "start.js",
  "scripts": {
    "start": "node start.js",
    "railway": "node start.js"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### start.js (العملية الرئيسية)
تشغيل 3 عمليات:
1. `bot.js` - بوت تيليجرام (الأوامر، callbacks، أفلييت، تذاكر)
2. `remote-server.js` - خادم Express API (المنفذ 3456، static files، shell، deploy)
3. `auto-responder.js` - AI auto-responder (Groq + OpenAI)

### remote-server.js (ويب API)
- **المنفذ:** 3456 (Railway: يتم تعيينه تلقائيًا)
- **مصفوفة CORS:** * (لكل شيء)
- **الملفات الثابتة:** ZELZAL-ISO-Build/ (الموقع الرئيسي)، public/ (/app/admin.html)
- **endpoints:** /api/ping، /api/public-stats، /api/verify-license، /api/contact، /api/dashboard
- **المصادقة:** `X-Auth-Token` أو `?token=` query parameter (AUTH_TOKEN من config.bot_token + ":remote")

### config.example.json
```json
{
  "bot_token": "8980473162:TU_TOKEN_HUNA",
  "admin_ids": [1231848867],
  "hmac_secret": "Z3lzYWxTZWN1cml0eTIwMjU=",
  "dashboard_url": "",
  "whatsapp": "https://wa.me/201034085168",
  "payment_phone": "01034085168",
  "website": "https://mohamedameer99999.github.io/zelzal-security/",
  "channel": "@ZELZAL_Security",
  "bot_username": "ZELZAL_Security_Bot",
  "translate_news": true,
  "openai_api_key": "",
  "openai_model": "gpt-4o",
  "gemini_api_key": "",
  "gemini_model": "gemini-2.0-flash",
  "groq_api_key": "",
  "groq_model": "llama-3.3-70b-versatile",
  "smtp": {
    "host": "smtp.sendgrid.net",
    "port": 587,
    "user": "apikey",
    "pass": "",
    "from": "ZELZAL Security <zelzalcybershield@gmail.com>"
  },
  "subscription": {
    "reminder_days": [7, 3, 1],
    "grace_period_days": 3,
    "check_interval_minutes": 60,
    "auto_renew_default": true
  },
  "webhook": {
    "port": 3457,
    "secret": "zelzal-webhook-secret-2026",
    "allowed_ips": ["127.0.0.1", "::1"]
  },
  "affiliate": {
    "commission_percent": 10,
    "min_payout": 100,
    "referral_bonus": 20
  }
}
```

## البنية والتبعيات

### المتطلبات الأساسية
- Node.js 20+ (لـ better-sqlite3)
- Python (لـ build-tools لـ better-sqlite3)
- gcc + make (مدرجة في Nixpacks)

### تقنية البناء
- **Nixpacks v1.41.0** — يقوم تلقائيًا بتثبيت Node.js 20، Python3، gcc، gnumake
- **المتغيرات البيئية لـ Railway:** يتم تطبيقها تلقائيًا
- **Persistent volume** — قاعدة البيانات في `/data/zelzal.db`

## التطبيقات العملية

### 1. إدارة التراخيص
- **الأوامر:** `/buy`, `/license`, `/verify`
- **النظام:** HMAC SHA256 مع صلاحية زمنية
- **الدفع:** فودافون كاش عبر تيليجرام

### 2. افلييت (المسوقين)
- **الأوامر:** `/affiliate` (إصدار الكود)، `/affiliates` (حساب العمولة)
- **النظام:** عمولة 10% + مكافأة تسجيل 20 جنية
- **المدفوعات:** الحد الأدنى للدفع 100 جنية، تلقائي

### 3. الدعم وخدمة العملاء
- **تذاكر الدعم:** `/ticket`، `/tickets`
- **النظام:** تذاكر متعددة المستخدمين مع إشعارات فورية
- **لوحة التحكم:** تفاصيل كاملة، إدارة الحالة، الرد على المستخدمين

### 4. التحليلات والتقارير
- **لوحة التحكم:** إحصائيات مباشرة (المستخدمون، التراخيص، الإيرادات، المدفوعات، التذاكر، جهات الاتصال)
- **التقارير:** مبيعات المنتجات، الإيرادات الشهرية، إحصائيات المدفوعات
- **النظام:** JSON+AI auto-responder للردود

### 5. النشر والتحديثات
- **التنفيذ:** `deploy.bat` (خيارات: Railway / VPS)
- **التحديثات:** كل push إلى master يقوم تلقائيًا بنشر نسخة جديدة
- **النسخ الاحتياطي:** يومي تلقائي + Google Drive + تيليجرام

## استكشاف المشكلات

### مشاكل الخادم
```bash
# تحقق من حالة الخدمات
ps aux | grep node

# عرض السجلات
node start.js  # سيطبع stdout لجميع الخدمات
```

### قاعدة البيانات
```bash
# التحقق من وجود قاعدة البيانات
ls -la zelzal.db

# إعادة تشغيل الخدمات
node start.js
```

### Google Drive
```bash
# إذا فشل الرفع إلى Drive
# 1. تأكد من وجود الرمز
ls -la google-drive-key.json
# 2. قم بتشغيل setup-google-drive.bat مرة أخرى
# 3. تأكد من وجود rclone.exe
ls -la rclone.exe
```

### تطبيقات الجوال
- **تيليجرام:** @ZELZAL_Security
- **واتساب:** https://wa.me/201034085168

## المعايير الأمنية

- **النقل الآمن:** HTTPS لجميع الاتصالات
- **مصفوفة CORS:** * (يمكن تقييدها حسب الحاجة)
- **المصادقة:** مصادقة التوكن لـ remote-server API
- **التعامل الآمن مع مفاتيح API:** متغيرات البيئة، وليس في الكود
- **النسخ الاحتياطي المشفر:** جميع النسخ الاحتياطية مشفرة باستخدام gzip

## المساهمات والتحديثات

### قائمة المهام الحالية
- [x] إضافة `config.js` module + متغيرات البيئة Railway
- [x] إنشاء `start.js` للعملية الرئيسية
- [x] إضافة `railway.toml` + `config.example.json`
- [x] تحديث `package.json` مع Node 20+ و `start.js`
- [x] إضافة `nixpacks.toml` مع Python/gcc/make
- [x] إضافة `public/index.html` للواجهة الرئيسية
- [x] إصلاح جذور الروابط في remote-server.js
- [x] تحسين backup-db.py لدعم نشر Railway الجديد
- [x] Push إلى GitHub (`ZELZAL-TelegramBot`)
- [x] نشر على Railway (`https://accomplished-recreation-production.up.railway.app/`)
- [x] إنشاء نظام النسخ الاحتياطي والتحديثات

### القائمة المستقبلية
- [ ] واجهة إدارة وسائط التواصل الاجتماعي
- [ ] نظام تصفية الرسائل المزعجة
- [ ] واجهة برمجة تطبيقات AFK للروبوت
- [ ] تكامل نقاط البيع (POS)
- [ ] نظام بوابة الدفع (مع فودافون كاش، Credit Card)
- [ ] لوحة تحكم بمستوى المؤسسة
- [ ] تحليلات التنبؤية AI
- [ ] تطبيقات الجوال الأصلية
- [ ] تكامل السحابة الهجينة (AWS/Azure/GCP)

## روابط مهمة

- **مستودع GitHub:** https://github.com/Mohamedameer99999/ZELZAL-TelegramBot
- **موقع ZELZAL Security:** https://mohamedameer99999.github.io/zelzal-security/
- **GitHub Pages:** https://mohamedameer99999.github.io/zelzal-security/

---

**آخر تحديث:** 2026-06-18 09:03 UTC
**تم النشر:** Railway.app (المشروع: accomplished-recreation)
**الكود المصدر:** GitHub
**البنية:** Node.js 20 + Nixpacks + Persistent volume

---

*إدارة منتجات ZELZAL Security - بوت تيليجرام مع لوحة تحكم ويب، وأفلييت، ودعم فني، ونشر 24/7* 🛡️
