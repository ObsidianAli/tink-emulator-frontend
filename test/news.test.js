const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNews, parseReleases, parseNews, bbToPlain, shorten, firstImage } = require('../src/news');

const NOW = Date.parse('2026-11-25T12:00:00Z');
const day = (n) => Math.floor((NOW - n * 86400000) / 1000);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);
const IMG = 'https://clan.cloudflare.steamstatic.com/images/123/abc.png';
const LONG = 'The new season is here and it brings a lot of changes for everyone playing. ';

const post = (gid, title, ageDays, extra = {}) => ({
  gid: String(gid),
  title,
  date: day(ageDays),
  feedname: 'steam_community_announcements',
  contents: LONG + LONG,
  ...extra,
});
const steamBody = (...items) => ({ appnews: { newsitems: items } });

function fakeNet(routes) {
  const requests = [];
  let active = 0;
  let peak = 0;
  const fetch = async (url) => {
    requests.push(url);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    const route = routes[url] !== undefined ? routes[url] : Object.entries(routes).find(([key]) => url.startsWith(key))?.[1];
    if (route instanceof Error) throw route;
    if (route === undefined) return new Response('nope', { status: 404 });
    return new Response(Buffer.isBuffer(route) ? route : JSON.stringify(route));
  };
  return { fetch, requests, peak: () => peak };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tink-news-'));
const RELEASES = 'https://api.github.com/repos/ObsidianAli/tink-emulator-frontend/releases';
const NEWS = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/';
const release = (tag, body, extra = {}) => ({ tag_name: tag, published_at: new Date(NOW - 3 * 86400000).toISOString(), body, ...extra });

test('BBCode and HTML become short plain text without links', () => {
  const text = bbToPlain('[h1]Big news[/h1]\n[img]{STEAM_CLAN_IMAGE}/1/a.png[/img]\nSee [url=https://x.example/a]the post[/url] or https://y.example now.\n[list][*]One[*]Two[/list]<script>alert(1)</script><b>Done</b> &amp; dusted');
  assert.strictEqual(text, 'Big news\n\nSee the post or now.\n\n- One\n- Two\nDone & dusted');
  assert.ok(!/[[<]|http/.test(text));
});

test('long text is cut at a sentence', () => {
  const cut = shorten(LONG.repeat(20));
  assert.ok(cut.length <= 600);
  assert.ok(cut.endsWith('everyone playing.'));
  assert.strictEqual(shorten('short'), 'short');
});

test('the first image must be a Steam-hosted picture', () => {
  assert.strictEqual(firstImage('[img]{STEAM_CLAN_IMAGE}/123/abc.png[/img]'), IMG);
  assert.strictEqual(firstImage('[img]https://evil.example/a.png[/img][img]https://cdn.akamai.steamstatic.com/x/b.jpg[/img]'), 'https://cdn.akamai.steamstatic.com/x/b.jpg');
  assert.strictEqual(firstImage('<img src="https://shared.akamaihd.net/y/z.jpeg">'), 'https://shared.akamaihd.net/y/z.jpeg');
  assert.strictEqual(firstImage('[img]http://clan.cloudflare.steamstatic.com/images/a.png[/img][img]https://clan.cloudflare.steamstatic.com/images/a.gif[/img]'), null);
});

test('releases become Tink items and skip drafts and odd tags', () => {
  const items = parseReleases([
    release('v0.7.0', '## Home\n- **New** [row](https://x.example) for profiles'),
    release('v0.8.0', 'draft', { draft: true }),
    release('nightly', 'x'),
  ]);
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual({ id: items[0].id, kind: items[0].kind, title: items[0].title, text: items[0].text }, {
    id: 'tink:0.7.0', kind: 'tink', title: 'Tink 0.7.0', text: 'Home\n- New row for profiles',
  });
});

test('only big developer announcements from the last 90 days are kept, two per game', () => {
  const body = steamBody(
    post(1, 'Season 4 is live', 2),
    post(2, 'Anniversary event', 10, { contents: `[img]{STEAM_CLAN_IMAGE}/123/abc.png[/img]${LONG}${LONG}` }),
    post(3, 'A third announcement', 20),
    post(4, 'Patch 1.2.3 notes', 1),
    post(5, 'Hotfix is out', 1),
    post(6, 'Balance changes', 1, { tags: ['patchnotes'] }),
    post(7, 'Old news', 120),
    post(8, 'Tiny', 1, { contents: 'Short.' }),
    post(9, 'Community event', 1, { feedname: 'PCGamer' }),
    post(10, 'Update 4', 1, { title: 'Version 2.1 update notes' }),
  );
  const items = parseNews(body, '620', 'Portal 2', NOW);
  assert.deepStrictEqual(items.map((item) => item.id), ['game:620:1', 'game:620:2']);
  assert.strictEqual(items[1].image, IMG);
  assert.strictEqual(items[0].game, 'Portal 2');
  assert.deepStrictEqual(parseNews(null, '620', 'x', NOW), []);
});

function setup(routes, games = [{ appId: '620', title: 'Portal 2' }, { appId: '730', title: 'CS' }]) {
  const dir = tempDir();
  const net = fakeNet(routes);
  const news = createNews({ dir, fetch: net.fetch, getGames: () => games, now: () => NOW });
  return { dir, net, news };
}

const routesOk = () => ({
  [RELEASES]: [release('v0.7.0', 'Notes for this release')],
  [`${NEWS}?count=20&maxlength=0&feeds=steam_community_announcements&appid=620`]: steamBody(post(1, 'Season 4 is live', 2, { contents: `[img]{STEAM_CLAN_IMAGE}/123/abc.png[/img]${LONG}${LONG}` })),
  [`${NEWS}?count=20&maxlength=0&feeds=steam_community_announcements&appid=730`]: steamBody(post(2, 'New map', 5)),
  [IMG]: PNG,
});

test('news merges both sources, newest first, and is cached for six hours', async () => {
  const { news, net } = setup(routesOk());
  const items = await news.getNews();
  assert.deepStrictEqual(items.map((item) => [item.id, item.kind, item.hasImage]), [
    ['game:620:1', 'game', true],
    ['tink:0.7.0', 'tink', false],
    ['game:730:2', 'game', false],
  ]);
  assert.deepStrictEqual(Object.keys(items[1]).sort(), ['date', 'game', 'hasImage', 'id', 'kind', 'text', 'title']);
  assert.strictEqual(net.requests.length, 3);
  await news.getNews();
  assert.strictEqual(net.requests.length, 3);
});

test('requests run a few at a time', async () => {
  const games = Array.from({ length: 12 }, (_, i) => ({ appId: String(100 + i), title: `Game ${i}` }));
  const { news, net } = setup({ [RELEASES]: [], [NEWS]: steamBody() }, games);
  await news.getNews();
  assert.strictEqual(net.requests.length, 13);
  assert.ok(net.peak() <= 3);
});

test('a stale cache still answers when the network is down', async () => {
  const dir = tempDir();
  const online = createNews({ dir, fetch: fakeNet(routesOk()).fetch, getGames: () => [{ appId: '620', title: 'Portal 2' }], now: () => NOW });
  await online.getNews();
  const net = fakeNet({ [RELEASES]: new Error('offline') });
  const offline = createNews({ dir, fetch: net.fetch, getGames: () => [{ appId: '620', title: 'Portal 2' }], now: () => NOW + 7 * 3600000 });
  const items = await offline.getNews();
  assert.deepStrictEqual(items.map((item) => item.id), ['game:620:1', 'tink:0.7.0']);
});

test('with no cache and no network it gives an empty list and gives up early', async () => {
  const games = Array.from({ length: 20 }, (_, i) => ({ appId: String(100 + i), title: 'g' }));
  const { news, net } = setup({ [RELEASES]: new Error('offline') }, games);
  assert.deepStrictEqual(await news.getNews(), []);
  assert.ok(net.requests.length <= 1 + 3 + 3);
});

test('broken answers never throw', async () => {
  const { news } = setup({ [RELEASES]: { not: 'a list' }, [NEWS]: 'garbage' });
  assert.deepStrictEqual(await news.getNews(), []);
});

test('the image comes as a data URL, is cached, and ids are validated', async () => {
  const { news, net } = setup(routesOk());
  await news.getNews();
  const url = await news.getNewsImage('game:620:1');
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.strictEqual(Buffer.from(url.split(',')[1], 'base64').equals(PNG), true);
  await news.getNewsImage('game:620:1');
  assert.strictEqual(net.requests.filter((r) => r === IMG).length, 1);
  assert.strictEqual(await news.getNewsImage('game:730:2'), null);
  assert.strictEqual(await news.getNewsImage('../../x'), null);
  assert.strictEqual(await news.getNewsImage({}), null);
  assert.strictEqual(await news.getNewsImage('game:999:1'), null);
});

test('an image that is not a picture or is too big gives nothing', async () => {
  const routes = routesOk();
  routes[IMG] = Buffer.from('<html>not an image</html>');
  const { news } = setup(routes);
  await news.getNews();
  assert.strictEqual(await news.getNewsImage('game:620:1'), null);
  const big = routesOk();
  big[IMG] = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  const second = setup(big);
  await second.news.getNews();
  assert.strictEqual(await second.news.getNewsImage('game:620:1'), null);
});

test('unread follows the newest seen date', async () => {
  const { news } = setup(routesOk());
  assert.strictEqual(await news.hasUnread(), false);
  await news.getNews();
  assert.strictEqual(await news.hasUnread(), true);
  assert.strictEqual(await news.markSeen(), true);
  assert.strictEqual(await news.hasUnread(), false);
});

test('a newer item after markSeen is unread again', async () => {
  const dir = tempDir();
  const games = [{ appId: '620', title: 'Portal 2' }];
  const first = createNews({ dir, fetch: fakeNet(routesOk()).fetch, getGames: () => games, now: () => NOW });
  await first.getNews();
  await first.markSeen();
  const routes = routesOk();
  routes[RELEASES] = [release('v0.8.0', 'Newer', { published_at: new Date(NOW + 8 * 3600000).toISOString() })];
  const later = createNews({ dir, fetch: fakeNet(routes).fetch, getGames: () => games, now: () => NOW + 9 * 3600000 });
  await later.getNews();
  assert.strictEqual(await later.hasUnread(), true);
});

test('games that left the library drop out', async () => {
  const dir = tempDir();
  const net = fakeNet(routesOk());
  let games = [{ appId: '620', title: 'Portal 2' }, { appId: '730', title: 'CS' }];
  const news = createNews({ dir, fetch: net.fetch, getGames: () => games, now: () => NOW });
  await news.getNews();
  games = [{ appId: '730', title: 'CS' }];
  assert.deepStrictEqual((await news.getNews()).map((item) => item.id), ['tink:0.7.0', 'game:730:2']);
});

test('only the two known hosts get news requests', async () => {
  const { net, news } = setup(routesOk());
  await news.getNews();
  const hosts = new Set(net.requests.map((url) => new URL(url).hostname));
  assert.deepStrictEqual([...hosts].sort(), ['api.github.com', 'api.steampowered.com']);
});
