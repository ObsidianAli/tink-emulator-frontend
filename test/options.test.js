const test = require('node:test');
const assert = require('node:assert');
const options = require('../src/options');

test('fullscreen is on unless it was turned off', () => {
  assert.strictEqual(options.wantsFullscreen({}), true);
  const settings = {};
  options.setFullscreen(settings, false);
  assert.strictEqual(options.wantsFullscreen(settings), false);
  options.setFullscreen(settings, true);
  assert.strictEqual(options.wantsFullscreen(settings), true);
});

test('profiles on Home are on unless turned off', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').homeProfiles, true);
  options.setHomeProfiles(settings, false);
  assert.strictEqual(options.buildSettings(settings, '1').homeProfiles, false);
  options.setHomeProfiles(settings, true);
  assert.strictEqual(options.buildSettings(settings, '1').homeProfiles, true);
});

test('favourite heart defaults to sticker and ignores unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').heart, 'sticker');
  options.setHeart(settings, 'small');
  assert.strictEqual(options.buildSettings(settings, '1').heart, 'small');
  options.setHeart(settings, 'huge');
  assert.strictEqual(options.buildSettings(settings, '1').heart, 'small');
});

test('game options default to beside the case and ignore unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').gameOptions, 'case');
  options.setGameOptions(settings, 'panel');
  assert.strictEqual(options.buildSettings(settings, '1').gameOptions, 'panel');
  options.setGameOptions(settings, 'popup');
  assert.strictEqual(options.buildSettings(settings, '1').gameOptions, 'panel');
});

test('changing a cover defaults to the case and ignores unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').coverPicker, 'case');
  options.setCoverPicker(settings, 'page');
  assert.strictEqual(options.buildSettings(settings, '1').coverPicker, 'page');
  options.setCoverPicker(settings, 'window');
  assert.strictEqual(options.buildSettings(settings, '1').coverPicker, 'page');
});

test('background defaults to picture and ignores unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').background, 'picture');
  for (const mode of ['flat', 'colour', 'picture', 'soft', 'calm']) {
    options.setBackground(settings, mode);
    assert.strictEqual(options.buildSettings(settings, '1').background, mode);
  }
  options.setBackground(settings, 'video');
  assert.strictEqual(options.buildSettings(settings, '1').background, 'calm');
  settings.background = 'drift';
  assert.strictEqual(options.buildSettings(settings, '1').background, 'picture');
});

test('names default to warm and ignore unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').names, 'warm');
  options.setNames(settings, 'plain');
  assert.strictEqual(options.buildSettings(settings, '1').names, 'plain');
  options.setNames(settings, 'bold');
  assert.strictEqual(options.buildSettings(settings, '1').names, 'plain');
});

test('text style defaults to plain and ignores unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').textStyle, 'plain');
  for (const mode of ['outline', 'pill', 'fade']) {
    options.setTextStyle(settings, mode);
    assert.strictEqual(options.buildSettings(settings, '1').textStyle, mode);
  }
  options.setTextStyle(settings, 'bold');
  assert.strictEqual(options.buildSettings(settings, '1').textStyle, 'fade');
});

test('corners default to soft and ignore unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').corners, 'soft');
  options.setCorners(settings, 'round');
  assert.strictEqual(options.buildSettings(settings, '1').corners, 'round');
  options.setCorners(settings, 'sharp');
  assert.strictEqual(options.buildSettings(settings, '1').corners, 'round');
});

test('highlight defaults to rim and ignores unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').focusStyle, 'rim');
  options.setFocusStyle(settings, 'under');
  assert.strictEqual(options.buildSettings(settings, '1').focusStyle, 'under');
  options.setFocusStyle(settings, 'full');
  assert.strictEqual(options.buildSettings(settings, '1').focusStyle, 'under');
});

test('the SteamGridDB key is trimmed, stored, cleared, and never sent to the screen', () => {
  const settings = {};
  options.setSteamKey(settings, '  secret-key-123 ');
  assert.strictEqual(options.steamKey(settings), 'secret-key-123');
  const state = options.buildSettings(settings, '1');
  assert.strictEqual(state.hasKey, true);
  assert.ok(!JSON.stringify(state).includes('secret-key-123'));
  options.setSteamKey(settings, '   ');
  assert.strictEqual(options.steamKey(settings), '');
  assert.strictEqual(options.buildSettings(settings, '1').hasKey, false);
});

test('keyboard defaults to grid and ignores unknown values', () => {
  const settings = {};
  assert.strictEqual(options.buildSettings(settings, '1').keyboard, 'grid');
  options.setKeyboard(settings, 'full');
  assert.strictEqual(options.buildSettings(settings, '1').keyboard, 'full');
  options.setKeyboard(settings, 'nonsense');
  assert.strictEqual(options.buildSettings(settings, '1').keyboard, 'full');
});

test('sounds ignore unknown values', () => {
  const settings = { sounds: { move: 'soft' } };
  options.setSounds(settings, { store: 'b', album: 'zzz', nope: 'a' });
  assert.deepStrictEqual(options.buildSettings(settings, '1').sounds, { store: 'b' });
});
