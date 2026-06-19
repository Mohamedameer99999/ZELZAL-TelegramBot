// ZELZAL Main Starter — runs all services in one process

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

const LOCK_FILE = path.join(__dirname, '.bot.lock');

// Prevent multiple instances with lock file
const is409Restart = process.env.IS_409_RESTART === '1';
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    if (existingPid) {
      try {
        process.kill(parseInt(existingPid), 0);
        if (!is409Restart) {
          console.log(`[LOCK] Another instance (PID: ${existingPid}) running. Killing it...`);
          process.kill(parseInt(existingPid), 'SIGKILL');
        }
      } catch {}
    }
    fs.unlinkSync(LOCK_FILE);
  }
  fs.writeFileSync(LOCK_FILE, process.pid.toString());
  console.log(`[LOCK] Acquired (PID: ${process.pid}${is409Restart ? ', 409 restart' : ''})`);
}
acquireLock();

const services = [
  { name: 'bot', file: 'bot.js' },
  { name: 'remote-server', file: 'remote-server.js' },
  { name: 'auto-responder', file: 'auto-responder.js' },
];

const children = {};
let shuttingDown = false;

function cleanup() {
  if (fs.existsSync(LOCK_FILE)) {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

services.forEach(s => {
  const child = fork(path.join(__dirname, s.file), [], { stdio: 'pipe' });
  children[s.name] = child;

  child.stdout.on('data', d => process.stdout.write(`[${s.name}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${s.name}] ${d}`));

  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[${s.name}] exited with code ${code}. Restarting in 3s...`);
      setTimeout(() => {
        if (!shuttingDown) {
          const newChild = fork(path.join(__dirname, s.file), [], { stdio: 'pipe' });
          children[s.name] = newChild;
          newChild.stdout.on('data', d => process.stdout.write(`[${s.name}] ${d}`));
          newChild.stderr.on('data', d => process.stderr.write(`[${s.name}] ${d}`));
        }
      }, 3000);
    }
  });

  console.log(`[${s.name}] started (PID: ${child.pid})`);
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  console.log('Shutting down all services...');
  Object.values(children).forEach(c => c.kill('SIGTERM'));
  cleanup();
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGINT', () => {
  shuttingDown = true;
  console.log('Shutting down all services...');
  Object.values(children).forEach(c => c.kill('SIGTERM'));
  cleanup();
  setTimeout(() => process.exit(0), 3000);
});

process.on('exit', cleanup);
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  cleanup();
  process.exit(1);
});
