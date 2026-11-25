const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { updateFirstSeen } = require('../src/firstseen');

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tink-seen-')), 'firstseen.json');

test('the first scan gives every game the baseline, later scans stamp new games with the time', () => {
  const f = file();
  assert.deepStrictEqual(updateFirstSeen(f, ['a', 'b'], 100), { a: 0, b: 0 });
  assert.deepStrictEqual(updateFirstSeen(f, ['a', 'b', 'c'], 200), { a: 0, b: 0, c: 200 });
  assert.deepStrictEqual(updateFirstSeen(f, ['a', 'b', 'c', 'd'], 300), { a: 0, b: 0, c: 200, d: 300 });
});

test('an empty first scan still counts as the baseline run', () => {
  const f = file();
  updateFirstSeen(f, [], 100);
  assert.deepStrictEqual(updateFirstSeen(f, ['a'], 200), { a: 200 });
});

test('a game that goes missing and comes back keeps its time', () => {
  const f = file();
  updateFirstSeen(f, ['a'], 100);
  updateFirstSeen(f, ['a', 'b'], 200);
  updateFirstSeen(f, ['a'], 300);
  assert.deepStrictEqual(updateFirstSeen(f, ['a', 'b'], 400), { a: 0, b: 200 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 0, b: 200 });
});

test('an unreadable file is treated like a first run instead of making everything new', () => {
  const f = file();
  fs.writeFileSync(f, 'not json');
  assert.deepStrictEqual(updateFirstSeen(f, ['a'], 500), { a: 0 });
});

test('a whole folder added at once does not count as new', () => {
  const f = file();
  updateFirstSeen(f, ['a'], 100);
  const folder = Array.from({ length: 20 }, (_, i) => `rom${i}`);
  assert.ok(Object.values(updateFirstSeen(f, ['a', ...folder], 200)).every((time) => time === 0));
});
