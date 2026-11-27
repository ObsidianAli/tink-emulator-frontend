const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDataDir, migrateOldData } = require('../src/paths');
const { createLog } = require('../src/log');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tink-data-'));

test('a packaged build keeps data beside the exe, whatever the override says', () => {
  const dir = resolveDataDir({ packaged: true, tinkDir: 'D:\\Tink', projectDir: 'C:\\src', override: 'C:\\other' });
  assert.strictEqual(dir, path.join('D:\\Tink', 'data'));
});

test('running from source keeps data in the project, or in the test override', () => {
  assert.strictEqual(resolveDataDir({ packaged: false, tinkDir: 'D:\\Tink', projectDir: 'C:\\src' }), path.join('C:\\src', 'data'));
  assert.strictEqual(
    resolveDataDir({ packaged: false, tinkDir: 'D:\\Tink', projectDir: 'C:\\src', override: 'C:\\tmp\\x' }),
    path.resolve('C:\\tmp\\x'),
  );
});

test('old settings and Covers move into the data folder once', () => {
  const root = temp();
  const oldDir = path.join(root, 'old');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(oldDir, 'covers', 'snes'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'settings.json'), '{"consoles":{}}');
  fs.writeFileSync(path.join(oldDir, 'covers', 'snes', 'a.png'), 'x');
  migrateOldData(data, oldDir);
  assert.strictEqual(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'), '{"consoles":{}}');
  assert.ok(fs.existsSync(path.join(data, 'covers', 'snes', 'a.png')));
  assert.ok(!fs.existsSync(path.join(oldDir, 'settings.json')));
});

test('settings already in the data folder are never replaced by old ones', () => {
  const root = temp();
  const oldDir = path.join(root, 'old');
  const data = path.join(root, 'data');
  fs.mkdirSync(oldDir);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(oldDir, 'settings.json'), 'old');
  fs.writeFileSync(path.join(data, 'settings.json'), 'new');
  migrateOldData(data, oldDir);
  assert.strictEqual(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'), 'new');
  assert.ok(fs.existsSync(path.join(oldDir, 'settings.json')));
});

test('with nothing to move, nothing is created', () => {
  const root = temp();
  migrateOldData(path.join(root, 'data'), path.join(root, 'old'));
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test('the log appends one timestamped line per entry, with details on the same line', () => {
  const file = path.join(temp(), 'data', 'tink.log');
  const log = createLog(file, { now: () => new Date('2026-01-02T03:04:05Z') });
  log('First');
  log('Second', new Error('boom'));
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0], '2026-01-02T03:04:05.000Z First');
  assert.match(lines[1], /^2026-01-02T03:04:05\.000Z Second \| Error: boom/);
});

test('the log rolls over to tink.log.old instead of growing forever', () => {
  const file = path.join(temp(), 'tink.log');
  const log = createLog(file, { maxBytes: 200 });
  for (let i = 0; i < 40; i++) log(`entry ${i}`);
  assert.ok(fs.statSync(file).size <= 200);
  assert.ok(fs.statSync(`${file}.old`).size <= 200);
  assert.match(fs.readFileSync(file, 'utf8'), /entry 39/);
  assert.strictEqual(fs.readdirSync(path.dirname(file)).length, 2);
});

test('logging never throws, even when the file can not be written', () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, 'tink.log'));
  assert.doesNotThrow(() => createLog(path.join(dir, 'tink.log'))('nope'));
});
