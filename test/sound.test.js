const test = require('node:test');
const assert = require('node:assert');
const { soundDue } = require('../renderer/sound.js');

test('a sound is due the first time', () => {
  assert.strictEqual(soundDue('move', 1000, new Map()), true);
});

test('a held direction does not play every repeat', () => {
  const last = new Map([['move', 1000]]);
  assert.strictEqual(soundDue('move', 1060, last), false);
  assert.strictEqual(soundDue('move', 1100, last), true);
});

test('other sounds only wait a short moment', () => {
  const last = new Map([['confirm', 1000]]);
  assert.strictEqual(soundDue('confirm', 1020, last), false);
  assert.strictEqual(soundDue('confirm', 1060, last), true);
  assert.strictEqual(soundDue('back', 1020, last), true);
});
