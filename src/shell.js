const { execFile } = require('node:child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';

const reg = (args) => new Promise((resolve) => {
  execFile('reg.exe', args, { windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
});

const quoted = (exe) => `"${exe}"`;

async function readShell() {
  const out = await reg(['query', KEY, '/v', 'Shell']);
  const match = out && /Shell\s+REG_SZ\s+(.+)/i.exec(out);
  return match ? match[1].trim() : null;
}

async function isShell(exe) {
  const value = await readShell();
  return value !== null && value.toLowerCase() === quoted(exe).toLowerCase();
}

async function setShell(exe, on) {
  const args = on ? ['add', KEY, '/v', 'Shell', '/t', 'REG_SZ', '/d', quoted(exe), '/f'] : ['delete', KEY, '/v', 'Shell', '/f'];
  return (await reg(args)) !== null;
}

module.exports = { isShell, setShell };
