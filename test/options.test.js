const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const options = require('../src/options');
const { launchSpec } = require('../src/presets');

const exe = () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tink-options-')), 'emu.exe');
  fs.writeFileSync(file, '');
  return file;
};
const row = (state, id) => state.consoles.find((item) => item.id === id);

test('fullscreen is on unless it was turned off', () => {
  assert.strictEqual(options.wantsFullscreen({ consoles: {} }), true);
  const settings = { consoles: {} };
  options.setFullscreen(settings, false);
  assert.strictEqual(options.wantsFullscreen(settings), false);
  options.setFullscreen(settings, true);
  assert.strictEqual(options.wantsFullscreen(settings), true);
});

test('profiles on Home are on unless turned off', () => {
  const settings = { consoles: {} };
  assert.strictEqual(options.buildSettings(settings, {}, '1').homeProfiles, true);
  options.setHomeProfiles(settings, false);
  assert.strictEqual(options.buildSettings(settings, {}, '1').homeProfiles, false);
  options.setHomeProfiles(settings, true);
  assert.strictEqual(options.buildSettings(settings, {}, '1').homeProfiles, true);
});

test('left edge defaults to slide and ignores unknown values', () => {
  const settings = { consoles: {} };
  assert.strictEqual(options.buildSettings(settings, {}, '1').leftEdge, 'slide');
  options.setLeftEdge(settings, 'fade');
  assert.strictEqual(options.buildSettings(settings, {}, '1').leftEdge, 'fade');
  options.setLeftEdge(settings, 'nonsense');
  assert.strictEqual(options.buildSettings(settings, {}, '1').leftEdge, 'fade');
});

test('background defaults to tint and ignores unknown values', () => {
  const settings = { consoles: {} };
  assert.strictEqual(options.buildSettings(settings, {}, '1').background, 'tint');
  options.setBackground(settings, 'drift');
  assert.strictEqual(options.buildSettings(settings, {}, '1').background, 'drift');
  options.setBackground(settings, 'video');
  assert.strictEqual(options.buildSettings(settings, {}, '1').background, 'drift');
});

test('highlight defaults to rim and ignores unknown values', () => {
  const settings = { consoles: {} };
  assert.strictEqual(options.buildSettings(settings, {}, '1').focusStyle, 'rim');
  options.setFocusStyle(settings, 'under');
  assert.strictEqual(options.buildSettings(settings, {}, '1').focusStyle, 'under');
  options.setFocusStyle(settings, 'full');
  assert.strictEqual(options.buildSettings(settings, {}, '1').focusStyle, 'under');
});

test('turning fullscreen off drops each emulator fullscreen flag', () => {
  const rom = 'game.iso';
  assert.deepStrictEqual(launchSpec('wiiu', 'Cemu.exe', rom, false).args, ['-g', rom]);
  assert.deepStrictEqual(launchSpec('switch', 'eden.exe', rom, false).args, ['-g', rom]);
  assert.deepStrictEqual(launchSpec('ps2', 'pcsx2-qt.exe', rom, false).args, ['-batch', '-nofullscreen', '--', rom]);
  assert.deepStrictEqual(launchSpec('3ds', 'azahar.exe', rom, false).args, [rom]);
  assert.deepStrictEqual(launchSpec('snes', 'retroarch.exe', rom, false).args, ['-L', 'cores\\snes9x_libretro.dll', rom]);
  assert.deepStrictEqual(launchSpec('gamecube', 'Dolphin.exe', rom, false).args, ['-b', '-e', rom]);
  assert.deepStrictEqual(launchSpec('ps5', 'x.exe', rom, false).args, [rom]);
});

test('Settings lists every Console with how its emulator was found', () => {
  const picked = exe();
  const state = options.buildSettings(
    { consoles: { wii: { folder: 'D:\\Wii' } }, emulators: { cemu: picked } },
    { dolphin: 'C:\\Dolphin.exe', cemu: 'C:\\other.exe' },
    '1.2.3',
  );
  assert.strictEqual(state.version, '1.2.3');
  assert.strictEqual(row(state, 'gamecube').emulator.status, 'Found');
  assert.strictEqual(row(state, 'wiiu').emulator.status, 'Chosen');
  assert.strictEqual(row(state, 'ps2').emulator.status, 'Not found');
  assert.strictEqual(row(state, 'ps5').emulator.status, 'Not chosen');
  assert.strictEqual(row(state, 'wii').folder, 'D:\\Wii');
});

test('Find automatically forgets a picked emulator so detection decides again', () => {
  const settings = { consoles: { ps5: { exe: 'x.exe', folder: 'D:\\PS5' } }, emulators: { dolphin: 'D.exe', cemu: 'C.exe' } };
  options.clearEmulator(settings, 'dolphin');
  assert.deepStrictEqual(settings.emulators, { cemu: 'C.exe' });
  options.clearEmulator(settings, 'ps5');
  assert.deepStrictEqual(settings.consoles.ps5, { folder: 'D:\\PS5' });
  assert.throws(() => options.clearEmulator(settings, 'nope'));
});

test('the SteamGridDB key is trimmed, stored, cleared, and never sent to the screen', () => {
  const settings = { consoles: {} };
  options.setSteamKey(settings, '  secret-key-123 ');
  assert.strictEqual(options.steamKey(settings), 'secret-key-123');
  const state = options.buildSettings(settings, {}, '1');
  assert.strictEqual(state.hasKey, true);
  assert.ok(!JSON.stringify(state).includes('secret-key-123'));
  options.setSteamKey(settings, '   ');
  assert.strictEqual(options.steamKey(settings), '');
  assert.strictEqual(options.buildSettings(settings, {}, '1').hasKey, false);
});

test('keyboard defaults to grid and ignores unknown values', () => {
  const settings = { consoles: {} };
  assert.strictEqual(options.buildSettings(settings, {}, '1').keyboard, 'grid');
  options.setKeyboard(settings, 'full');
  assert.strictEqual(options.buildSettings(settings, {}, '1').keyboard, 'full');
  options.setKeyboard(settings, 'nonsense');
  assert.strictEqual(options.buildSettings(settings, {}, '1').keyboard, 'full');
});

test('icon style and row have defaults and ignore unknown values', () => {
  const settings = { consoles: {} };
  const read = () => options.buildSettings(settings, {}, '1');
  assert.deepStrictEqual([read().iconStyle, read().iconRow], ['disc', 'separate']);
  options.setIconStyle(settings, 'glyph');
  options.setIconRow(settings, 'bar');
  options.setIconStyle(settings, 'rainbow');
  options.setIconRow(settings, 'circle');
  assert.deepStrictEqual([read().iconStyle, read().iconRow], ['glyph', 'bar']);
});
