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
  const settings = { consoles: { gamecube: { folder: 'D:\\Games' } }, covers: true };
  saveSettings(file, settings);
  assert.deepStrictEqual(loadSettings(file), settings);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('replaces an existing file', () => {
  const file = tempFile();
  saveSettings(file, { consoles: {}, covers: true });
  saveSettings(file, { consoles: {}, covers: false });
  assert.strictEqual(loadSettings(file).covers, false);
});

test('a failed save leaves the old file intact and no temp file behind', () => {
  const file = tempFile();
  saveSettings(file, { consoles: {}, covers: true });
  const broken = { consoles: {} };
  broken.self = broken;
  assert.throws(() => saveSettings(file, broken));
  assert.strictEqual(loadSettings(file).covers, true);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('a failed rename also cleans up the temp file', () => {
  const file = tempFile();
  fs.mkdirSync(file, { recursive: true });
  assert.throws(() => saveSettings(file, { consoles: {} }));
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});
