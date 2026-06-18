const db = require('./database.js');
const fs = require('fs');
const path = require('path');

db.init();
const LOG_FILE = path.join(__dirname, '_ai_watcher.log');
const NOTIFY_FILE = path.join(__dirname, '_new_for_ai.json');
let lastCount = db.getPendingCommands().length;
let notifiedIds = new Set();

function check() {
  try {
    const pending = db.getPendingCommands();
    for (const cmd of pending) {
      if (notifiedIds.has(cmd.id)) continue;
      notifiedIds.add(cmd.id);
      const msg = `[${new Date().toISOString()}] 🔔 رسالة جديدة من المستخدم!\n📝 ${cmd.task.substring(0, 200)}\n🆔 ${cmd.id}\n━━━━━━━━━━━━━━━━━━\n`;
      fs.appendFileSync(LOG_FILE, msg);
      fs.writeFileSync(NOTIFY_FILE, JSON.stringify({ id: cmd.id, task: cmd.task, created: new Date().toISOString(), read: false }));
      console.log(msg);
    }
    if (pending.length !== lastCount) {
      lastCount = pending.length;
    }
  } catch {}
}

setInterval(check, 5000);
check();
console.log('[AI Watcher] Started — watching for new messages every 5s');
