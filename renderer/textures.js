// Turns a Game's Cover (or Plain cover) into a texture sized for its Case, plus its spine and the colour for the
// background tint, and composes the Back and the Disc label from it. Every Case on the Shelf gets a small Cover; only
// the selected one gets a sharp Cover as big as it shows on screen. Only the most recent few of each are kept.
import * as THREE from '../node_modules/three/build/three.module.js';

const TEXTURE_HEIGHT = 512;
const KEEP = 64;
// Sharp Covers are made for the selected Case only, so a handful is plenty.
const KEEP_SHARP = 4;
const SPINE_WIDTH = 48;
const SPINE_DIM = 0.55;
// Covers closer than this to the Case's shape are cropped to fill it; others are fitted whole.
const CROP_LIMIT = 0.25;
const TINT_SAMPLES = 16;
const KEEP_DETAILS = 4;
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

function canvasFor(aspect, height) {
  const canvas = document.createElement('canvas');
  canvas.height = height;
  canvas.width = Math.round(height * aspect);
  return canvas;
}

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function drawImage(img, aspect, height) {
  // Never bigger than the image itself, since that would only blur it and use memory.
  const canvas = canvasFor(aspect, Math.min(height, Math.max(TEXTURE_HEIGHT, img.naturalHeight)));
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
async function drawPlain(title, colour, aspect, height) {
  const canvas = canvasFor(aspect, height);
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

// The spine: the Title written top to bottom on a darker shade of the Cover's colour.
async function drawSpine(title, tint, aspect) {
  const canvas = document.createElement('canvas');
  canvas.width = SPINE_WIDTH;
  canvas.height = Math.round(SPINE_WIDTH / aspect);
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = SPINE_DIM;
  ctx.fillStyle = token('--scrim');
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  const font = fontFor(width * 0.42, '--weight-bold');
  await document.fonts.load(font);
  ctx.font = font;
  ctx.fillStyle = token('--text');
  ctx.textBaseline = 'middle';
  ctx.translate(width / 2, width / 2);
  ctx.rotate(Math.PI / 2);
  const room = height - width;
  let text = title;
  while (text.length > 1 && ctx.measureText(text).width > room) text = text.slice(0, -2) + '…';
  ctx.fillText(text, 0, 0);
  return canvas;
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
  canvas.width = cover.width;
  canvas.height = cover.height;
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
  const size = Math.max(cover.width, cover.height);
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

async function coverCanvas(game, aspect, height) {
  const cover = await window.tink.getCover(game.id);
  try {
    if (cover && cover.src) return drawImage(await loadImage(cover.src), aspect, height);
  } catch {
    // a broken cached file: a Plain cover instead
  }
  const colour = (cover && cover.plain && cover.plain.colour) || token('--surface-raised');
  return drawPlain(game.title, colour, aspect, height);
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
  // Side Cases are seen at a steep angle, where anisotropic filtering keeps their Covers from smearing.
  const anisotropy = Math.min(8, maxAnisotropy);

  const covers = createCache(KEEP, async (game, aspect, spineAspect) => {
    const canvas = await coverCanvas(game, aspect, TEXTURE_HEIGHT);
    const tint = averageColour(canvas);
    const texture = makeTexture(canvas, anisotropy);
    const spine = makeTexture(await drawSpine(game.title, tint, spineAspect), anisotropy);
    return { texture, spine, tint, textures: [texture, spine] };
  });

  const sharp = createCache(KEEP_SHARP, async (game, aspect, height) => {
    const texture = makeTexture(await coverCanvas(game, aspect, height), anisotropy);
    return { texture, textures: [texture] };
  });

  const details = createCache(KEEP_DETAILS, async (game, cover, consoleName) => {
    const back = makeTexture(await drawBack(cover, game.title, consoleName), anisotropy);
    const label = makeTexture(drawLabel(cover), anisotropy);
    return { back, label, textures: [back, label] };
  });

  // Resolves to { texture, spine, tint }, or null if the Cover couldn't be made at all.
  // inUse: ids of the Games whose textures must not be dropped.
  function get(game, aspect, spineAspect, inUse) {
    return covers(game.id, inUse, game, aspect, spineAspect);
  }

  // Resolves to { texture } with the Cover height pixels tall, or null.
  function getSharp(game, aspect, height, inUse) {
    return sharp(game.id, inUse, game, aspect, height);
  }

  // Resolves to { back, label } composed from the Game's sharp Cover, or null.
  async function getDetails(game, aspect, height, consoleName, inUse) {
    const made = await getSharp(game, aspect, height, inUse);
    if (!made) return null;
    return details(game.id, inUse, game, made.texture.image, consoleName);
  }

  // Forgets every texture made so far, for when the saved Covers were replaced.
  function forget() {
    covers.clear();
    sharp.clear();
    details.clear();
  }

  return { get, getSharp, getDetails, forget };
}

export { createTextures };
