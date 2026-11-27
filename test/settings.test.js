const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSettings, saveSettings } = require('../src/settings');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tink-settings-')), 'sub', 'settings.json');
}

test('saves settings that load back the same, leaving no temp file', () => {
  const file = tempFile();
  const settings = { covers: true, setupDone: true };
  saveSettings(file, settings);
  assert.deepStrictEqual(loadSettings(file), settings);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('replaces an existing file', () => {
  const file = tempFile();
  saveSettings(file, { covers: true });
  saveSettings(file, { covers: false });
  assert.strictEqual(loadSettings(file).covers, false);
});

test('a failed save leaves the old file intact and no temp file behind', () => {
  const file = tempFile();
  saveSettings(file, { covers: true });
  const broken = {};
  broken.self = broken;
  assert.throws(() => saveSettings(file, broken));
  assert.strictEqual(loadSettings(file).covers, true);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('a failed rename also cleans up the temp file', () => {
  const file = tempFile();
  fs.mkdirSync(file, { recursive: true });
  assert.throws(() => saveSettings(file, {}));
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('a missing or broken file gives empty settings, and old console keys still load', () => {
  const file = tempFile();
  assert.deepStrictEqual(loadSettings(file), {});
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{broken');
  assert.deepStrictEqual(loadSettings(file), {});
  fs.writeFileSync(file, JSON.stringify({ consoles: { wii: { folder: 'D:\\Wii' } }, emulators: {}, covers: true }));
  assert.strictEqual(loadSettings(file).covers, true);
});
