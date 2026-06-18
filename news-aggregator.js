const RssParser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const CONFIG = require('./config');
const CHANNEL = (CONFIG.channel || '@ZELZAL_Security').replace('@', '');
const DB_FILE = path.join(__dirname, 'news-db.json');
const TRANSLATE = CONFIG.translate_news !== false; // default true

const SOURCES = [
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', emoji: '🌐', lang: 'en' },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', emoji: '💻', lang: 'en' },
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', emoji: '🔍', lang: 'en' },
  { name: 'PortSwigger Research', url: 'https://portswigger.net/research/rss', emoji: '🔬', lang: 'en' },
  { name: 'العربية', url: 'https://www.alarabiya.net/feed/rss2/ar/technology.xml', emoji: '🇸🇦', lang: 'ar' },
];

let postedUrls = {};
let botInstance = null;
let timer = null;

function loadDb() {
  try { postedUrls = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { postedUrls = {}; }
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(postedUrls, null, 2));
}

function isPosted(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return !!postedUrls[hash];
}

function markPosted(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  postedUrls[hash] = { url, posted: new Date().toISOString() };
  // Keep only last 500
  const keys = Object.keys(postedUrls);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) => postedUrls[a].posted.localeCompare(postedUrls[b].posted));
    for (let i = 0; i < keys.length - 500; i++) delete postedUrls[sorted[i]];
  }
  saveDb();
}

function truncate(text, max) {
  if (!text) return '';
  const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.substring(0, max) + '…' : clean;
}

function translateToArabic(text) {
  return new Promise((resolve) => {
    if (!text || text.length < 2) return resolve(text);
    const encoded = encodeURIComponent(text.substring(0, 1500));
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encoded}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let result = '';
          for (const part of json[0]) { if (part[0]) result += part[0]; }
          resolve(result || text);
        } catch { resolve(text); }
      });
    }).on('error', () => resolve(text));
  });
}

async function translateItem(item) {
  if (!TRANSLATE || item.lang === 'ar') return item;
  const [translatedTitle, translatedSummary] = await Promise.all([
    translateToArabic(item.title),
    item.summary ? translateToArabic(item.summary) : Promise.resolve(''),
  ]);
  return {
    ...item,
    title: translatedTitle || item.title,
    summary: translatedSummary || item.summary,
  };
}

async function fetchSource(source) {
  const parser = new RssParser({
    timeout: 10000,
    headers: { 'User-Agent': 'ZELZAL-NewsBot/1.0' }
  });
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || []).slice(0, 5);
    return items.filter(item => item.link && !isPosted(item.link)).map(item => ({
      title: truncate(item.title || '', 120),
      summary: truncate(item.contentSnippet || item.content || '', 250),
      link: item.link,
      date: item.pubDate || item.isoDate || '',
      source: source.name,
      emoji: source.emoji,
      lang: source.lang,
    }));
  } catch (e) {
    console.log(`[News] ${source.name}: ${e.message}`);
    return [];
  }
}

async function fetchAll() {
  const all = [];
  for (const src of SOURCES) {
    const items = await fetchSource(src);
    all.push(...items);
  }
  // Translate English items to Arabic
  if (TRANSLATE) {
    for (let i = 0; i < all.length; i++) {
      if (all[i].lang === 'en') {
        all[i] = await translateItem(all[i]);
      }
    }
  }
  // Randomize order so not all from same source
  all.sort(() => Math.random() - 0.5);
  return all.slice(0, 3); // Max 3 per cycle
}

function formatPost(item) {
  const tag = item.source.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
  let text = `${item.emoji} <b>${item.title}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━\n`;
  if (item.summary) text += `${item.summary}\n\n`;
  text += `📰 ${item.source}\n`;
  text += `📎 <a href="${item.link}">اقرأ المزيد</a>\n\n`;
  text += `#أمن_سيبراني #هاكرز #${tag}`;
  return text;
}

async function postToChannel(bot, item) {
  try {
    const text = formatPost(item);
    await bot.sendMessage(`@${CHANNEL}`, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
    markPosted(item.link);
    console.log(`[News] Posted: ${item.title.substring(0, 50)}...`);
    return true;
  } catch (e) {
    console.log(`[News] Post failed: ${e.message}`);
    return false;
  }
}

async function runCycle(bot) {
  console.log(`[News] Fetching at ${new Date().toLocaleString('ar-EG')}`);
  loadDb();
  const items = await fetchAll();
  console.log(`[News] Found ${items.length} new items`);
  let posted = 0;
  for (const item of items) {
    if (await postToChannel(bot, item)) posted++;
    await new Promise(r => setTimeout(r, 2000)); // Delay between posts
  }
  if (posted > 0) {
    console.log(`[News] Posted ${posted} articles`);
  }
  return posted;
}

// Start the scheduler
function start(bot, intervalMs = 3 * 60 * 60 * 1000) {
  botInstance = bot;
  loadDb();
  console.log(`[News] Aggregator started (interval: ${intervalMs / 60000} min)`);
  // Run immediately
  runCycle(bot);
  // Schedule
  timer = setInterval(() => runCycle(bot), intervalMs);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  console.log('[News] Aggregator stopped');
}

function isRunning() { return timer !== null; }

module.exports = { start, stop, runCycle, isRunning, fetchAll, formatPost };
