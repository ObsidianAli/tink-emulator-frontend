const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { needsSetup, resolveEmulator, buildSetup, setEmulatorExe, setConsoleFolder, completeSetup } = require('../src/setup');

function tempExe() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tink-setup-')), 'emu.exe');
  fs.writeFileSync(file, '');
  return file;
}

test('setup shows for new settings and not once finished', () => {
  assert.strictEqual(needsSetup({ consoles: {} }), true);
  assert.strictEqual(needsSetup({ consoles: {}, setupDone: true }), false);
});

test('settings from before setup existed with a games folder skip it', () => {
  assert.strictEqual(needsSetup({ consoles: { wii: { folder: 'D:\\Wii' } } }), false);
  assert.strictEqual(needsSetup({ consoles: { wii: { exe: 'x.exe' } } }), true);
});

test('setup that was started but not finished still shows', () => {
  assert.strictEqual(needsSetup({ consoles: { wii: { folder: 'D:\\Wii' } }, setupDone: false }), true);
});

test('a chosen emulator beats a detected one, but only while its file exists', () => {
  const exe = tempExe();
  assert.strictEqual(resolveEmulator({ consoles: {}, emulators: { dolphin: exe } }, { dolphin: 'found.exe' }, 'dolphin'), exe);
  assert.strictEqual(resolveEmulator({ consoles: {}, emulators: { dolphin: 'C:\\gone.exe' } }, { dolphin: 'found.exe' }, 'dolphin'), 'found.exe');
  assert.strictEqual(resolveEmulator({ consoles: {} }, {}, 'dolphin'), null);
});

test('lists emulators as found or missing, and the Consoles that need a picked exe', () => {
  const state = buildSetup({ consoles: {} }, { dolphin: 'D.exe' }, true);
  const dolphin = state.emulators.find((e) => e.id === 'dolphin');
  assert.deepStrictEqual([dolphin.found, dolphin.consoles], [true, 'GameCube, Wii']);
  assert.strictEqual(state.emulators.find((e) => e.id === 'cemu').found, false);
  assert.deepStrictEqual(state.manual.map((m) => m.id), ['switch2', 'ps5']);
  assert.strictEqual(state.steamFound, true);
  assert.strictEqual(state.consoles.length, 21);
});

test('a picked exe is stored per emulator, or per Console when there is no emulator', () => {
  const settings = { consoles: {} };
  setEmulatorExe(settings, 'cemu', 'C:\\Cemu.exe');
  setEmulatorExe(settings, 'ps5', 'C:\\ps5.exe');
  assert.deepStrictEqual(settings, { consoles: { ps5: { exe: 'C:\\ps5.exe' } }, emulators: { cemu: 'C:\\Cemu.exe' } });
  assert.throws(() => setEmulatorExe(settings, 'nope', 'x'));
});

test('a Console keeps one folder, and clearing it keeps the exe', () => {
  const settings = { consoles: { ps5: { exe: 'p.exe' } } };
  setConsoleFolder(settings, 'ps5', 'D:\\A');
  setConsoleFolder(settings, 'ps5', 'D:\\B');
  assert.deepStrictEqual(settings.consoles.ps5, { exe: 'p.exe', folder: 'D:\\B' });
  setConsoleFolder(settings, 'ps5', null);
  assert.deepStrictEqual(settings.consoles.ps5, { exe: 'p.exe' });
  assert.throws(() => setConsoleFolder(settings, 'nope', 'D:\\C'));
});

test('finishing stores the covers choice and ends setup', () => {
  const settings = { consoles: {} };
  completeSetup(settings, false);
  assert.deepStrictEqual([settings.covers, settings.setupDone, needsSetup(settings)], [false, true, false]);
  completeSetup(settings, true);
  assert.strictEqual(settings.covers, true);
});

test('ids that only exist on Object.prototype are refused', () => {
  const settings = { consoles: {} };
  for (const id of ['__proto__', 'constructor', 'toString']) {
    assert.throws(() => setConsoleFolder(settings, id, 'D:\Games'), id);
    assert.throws(() => setEmulatorExe(settings, id, 'C:\evil.exe'), id);
  }
  assert.strictEqual({}.folder, undefined);
  assert.deepStrictEqual(settings, { consoles: {} });
});
