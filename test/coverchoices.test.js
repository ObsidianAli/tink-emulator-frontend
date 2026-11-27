const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCovers } = require('../src/covers');
const { openChoices } = require('../src/coverchoices');
const { artUrls } = require('../src/steam');

const GRID = 'https://www.steamgriddb.com/api/v2';
const CDN = 'https://cdn2.steamgriddb.com';
const SNES = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System/master/Named_Boxarts/';
const SIZE = '?dimensions=600x900&types=static';

const png = (name) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(name)]);
const json = (data) => new Response(JSON.stringify({ success: true, data }));
const grid = (name) => ({ url: `${CDN}/grid/${name}.png`, thumb: `${CDN}/thumb/${name}.png` });

function gridImages(names) {
  return Object.fromEntries(names.flatMap((name) => [[`${CDN}/grid/${name}.png`, png(name)], [`${CDN}/thumb/${name}.png`, png(`small ${name}`)]]));
}

function fakeNet(routes) {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, headers: options.headers, redirect: options.redirect });
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route instanceof Response) return route.clone();
    return route ? new Response(route) : new Response('nope', { status: 404 });
  };
  return { fetch, requests, urls: () => requests.map((request) => request.url) };
}

const doom = { console: 'pc', key: 'pc:aaaaaaaaaa', title: 'Doom', fileName: 'Doom' };
const doomRoutes = {
  [`${GRID}/search/autocomplete/Doom`]: json([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
  [`${GRID}/grids/game/1${SIZE}`]: json([grid('a'), grid('b')]),
  [`${GRID}/grids/game/2${SIZE}`]: json([grid('c'), grid('a')]),
  [`${GRID}/grids/game/3${SIZE}`]: json([grid('d')]),
  [`${GRID}/grids/game/4${SIZE}`]: json([grid('never')]),
  ...gridImages(['a', 'b', 'c', 'd', 'never']),
};
const portal = { console: 'steam', key: 'steam:400', title: 'Portal', fileName: '400', art: artUrls('400') };
const metroid = { console: 'snes', key: 'snes:Super Metroid (Japan, USA) (En,Ja).sfc', title: 'Super Metroid', fileName: 'Super Metroid (Japan, USA) (En,Ja)' };

function setup(t, { routes = {}, enabled = true, key = 'k' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-choices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const net = fakeNet(routes);
  const coversWith = (on = enabled) => createCovers({ dir: path.join(root, 'covers'), enabled: on, steamGridKey: key, fetch: net.fetch });
  const covers = coversWith();
  const open = (game) => openChoices({ game, covers, steamGridKey: key, fetch: net.fetch });
  return { root, net, covers, coversWith, open };
}

async function all(open) {
  let state = { count: 0, done: false };
  while (!state.done) state = await open.more(state.count);
  return state;
}

const nameOf = (shown) => (shown.plain ? 'plain' : Buffer.from(shown.src.split(',')[1], 'base64').subarray(8).toString());

async function names(open, whole = false) {
  const { count } = await all(open);
  return Promise.all(Array.from({ length: count }, async (_, index) => nameOf(await open.image(index, whole))));
}

async function shownFor(covers, game) {
  const cover = await covers.getCover(game);
  return cover.plain ? 'plain' : fs.readFileSync(cover.file).subarray(8).toString();
}

test('a search offers the first three matches, small images first, without repeating the current cover', async (t) => {
  const { covers, net, open } = setup(t, { routes: doomRoutes });
  assert.strictEqual(await shownFor(covers, doom), 'a');
  const choices = open(doom);
  assert.deepStrictEqual(await names(choices), ['a', 'small b', 'small c', 'small d']);
  assert.deepStrictEqual(await names(choices, true), ['a', 'b', 'c', 'd']);
  assert.ok(!net.urls().some((url) => url.includes('never')));
});

test('a first match with many covers leaves room for the others, and the list stays short', async (t) => {
  const many = Array.from({ length: 40 }, (_, index) => `m${index}`);
  const { open } = setup(t, {
    enabled: false,
    routes: {
      ...doomRoutes,
      [`${GRID}/grids/game/1${SIZE}`]: json(many.map(grid)),
      ...gridImages(many),
    },
  });
  const list = await names(open(doom), true);
  assert.strictEqual(list.length, 24);
  for (const name of ['c', 'd']) assert.ok(list.includes(name), name);
  assert.strictEqual(new Set(list).size, 24);
});

test("a Steam game offers Steam's own art, then SteamGridDB by app id", async (t) => {
  const { open } = setup(t, {
    enabled: false,
    routes: {
      [portal.art.cover]: png('tall'),
      [portal.art.fallback]: png('header'),
      [`${GRID}/grids/steam/400${SIZE}`]: json([grid('a'), grid('b')]),
      ...gridImages(['a', 'b']),
    },
  });
  assert.deepStrictEqual(await names(open(portal), true), ['plain', 'tall', 'header', 'a', 'b']);
});

test('an emulated game offers libretro box art for its name and the other regions, then SteamGridDB', async (t) => {
  const { covers, open } = setup(t, {
    routes: {
      [`${SNES}Super%20Metroid%20(Japan%2C%20USA).png`]: png('both'),
      [`${SNES}Super%20Metroid%20(Europe).png`]: png('europe'),
      [`${SNES}Super%20Metroid%20(Japan).png`]: png('both'),
      [`${GRID}/search/autocomplete/Super%20Metroid`]: json([{ id: 9 }]),
      [`${GRID}/grids/game/9${SIZE}`]: json([grid('a')]),
      ...gridImages(['a']),
    },
  });
  await covers.getCover(metroid);
  assert.deepStrictEqual(await names(open(metroid), true), ['both', 'europe', 'a']);
});

test('a picked cover survives a restart, a new download and covers being off', async (t) => {
  const { covers, coversWith, open } = setup(t, { routes: doomRoutes });
  const choices = open(doom);
  await all(choices);
  assert.strictEqual(await choices.use(2), true);
  assert.strictEqual(await shownFor(covers, doom), 'c');
  assert.strictEqual(await shownFor(covers, { ...doom, key: 'pc:bbbbbbbbbb' }), 'a', 'another game of the same name keeps its own');
  await covers.redownload();
  assert.strictEqual(await shownFor(covers, doom), 'c');
  assert.strictEqual(await shownFor(coversWith(false), doom), 'c');
});

test('after a pick the default comes right after the current cover, and picking it removes the pick', async (t) => {
  const { root, covers, open } = setup(t, { routes: doomRoutes });
  await covers.getCover(doom);
  const first = open(doom);
  await all(first);
  await first.use(2);

  const second = open(doom);
  assert.deepStrictEqual(await names(second, true), ['c', 'a', 'b', 'd']);
  assert.strictEqual(await second.use(3), true, 'one pick replaces another');
  assert.deepStrictEqual(await names(open(doom), true), ['d', 'a', 'b', 'c']);

  const third = open(doom);
  await all(third);
  assert.strictEqual(await third.use(1), true);
  assert.strictEqual(await shownFor(covers, doom), 'a');
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'covers-picked')), []);
});

test('without a key SteamGridDB is never asked, and a game with nothing else says it needs one', async (t) => {
  const { net, open } = setup(t, { routes: doomRoutes, key: '' });
  assert.deepStrictEqual(await all(open(doom)), { count: 1, done: true, needsKey: true });
  assert.deepStrictEqual(net.urls(), []);
});

test('offline there is only the current cover, and it is not blamed on the key', async (t) => {
  const down = new TypeError('fetch failed');
  const withKey = setup(t, { routes: { [`${GRID}/search/autocomplete/Doom`]: down } });
  assert.deepStrictEqual(await all(withKey.open(doom)), { count: 1, done: true, needsKey: false });
  const noKey = setup(t, { routes: { [portal.art.cover]: down, [portal.art.fallback]: down }, key: '' });
  assert.deepStrictEqual(await all(noKey.open(portal)), { count: 1, done: true, needsKey: false });
});

test('only real https images are offered, redirects are refused and the key stays with the API', async (t) => {
  const { net, open } = setup(t, {
    enabled: false,
    key: 'secret',
    routes: {
      [`${GRID}/search/autocomplete/Doom`]: json([{ id: 1 }]),
      [`${GRID}/grids/game/1${SIZE}`]: json([grid('a'), { url: 'http://cdn2.steamgriddb.com/plain.png' }, grid('page'), { url: null }, grid('b')]),
      ...gridImages(['a', 'b']),
      [`${CDN}/grid/page.png`]: '<html>',
      [`${CDN}/thumb/page.png`]: '<html>',
    },
  });
  const choices = open(doom);
  assert.deepStrictEqual(await names(choices, true), ['plain', 'a', 'b']);
  assert.ok(net.requests.every(({ url, redirect }) => url.startsWith('https://') && redirect === 'error'));
  assert.ok(net.requests.every(({ url, headers }) => Boolean(headers) === url.startsWith(`${GRID}/`)));
  assert.ok(!JSON.stringify(await choices.image(1, true)).includes('secret'));
});

test('unknown choices, and choices after closing, change nothing', async (t) => {
  const { covers, open } = setup(t, { routes: doomRoutes });
  const choices = open(doom);
  await all(choices);
  for (const index of [-1, 99, 1.5, NaN]) {
    assert.strictEqual(await choices.image(index, true), null);
    assert.strictEqual(await choices.use(index), false);
  }
  choices.close();
  assert.strictEqual(await choices.use(2), false);
  assert.strictEqual(await shownFor(covers, doom), 'a');
});
