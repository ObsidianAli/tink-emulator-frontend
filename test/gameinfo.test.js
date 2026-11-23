const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameInfo, plainText, parseDetails } = require('../src/gameinfo');

const STORE = 'https://store.steampowered.com/api/appdetails?appids=620';
const SHOT = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/ss_1.600x338.jpg';
const SHOT_2 = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/ss_2.600x338.jpg';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);

const answer = {
  620: {
    success: true,
    data: {
      short_description: 'The &quot;Perpetual Testing Initiative&quot; &amp; more.<br>Think <b>with</b> portals.',
      screenshots: [
        { id: 0, path_thumbnail: SHOT, path_full: SHOT.replace('600x338', '1920x1080') },
        { id: 1, path_thumbnail: SHOT_2 },
        { id: 2, path_thumbnail: 'http://evil.example/plain.jpg' },
      ],
    },
  },
};

// A fake network: known URLs answer, everything else is a 404. Every request is logged.
function fakeNet(routes) {
  const requests = [];
  const fetch = async (url) => {
    requests.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    return route === undefined ? new Response('nope', { status: 404 }) : new Response(route);
  };
  return { fetch, requests };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tink-info-'));

test('HTML becomes plain text', () => {
  assert.strictEqual(plainText('<p>One &amp; two</p><p>Three&nbsp;&#8211; <i>four</i> &#x41;</p>'), 'One & two\nThree – four A');
  assert.strictEqual(plainText('a<br/>b<script>alert(1)</script>'), 'a\nb');
  assert.strictEqual(plainText(undefined), '');
  assert.ok(plainText('word '.repeat(2000)).length < 1600);
});

test('the store answer gives an overview and only https screenshots from Steam', () => {
  const details = parseDetails(answer, '620');
  assert.strictEqual(details.overview, 'The "Perpetual Testing Initiative" & more.\nThink with portals.');
  assert.deepStrictEqual(details.shots, [SHOT, SHOT_2]);
  assert.strictEqual(parseDetails({ 620: { success: false } }, '620'), null);
  assert.strictEqual(parseDetails(null, '620'), null);
});

test('the overview falls back to the long description', () => {
  const details = parseDetails({ 1: { success: true, data: { about_the_game: '<h1>Hi</h1>' } } }, '1');
  assert.deepStrictEqual(details, { overview: 'Hi', shots: [] });
});

test('a game is fetched once, then served from the data folder offline', async () => {
  const dir = tempDir();
  const net = fakeNet({ [STORE]: JSON.stringify(answer), [SHOT]: JPEG, [SHOT_2]: JPEG });
  const info = createGameInfo({ dir, fetch: net.fetch });
  const first = await info.get('620');
  assert.strictEqual(first.overview, 'The "Perpetual Testing Initiative" & more.\nThink with portals.');
  assert.strictEqual(first.screenshots.length, 2);
  assert.ok(first.screenshots[0].startsWith('data:image/jpeg;base64,'));
  assert.ok(net.requests.every((url) => url.startsWith('https://')));

  const offline = createGameInfo({ dir, fetch: async () => { throw new Error('offline'); } });
  assert.deepStrictEqual(await offline.get('620'), first);
});

test('a failed fetch gives nothing and is tried again next time', async () => {
  const dir = tempDir();
  const down = createGameInfo({ dir, fetch: async () => { throw new Error('offline'); } });
  assert.strictEqual(await down.get('620'), null);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  const net = fakeNet({ [STORE]: JSON.stringify(answer), [SHOT]: JPEG });
  const later = await createGameInfo({ dir, fetch: net.fetch }).get('620');
  assert.strictEqual(later.screenshots.length, 1, 'a screenshot that is missing is left out');
});

test('a game the store does not know is remembered as empty', async () => {
  const dir = tempDir();
  const net = fakeNet({ 'https://store.steampowered.com/api/appdetails?appids=7': JSON.stringify({ 7: { success: false } }) });
  const info = createGameInfo({ dir, fetch: net.fetch });
  assert.deepStrictEqual(await info.get('7'), { overview: '', screenshots: [] });
  await info.get('7');
  assert.strictEqual(net.requests.length, 1);
});

test('only a number is looked up', async () => {
  const net = fakeNet({});
  assert.strictEqual(await createGameInfo({ dir: tempDir(), fetch: net.fetch }).get('../620'), null);
  assert.strictEqual(net.requests.length, 0);
});

test('an image that is not an image is not kept', async () => {
  const net = fakeNet({ [STORE]: JSON.stringify(answer), [SHOT]: '<html>', [SHOT_2]: JPEG });
  const got = await createGameInfo({ dir: tempDir(), fetch: net.fetch }).get('620');
  assert.strictEqual(got.screenshots.length, 1);
});
