const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { download, writeAtomic } = require('./covers');

const RELEASES_URL = 'https://api.github.com/repos/ObsidianAli/tink-emulator-frontend/releases?per_page=3';
const STEAM_NEWS = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?count=20&maxlength=0&feeds=steam_community_announcements&appid=';
const CLAN_IMAGES = 'https://clan.cloudflare.steamstatic.com/images';
const IMAGE_HOST = /^https:\/\/[a-z0-9.-]+\.(steamstatic\.com|akamaihd\.net)\//i;
const IMAGE_EXT = /\.(png|jpe?g|webp)(\?\S*)?$/i;
const JSON_HOSTS = new Set(['api.github.com', 'api.steampowered.com']);
const TTL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 90 * DAY_MS;
const PER_GAME = 2;
const MAX_GAMES = 200;
const PARALLEL = 3;
const GIVE_UP_AFTER = 3;
const MAX_JSON = 4 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const TEXT_LIMIT = 600;
const NOTES_LIMIT = 1500;
const TEXT_MIN_CUT = 200;
const MIN_TEXT = 80;
const BAD_TAGS = new Set(['patchnotes', 'patchnote', 'hotfix', 'hotfixes']);
const BAD_TITLE = /\b(patch|hot-?fix|update notes|change-?log|release notes|bug ?fix(es)?)\b|\bv(?:ersion)?\s*\d+(\.\d+)+|\b\d+\.\d+\.\d+\b|\bbuild\s*\d{3,}/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[name.toLowerCase()] || whole;
  });
}

function tidy(text) {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shorten(text, limit = TEXT_LIMIT) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const stops = [...head.matchAll(/[.!?](?=\s|$)|\n/g)].map((m) => m.index + (m[0] === '\n' ? 0 : 1));
  const cut = stops.filter((at) => at >= TEXT_MIN_CUT).pop();
  if (cut) return head.slice(0, cut).trim();
  return `${head.replace(/\s+\S*$/, '')}…`;
}

function bbToPlain(source) {
  const text = String(source || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/\[(img|previewyoutube|video|noparse)(?:[ =][^\]]*)?\][\s\S]*?\[\/\1\]/gi, '')
    .replace(/\[\*\]/g, '\n- ')
    .replace(/\[\/(h[1-6]|p|list|olist|quote|table|tr)\]|\[(br|hr)\]/gi, '\n')
    .replace(/\[\/?[a-z0-9*]+(?:[ =][^\]]*)?\]/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]*>/g, '');
  return tidy(decode(text));
}

function markdownToPlain(source) {
  const text = String(source || '')
    .replace(/\r/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/(\*\*|__|`)/g, '');
  return tidy(decode(text));
}

function firstImage(contents) {
  const body = String(contents || '');
  const found = [
    ...[...body.matchAll(/\[img\]\s*([^\s[]+)\s*\[\/img\]/gi)].map((m) => m[1]),
    ...[...body.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]),
  ];
  for (const raw of found) {
    const url = decode(raw).replace('{STEAM_CLAN_IMAGE}', CLAN_IMAGES).replace(/^\/\//, 'https://');
    if (IMAGE_HOST.test(url) && IMAGE_EXT.test(url)) return url;
  }
  return null;
}

function parseReleases(body) {
  const items = [];
  for (const release of Array.isArray(body) ? body : []) {
    if (!release || release.draft || release.prerelease) continue;
    const version = String(release.tag_name || '').replace(/^v/i, '');
    const date = Date.parse(release.published_at || release.created_at);
    if (!/^\d+\.\d+\.\d+$/.test(version) || Number.isNaN(date)) continue;
    const text = shorten(markdownToPlain(release.body), NOTES_LIMIT);
    items.push({ id: `tink:${version}`, kind: 'tink', title: `Tink ${version}`, game: '', date, text, image: null });
  }
  return items;
}

function parseNews(body, appId, gameName, now) {
  const list = body && body.appnews && Array.isArray(body.appnews.newsitems) ? body.appnews.newsitems : [];
  const items = [];
  for (const entry of list) {
    if (!entry || entry.feedname !== 'steam_community_announcements') continue;
    const title = decode(String(entry.title || '')).trim();
    const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).toLowerCase()) : [];
    const date = Number(entry.date) * 1000;
    if (!title || !/^\d+$/.test(String(entry.gid)) || !Number.isFinite(date)) continue;
    if (date > now + DAY_MS || now - date > MAX_AGE_MS) continue;
    if (tags.some((tag) => BAD_TAGS.has(tag)) || BAD_TITLE.test(title)) continue;
    const text = shorten(bbToPlain(entry.contents));
    if (text.length < MIN_TEXT) continue;
    items.push({ id: `game:${appId}:${entry.gid}`, kind: 'game', title, game: gameName, date, text, image: firstImage(entry.contents) });
  }
  return items.sort((a, b) => b.date - a.date).slice(0, PER_GAME);
}

async function getJson(fetchFn, url, timeoutMs) {
  if (!JSON_HOSTS.has(new URL(url).hostname)) throw new Error('host not allowed');
  const response = await fetchFn(url, { redirect: 'error', headers: { 'User-Agent': 'Tink', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_JSON) throw new Error('too big');
  return JSON.parse(text);
}

const publicItem = ({ id, kind, title, game, date, text, image }) => ({ id, kind, title, game, date, text, hasImage: Boolean(image) });

function createNews({ dir, fetch: fetchFn = globalThis.fetch, getGames = () => [], now = Date.now, timeoutMs = TIMEOUT_MS }) {
  const cacheFile = path.join(dir, 'news.json');
  const seenFile = path.join(dir, 'news-seen.json');
  const imageRuns = new Map();
  let running = null;

  async function readCache() {
    try {
      const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      return { tink: saved.tink || null, games: saved.games && typeof saved.games === 'object' ? saved.games : {} };
    } catch {
      return { tink: null, games: {} };
    }
  }

  const fresh = (entry) => Boolean(entry) && Number.isFinite(entry.at) && entry.at <= now() && now() - entry.at < TTL_MS;

  function wanted() {
    const seen = new Set();
    const games = [];
    for (const game of getGames() || []) {
      const id = game && String(game.appId);
      if (!id || !/^\d+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      games.push({ id, name: String(game.title || '') });
    }
    return games.slice(0, MAX_GAMES);
  }

  function collect(cache, games) {
    const items = [...(cache.tink ? cache.tink.items : [])];
    for (const game of games) if (cache.games[game.id]) items.push(...cache.games[game.id].items);
    const cutoff = now() - MAX_AGE_MS;
    return items.filter((item) => item.kind === 'tink' || item.date >= cutoff).sort((a, b) => b.date - a.date);
  }

  async function refresh() {
    const cache = await readCache();
    const games = wanted();
    let changed = false;

    if (!fresh(cache.tink)) {
      try {
        cache.tink = { at: now(), items: parseReleases(await getJson(fetchFn, RELEASES_URL, timeoutMs)) };
        changed = true;
      } catch {
      }
    }

    const todo = games.filter((game) => !fresh(cache.games[game.id]));
    let failures = 0;
    let next = 0;
    const worker = async () => {
      while (failures < GIVE_UP_AFTER && next < todo.length) {
        const game = todo[next++];
        try {
          const body = await getJson(fetchFn, `${STEAM_NEWS}${game.id}`, timeoutMs);
          cache.games[game.id] = { at: now(), items: parseNews(body, game.id, game.name, now()) };
          changed = true;
          failures = 0;
        } catch {
          failures++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));

    const ids = new Set(games.map((game) => game.id));
    for (const id of Object.keys(cache.games)) {
      if (!ids.has(id)) {
        delete cache.games[id];
        changed = true;
      }
    }
    if (changed) {
      try {
        await writeAtomic(cacheFile, JSON.stringify(cache));
      } catch {
      }
    }
    return collect(cache, games);
  }

  async function getNews({ cachedOnly = false } = {}) {
    try {
      if (cachedOnly) return (await readItems()).map(publicItem);
      if (!running) running = refresh().finally(() => { running = null; });
      const items = await running;
      await startSeen(items);
      return items.map(publicItem);
    } catch {
      return [];
    }
  }

  async function readItems() {
    return collect(await readCache(), wanted());
  }

  const imageBase = (id) => path.join(dir, 'images', crypto.createHash('sha1').update(id).digest('hex'));

  async function loadImage(id) {
    const item = (await readItems()).find((entry) => entry.id === id);
    if (!item || !item.image) return null;
    const base = imageBase(id);
    for (const [ext, mime] of [['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.webp', 'image/webp']]) {
      try {
        return `data:${mime};base64,${(await fs.readFile(base + ext)).toString('base64')}`;
      } catch {
      }
    }
    if (!IMAGE_HOST.test(item.image)) return null;
    const image = await download(fetchFn, item.image, timeoutMs);
    if (!image || image.data.length > MAX_IMAGE) return null;
    await writeAtomic(base + image.type.ext, image.data);
    return `data:${image.type.mime};base64,${image.data.toString('base64')}`;
  }

  function getNewsImage(id) {
    const key = String(id);
    if (!/^(tink:\d+\.\d+\.\d+|game:\d+:\d+)$/.test(key)) return Promise.resolve(null);
    if (!imageRuns.has(key)) imageRuns.set(key, loadImage(key).catch(() => null).finally(() => imageRuns.delete(key)));
    return imageRuns.get(key);
  }

  async function readSeen() {
    try {
      const date = Number(JSON.parse(await fs.readFile(seenFile, 'utf8')).date);
      return Number.isFinite(date) ? date : 0;
    } catch {
      return 0;
    }
  }

  async function startSeen(items) {
    if (items.length === 0) return;
    try {
      await fs.access(seenFile);
    } catch {
      await writeAtomic(seenFile, JSON.stringify({ date: items[0].date }));
    }
  }

  async function hasUnread() {
    try {
      const items = await readItems();
      return items.length > 0 && items[0].date > (await readSeen());
    } catch {
      return false;
    }
  }

  async function markSeen() {
    try {
      const items = await readItems();
      if (items.length === 0) return false;
      await writeAtomic(seenFile, JSON.stringify({ date: Math.max(items[0].date, await readSeen()) }));
      return true;
    } catch {
      return false;
    }
  }

  return { getNews, getNewsImage, hasUnread, markSeen };
}

module.exports = { createNews, parseReleases, parseNews, bbToPlain, markdownToPlain, shorten, firstImage };
