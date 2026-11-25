import * as THREE from '../node_modules/three/build/three.module.js';

const TEXTURE_HEIGHT = 512;
const KEEP = 64;
const KEEP_SHARP = 4;
const SPINE_WIDTH = 48;
const SPINE_DIM = 0.55;
const CROP_LIMIT = 0.25;
const TINT_SAMPLES = 16;

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
  const canvas = canvasFor(aspect, Math.min(height, Math.max(TEXTURE_HEIGHT, img.naturalHeight)));
  // Copying a GPU canvas into an sRGB texture stalls the screen for 15 ms or more, so this one stays on the CPU.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

async function coverCanvas(game, aspect, height) {
  const cover = await window.tink.getCover(game.id);
  try {
    if (cover && cover.src) return { canvas: drawImage(await loadImage(cover.src), aspect, height), art: true };
  } catch {
  }
  const colour = (cover && cover.plain && cover.plain.colour) || token('--surface-raised');
  return { canvas: await drawPlain(game.title, colour, aspect, height), art: false };
}

function createCache(keep, make) {
  const entries = new Map();

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
    const { canvas, art } = await coverCanvas(game, aspect, TEXTURE_HEIGHT);
    const tint = averageColour(canvas);
    const texture = makeTexture(canvas, anisotropy);
    const spine = makeTexture(await drawSpine(game.title, tint, spineAspect), anisotropy);
    return { texture, spine, tint, art: art ? canvas : null, textures: [texture, spine] };
  });

  const sharp = createCache(KEEP_SHARP, async (game, aspect, height) => {
    const texture = makeTexture((await coverCanvas(game, aspect, height)).canvas, anisotropy);
    return { texture, textures: [texture] };
  });

  function get(game, aspect, spineAspect, inUse) {
    return covers(game.id, inUse, game, aspect, spineAspect);
  }

  function getSharp(game, aspect, height, inUse) {
    return sharp(game.id, inUse, game, aspect, height);
  }

  function forget() {
    covers.clear();
    sharp.clear();
  }

  return { get, getSharp, forget };
}

export { createTextures };
