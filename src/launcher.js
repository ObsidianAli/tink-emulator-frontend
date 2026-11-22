// Starts an emulator and waits for it to close.
const { spawn } = require('node:child_process');
const path = require('node:path');

// Resolves when the program exits. Rejects if it can't be started at all.
function runEmulator({ exe, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
}

// Hides Tink while the emulator runs and always shows it again, even if the start failed.
async function playGame(spec, { hide, show }) {
  hide();
  try {
    await runEmulator(spec);
  } finally {
    show();
  }
}

module.exports = { runEmulator, playGame };
