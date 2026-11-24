const { execFile } = require('node:child_process');

const COMMANDS = {
  sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0', '1', '0']],
  shutdown: ['shutdown', ['/s', '/t', '0']],
};

function powerAction(action, { platform = process.platform, run = execFile } = {}) {
  const command = COMMANDS[action];
  if (platform !== 'win32' || !command) return false;
  run(command[0], command[1], { windowsHide: true }, () => {});
  return true;
}

module.exports = { powerAction };
