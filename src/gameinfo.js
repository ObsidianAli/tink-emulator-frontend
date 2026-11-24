const fs = require('node:fs/promises');
const path = require('node:path');
const { download, writeAtomic } = require('./covers');

const STORE = 'https://store.steampowered.com/api/appdetails?appids=';
const MAX_SHOTS = 8;
const MAX_TEXT = 1500;
const MAX_JSON = 4 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const IMAGE_HOST = /^https:\/\/[a-z0-9.-]+\.(steamstatic\.com|akamaihd\.net)\//i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function plainText(html) {
  const text = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[name.toLowerCase()] || whole;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).replace(/\s+\S*$/, '')}…` : text;
}

function parseDetails(body, appId) {
  const entry = body && body[appId];
  if (!entry || !entry.success || !entry.data) return null;
  const data = entry.data;
  const overview = plainText(data.short_description) || plainText(data.about_the_game);
  const shots = (Array.isArray(data.screenshots) ? data.screenshots : [])
    .map((shot) => shot && shot.path_thumbnail)
    .filter((url) => typeof url === 'string' && IMAGE_HOST.test(url))
    .slice(0, MAX_SHOTS);
  return { overview, shots };
}

async function fetchDetails(fetchFn, appId, timeoutMs) {
  const response = await fetchFn(`${STORE}${appId}`, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_JSON) throw new Error('too big');
  return parseDetails(JSON.parse(text), appId);
}

function createGameInfo({ dir, fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const inFlight = new Map();
  const jsonFile = (appId) => path.join(dir, `${appId}.json`);

  async function read(appId) {
    try {
      const saved = JSON.parse(await fs.readFile(jsonFile(appId), 'utf8'));
      const screenshots = [];
      for (const name of saved.files || []) {
        const data = await fs.readFile(path.join(dir, appId, path.basename(name)));
        screenshots.push(`data:${/\.png$/.test(name) ? 'image/png' : 'image/jpeg'};base64,${data.toString('base64')}`);
      }
      return { overview: String(saved.overview || ''), screenshots };
    } catch {
      return null;
    }
  }

  async function load(appId) {
    const found = await read(appId);
    if (found) return found;
    let details;
    try {
      details = await fetchDetails(fetchFn, appId, timeoutMs);
    } catch {
      return null;
    }
    const files = [];
    for (const url of details ? details.shots : []) {
      try {
        const image = await download(fetchFn, url, timeoutMs);
        if (!image) continue;
        const name = `${files.length + 1}${image.type.ext}`;
        await writeAtomic(path.join(dir, appId, name), image.data);
        files.push(name);
      } catch {
      }
    }
    await writeAtomic(jsonFile(appId), JSON.stringify({ overview: details ? details.overview : '', files }));
    return read(appId);
  }

  function get(appId) {
    const key = String(appId);
    if (!/^\d+$/.test(key)) return Promise.resolve(null);
    if (!inFlight.has(key)) inFlight.set(key, load(key).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  return { get };
}

module.exports = { createGameInfo, plainText, parseDetails };
