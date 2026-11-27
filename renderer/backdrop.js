const root = document.createElement('div');
root.id = 'backdrop';

function part(name, tag = 'div') {
  const node = document.createElement(tag);
  node.className = name;
  return node;
}

const layers = [0, 1].map(() => part('backdrop-art', 'canvas'));
const pictures = [0, 1].map(() => part('backdrop-picture'));
const blobs = ['a', 'b', 'c'].map((name) => part(`backdrop-blob backdrop-blob-${name}`));
root.append(...layers, part('backdrop-shade'), ...blobs, part('backdrop-vignette'), ...pictures, part('backdrop-dim'), part('backdrop-fade'));
document.body.prepend(root);

const KEEP_HEROES = 3;

let mode = 'tint';
let source = null;
let colour = '';
let game = null;
let resting = false;

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const number = (name) => parseFloat(token(name));

function paint(canvas, image) {
  canvas.width = number('--art-width');
  canvas.height = number('--art-height');
  const ctx = canvas.getContext('2d');
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height) * number('--art-overscan');
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.filter = `blur(${token('--art-blur')}) saturate(${token('--art-saturate')})`;
  ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) * number('--art-focus'), w, h);
}

function crossfade(pair, fill) {
  const [old, next] = pair;
  pair.reverse();
  next.classList.remove('shown', 'gone');
  next.style.transition = 'none';
  void next.offsetWidth;
  next.style.transition = '';
  fill(next);
  next.classList.add('shown');
  old.classList.remove('shown');
}

function show() {
  if (mode !== 'art' || !source) layers[0].classList.replace('shown', 'gone');
  else crossfade(layers, (next) => paint(next, source));
}

const pictured = () => mode === 'picture' || mode === 'soft';
const heroes = new Map();
let shown = null;
let wanted = null;
let swapping = false;
let turn = 0;
let restTimer = 0;

const fades = () => Promise.allSettled(pictures.flatMap((layer) => layer.getAnimations()).map((fade) => fade.finished));

async function swap(key, content) {
  wanted = { key, content };
  if (swapping) return;
  swapping = true;
  await fades();
  swapping = false;
  if (!wanted || wanted.key === shown) return;
  const next = wanted;
  const old = pictures[0];
  shown = next.key;
  crossfade(pictures, (layer) => layer.replaceChildren(next.content, part('backdrop-picture-shade')));
  await fades();
  if (shown === next.key) old.replaceChildren();
}

function smallCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = number('--art-width');
  canvas.height = number('--art-height');
  return canvas;
}

function soften(image) {
  const small = smallCanvas();
  const { width, height } = small;
  const flat = small.getContext('2d');
  if (image) {
    const scale = Math.max(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    flat.drawImage(image, (width - w) / 2, (height - h) * number('--picture-focus'), w, h);
  } else {
    flat.fillStyle = colour;
    flat.fillRect(0, 0, width, height);
  }
  const canvas = smallCanvas();
  const ctx = canvas.getContext('2d');
  const zoom = number('--soft-zoom');
  ctx.filter = `blur(${token('--soft-blur')}) saturate(${token('--soft-saturate')})`;
  ctx.drawImage(small, (width - width * zoom) / 2, (height - height * zoom) / 2, width * zoom, height * zoom);
  ctx.filter = 'none';
  ctx.fillStyle = token('--soft-shade');
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

async function loadHero(id, current) {
  const hero = await window.tink.getHero(id);
  if (!hero || !current()) return null;
  if (mode === 'soft') {
    const bytes = Uint8Array.fromBase64(hero.src.slice(hero.src.indexOf(',') + 1));
    const bitmap = await createImageBitmap(new Blob([bytes]), { resizeHeight: number('--art-height') * 2, resizeQuality: 'medium' });
    const canvas = soften(bitmap);
    bitmap.close();
    return canvas;
  }
  const image = new Image();
  image.src = hero.src;
  return image;
}

function cancel() {
  clearTimeout(restTimer);
  turn++;
  wanted = null;
}

async function present() {
  cancel();
  if (!game || resting || !pictured()) return;
  const id = game;
  const run = turn;
  const current = () => run === turn;
  const showCover = () => {
    if (current()) swap(source || colour, soften(source));
  };
  const late = setTimeout(showCover, number('--picture-wait'));
  let hero = heroes.get(id);
  try {
    hero ||= await loadHero(id, current);
    if (hero && hero.decode) await hero.decode();
  } catch {
    hero = null;
  }
  clearTimeout(late);
  if (!current()) return;
  if (!hero) {
    showCover();
    return;
  }
  heroes.delete(id);
  heroes.set(id, hero);
  if (heroes.size > KEEP_HEROES) heroes.delete(heroes.keys().next().value);
  swap(hero, hero);
}

function settle() {
  cancel();
  if (pictured()) restTimer = setTimeout(present, number('--picture-rest'));
}

function clearPictures() {
  cancel();
  heroes.clear();
  shown = null;
  for (const layer of pictures) {
    layer.classList.remove('shown');
    layer.replaceChildren();
  }
}

export function forgetPictures() {
  heroes.clear();
  game = null;
}

export function setBackground(next) {
  if (next === mode) return;
  mode = next;
  document.body.dataset.background = mode;
  show();
  heroes.clear();
  if (pictured()) present();
  else clearPictures();
}

export function setArt(image, tint, id) {
  const changed = image !== source;
  if (!changed && id === game) return;
  source = image;
  colour = tint;
  game = id;
  if (mode === 'art' && changed) show();
  settle();
}

export function rest(on) {
  resting = on;
  document.body.classList.toggle('resting', on);
  if (on) clearPictures();
  else settle();
}

document.body.dataset.background = mode;
document.addEventListener('visibilitychange', () => document.body.classList.toggle('window-hidden', document.hidden));
window.tink.getSettings().then((state) => setBackground(state.background));
