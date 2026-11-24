const root = document.getElementById('loading');
const cover = document.getElementById('loading-cover');
// A slow Cover can't hold back the loading screen for longer than this; it fades in when it arrives.
const ART_WAIT_MS = 300;

let current = null;

function copy(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

export async function showLoading(game, art) {
  current = game;
  root.hidden = false;
  setHints([]);
  cover.replaceChildren();
  cover.className = '';
  cover.style.aspectRatio = '';
  const height = Math.round(cover.clientHeight * (window.devicePixelRatio || 1));
  const drawn = art(game, height).catch(() => null).then((made) => {
    if (current !== game) return;
    if (made && made.image) {
      cover.style.aspectRatio = made.aspect;
      cover.append(copy(made.image));
    } else {
      cover.textContent = game.title;
      cover.classList.add('plain');
    }
    cover.classList.add('shown');
  });
  await Promise.race([drawn, new Promise((resolve) => setTimeout(resolve, ART_WAIT_MS))]);
}

export function hideLoading() {
  current = null;
  root.hidden = true;
  cover.replaceChildren();
}

export const loadingOpen = () => !root.hidden;
