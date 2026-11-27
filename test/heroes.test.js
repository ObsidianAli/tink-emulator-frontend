const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHeroes, pickHeroes } = require('../src/heroes');
const { artUrls } = require('../src/steam');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const SRC = `data:image/png;base64,${PNG.toString('base64')}`;
const GRID = 'https://www.steamgriddb.com/api/v2';
const portal = { console: 'steam', title: 'Portal', fileName: '400', art: artUrls('400') };
const astro = { console: 'ps5', title: 'Astro Bot', fileName: 'Astro Bot' };
const json = (data) => new Response(JSON.stringify({ success: true, data }));
const gridRoutes = {
  [`${GRID}/search/autocomplete/Astro%20Bot`]: json([{ id: 7, name: 'Astro Bot' }]),
  [`${GRID}/heroes/game/7?types=static`]: json([
    { url: 'https://cdn2.steamgriddb.com/hero/huge.png', width: 3840, height: 1240 },
    { url: 'https://cdn2.steamgriddb.com/hero/full.png', width: 1920, height: 620 },
  ]),
  'https://cdn2.steamgriddb.com/hero/full.png': PNG,
};

function fakeNet(routes) {
  const requests = [];
  const fetch = async (url, opts) => {
    requests.push([url, opts]);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route instanceof Response) return route.clone();
    return route ? new Response(route) : new Response('nope', { status: 404 });
  };
  return { fetch, requests, urls: () => requests.map(([url]) => url) };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-heroes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a Steam game uses Steam's hero, kept on disk", async (t) => {
  const dir = tempDir(t);
  const net = fakeNet({ [portal.art.hero]: PNG });
  const options = { dir, enabled: true, steamGridKey: 'k' };
  assert.deepStrictEqual(await createHeroes({ ...options, fetch: net.fetch }).getHero(portal), { src: SRC });
  assert.deepStrictEqual(net.urls(), [portal.art.hero]);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'steam')), ['400.png']);

  const offline = fakeNet({});
  assert.deepStrictEqual(await createHeroes({ ...options, fetch: offline.fetch }).getHero(portal), { src: SRC });
  assert.deepStrictEqual(offline.urls(), []);
});

test('a Steam game without a hero falls back to SteamGridDB', async (t) => {
  const fresh = { ...portal, title: 'Astro Bot' };
  const net = fakeNet(gridRoutes);
  const heroes = createHeroes({ dir: tempDir(t), enabled: true, steamGridKey: 'k', fetch: net.fetch });
  assert.deepStrictEqual(await heroes.getHero(fresh), { src: SRC });
  assert.deepStrictEqual(net.urls(), [fresh.art.hero, ...Object.keys(gridRoutes)]);
});

test('other games are searched on SteamGridDB, and the key goes nowhere else', async (t) => {
  const net = fakeNet(gridRoutes);
  const heroes = createHeroes({ dir: tempDir(t), enabled: true, steamGridKey: 'secret', fetch: net.fetch });
  assert.deepStrictEqual(await heroes.getHero(astro), { src: SRC });
  assert.deepStrictEqual(net.urls(), Object.keys(gridRoutes));
  for (const [url, { headers }] of net.requests) {
    assert.strictEqual(headers && headers.Authorization, url.startsWith(GRID) ? 'Bearer secret' : undefined);
  }
});

test('nothing goes online without a key or with covers off', async (t) => {
  const net = fakeNet({ ...gridRoutes, [portal.art.hero]: PNG });
  const dir = tempDir(t);
  assert.strictEqual(await createHeroes({ dir, enabled: true, steamGridKey: '', fetch: net.fetch }).getHero(astro), null);
  const off = createHeroes({ dir, enabled: false, steamGridKey: 'k', fetch: net.fetch });
  assert.strictEqual(await off.getHero(astro), null);
  assert.strictEqual(await off.getHero(portal), null);
  assert.deepStrictEqual(net.urls(), []);
});

test('a missing hero is remembered until re-download, a failed connection is not', async (t) => {
  const dir = tempDir(t);
  const options = { dir, enabled: true, steamGridKey: '' };
  const offline = fakeNet({ [portal.art.hero]: new TypeError('fetch failed') });
  assert.strictEqual(await createHeroes({ ...options, fetch: offline.fetch }).getHero(portal), null);

  const missing = fakeNet({});
  assert.strictEqual(await createHeroes({ ...options, fetch: missing.fetch }).getHero(portal), null);
  const later = fakeNet({ [portal.art.hero]: PNG });
  const heroes = createHeroes({ ...options, fetch: later.fetch });
  assert.strictEqual(await heroes.getHero(portal), null);
  assert.deepStrictEqual(later.urls(), []);
  await heroes.redownload();
  assert.deepStrictEqual(await heroes.getHero(portal), { src: SRC });
});

test('the hero must be an image over https', async (t) => {
  const dir = tempDir(t);
  const html = fakeNet({ [portal.art.hero]: new Response('<html></html>') });
  assert.strictEqual(await createHeroes({ dir, enabled: true, fetch: html.fetch }).getHero(portal), null);
  const plain = { ...portal, fileName: '401', art: { hero: 'http://example.com/hero.png' } };
  const net = fakeNet({ [plain.art.hero]: PNG });
  assert.strictEqual(await createHeroes({ dir, enabled: true, fetch: net.fetch }).getHero(plain), null);
  assert.deepStrictEqual(net.urls(), []);
});

test('full HD comes first, then smaller, then 4K, and only wide pictures count', () => {
  const hero = (url, width, height) => ({ url, width, height });
  assert.deepStrictEqual(pickHeroes([
    hero('4k', 3840, 1240),
    hero('tall', 1920, 1920),
    hero('small', 1600, 650),
    hero('full', 1920, 620),
    null,
  ]), ['full', 'small', '4k']);
});
