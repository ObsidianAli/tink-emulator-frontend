const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { compareVersions, allowedUrl, createUpdater } = require('../src/update');

const ZIP = Buffer.alloc(100, 7);
const ASSET = 'https://github.com/ObsidianAli/tink-emulator-frontend/releases/download/v0.3.0/Tink.zip';

function fakeExtract(shape) {
  return async (_zip, dest) => {
    if (shape === 'fail') throw new Error('tar failed');
    fs.mkdirSync(path.join(dest, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'Tink.exe'), shape === 'notexe' ? 'hello' : 'MZ new');
    fs.writeFileSync(path.join(dest, 'resources', 'app.asar'), 'new asar');
  };
}

function spawner(launched, launchError) {
  return (command, args) => {
    launched.push([command, args]);
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => (launchError ? child.emit('error', launchError) : child.emit('spawn')));
    return child;
  };
}

function setup({ version = '0.2.0', release, shape, launchError = null, size = ZIP.length } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-update-'));
  const appDir = path.join(root, 'Tink');
  const dataDir = path.join(appDir, 'data');
  fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true });
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(appDir, 'Tink.exe'), 'MZ current');
  fs.writeFileSync(path.join(appDir, 'resources', 'app.asar'), 'current asar');
  fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"keep":true}');
  const lines = [];
  const launched = [];
  const make = (extra = {}) => createUpdater({
    appDir,
    dataDir,
    version,
    log: (message) => lines.push(message),
    getJson: async () => {
      if (release instanceof Error) throw release;
      return release || { tag_name: 'v0.3.0', assets: [{ name: 'Tink.zip', size, browser_download_url: ASSET }] };
    },
    getFile: async (_url, dest) => fs.writeFileSync(dest, ZIP),
    extract: fakeExtract(shape),
    launch: spawner(launched, launchError),
    pause: async () => {},
    ...extra,
  });
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  return { root, appDir, dataDir, updater: make(), make, lines, launched, read, exists: (name) => fs.existsSync(path.join(root, name)) };
}

test('versions compare as numbers, not text', () => {
  assert.ok(compareVersions('v0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('0.1.2', '0.1.10') < 0);
  assert.ok(compareVersions('v1.0.0', '0.99.99') > 0);
  assert.strictEqual(compareVersions('v0.3.0', '0.3.0'), 0);
  assert.strictEqual(compareVersions('nightly', '0.3.0'), null);
  assert.strictEqual(compareVersions('v0.3.0-beta', '0.3.0'), null);
});

test('only GitHub over https is allowed, and a local server only in loopback mode', () => {
  assert.ok(allowedUrl(ASSET, false));
  assert.ok(allowedUrl('https://release-assets.githubusercontent.com/x', false));
  assert.ok(!allowedUrl('http://github.com/x', false));
  assert.ok(!allowedUrl('https://evil.example.com/Tink.zip', false));
  assert.ok(!allowedUrl('https://githubusercontent.com.evil.com/x', false));
  assert.ok(!allowedUrl('http://127.0.0.1:9/x', false));
  assert.ok(allowedUrl('http://127.0.0.1:9/x', true));
  assert.ok(!allowedUrl('http://localhost:9/x', true));
  assert.ok(!allowedUrl('https://github.com/x', true));
});

test('a newer release is unpacked beside the app folder and the running one is left alone', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
  assert.strictEqual(t.read('Tink.new/Tink.exe'), 'MZ new');
  assert.ok(!t.exists('Tink.zip'));
  assert.strictEqual(t.read('Tink/data/update-pending.txt'), '0.3.0');
});

test('nothing is downloaded when the release is the same, older, or odd', async () => {
  for (const tag of ['v0.2.0', 'v0.1.9', 'latest']) {
    const t = setup({ release: { tag_name: tag, assets: [] } });
    await t.updater.checkInBackground();
    assert.ok(!t.exists('Tink.new'), tag);
  }
});

test('offline, rate limited and missing assets fail quietly and are logged', async () => {
  const cases = [
    new Error('getaddrinfo ENOTFOUND'),
    new Error('GitHub answered 403'),
    { tag_name: 'v0.3.0', assets: [] },
    { tag_name: 'v0.3.0', assets: [{ name: 'Tink.zip', size: 100, browser_download_url: 'https://evil.example.com/Tink.zip' }] },
  ];
  for (const value of cases) {
    const t = setup({ release: value });
    await t.updater.checkInBackground();
    assert.ok(!t.exists('Tink.new'));
    assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
    assert.ok(t.lines.length > 0);
  }
});

test('a download of the wrong size, a failed unzip, or a zip that is not Tink is thrown away', async () => {
  const cases = [{ size: ZIP.length + 1 }, { shape: 'fail' }, { shape: 'notexe' }];
  for (const options of cases) {
    const t = setup(options);
    await t.updater.checkInBackground();
    assert.ok(!t.exists('Tink.new') && !t.exists('Tink.zip'));
    assert.ok(t.lines.some((line) => line.includes('failed')));
  }
});

test('the real tar.exe unpacks a zip', { skip: process.platform !== 'win32' }, async () => {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-tar-'));
  fs.mkdirSync(path.join(root, 'Tink', 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Tink', 'Tink.exe'), 'MZ x');
  fs.writeFileSync(path.join(root, 'Tink', 'resources', 'app.asar'), 'x');
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-cf', path.join(root, 'Tink.zip'), '-C', root, 'Tink']);
  const size = fs.statSync(path.join(root, 'Tink.zip')).size;
  const t = setup({ size });
  const real = t.make({ extract: undefined, getFile: async (_url, dest) => fs.copyFileSync(path.join(root, 'Tink.zip'), dest) });
  await real.checkInBackground();
  assert.strictEqual(t.read('Tink.new/Tink.exe'), 'MZ x');
});

function finisher(t, { launchError = null, busyFor = 0 } = {}) {
  let busy = busyFor;
  const launched = [];
  const updater = t.make({
    launch: spawner(launched, launchError),
    pause: async () => { busy--; },
  });
  const realRename = fs.renameSync;
  const lock = () => {
    fs.renameSync = (from, to) => {
      if (busy > 0 && from === t.appDir) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return realRename(from, to);
    };
    return () => { fs.renameSync = realRename; };
  };
  return { updater, launched, lock };
}

test('Update starts the staged copy to finish the swap, and nothing is changed yet', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  assert.strictEqual(await t.updater.applyPending(), true);
  assert.deepStrictEqual(t.launched, [[path.join(t.root, 'Tink.new', 'Tink.exe'), ['--finish-update']]]);
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
});

test('starting again keeps a download that is still newer', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  t.updater.removeOld();
  assert.ok(t.exists('Tink.new') && t.exists('Tink/data/update-pending.txt'));
});

test('a waiting update is reported only while it is newer', async () => {
  const t = setup();
  assert.strictEqual(t.updater.pendingVersion(), null);
  await t.updater.checkInBackground();
  assert.strictEqual(t.updater.pendingVersion(), '0.3.0');
  assert.strictEqual(t.make({ version: '0.3.0' }).pendingVersion(), null);
});

test('nothing is launched when there is no valid newer download', async () => {
  const none = setup();
  assert.strictEqual(await none.updater.applyPending(), false);
  const stale = setup({ version: '0.4.0' });
  fs.mkdirSync(path.join(stale.root, 'Tink.new'));
  fs.writeFileSync(path.join(stale.dataDir, 'update-pending.txt'), '0.3.0');
  assert.strictEqual(await stale.updater.applyPending(), false);
  assert.deepStrictEqual(stale.launched, []);
});

test('if the staged copy cannot be started, the app just carries on', async () => {
  const t = setup({ launchError: new Error('spawn EACCES') });
  await t.updater.checkInBackground();
  assert.strictEqual(await t.updater.applyPending(), false);
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
  assert.ok(t.lines.some((line) => line.includes('could not start')));
});

test('the staged copy waits for the folder to be free, swaps the files, keeps data, and relaunches', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  const h = finisher(t, { busyFor: 3 });
  const unlock = h.lock();
  try {
    assert.strictEqual(await h.updater.finishUpdate(), true);
  } finally {
    unlock();
  }
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ new');
  assert.strictEqual(t.read('Tink/resources/app.asar'), 'new asar');
  assert.strictEqual(t.read('Tink.old/Tink.exe'), 'MZ current');
  assert.strictEqual(t.read('Tink/data/settings.json'), '{"keep":true}');
  assert.deepStrictEqual(h.launched, [[path.join(t.appDir, 'Tink.exe'), []]]);
});

test('the new version cleans up the leftovers and shows the notice once', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  await finisher(t).updater.finishUpdate();
  const next = t.make({ version: '0.3.0' });
  assert.strictEqual(await next.applyPending(), false);
  next.removeOld();
  assert.ok(!t.exists('Tink.old') && !t.exists('Tink.new') && !t.exists('Tink/data/update-pending.txt'));
  assert.strictEqual(next.takeNotice(), 'Updated to 0.3.0');
  assert.strictEqual(next.takeNotice(), null);
  assert.strictEqual(t.read('Tink/data/settings.json'), '{"keep":true}');
});

test('if the new Tink will not start, the old folder and its data are put back', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  const h = finisher(t, { launchError: new Error('spawn EACCES') });
  assert.strictEqual(await h.updater.finishUpdate(), false);
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
  assert.strictEqual(t.read('Tink/data/settings.json'), '{"keep":true}');
  assert.ok(!t.exists('Tink.old') && !t.exists('Tink/data/update-done.txt'));
  assert.ok(t.lines.some((line) => line.includes('going back')));
});

test('if the copy fails, the old folder is put back', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  const h = finisher(t);
  const realCopy = fs.cpSync;
  fs.cpSync = () => { throw new Error('ENOSPC'); };
  try {
    assert.strictEqual(await h.updater.finishUpdate(), false);
  } finally {
    fs.cpSync = realCopy;
  }
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
  assert.strictEqual(t.read('Tink/data/settings.json'), '{"keep":true}');
  assert.ok(!t.exists('Tink.old'));
  assert.deepStrictEqual(h.launched, []);
});

test('if the folder never lets go, nothing is changed', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  const h = finisher(t, { busyFor: 1e9 });
  const unlock = h.lock();
  try {
    assert.strictEqual(await h.updater.finishUpdate(), false);
  } finally {
    unlock();
  }
  assert.strictEqual(t.read('Tink/Tink.exe'), 'MZ current');
  assert.deepStrictEqual(h.launched, []);
});

test('a leftover download that is not newer than the running version is discarded', async () => {
  const t = setup({ version: '0.4.0' });
  fs.mkdirSync(path.join(t.root, 'Tink.new'));
  fs.writeFileSync(path.join(t.dataDir, 'update-pending.txt'), '0.3.0');
  assert.strictEqual(await t.updater.applyPending(), false);
  t.updater.removeOld();
  assert.ok(!t.exists('Tink.new'));
});

test('a download that is already waiting is not fetched twice', async () => {
  const t = setup();
  await t.updater.checkInBackground();
  fs.writeFileSync(path.join(t.root, 'Tink.new', 'marker'), 'marker');
  await t.updater.checkInBackground();
  assert.strictEqual(t.read('Tink.new/marker'), 'marker');
});
