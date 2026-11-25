const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const IMAGE = /\.(png|jpe?g)$/i;
const THUMB_SIZE = { width: 640, height: 360 };
const THUMB_QUALITY = 85;
const THUMB_CACHE = 60;
const MAX_SHOT_BYTES = 64 * 1024 * 1024;
// Game Bar writes "Title 2026-09-07 02-13-42", and "Title 9_7_2026 2_13_42 AM" on older Windows.
const STAMPS = [
  / \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}( ?\(\d+\))?$/,
  / \d{1,4}[_.-]\d{1,2}[_.-]\d{1,4} \d{1,2}[_.-]\d{2}[_.-]\d{2}( [AP]M)?( ?\(\d+\))?$/i,
];
const STEAM_STAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/;

const idFor = (file) => crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 20);
const mimeOf = (file) => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg');

function titleFromName(fileName) {
  const name = fileName.replace(/\.[^.]+$/, '');
  const stamp = STAMPS.find((pattern) => pattern.test(name));
  return stamp ? name.replace(stamp, '').trim() || null : null;
}

function steamTime(fileName) {
  const match = STEAM_STAMP.exec(fileName);
  if (!match) return null;
  const [year, month, ...rest] = match.slice(1).map(Number);
  return new Date(year, month - 1, ...rest).getTime();
}

async function entries(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const images = async (dir) => (await entries(dir)).filter((entry) => entry.isFile() && IMAGE.test(entry.name)).map((entry) => entry.name);
const folders = async (dir) => (await entries(dir)).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

async function modified(file) {
  try {
    return Math.round((await fs.promises.stat(file)).mtimeMs);
  } catch {
    return null;
  }
}

async function listCaptures(dir, fileTitle) {
  return Promise.all((await images(dir)).map(async (name) => {
    const file = path.join(dir, name);
    const title = titleFromName(name);
    return { file, title: title && fileTitle(title), takenAt: await modified(file) };
  }));
}

async function listSteam(steamDir, steamTitle) {
  const found = [];
  const users = path.join(steamDir, 'userdata');
  for (const user of await folders(users)) {
    const remote = path.join(users, user, '760', 'remote');
    for (const appId of await folders(remote)) {
      const dir = path.join(remote, appId, 'screenshots');
      for (const name of await images(dir)) {
        const file = path.join(dir, name);
        found.push({ file, title: steamTitle(appId) || null, takenAt: steamTime(name) ?? await modified(file) });
      }
    }
  }
  return found;
}

function createAlbum({ capturesDir, tinkDir, findSteamDir, steamTitle, fileTitle = (title) => title, nativeImage, trash }) {
  let files = new Map();
  const thumbs = new Map();

  async function list() {
    const steamDir = await findSteamDir();
    const found = (await Promise.all([
      listCaptures(capturesDir, fileTitle),
      listCaptures(tinkDir, fileTitle),
      steamDir ? listSteam(steamDir, steamTitle) : [],
    ])).flat().filter((shot) => shot.takenAt !== null);
    found.sort((a, b) => b.takenAt - a.takenAt);
    files = new Map(found.map(({ file }) => [idFor(file), file]));
    for (const id of thumbs.keys()) if (!files.has(id)) thumbs.delete(id);
    return found.map(({ file, title, takenAt }) => ({ id: idFor(file), title, takenAt }));
  }

  async function makeThumb(file) {
    let image;
    try {
      image = await nativeImage.createThumbnailFromPath(file, THUMB_SIZE);
    } catch {
      image = nativeImage.createFromPath(file);
      if (!image.isEmpty()) image = image.resize({ width: THUMB_SIZE.width, quality: 'good' });
    }
    return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(THUMB_QUALITY).toString('base64')}`;
  }

  async function getThumb(id) {
    const file = files.get(id);
    if (!file) return null;
    const kept = thumbs.get(id);
    if (kept) return kept;
    const src = await makeThumb(file);
    if (src) {
      thumbs.set(id, src);
      if (thumbs.size > THUMB_CACHE) thumbs.delete(thumbs.keys().next().value);
    }
    return src;
  }

  async function getShot(id) {
    const file = files.get(id);
    if (!file) return null;
    try {
      const { size } = await fs.promises.stat(file);
      if (size > MAX_SHOT_BYTES) return null;
      return `data:${mimeOf(file)};base64,${(await fs.promises.readFile(file)).toString('base64')}`;
    } catch {
      return null;
    }
  }

  async function remove(id) {
    const file = files.get(id);
    if (!file) return false;
    await trash(file);
    files.delete(id);
    thumbs.delete(id);
    return true;
  }

  return { list, getThumb, getShot, remove };
}

module.exports = { createAlbum, titleFromName, steamTime };
