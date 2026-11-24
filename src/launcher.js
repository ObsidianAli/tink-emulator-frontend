const { spawn } = require('node:child_process');
const path = require('node:path');

const CLOSE_WAIT_MS = 5000;

function runEmulator({ exe, args }, onStart) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => onStart && onStart(child));
    child.once('exit', () => resolve());
  });
}

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

async function playGame(spec, { hide, show, whilePlaying }) {
  hide();
  let stop = null;
  try {
    await runEmulator(spec, (child) => {
      if (whilePlaying) stop = whilePlaying(child);
    });
  } finally {
    if (stop) stop();
    show();
  }
}

module.exports = { playGame, closeEmulator };
