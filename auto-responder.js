const db = require('./database.js');
const { askAI } = require('./ai-responder.js');

db.init();
console.log('[Auto-Responder] Started — checking every 15s');

let lastCount = 0;
const seen = new Set();

async function check() {
  try {
    const pending = db.getPendingCommands();
    if (pending.length !== lastCount) {
      console.log(`[Auto-Responder] Pending: ${pending.length}`);
      lastCount = pending.length;
    }
    for (const cmd of pending) {
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      const text = (cmd.task || '').replace(/^\[(CHAT|ASK)\]\s*/, '');
      console.log(`[Auto-Responder] Processing: ${text.substring(0, 80)}`);
      
      // Build history from recent done commands
      const recent = db.getChatHistory(10);
      const history = [];
      for (const r of recent.reverse()) {
        const userText = (r.task || '').replace(/^\[(CHAT|ASK)\]\s*/, '');
        if (userText && r.result) history.push({ user: userText, assistant: r.result });
      }

      const reply = await askAI(text, history);
      if (reply) {
        db.markCommandDone(cmd.id, reply);
        db.markNotified(cmd.id);
        console.log(`[Auto-Responder] ✅ Replied to: ${cmd.id}`);
      } else {
        seen.delete(cmd.id);
        console.log(`[Auto-Responder] ❌ Failed: ${cmd.id}`);
      }
    }
  } catch (err) {
    console.error('[Auto-Responder Error]', err.message);
  }
}

setInterval(check, 15000);
check();
