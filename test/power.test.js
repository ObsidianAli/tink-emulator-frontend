const test = require('node:test');
const assert = require('node:assert');
const { powerAction } = require('../src/power');

test('sleep and shut down run fixed commands on Windows', () => {
  const calls = [];
  const run = (file, args) => calls.push([file, args]);
  assert.strictEqual(powerAction('sleep', { platform: 'win32', run }), true);
  assert.strictEqual(powerAction('shutdown', { platform: 'win32', run }), true);
  assert.deepStrictEqual(calls, [
    ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0', '1', '0']],
    ['shutdown', ['/s', '/t', '0']],
  ]);
});

test('sleep and shut down do nothing elsewhere or for anything else', () => {
  const run = () => assert.fail('nothing should run');
  assert.strictEqual(powerAction('sleep', { platform: 'linux', run }), false);
  assert.strictEqual(powerAction('shutdown', { platform: 'darwin', run }), false);
  assert.strictEqual(powerAction('format', { platform: 'win32', run }), false);
});
