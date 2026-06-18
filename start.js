// ZELZAL Main Starter — runs all services in one process

const { fork } = require('child_process');
const path = require('path');

const services = [
  { name: 'bot', file: 'bot.js' },
  { name: 'remote-server', file: 'remote-server.js' },
  { name: 'auto-responder', file: 'auto-responder.js' },
];

const children = {};
let shuttingDown = false;

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
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGINT', () => {
  shuttingDown = true;
  console.log('Shutting down all services...');
  Object.values(children).forEach(c => c.kill('SIGTERM'));
  setTimeout(() => process.exit(0), 3000);
});
