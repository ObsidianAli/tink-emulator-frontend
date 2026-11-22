// Finds each emulated Game's Cover in the libretro thumbnail library and keeps it on disk.
const fs = require('node:fs/promises');
const path = require('node:path');
const { CONSOLES } = require('./presets');

// libretro's own GitHub copy of its thumbnail library; thumbnails.libretro.com answers 404 for every file.
const LIBRETRO = 'https://raw.githubusercontent.com/libretro-thumbnails';
const MAX_BYTES = 8 * 1024 * 1024;
const PARALLEL = 4;

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
async function download(fetchFn, url) {
  if (!url.startsWith('https://')) throw new Rejected('not https');
  const response = await fetchFn(url, { redirect: 'error' });
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

async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, file);
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

// dir: the cache folder. enabled: whether Tink may go online. fetch: swapped out in tests.
// getCover(game) gives { file, mime } for a real Cover, or { plain: { colour } } for a Plain cover.
function createCovers({ dir, enabled, fetch: fetchFn = globalThis.fetch }) {
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

  async function fromLibretro(system, game) {
    for (const name of nameVariants(game.fileName)) {
      try {
        const image = await queue(() => download(fetchFn, libretroUrl(system, name)));
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

  async function resolve(game) {
    const preset = CONSOLES[game.console];
    const plain = { plain: { colour: preset.colour } };
    const found = await cached(game);
    if (found) return found;
    const key = `${game.console}/${game.fileName}`;
    if (!enabled || !preset.libretro || (await loadMisses()).has(key)) return plain;
    try {
      const cover = await fromLibretro(preset.libretro, game);
      if (cover) return cover;
      await remember(key);
    } catch {
      // offline or the server failed: try again next time
    }
    return plain;
  }

  function getCover(game) {
    const key = `${game.console}/${game.fileName}`;
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

module.exports = { createCovers };
