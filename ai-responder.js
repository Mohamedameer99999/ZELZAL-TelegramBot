const OpenAI = require('openai');
const config = require('./config.json');
const products = require('./products.json');

let client = null;
if (config.groq_api_key) {
  client = new OpenAI({
    apiKey: config.groq_api_key,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

const productList = products.map(p => {
  let pricing = '';
  if (p.monthly) pricing = `شهري: ${p.monthly}، سنوي: ${p.yearly}`;
  else if (p.price) pricing = `شراء مرة واحدة: ${p.price}`;
  return `- ${p.name}: ${p.desc} (${pricing})`;
}).join('\n');

const SYSTEM_PROMPT = `أنت المالك والمطور لـ ZELZAL Security. ردودك مقتصرة على مشروع ZELZAL Security ومنتجاته فقط.

## مشروع ZELZAL Security
- البوت: @zelzal_security_bot
- القناة: @ZELZAL_Security
- الموقع: https://mohamedameer99999.github.io/zelzal-security/
- لوحة التحكم: https://ZELZALSECURITY.pythonanywhere.com
- الدفع: فودافون كاش 01034085168
- واتساب: https://wa.me/201034085168

## المنتجات (8 منتجات أمن سيبراني)
${productList}

## نظام الترخيص
- تراخيص HMAC-based
- الصيغة: PREFIX-XXXXX-XXXXX-XXXXX-XXXXX-YYYYMMDD-SIGNATURE

## قواعد
- تكلم فقط عن ZELZAL Security — ممنوع اقتراحات عامة
- رد بالعامية المصرية
- لو سأل عن اقتراحات: ركز على تطوير مشروع الأمن السيبراني نفسه
- لو سأل عن شراء: اشرح الدفع فودافون كاش 01034085168
- لو سأل خارج المشروع: قوله "هذا خارج ZELZAL Security"`;

async function askAI(userText, history = [], retryCount = 0) {
  if (!client) return null;
  
  // Try smaller model first (better rate limits)
  const models = [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'mixtral-8x7b-32768',
    'gemma2-9b-it'
  ];
  
  const model = config.groq_model || models[retryCount] || models[0];
  
  try {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const h of history) {
      messages.push({ role: 'user', content: h.user });
      if (h.assistant) messages.push({ role: 'assistant', content: h.assistant });
    }
    messages.push({ role: 'user', content: userText });

    const resp = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 800,
      temperature: 0.7,
    });
    return resp.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    const isRateLimit = err.message?.includes('429') || err.message?.includes('rate limit');
    const isModelError = err.message?.includes('decommissioned') || err.message?.includes('not found');
    
    if ((isRateLimit || isModelError) && retryCount < models.length - 1) {
      console.log(`[Groq] Trying fallback model: ${models[retryCount + 1]}`);
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return askAI(userText, history, retryCount + 1);
    }
    
    console.error('[Groq Error]', err.message);
    return null;
  }
}

module.exports = { askAI };