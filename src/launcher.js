const { spawn } = require('node:child_process');
const path = require('node:path');

const CLOSE_WAIT_MS = 5000;

const taskkill = (args) =>
  new Promise((resolve) => {
    const proc = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    proc.once('error', resolve);
    proc.once('exit', resolve);
  });

const askToClose = (child) => taskkill(['/PID', String(child.pid)]);
const forceClose = (child) => taskkill(['/PID', String(child.pid), '/T', '/F']);

function closeEmulator(child, { waitMs = CLOSE_WAIT_MS, ask = askToClose, force = forceClose } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => force(child), waitMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    ask(child);
  });
}

function playGame({ exe, args }) {
  const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
  return { child, exited };
}

module.exports = { playGame, closeEmulator };
