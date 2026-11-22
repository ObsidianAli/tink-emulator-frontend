const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { compareVersions, allowedUrl, createUpdater } = require('../src/update');

const GOOD = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(98, 1)]);
const ASSET = 'https://github.com/ObsidianAli/tink-emulator-frontend/releases/download/v0.2.0/Tink.exe';

function setup({ version = '0.1.0', release, file = GOOD, launchError = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-update-'));
  const exe = path.join(root, 'Tink.exe');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(exe, 'current');
  fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"keep":true}');
  const lines = [];
  const launched = [];
  const updater = createUpdater({
    exe,
    dataDir,
    version,
    log: (message) => lines.push(message),
    getJson: async () => {
      if (release instanceof Error) throw release;
      return release;
    },
    getFile: async (_url, dest) => fs.writeFileSync(dest, file),
    launch: (command) => {
      launched.push(command);
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => (launchError ? child.emit('error', launchError) : child.emit('spawn')));
      return child;
    },
  });
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  return { root, exe, dataDir, updater, lines, launched, read, exists: (name) => fs.existsSync(path.join(root, name)) };
}

const release = (tag = 'v0.2.0', size = GOOD.length, url = ASSET) => ({
  tag_name: tag,
  assets: [{ name: 'Tink.exe', size, browser_download_url: url }],
});

test('versions compare as numbers, not text', () => {
  assert.ok(compareVersions('v0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('0.1.2', '0.1.10') < 0);
  assert.ok(compareVersions('v1.0.0', '0.99.99') > 0);
  assert.strictEqual(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.strictEqual(compareVersions('nightly', '0.2.0'), null);
  assert.strictEqual(compareVersions('v0.2.0-beta', '0.2.0'), null);
});

test('only GitHub over https is allowed, and a local server only in loopback mode', () => {
  assert.ok(allowedUrl(ASSET, false));
  assert.ok(allowedUrl('https://release-assets.githubusercontent.com/x', false));
  assert.ok(!allowedUrl('http://github.com/x', false));
  assert.ok(!allowedUrl('https://evil.example.com/Tink.exe', false));
  assert.ok(!allowedUrl('https://githubusercontent.com.evil.com/x', false));
  assert.ok(!allowedUrl('http://127.0.0.1:9/x', false));
  assert.ok(allowedUrl('http://127.0.0.1:9/x', true));
  assert.ok(!allowedUrl('http://localhost:9/x', true));
  assert.ok(!allowedUrl('https://github.com/x', true));
});

test('a newer release is downloaded as Tink.exe.new and the running exe is left alone', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  assert.strictEqual(t.read('Tink.exe'), 'current');
  assert.ok(Buffer.from(fs.readFileSync(path.join(t.root, 'Tink.exe.new'))).equals(GOOD));
  assert.ok(!t.exists('Tink.exe.download'));
  assert.strictEqual(t.read('data/update-pending.txt'), '0.2.0');
});

test('nothing is downloaded when the release is the same, older, or odd', async () => {
  for (const tag of ['v0.1.0', 'v0.0.9', 'latest']) {
    const t = setup({ release: release(tag) });
    await t.updater.checkInBackground();
    assert.ok(!t.exists('Tink.exe.new'), tag);
  }
});

test('offline, rate limited and missing assets fail quietly and are logged', async () => {
  const cases = [
    new Error('getaddrinfo ENOTFOUND'),
    new Error('GitHub answered 403'),
    { tag_name: 'v0.2.0', assets: [] },
    release('v0.2.0', GOOD.length, 'https://evil.example.com/Tink.exe'),
  ];
  for (const value of cases) {
    const t = setup({ release: value });
    await t.updater.checkInBackground();
    assert.ok(!t.exists('Tink.exe.new'));
    assert.strictEqual(t.read('Tink.exe'), 'current');
    assert.ok(t.lines.length > 0);
  }
});

test('a download of the wrong size or without MZ is thrown away', async () => {
  const wrongSize = setup({ release: release('v0.2.0', GOOD.length + 1) });
  await wrongSize.updater.checkInBackground();
  assert.ok(!wrongSize.exists('Tink.exe.new') && !wrongSize.exists('Tink.exe.download'));
  const notExe = setup({ release: release(), file: Buffer.alloc(GOOD.length, 65) });
  await notExe.updater.checkInBackground();
  assert.ok(!notExe.exists('Tink.exe.new') && !notExe.exists('Tink.exe.download'));
  assert.ok(notExe.lines.some((line) => line.includes('failed')));
});

// What the downloaded exe sees when it starts as Tink.exe.new: the same folder, at the new version.
function helper(t, { launchError = null, busyFor = 0 } = {}) {
  let busy = busyFor;
  const launched = [];
  const updater = createUpdater({
    exe: t.exe,
    dataDir: t.dataDir,
    version: '0.2.0',
    log: (message) => t.lines.push(message),
    pause: async () => { busy--; },
    launch: (command, args) => {
      launched.push([command, args]);
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => (launchError ? child.emit('error', launchError) : child.emit('spawn')));
      return child;
    },
  });
  const realRename = fs.renameSync;
  const lock = () => {
    fs.renameSync = (from, to) => {
      if (busy > 0 && from === t.exe) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return realRename(from, to);
    };
    return () => { fs.renameSync = realRename; };
  };
  return { updater, launched, lock };
}

test('on start the downloaded exe is launched to finish the swap, and nothing is changed yet', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  assert.strictEqual(await t.updater.applyPending(), true);
  assert.deepStrictEqual(t.launched, [path.join(t.root, 'Tink.exe.new')]);
  assert.strictEqual(t.read('Tink.exe'), 'current');
});

test('starting again keeps a download that is still newer', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  t.updater.removeOld();
  assert.ok(t.exists('Tink.exe.new') && t.exists('data/update-pending.txt'));
});

test('a waiting update is reported only while it is newer', async () => {
  const t = setup({ release: release() });
  assert.strictEqual(t.updater.pendingVersion(), null);
  await t.updater.checkInBackground();
  assert.strictEqual(t.updater.pendingVersion(), '0.2.0');
  const same = createUpdater({ exe: t.exe, dataDir: t.dataDir, version: '0.2.0', log: () => {} });
  assert.strictEqual(same.pendingVersion(), null);
});

test('nothing is launched when there is no valid newer download', async () => {
  const none = setup({ release: release() });
  assert.strictEqual(await none.updater.applyPending(), false);
  const stale = setup({ version: '0.3.0', release: release() });
  fs.writeFileSync(path.join(stale.root, 'Tink.exe.new'), GOOD);
  fs.writeFileSync(path.join(stale.dataDir, 'update-pending.txt'), '0.2.0');
  assert.strictEqual(await stale.updater.applyPending(), false);
  assert.deepStrictEqual(stale.launched, []);
});

test('if the downloaded exe cannot be started, the app just carries on', async () => {
  const t = setup({ release: release(), launchError: new Error('spawn EACCES') });
  await t.updater.checkInBackground();
  assert.strictEqual(await t.updater.applyPending(), false);
  assert.strictEqual(t.read('Tink.exe'), 'current');
  assert.ok(t.lines.some((line) => line.includes('could not start')));
});

test('the downloaded exe waits for Tink.exe to be free, swaps it, and relaunches it', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  const h = helper(t, { busyFor: 3 });
  const unlock = h.lock();
  try {
    assert.strictEqual(await h.updater.finishUpdate(), true);
  } finally {
    unlock();
  }
  assert.ok(fs.readFileSync(t.exe).equals(GOOD));
  assert.strictEqual(t.read('Tink.exe.old'), 'current');
  assert.deepStrictEqual(h.launched, [[t.exe, []]]);
  assert.strictEqual(t.read('data/settings.json'), '{"keep":true}');
  assert.ok(!t.exists('Tink.exe.download'));
});

test('the new version cleans up the leftovers and shows the notice once', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  await helper(t).updater.finishUpdate();
  const next = createUpdater({ exe: t.exe, dataDir: t.dataDir, version: '0.2.0', log: () => {} });
  assert.strictEqual(await next.applyPending(), false);
  next.removeOld();
  assert.ok(!t.exists('Tink.exe.old') && !t.exists('Tink.exe.new') && !t.exists('data/update-pending.txt'));
  assert.strictEqual(next.takeNotice(), 'Updated to 0.2.0');
  assert.strictEqual(next.takeNotice(), null);
});

test('if the new exe will not start, the old one is put back', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  const h = helper(t, { launchError: new Error('spawn EACCES') });
  assert.strictEqual(await h.updater.finishUpdate(), false);
  assert.strictEqual(t.read('Tink.exe'), 'current');
  assert.ok(!t.exists('Tink.exe.old') && !t.exists('data/update-done.txt'));
  assert.ok(t.lines.some((line) => line.includes('going back')));
});

test('if the copy fails, the old exe is put back', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  const h = helper(t);
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = () => { throw new Error('ENOSPC'); };
  try {
    assert.strictEqual(await h.updater.finishUpdate(), false);
  } finally {
    fs.copyFileSync = realCopy;
  }
  assert.strictEqual(t.read('Tink.exe'), 'current');
  assert.ok(!t.exists('Tink.exe.old') && !t.exists('Tink.exe.download'));
  assert.deepStrictEqual(h.launched, []);
});

test('if Tink.exe never lets go, nothing is changed', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  const h = helper(t, { busyFor: 1e9 });
  const unlock = h.lock();
  try {
    assert.strictEqual(await h.updater.finishUpdate(), false);
  } finally {
    unlock();
  }
  assert.strictEqual(t.read('Tink.exe'), 'current');
  assert.deepStrictEqual(h.launched, []);
});

test('a leftover download that is not newer than the running version is discarded', async () => {
  const t = setup({ version: '0.3.0', release: release() });
  fs.writeFileSync(path.join(t.root, 'Tink.exe.new'), GOOD);
  fs.writeFileSync(path.join(t.dataDir, 'update-pending.txt'), '0.2.0');
  assert.strictEqual(await t.updater.applyPending(), false);
  t.updater.removeOld();
  assert.ok(!t.exists('Tink.exe.new'));
  assert.strictEqual(t.read('Tink.exe'), 'current');
});

test('a download that is already waiting is not fetched twice', async () => {
  const t = setup({ release: release() });
  await t.updater.checkInBackground();
  fs.writeFileSync(path.join(t.root, 'Tink.exe.new'), 'marker');
  await t.updater.checkInBackground();
  assert.strictEqual(t.read('Tink.exe.new'), 'marker');
});
