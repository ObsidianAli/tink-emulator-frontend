const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getSteamGames, artUrls, parseVdf, gameProcesses, closeSteamGame } = require('../src/steam');

// Copy the fixture install to a temp folder and point its library list at the copies,
// writing paths the way Steam does (backslashes doubled).
function makeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-steam-'));
  const main = path.join(root, 'steam');
  const second = path.join(root, 'steam-second');
  fs.cpSync(path.join(__dirname, 'fixtures', 'steam'), main, { recursive: true });
  fs.cpSync(path.join(__dirname, 'fixtures', 'steam-second'), second, { recursive: true });
  const vdfPath = path.join(main, 'steamapps', 'libraryfolders.vdf');
  const escape = (p) => p.replaceAll('\\', '\\\\');
  const vdf = fs.readFileSync(vdfPath, 'utf8')
    .replace('@ROOT@', escape(main))
    .replace('@SECOND@', escape(second));
  fs.writeFileSync(vdfPath, vdf);
  return { root, main };
}

test('lists games from every library folder', () => {
  const { root, main } = makeInstall();
  const games = getSteamGames(main);
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepStrictEqual(
    games.map((g) => g.title),
    ['ELDEN RING', 'Portal 2', 'Proton Fan Game'],
  );
  assert.deepStrictEqual(games.map((g) => g.appId), ['1245620', '620', '999002']);
});

test('skips redistributables, Proton and runtimes', () => {
  const { root, main } = makeInstall();
  const titles = getSteamGames(main).map((g) => g.title);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(!titles.some((t) => /Redistributables|Proton Experimental|Runtime/.test(t)));
});

test('a missing Steam folder gives no games', () => {
  assert.deepStrictEqual(getSteamGames(path.join(os.tmpdir(), 'no-such-steam')), []);
});

test('art is the library image with the header image as fallback', () => {
  const art = artUrls('620');
  assert.match(art.cover, /\/apps\/620\/library_600x900\.jpg$/);
  assert.match(art.fallback, /\/apps\/620\/header\.jpg$/);
  assert.ok(art.cover.startsWith('https://'));
});

test('each game carries its art', () => {
  const { root, main } = makeInstall();
  const [first] = getSteamGames(main);
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepStrictEqual(first.art, artUrls(first.appId));
});

test('games that are still downloading are not listed', () => {
  const { root, main } = makeInstall();
  const titles = getSteamGames(main).map((g) => g.title);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(!titles.includes('Still Downloading'));
});

test('a real game with "Proton" in its name is kept', () => {
  const { root, main } = makeInstall();
  const titles = getSteamGames(main).map((g) => g.title);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(titles.includes('Proton Fan Game'));
});

test('library folders written in the older Steam format are found', () => {
  const { root, main } = makeInstall();
  const second = path.join(root, 'steam-second').replaceAll('\\', '\\\\');
  const oldVdf = ['"LibraryFolders"', '{', '\t"TimeNextStatsReport"\t"1"', `\t"1"\t"${second}"`, '}'].join('\n');
  fs.writeFileSync(path.join(main, 'steamapps', 'libraryfolders.vdf'), oldVdf);
  const titles = getSteamGames(main).map((g) => g.title);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(titles.includes('ELDEN RING'));
});

test('the Steam text format parses nested values and escaped backslashes', () => {
  const text = ['"a"', '{', '\t"b"\t"c\\\\d"', '\t"e"', '\t{', '\t\t"f"\t"g"', '\t}', '}'].join('\n');
  assert.deepStrictEqual(parseVdf(text), { a: { b: 'c\\d', e: { f: 'g' } } });
});


const GAME_DIR = path.join('D:', 'SteamLibrary', 'steamapps', 'common', 'Portal 2');
const at = (...parts) => path.join(GAME_DIR, ...parts);
const STEAM_EXE = path.join('C:', 'Steam', 'steam.exe');

test('a game is found in the library it lives in', () => {
  const { root, main } = makeInstall();
  const games = getSteamGames(main);
  fs.rmSync(root, { recursive: true, force: true });
  assert.strictEqual(games.find((g) => g.appId === '620').installDir, path.join(main, 'steamapps', 'common', 'x'));
  assert.ok(games.find((g) => g.appId === '1245620').installDir.includes('steam-second'));
});

test('only processes inside the game folder match, and never steam.exe', () => {
  const processes = [
    { pid: 1, exe: at('portal2.exe') },
    { pid: 2, exe: at('bin', 'helper.exe') },
    { pid: 3, exe: at('BIN', 'Other.exe').toLowerCase() },
    { pid: 4, exe: `${GAME_DIR} Extra${path.sep}other.exe` },
    { pid: 5, exe: STEAM_EXE },
    { pid: 6, exe: at('steam.exe') },
    { pid: 7, exe: null },
    { pid: 8, exe: path.join('C:', 'Windows', 'explorer.exe') },
  ];
  assert.deepStrictEqual(gameProcesses(processes, GAME_DIR), [1, 2, 3]);
  assert.deepStrictEqual(gameProcesses(processes, null), []);
});

test('closing a Steam game asks politely, then forces what is left after the wait', async () => {
  const calls = [];
  let round = 0;
  const lists = [
    [{ pid: 1, exe: at('portal2.exe') }, { pid: 2, exe: at('crash.exe') }, { pid: 9, exe: STEAM_EXE }],
    [{ pid: 2, exe: at('crash.exe') }, { pid: 9, exe: STEAM_EXE }],
  ];
  await closeSteamGame(GAME_DIR, {
    list: async () => lists[round++],
    kill: async (args) => calls.push(args),
    wait: async (ms) => calls.push(['wait', ms]),
  });
  assert.deepStrictEqual(calls, [['/PID', '1'], ['/PID', '2'], ['wait', 5000], ['/PID', '2', '/T', '/F']]);
});

test('closing does nothing when no process of the game is running', async () => {
  const calls = [];
  await closeSteamGame(GAME_DIR, { list: async () => [{ pid: 9, exe: STEAM_EXE }], kill: async (a) => calls.push(a), wait: async () => calls.push('wait') });
  assert.deepStrictEqual(calls, []);
});
