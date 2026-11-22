// Turns a Game's Cover (or Plain cover) into a texture sized for its Case, plus the colour for the background tint.
// Textures are made on demand and only the most recent few are kept.
import * as THREE from '../node_modules/three/build/three.module.js';

const TEXTURE_HEIGHT = 512;
const KEEP = 64;
// Covers closer than this to the Case's shape are cropped to fill it; others are fitted whole.
const CROP_LIMIT = 0.25;
const TINT_SAMPLES = 16;

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

function createTextures(maxAnisotropy) {
  const entries = new Map();

  async function make(game, aspect) {
    const canvas = await coverCanvas(game, aspect);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, maxAnisotropy);
    return { texture, tint: averageColour(canvas) };
  }

  // Drops the oldest textures no live Case is showing.
  function trim(inUse) {
    for (const [id, entry] of entries) {
      if (entries.size <= KEEP) return;
      if (inUse.has(id)) continue;
      entries.delete(id);
      entry.then((made) => made && made.texture.dispose());
    }
  }

  // Resolves to { texture, tint }, or null if the Cover couldn't be made at all.
  function get(game, aspect, inUse) {
    if (entries.has(game.id)) {
      const entry = entries.get(game.id);
      entries.delete(game.id);
      entries.set(game.id, entry);
      return entry;
    }
    const entry = make(game, aspect).catch(() => null);
    entries.set(game.id, entry);
    trim(inUse);
    return entry;
  }

  return { get };
}

export { createTextures };
