const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getSteamGames, artUrls, parseVdf } = require('../src/steam');

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

