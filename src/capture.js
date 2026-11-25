const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 6000;
const NAME_MAX = 80;

// A separate process, so a driver crash or hang during a capture can't take Tink down with it.
function forkWorker(args) {
  const { utilityProcess } = require('electron');
  return utilityProcess.fork(path.join(__dirname, 'capture-worker.js'), args, { serviceName: 'Tink screenshot', stdio: 'ignore' });
}

function captureWindow(hwnd, file, { fork = forkWorker, timeoutMs = TIMEOUT_MS, onFail = () => {} } = {}) {
  return new Promise((resolve) => {
    let timer = null;
    let reason = 'the capture process stopped early';

    function finish(ok) {
      clearTimeout(timer);
      if (!ok) {
        fs.rm(`${file}.tmp`, { force: true }, () => {});
        onFail(reason);
      }
      resolve(ok ? file : null);
    }

    let child;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      child = fork([String(hwnd), file]);
    } catch (error) {
      reason = error.message;
      finish(false);
      return;
    }
    child.on('message', (message) => { reason = String(message); });
    child.once('exit', (code) => finish(code === 0));
    timer = setTimeout(() => {
      reason = 'the capture took too long';
      child.kill();
    }, timeoutMs);
  });
}

const two = (number) => String(number).padStart(2, '0');

function safeName(title) {
  const name = String(title || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, NAME_MAX).replace(/[. ]+$/, '');
}

// The same shape Game Bar uses, so both sort and read alike in the folder.
function shotName(title, date) {
  const day = [date.getFullYear(), two(date.getMonth() + 1), two(date.getDate())].join('-');
  const time = [two(date.getHours()), two(date.getMinutes()), two(date.getSeconds())].join('-');
  return `${safeName(title) || 'Screenshot'} ${day} ${time}.png`;
}

module.exports = { captureWindow, shotName, safeName };
