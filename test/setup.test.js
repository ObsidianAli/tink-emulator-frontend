const test = require('node:test');
const assert = require('node:assert');
const { needsSetup, completeSetup } = require('../src/setup');

test('setup shows for new settings and not once finished', () => {
  assert.strictEqual(needsSetup({}), true);
  assert.strictEqual(needsSetup({ setupDone: true }), false);
});

test('setup that was started but not finished still shows', () => {
  assert.strictEqual(needsSetup({ setupDone: false }), true);
});

test('old console and emulator keys do not change whether setup shows', () => {
  assert.strictEqual(needsSetup({ consoles: { wii: { folder: 'D:\\Wii' } }, emulators: { dolphin: 'D.exe' } }), true);
  assert.strictEqual(needsSetup({ consoles: { wii: { folder: 'D:\\Wii' } }, setupDone: true }), false);
});

test('finishing stores the covers choice and ends setup', () => {
  const settings = {};
  completeSetup(settings, false);
  assert.deepStrictEqual([settings.covers, settings.setupDone, needsSetup(settings)], [false, true, false]);
  completeSetup(settings, true);
  assert.strictEqual(settings.covers, true);
});
