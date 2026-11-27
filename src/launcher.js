const { spawn } = require('node:child_process');
const path = require('node:path');

function playGame({ exe, args }) {
  const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
  return { child, exited };
}

module.exports = { playGame };
