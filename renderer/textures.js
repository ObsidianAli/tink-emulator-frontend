// Turns a Game's Cover (or Plain cover) into a texture sized for its Case, plus the colour for the background tint,
// and composes the Back and the Disc label from it. Textures are made on demand and only the most recent few are kept.
import * as THREE from '../node_modules/three/build/three.module.js';

const TEXTURE_HEIGHT = 512;
const KEEP = 64;
// Covers closer than this to the Case's shape are cropped to fill it; others are fitted whole.
const CROP_LIMIT = 0.25;
const TINT_SAMPLES = 16;
// Only the selected Case ever shows its Back or Disc, so a handful is plenty.
const KEEP_DETAILS = 4;
// Back and Disc label are made sharper than Covers, since only one is on screen.
const DETAIL_SCALE = Math.min(window.devicePixelRatio || 1, 2);
const BACK_BLUR = 0.04;
const BACK_MARGIN = 0.08;
const BACK_DIM = 0.6;
const HOLE = 0.07;
const HUB = 0.17;

const tokens = new Map();

function token(name) {
  if (!tokens.has(name)) tokens.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  return tokens.get(name);
}

function canvasFor(aspect) {
  const canvas = document.createElement('canvas');
  canvas.height = TEXTURE_HEIGHT;
  canvas.width = Math.round(TEXTURE_HEIGHT * aspect);
  return canvas;
}

async function loadImage(src) {
  const img = new Image();
  if (src.startsWith('https:')) img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

// Steam's tall library image, or its wide header when a game has no tall one.
async function loadSteamImage(art) {
  try {
    return await loadImage(art.cover);
  } catch {
    return loadImage(art.fallback);
  }
}

function drawImage(img, aspect) {
  const canvas = canvasFor(aspect);
  const ctx = canvas.getContext('2d');
  const crop = Math.abs(img.naturalWidth / img.naturalHeight / aspect - 1) <= CROP_LIMIT;
  const fit = crop ? Math.max : Math.min;
  const scale = fit(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  if (!crop) {
    ctx.fillStyle = token('--surface');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas;
}

// Splits a Title into lines that fit the width.
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// A Plain cover: the Title on its Console's colour.
async function drawPlain(title, colour, aspect) {
  const canvas = canvasFor(aspect);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const size = Math.round(canvas.width / 9);
  const font = `${token('--weight-bold')} ${size}px Inter`;
  await document.fonts.load(font);
  ctx.font = font;
  ctx.fillStyle = token('--text');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, title, canvas.width * 0.8);
  const lineHeight = size * 1.25;
  const top = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((text, i) => ctx.fillText(text, canvas.width / 2, top + i * lineHeight));
  return canvas;
}

// The average colour of a canvas, for the background tint.
function averageColour(canvas) {
  const small = document.createElement('canvas');
  small.width = TINT_SAMPLES;
  small.height = TINT_SAMPLES;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, TINT_SAMPLES, TINT_SAMPLES);
  const { data } = ctx.getImageData(0, 0, TINT_SAMPLES, TINT_SAMPLES);
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
  }
  const count = data.length / 4;
  return `rgb(${sum.map((v) => Math.round(v / count)).join(' ')})`;
}

function makeTexture(canvas, anisotropy) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function fontFor(size, weight) {
  return `${token(weight)} ${Math.round(size)}px Inter`;
}

// The Back: the Cover blurred and darkened, the Title at the top and the Console name at the bottom.
async function drawBack(cover, title, consoleName) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cover.width * DETAIL_SCALE);
  canvas.height = Math.round(cover.height * DETAIL_SCALE);
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const blur = width * BACK_BLUR;
  ctx.filter = `blur(${blur}px)`;
  // Drawn past the edges so the blur doesn't fade them.
  ctx.drawImage(cover, -blur * 2, -blur * 2, width + blur * 4, height + blur * 4);
  ctx.filter = 'none';
  ctx.globalAlpha = BACK_DIM;
  ctx.fillStyle = token('--scrim');
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  const titleSize = width / 10;
  const smallSize = titleSize * (parseFloat(token('--text-body')) / parseFloat(token('--text-title')));
  const titleFont = fontFor(titleSize, '--weight-bold');
  const smallFont = fontFor(smallSize, '--weight-regular');
  await Promise.all([document.fonts.load(titleFont), document.fonts.load(smallFont)]);
  const margin = width * BACK_MARGIN;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = titleFont;
  ctx.fillStyle = token('--text');
  const lineHeight = titleSize * parseFloat(token('--line-height'));
  wrap(ctx, title, width - margin * 2).forEach((line, i) => ctx.fillText(line, margin, margin + i * lineHeight));
  ctx.font = smallFont;
  ctx.fillStyle = token('--muted');
  ctx.textBaseline = 'bottom';
  ctx.fillText(consoleName, margin, height - margin);
  return canvas;
}

// The Disc label: the middle of the Cover cropped into a circle, with a hub ring and a hole in the centre.
function drawLabel(cover) {
  const canvas = document.createElement('canvas');
  const size = Math.round(Math.max(cover.width, cover.height) * DETAIL_SCALE);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const circle = (radius) => {
    ctx.beginPath();
    ctx.arc(r, r, radius, 0, Math.PI * 2);
  };
  circle(r);
  ctx.clip();
  const scale = Math.max(size / cover.width, size / cover.height);
  ctx.drawImage(cover, (size - cover.width * scale) / 2, (size - cover.height * scale) / 2, cover.width * scale, cover.height * scale);
  circle(r * HUB);
  ctx.fillStyle = token('--muted');
  ctx.fill();
  circle(r * HOLE);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill();
  return canvas;
}

async function coverCanvas(game, aspect) {
  const cover = game.art ? null : await window.tink.getCover(game.id);
  try {
    if (game.art) return drawImage(await loadSteamImage(game.art), aspect);
    if (cover && cover.src) return drawImage(await loadImage(cover.src), aspect);
  } catch {
    // offline, or a broken cached file: a Plain cover instead
  }
  const colour = (cover && cover.plain && cover.plain.colour) || token('--surface-raised');
  return drawPlain(game.title, colour, aspect);
}

// A most-recently-used cache of promises for texture sets, disposing what falls out.
function createCache(keep, make) {
  const entries = new Map();

  // Drops the oldest entries no live Case is showing.
  function trim(inUse) {
    for (const [id, entry] of entries) {
      if (entries.size <= keep) return;
      if (inUse.has(id)) continue;
      entries.delete(id);
      entry.then((made) => made && made.textures.forEach((texture) => texture.dispose()));
    }
  }

  function get(id, inUse, ...args) {
    if (entries.has(id)) {
      const entry = entries.get(id);
      entries.delete(id);
      entries.set(id, entry);
      return entry;
    }
    const entry = make(...args).catch(() => null);
    entries.set(id, entry);
    trim(inUse);
    return entry;
  }

  // Drops everything, so the next lookup is made fresh.
  get.clear = () => {
    for (const entry of entries.values()) entry.then((made) => made && made.textures.forEach((texture) => texture.dispose()));
    entries.clear();
  };
  return get;
}

function createTextures(maxAnisotropy) {
  const anisotropy = Math.min(4, maxAnisotropy);

  const covers = createCache(KEEP, async (game, aspect) => {
    const canvas = await coverCanvas(game, aspect);
    const texture = makeTexture(canvas, anisotropy);
    return { texture, tint: averageColour(canvas), textures: [texture] };
  });

  const details = createCache(KEEP_DETAILS, async (game, cover, consoleName) => {
    const back = makeTexture(await drawBack(cover, game.title, consoleName), anisotropy);
    const label = makeTexture(drawLabel(cover), anisotropy);
    return { back, label, textures: [back, label] };
  });

  // Resolves to { texture, tint }, or null if the Cover couldn't be made at all.
  // inUse: ids of the Games whose textures must not be dropped.
  function get(game, aspect, inUse) {
    return covers(game.id, inUse, game, aspect);
  }

  // Resolves to { back, label } composed from the Game's Cover, or null.
  async function getDetails(game, aspect, consoleName, inUse) {
    const made = await get(game, aspect, inUse);
    if (!made) return null;
    return details(game.id, inUse, game, made.texture.image, consoleName);
  }

  // Forgets every texture made so far, for when the saved Covers were replaced.
  function forget() {
    covers.clear();
    details.clear();
  }

  return { get, getDetails, forget };
}

export { createTextures };
