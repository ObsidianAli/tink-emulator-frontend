const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getSteamGames, artUrls } = require('../src/steam');

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
    ['ELDEN RING', 'Portal 2'],
  );
  assert.deepStrictEqual(games.map((g) => g.appId), ['1245620', '620']);
});

test('skips redistributables, Proton and runtimes', () => {
  const { root, main } = makeInstall();
  const titles = getSteamGames(main).map((g) => g.title);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(!titles.some((t) => /Redistributables|Proton|Runtime/.test(t)));
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
