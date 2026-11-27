const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appInfo } = require('./binvdf');
const { parseVdf } = require('../src/steam');
const { progress } = require('../src/install');
const { createSteamInstall, isSafeFolderName, smallestSize, manifestText } = require('../src/steaminstall');

const GB = 1024 ** 3;
const OWNER = '76561197960266728';
const APPS = {
  620: {
    common: { name: 'Portal "2"', type: 'game', oslist: 'windows,macos', ReleaseState: 'released' },
    config: { installdir: 'Portal 2' },
    depots: { 621: { manifests: { public: { gid: '1', size: String(10 * GB), download: '5' } } } },
  },
  30: { common: { name: 'No Folder', type: 'game' }, config: {} },
  40: { common: { name: 'Escaper', type: 'game' }, config: { installdir: '..\\..\\evil' } },
  50: { common: { name: 'Mac Only', type: 'game', oslist: 'macos' }, config: { installdir: 'Mac Only' } },
  60: { common: { name: 'Later', type: 'game', ReleaseState: 'prerelease' }, config: { installdir: 'Later' } },
};

const escape = (p) => p.replaceAll('\\', '\\\\');

function makeSteam({ second = true, login = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-place-'));
  const dir = path.join(root, 'steam');
  const other = path.join(root, 'other');
  for (const folder of [path.join(dir, 'steamapps'), path.join(dir, 'appcache'), path.join(dir, 'config'), path.join(other, 'steamapps')]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(dir, 'steam.exe'), '');
  fs.writeFileSync(path.join(dir, 'appcache', 'appinfo.vdf'), appInfo(APPS));
  fs.writeFileSync(path.join(dir, 'config', 'loginusers.vdf'), `"users"\n{\n"${OWNER}"\n{\n"MostRecent"\t"1"\n${login}\n}\n}\n`);
  const folders = [dir, ...(second ? [other] : []), dir.toUpperCase(), path.join(root, 'unplugged')];
  const entries = folders.map((folder, i) => `"${i}"\n{\n"path"\t"${escape(folder)}"\n}\n`).join('');
  fs.writeFileSync(path.join(dir, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n${entries}}\n`);
  return { root, dir, other };
}

const manifest = (library, id = 620) => path.join(library, 'steamapps', `appmanifest_${id}.acf`);

const steamTakes = (file) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"TargetBuildID"\t\t"0"', '"TargetBuildID"\t\t"77"').replace('"BytesToDownload"\t\t"0"', '"BytesToDownload"\t\t"900"'));

function world(steam, { running = false, appId = 0, extra = [], closes = true, free = () => 500 * GB, onStart = () => {}, onTick = () => {}, inGame = () => false, startFails = false, list = null } = {}) {
  const state = { running, time: 0, calls: [], opened: [], logs: [] };
  const exe = path.join(steam.dir, 'steam.exe');
  const install = createSteamInstall({
    findSteamDir: async () => steam.dir,
    processes: async () => list || [{ pid: 1, exe: path.join(steam.root, 'explorer.exe') }, ...extra, ...(state.running ? [{ pid: 2, exe }] : [])],
    runningAppId: async () => appId,
    open: async (url) => state.opened.push(url),
    run: async (file, args) => {
      assert.strictEqual(file, exe);
      state.calls.push(args.join(' '));
      if (args[0] === '-shutdown') state.running = !closes;
      else if (startFails) throw new Error('blocked');
      else {
        state.running = true;
        onStart();
      }
    },
    freeSpace: async (folder) => free(folder),
    inGame,
    clock: { now: () => state.time, sleep: async (ms) => { state.time += ms; onTick(state); } },
    log: (message) => state.logs.push(message),
  });
  return Object.assign(state, { install });
}

function using(options, run) {
  return async () => {
    const steam = makeSteam(options);
    try {
      await run(steam);
    } finally {
      fs.rmSync(steam.root, { recursive: true, force: true });
    }
  };
}

const leftovers = (steam) => [steam.dir, steam.other].flatMap((folder) => fs.readdirSync(path.join(folder, 'steamapps'))).filter((name) => name !== 'libraryfolders.vdf');

test('drives lists each connected library once with its free space', using({}, async (steam) => {
  const w = world(steam, { free: (folder) => (folder === steam.dir ? 412.9 * GB : 3 * GB) });
  const drives = await w.install.drives('620');
  assert.deepStrictEqual(drives.map(({ id, fits }) => [id, fits]), [[steam.dir, true], [steam.other, false]]);
  assert.strictEqual(drives[0].label, `${steam.dir} 412 GB free`);
}));

test('a library alone on its drive is named by the drive letter', using({ second: false }, async (steam) => {
  const [drive] = await world(steam, { free: () => 96 * GB }).install.drives('620');
  assert.match(drive.label, /^[A-Z]: 96 GB free$/);
  const [unknown] = await world(steam, { free: () => null }).install.drives('620');
  assert.match(unknown.label, /^[A-Z]:$/);
  assert.strictEqual(unknown.fits, true);
}));

test('an install closes Steam, places the manifest and starts Steam again', using({}, async (steam) => {
  const file = manifest(steam.other);
  let written = '';
  const w = world(steam, { running: true, onStart: () => { written = fs.readFileSync(file, 'utf8'); }, onTick: (s) => { if (s.time === 5000) steamTakes(file); } });
  assert.strictEqual(await w.install.install('620', steam.other), 'placed');
  assert.deepStrictEqual(w.calls, ['-shutdown', '-silent']);
  assert.deepStrictEqual(w.opened, []);
  const { AppState } = parseVdf(written);
  assert.strictEqual(AppState.appid, '620');
  assert.strictEqual(AppState.StateFlags, '1026');
  assert.strictEqual(AppState.installdir, 'Portal 2');
  assert.strictEqual(AppState.name, 'Portal "2"');
  assert.strictEqual(AppState.LastOwner, OWNER);
  assert.deepStrictEqual(leftovers(steam), ['appmanifest_620.acf']);
  assert.ok(!w.logs.join().includes(OWNER));
}));

test('with Steam closed it is only started', using({ second: false }, async (steam) => {
  const w = world(steam, { appId: 400, onStart: () => steamTakes(manifest(steam.dir)) });
  assert.strictEqual(await w.install.install('620', steam.dir), 'placed');
  assert.deepStrictEqual(w.calls, ['-silent']);
}));

test('a placed manifest reads as queued', using({}, async (steam) => {
  fs.writeFileSync(manifest(steam.dir), manifestText({ appId: '620', name: 'a', installdir: 'a', owner: OWNER }));
  assert.deepStrictEqual(progress('620', steam.dir), { state: 'queued', percent: 0 });
}));

async function asksSteam(steam, options, { library = steam.other, id = '620', calls = [] } = {}) {
  const w = world(steam, options);
  assert.strictEqual(await w.install.install(id, library), 'asked');
  assert.deepStrictEqual(w.opened, [`steam://install/${Number(id)}`]);
  assert.deepStrictEqual(w.calls, calls);
  return w;
}

test('Steam is asked, and left open, when closing it would interrupt something', using({}, async (steam) => {
  await asksSteam(steam, { running: true, appId: 400 });
  await asksSteam(steam, { running: true, appId: null });
  await asksSteam(steam, { running: true, extra: [{ pid: 9, exe: path.join(steam.other, 'steamapps', 'common', 'Game', 'game.exe') }] });
  await asksSteam(steam, { list: [] });
  fs.writeFileSync(manifest(steam.dir, 70), '"AppState"\n{\n"appid"\t"70"\n"StateFlags"\t"1026"\n}\n');
  await asksSteam(steam, { running: true });
  assert.deepStrictEqual(await world(steam, { running: true }).install.drives('620'), []);
  assert.deepStrictEqual(leftovers(steam), ['appmanifest_70.acf']);
}));

test('Steam is asked when the game or library is not certain', using({}, async (steam) => {
  for (const id of ['30', '40', '50', '60', '999']) await asksSteam(steam, {}, { id });
  for (const library of [null, steam.root, `${steam.other}${path.sep}`, path.join(steam.root, 'unplugged')]) await asksSteam(steam, {}, { library });
  await asksSteam(steam, { free: () => 9 * GB });
  fs.writeFileSync(path.join(steam.dir, 'steamapps', 'libraryfolders.vdf'), 'broken');
  await asksSteam(steam, {}, { library: steam.dir });
  assert.deepStrictEqual(leftovers(steam), []);
}));

for (const login of ['"RememberPassword"\t"0"', '"AllowAutoLogin"\t"0"', '"WantsOfflineMode"\t"1"']) {
  test(`Steam is asked when it would not sign in by itself: ${login}`, using({ login }, async (steam) => {
    await asksSteam(steam, { running: true });
  }));
}

test('Steam is asked when it does not close', using({}, async (steam) => {
  const w = await asksSteam(steam, { running: true, closes: false }, { calls: ['-shutdown'] });
  assert.ok(w.time >= 30000);
  assert.deepStrictEqual(leftovers(steam), []);
}));

test('an existing manifest is never replaced', using({}, async (steam) => {
  fs.writeFileSync(manifest(steam.dir), 'theirs');
  await asksSteam(steam, {});
  fs.rmSync(manifest(steam.dir));
  await asksSteam(steam, { running: true, onTick: () => fs.writeFileSync(manifest(steam.other), 'theirs') }, { calls: ['-shutdown'] });
  assert.strictEqual(fs.readFileSync(manifest(steam.other), 'utf8'), 'theirs');
}));

test('nothing is left behind when Steam cannot be started or ignores the manifest', using({}, async (steam) => {
  await asksSteam(steam, { startFails: true }, { calls: ['-silent'] });
  const w = await asksSteam(steam, {}, { calls: ['-silent'] });
  assert.ok(w.time >= 180000);
  assert.deepStrictEqual(leftovers(steam), []);
}));

test('a manifest Steam has changed stays, even without a download', using({}, async (steam) => {
  const file = manifest(steam.other);
  await asksSteam(steam, { onStart: () => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"1026"', '"1538"')) }, { calls: ['-silent'] });
  assert.match(fs.readFileSync(file, 'utf8'), /"1538"/);
}));

test('a failed write leaves no manifest and Steam is asked', using({}, async (steam) => {
  fs.mkdirSync(path.join(steam.other, 'steamapps', 'tink_620.tmp', 'x'), { recursive: true });
  await asksSteam(steam, {});
  assert.ok(!fs.existsSync(manifest(steam.other)));
}));

test('Steam never comes up over a game', using({}, async (steam) => {
  let playing = false;
  const w = world(steam, { inGame: () => playing, onStart: () => { playing = true; } });
  assert.strictEqual(await w.install.install('620', steam.other), false);
  assert.deepStrictEqual(w.opened, []);
  assert.deepStrictEqual(leftovers(steam), []);
}));

test('installs run one at a time and a second one gets no drive choice meanwhile', using({}, async (steam) => {
  const w = world(steam, { onTick: (s) => { if (s.time === 2000) steamTakes(manifest(steam.other)); } });
  const first = w.install.install('620', steam.other);
  assert.deepStrictEqual(await w.install.drives('30'), []);
  const second = w.install.install('30', null);
  assert.deepStrictEqual(w.opened, []);
  assert.strictEqual(await first, 'placed');
  assert.strictEqual(await second, 'asked');
  await w.install.settled();
  assert.deepStrictEqual(w.opened, ['steam://install/30']);
}));

test('only plain numbers and plain folder names get through', async () => {
  const steam = { dir: 'x', root: 'x' };
  for (const bad of ['', 'abc', '620/../x', '-5', null, undefined]) assert.strictEqual(await world(steam).install.install(bad, 'x'), false);
  for (const good of ['Portal 2', 'Tom Clancy\'s Game', 'control', 'a.b', 'Nioh™']) assert.ok(isSafeFolderName(good), good);
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'C:', 'a"b', 'a\nb', 'a.', 'a ', ' a', 'CON', 'nul.txt', 'com1', 'a'.repeat(121), null, 5]) assert.ok(!isSafeFolderName(bad), String(bad));
});

test('the size only counts what every Windows install needs', () => {
  const depot = (size, rest = {}) => ({ manifests: { public: { size: String(size) } }, ...rest });
  assert.strictEqual(smallestSize({
    1: depot(10),
    2: depot(5, { config: { oslist: 'windows', osarch: '64' } }),
    3: depot(100, { config: { oslist: 'macos' } }),
    4: depot(100, { config: { language: 'german' } }),
    5: depot(100, { dlcappid: '9' }),
    6: depot(100, { config: { osarch: '32' } }),
    7: { manifests: { public: '123' } },
    branches: { public: { buildid: '1' } },
  }), 15);
  assert.strictEqual(smallestSize(undefined), 0);
});
