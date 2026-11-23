// Finds each Game's Cover (libretro, then SteamGridDB, or Steam's own art) and keeps it on disk.
const fs = require('node:fs/promises');
const path = require('node:path');
const { CONSOLES, coverColour } = require('./presets');

// libretro's own GitHub copy of its thumbnail library; thumbnails.libretro.com answers 404 for every file.
const LIBRETRO = 'https://raw.githubusercontent.com/libretro-thumbnails';
const GRIDDB = 'https://www.steamgriddb.com/api/v2';
const MAX_BYTES = 8 * 1024 * 1024;
const PARALLEL = 4;
// A stalled connection (a captive portal, say) gives up instead of holding the queue forever.
const TIMEOUT_MS = 20000;

const IMAGE_TYPES = [
  { ext: '.png', mime: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.jpg', mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.webp', mime: 'image/webp', magic: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

// libretro writes these characters as "_" in its file names.
const libretroSafe = (name) => name.replace(/[&*/:`<>?\\|"]/g, '_');

// The file name as it is, then without [..] dump tags, then with only its first (..) tag, then with no tags at all.
function nameVariants(fileName) {
  const noBrackets = fileName.replace(/\s*\[[^\]]*\]/g, '').trim();
  const firstTag = noBrackets.match(/^[^(]*\([^)]*\)/);
  const bare = noBrackets.replace(/\s*\([^)]*\)/g, '').trim();
  return [...new Set([fileName, noBrackets, firstTag && firstTag[0].trim(), bare].filter(Boolean))];
}

function libretroUrl(system, name) {
  const repo = system.replace(/ /g, '_');
  return `${LIBRETRO}/${encodeURIComponent(repo)}/master/Named_Boxarts/${encodeURIComponent(libretroSafe(name))}.png`;
}

class Rejected extends Error {}

// The image at url, null if the server has none, Rejected if it isn't a safe image.
// Anything else (offline, server down) throws, so it isn't remembered as a miss.
async function download(fetchFn, url, timeoutMs) {
  if (!url.startsWith('https://')) throw new Rejected('not https');
  const response = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Rejected('too big');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Rejected('too big');
    chunks.push(Buffer.from(chunk));
  }
  const data = Buffer.concat(chunks);
  const type = IMAGE_TYPES.find((t) => t.magic(data));
  if (!type) throw new Rejected('not an image');
  return { data, type };
}

// SteamGridDB's JSON answer, null if it has none. The key only ever goes to its own API host.
async function griddbJson(fetchFn, key, route, timeoutMs) {
  const response = await fetchFn(`${GRIDDB}${route}`, {
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body && body.success && Array.isArray(body.data) ? body.data : null;
}

async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

// Runs at most `limit` tasks at once.
function limiter(limit) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= limit || waiting.length === 0) return;
    running++;
    const { task, resolve, reject } = waiting.shift();
    task().then(resolve, reject).finally(() => {
      running--;
      next();
    });
  };
  return (task) => new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    next();
  });
}

// dir: the cache folder. enabled: whether Tink may go online. steamGridKey: optional SteamGridDB API key. fetch: swapped out in tests.
// getCover(game) gives { file, mime } for a real Cover, or { plain: { colour } } for a Plain cover.
// A Steam Game brings its own art: { cover, fallback } URLs.
function createCovers({ dir, enabled, steamGridKey, fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const missesFile = path.join(dir, 'misses.json');
  const inFlight = new Map();
  const queue = limiter(PARALLEL);
  let misses = null;

  async function loadMisses() {
    if (misses) return misses;
    try {
      misses = new Set(JSON.parse(await fs.readFile(missesFile, 'utf8')));
    } catch {
      misses = new Set();
    }
    return misses;
  }

  async function remember(key) {
    (await loadMisses()).add(key);
    await writeAtomic(missesFile, JSON.stringify([...misses]));
  }

  const coverBase = (game) => path.join(dir, game.console, libretroSafe(game.fileName));
  const missKey = (game) => `${game.console}/${game.fileName}`;

  async function cached(game) {
    for (const type of IMAGE_TYPES) {
      const file = coverBase(game) + type.ext;
      try {
        await fs.access(file);
        return { file, mime: type.mime };
      } catch {
        // not this type
      }
    }
    return null;
  }

  // Saves the first of these URLs that gives a safe image.
  async function firstImage(game, urls) {
    for (const url of urls) {
      try {
        const image = await queue(() => download(fetchFn, url, timeoutMs));
        if (!image) continue;
        const file = coverBase(game) + image.type.ext;
        await writeAtomic(file, image.data);
        return { file, mime: image.type.mime };
      } catch (error) {
        if (!(error instanceof Rejected)) throw error;
      }
    }
    return null;
  }

  function fromLibretro(system, game) {
    return firstImage(game, nameVariants(game.fileName).map((name) => libretroUrl(system, name)));
  }

  // Searches SteamGridDB by title and takes the first portrait grid of the best match.
  async function fromGridDb(game) {
    const ask = (route) => queue(() => griddbJson(fetchFn, steamGridKey, route, timeoutMs));
    const matches = await ask(`/search/autocomplete/${encodeURIComponent(game.title || game.fileName)}`);
    if (!matches || !matches.length) return null;
    const grids = await ask(`/grids/game/${encodeURIComponent(matches[0].id)}?dimensions=600x900&types=static`);
    return firstImage(game, (grids || []).map((grid) => String(grid.url)));
  }

  // The places to look for this Game's Cover, in order.
  function sources(game) {
    if (game.art) return [() => firstImage(game, [game.art.cover, game.art.fallback])];
    const system = CONSOLES[game.console].libretro;
    return [system && (() => fromLibretro(system, game)), steamGridKey && (() => fromGridDb(game))].filter(Boolean);
  }

  async function resolve(game) {
    const plain = { plain: { colour: coverColour(game.console) } };
    const found = await cached(game);
    if (found) return found;
    const lookups = sources(game);
    if (!enabled || !lookups.length || (await loadMisses()).has(missKey(game))) return plain;
    try {
      for (const lookup of lookups) {
        const cover = await lookup();
        if (cover) return cover;
      }
      await remember(missKey(game));
    } catch {
      // offline or the server failed: try again next time
    }
    return plain;
  }

  function getCover(game) {
    const key = missKey(game);
    if (!inFlight.has(key)) {
      inFlight.set(key, resolve(game).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  // Forgets every cached Cover and every miss, so each Game is looked up again.
  async function redownload() {
    await fs.rm(dir, { recursive: true, force: true });
    misses = null;
  }

  return { getCover, redownload };
}

module.exports = { createCovers, download, writeAtomic, Rejected };
