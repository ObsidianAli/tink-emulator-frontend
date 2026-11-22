const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCovers } = require('../src/covers');
const { CONSOLES, STEAM } = require('../src/presets');
const { artUrls } = require('../src/steam');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const GC = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_GameCube/master/Named_Boxarts/';

// A fake network: known URLs answer with their response, everything else is a 404. Every request is logged.
function fakeNet(routes) {
  const requests = [];
  const fetch = async (url) => {
    requests.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (typeof route === 'function') return route();
    if (route instanceof Response) return route.clone();
    return route ? new Response(route) : new Response('nope', { status: 404 });
  };
  return { fetch, requests };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tink-covers-'));
}

const zelda = {
  console: 'gamecube',
  title: 'The Legend of Zelda: The Wind Waker',
  fileName: 'Legend of Zelda, The - The Wind Waker (USA) [!]',
};
const zeldaUrl = `${GC}Legend%20of%20Zelda%2C%20The%20-%20The%20Wind%20Waker%20(USA).png`;

test('a cover is found by a relaxed file name and cached', async () => {
  const dir = tempDir();
  const net = fakeNet({ [zeldaUrl]: PNG });
  const covers = createCovers({ dir, enabled: true, fetch: net.fetch });
  const cover = await covers.getCover(zelda);
  assert.strictEqual(cover.mime, 'image/png');
  assert.deepStrictEqual(fs.readFileSync(cover.file), PNG);
  assert.deepStrictEqual(net.requests, [`${GC}Legend%20of%20Zelda%2C%20The%20-%20The%20Wind%20Waker%20(USA)%20%5B!%5D.png`, zeldaUrl]);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(cover.file)), [path.basename(cover.file)]);

  const again = createCovers({ dir, enabled: true, fetch: net.fetch });
  assert.deepStrictEqual(await again.getCover(zelda), cover);
  assert.strictEqual(net.requests.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('libretro\'s unsafe characters become _', async () => {
  const dir = tempDir();
  const game = { console: 'gamecube', fileName: 'Ocarina of Time / Master Quest (USA)' };
  const net = fakeNet({ [`${GC}Ocarina%20of%20Time%20_%20Master%20Quest%20(USA).png`]: PNG });
  const cover = await createCovers({ dir, enabled: true, fetch: net.fetch }).getCover(game);
  assert.ok(cover.file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with covers off, nothing goes online and the game gets a plain cover', async () => {
  const dir = tempDir();
  const net = fakeNet({ [zeldaUrl]: PNG });
  const cover = await createCovers({ dir, enabled: false, fetch: net.fetch }).getCover(zelda);
  assert.deepStrictEqual(cover, { plain: { colour: CONSOLES.gamecube.colour } });
  assert.deepStrictEqual(net.requests, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('consoles libretro has no covers for get a plain cover without asking', async () => {
  const dir = tempDir();
  const net = fakeNet({});
  const cover = await createCovers({ dir, enabled: true, fetch: net.fetch }).getCover({ console: 'ps5', fileName: 'Astro Bot' });
  assert.deepStrictEqual(cover, { plain: { colour: CONSOLES.ps5.colour } });
  assert.deepStrictEqual(net.requests, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('misses are remembered until re-download', async () => {
  const dir = tempDir();
  const net = fakeNet({});
  const covers = createCovers({ dir, enabled: true, fetch: net.fetch });
  assert.ok((await covers.getCover(zelda)).plain);
  const asked = net.requests.length;
  assert.ok(asked > 0);

  const later = createCovers({ dir, enabled: true, fetch: net.fetch });
  assert.ok((await later.getCover(zelda)).plain);
  assert.strictEqual(net.requests.length, asked);

  await later.redownload();
  assert.ok((await later.getCover(zelda)).plain);
  assert.strictEqual(net.requests.length, asked * 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('re-download replaces a cached cover', async () => {
  const dir = tempDir();
  const net = fakeNet({ [zeldaUrl]: PNG });
  const covers = createCovers({ dir, enabled: true, fetch: net.fetch });
  await covers.getCover(zelda);
  await covers.redownload();
  const asked = net.requests.length;
  assert.ok((await covers.getCover(zelda)).file);
  assert.ok(net.requests.length > asked);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed connection is not remembered as a miss', async () => {
  const dir = tempDir();
  const offline = createCovers({ dir, enabled: true, fetch: fakeNet({ [zeldaUrl]: new TypeError('fetch failed') }).fetch });
  // The first variant is a 404, the second fails to connect.
  assert.ok((await offline.getCover(zelda)).plain);
  const online = createCovers({ dir, enabled: true, fetch: fakeNet({ [zeldaUrl]: PNG }).fetch });
  assert.ok((await online.getCover(zelda)).file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('downloads that are not images or too big are refused', async () => {
  const dir = tempDir();
  const html = () => new Response('<html>not found</html>', { headers: { 'content-type': 'image/png' } });
  const huge = () => new Response(PNG, { headers: { 'content-length': String(50 * 1024 * 1024) } });
  const endless = () => new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  }));
  for (const route of [html, huge, endless]) {
    const covers = createCovers({ dir, enabled: true, fetch: fakeNet({ [zeldaUrl]: route }).fetch });
    assert.ok((await covers.getCover(zelda)).plain);
    await covers.redownload();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('redirects are not followed', async () => {
  const dir = tempDir();
  let options = null;
  const fetch = async (url, opts) => {
    options = opts;
    return new Response('nope', { status: 404 });
  };
  await createCovers({ dir, enabled: true, fetch }).getCover(zelda);
  assert.strictEqual(options.redirect, 'error');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every console has a plain cover colour', () => {
  for (const [id, preset] of Object.entries({ ...CONSOLES, steam: STEAM })) {
    assert.match(preset.colour, /^#[0-9a-f]{6}$/, id);
  }
});

test('a stalled connection gives up instead of waiting forever, and is not remembered', async () => {
  const dir = tempDir();
  const stalled = (url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  });
  const cover = await createCovers({ dir, enabled: true, fetch: stalled, timeoutMs: 20 }).getCover(zelda);
  assert.ok(cover.plain);
  assert.ok((await createCovers({ dir, enabled: true, fetch: fakeNet({ [zeldaUrl]: PNG }).fetch }).getCover(zelda)).file);
  fs.rmSync(dir, { recursive: true, force: true });
});

const portal = { console: 'steam', title: 'Portal', fileName: '400', art: artUrls('400') };

test("a Steam game uses Steam's tall art, then its header, and is cached by app id", async () => {
  const dir = tempDir();
  const net = fakeNet({ [portal.art.fallback]: PNG });
  const cover = await createCovers({ dir, enabled: true, steamGridKey: 'k', fetch: net.fetch }).getCover(portal);
  assert.deepStrictEqual(net.requests, [portal.art.cover, portal.art.fallback]);
  assert.strictEqual(path.basename(cover.file), '400.png');
  const offline = fakeNet({});
  assert.deepStrictEqual(await createCovers({ dir, enabled: true, fetch: offline.fetch }).getCover(portal), cover);
  assert.deepStrictEqual(offline.requests, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with covers off, a Steam game stays offline too', async () => {
  const dir = tempDir();
  const net = fakeNet({ [portal.art.cover]: PNG });
  const cover = await createCovers({ dir, enabled: false, fetch: net.fetch }).getCover(portal);
  assert.deepStrictEqual(cover, { plain: { colour: STEAM.colour } });
  assert.deepStrictEqual(net.requests, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

const GRID = 'https://www.steamgriddb.com/api/v2';
const json = (data) => new Response(JSON.stringify({ success: true, data }));
const astro = { console: 'ps5', title: 'Astro Bot', fileName: 'Astro Bot' };
const gridRoutes = {
  [`${GRID}/search/autocomplete/Astro%20Bot`]: json([{ id: 7, name: 'Astro Bot' }]),
  [`${GRID}/grids/game/7?dimensions=600x900&types=static`]: json([{ url: 'https://cdn2.steamgriddb.com/grid/a.png' }]),
  'https://cdn2.steamgriddb.com/grid/a.png': PNG,
};

test('without a key, SteamGridDB is never asked', async () => {
  const dir = tempDir();
  const net = fakeNet(gridRoutes);
  const cover = await createCovers({ dir, enabled: true, fetch: net.fetch }).getCover(astro);
  assert.ok(cover.plain);
  assert.deepStrictEqual(net.requests, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a console libretro lacks is searched on SteamGridDB by title', async () => {
  const dir = tempDir();
  const net = fakeNet(gridRoutes);
  const cover = await createCovers({ dir, enabled: true, steamGridKey: 'k', fetch: net.fetch }).getCover(astro);
  assert.deepStrictEqual(fs.readFileSync(cover.file), PNG);
  assert.deepStrictEqual(net.requests, Object.keys(gridRoutes));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('libretro is tried before SteamGridDB, which only hears about its misses', async () => {
  const dir = tempDir();
  const hit = fakeNet({ [zeldaUrl]: PNG });
  assert.ok((await createCovers({ dir, enabled: true, steamGridKey: 'k', fetch: hit.fetch }).getCover(zelda)).file);
  assert.ok(hit.requests.every((url) => url.startsWith('https://raw.githubusercontent.com/')));

  const miss = fakeNet({
    [`${GRID}/search/autocomplete/${encodeURIComponent(zelda.title)}`]: json([{ id: 7 }]),
    [`${GRID}/grids/game/7?dimensions=600x900&types=static`]: json([{ url: 'https://cdn2.steamgriddb.com/grid/a.png' }]),
    'https://cdn2.steamgriddb.com/grid/a.png': PNG,
  });
  const other = tempDir();
  assert.ok((await createCovers({ dir: other, enabled: true, steamGridKey: 'k', fetch: miss.fetch }).getCover(zelda)).file);
  const firstGrid = miss.requests.findIndex((url) => url.includes('steamgriddb'));
  assert.ok(firstGrid > 0);
  assert.ok(miss.requests.slice(0, firstGrid).every((url) => url.includes('libretro')));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test('the key is sent only to the SteamGridDB API, and nothing is remembered when it is offline', async () => {
  const dir = tempDir();
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push([url, opts && opts.headers]);
    throw new TypeError('fetch failed');
  };
  assert.ok((await createCovers({ dir, enabled: true, steamGridKey: 'secret', fetch }).getCover(astro)).plain);
  assert.ok(seen.every(([url, headers]) => url.startsWith(GRID) && headers.Authorization === 'Bearer secret'));
  const net = fakeNet(gridRoutes);
  assert.ok((await createCovers({ dir, enabled: true, steamGridKey: 'k', fetch: net.fetch }).getCover(astro)).file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a title SteamGridDB does not know gets a plain cover and is remembered', async () => {
  const dir = tempDir();
  const net = fakeNet({ [`${GRID}/search/autocomplete/Astro%20Bot`]: json([]) });
  const covers = createCovers({ dir, enabled: true, steamGridKey: 'k', fetch: net.fetch });
  assert.ok((await covers.getCover(astro)).plain);
  assert.ok((await covers.getCover(astro)).plain);
  assert.strictEqual(net.requests.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
