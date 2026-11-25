const root = document.createElement('div');
root.id = 'backdrop';
const layers = [0, 1].map(() => {
  const canvas = document.createElement('canvas');
  canvas.className = 'backdrop-art';
  return canvas;
});
const blobs = ['a', 'b', 'c'].map((name) => {
  const blob = document.createElement('div');
  blob.className = `backdrop-blob backdrop-blob-${name}`;
  return blob;
});
const shade = document.createElement('div');
shade.className = 'backdrop-shade';
const vignette = document.createElement('div');
vignette.className = 'backdrop-vignette';
root.append(...layers, shade, ...blobs, vignette);
document.body.prepend(root);

let mode = 'tint';
let source = null;
let front = 0;

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function paint(canvas, image) {
  canvas.width = parseFloat(token('--art-width'));
  canvas.height = parseFloat(token('--art-height'));
  const ctx = canvas.getContext('2d');
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height) * parseFloat(token('--art-overscan'));
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.filter = `blur(${token('--art-blur')}) saturate(${token('--art-saturate')})`;
  ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) * parseFloat(token('--art-focus')), w, h);
}

function show() {
  const current = layers[front];
  if (mode !== 'art' || !source) {
    current.classList.replace('shown', 'gone');
    return;
  }
  front = 1 - front;
  const next = layers[front];
  next.className = 'backdrop-art';
  next.style.transition = 'none';
  void next.offsetWidth;
  next.style.transition = '';
  paint(next, source);
  next.classList.add('shown');
  current.classList.remove('shown');
}

export function setBackground(next) {
  if (next === mode) return;
  mode = next;
  document.body.dataset.background = mode;
  show();
}

export function setArt(image) {
  if (image === source) return;
  source = image;
  if (mode === 'art') show();
}

export function rest(resting) {
  document.body.classList.toggle('resting', resting);
}

document.body.dataset.background = mode;
document.addEventListener('visibilitychange', () => document.body.classList.toggle('window-hidden', document.hidden));
window.tink.getSettings().then((state) => setBackground(state.background));
