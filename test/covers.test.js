const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCovers } = require('../src/covers');
const { CONSOLES } = require('../src/presets');

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
  for (const [id, preset] of Object.entries(CONSOLES)) {
    assert.match(preset.colour, /^#[0-9a-f]{6}$/, id);
  }
});
