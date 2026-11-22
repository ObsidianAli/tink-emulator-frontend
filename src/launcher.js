// Starts an emulator, waits for it to close, and can close it when the player wants to leave.
const { spawn } = require('node:child_process');
const path = require('node:path');

// How long the emulator gets to close by itself before it's forced.
const CLOSE_WAIT_MS = 5000;

// Resolves when the program exits. Rejects if it can't be started at all.
// onStart gets the running process once it's up.
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

// Asks the emulator's windows to close, the same as clicking their X.
const askToClose = (child) => taskkill(['/PID', String(child.pid)]);
// Ends the emulator and anything it started.
const forceClose = (child) => taskkill(['/PID', String(child.pid), '/T', '/F']);

// Asks the emulator to close, then forces it if it's still open after waitMs.
// Resolves once it has exited.
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

// Hides Tink while the emulator runs and always shows it again, even if the start failed.
// whilePlaying runs once the emulator is up and can return a function that's called when it closes.
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
