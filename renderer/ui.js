// The plain list screen: Up/Down to move, A (Enter) to play.
const list = document.getElementById('games');
const message = document.getElementById('message');

let games = [];
let selected = 0;
let launching = false;

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

const covers = new Map();

// A Plain cover: the title on its console's colour.
function plainCover(game, colour) {
  const box = document.createElement('div');
  box.className = 'plain-cover';
  box.style.backgroundColor = colour;
  box.textContent = game.title;
  return box;
}

// Emulated games: an empty box until the main process has found the cover.
function emulatedCover(game) {
  const cover = covers.get(game.id);
  if (!cover) {
    const box = document.createElement('div');
    box.className = 'no-cover';
    return box;
  }
  if (cover.plain) return plainCover(game, cover.plain.colour);
  const img = document.createElement('img');
  img.alt = '';
  img.src = cover.src;
  return img;
}

// Steam games: library image first; if it doesn't exist, the wide header image.
function makeImage(game) {
  const { art } = game;
  if (!art) return emulatedCover(game);
  const img = document.createElement('img');
  img.alt = '';
  img.src = art.cover;
  img.addEventListener('error', () => {
    if (img.src !== art.fallback) img.src = art.fallback;
  }, { once: true });
  return img;
}

function render() {
  list.replaceChildren(...games.map((game, index) => {
    const item = document.createElement('li');
    item.className = index === selected ? 'selected' : '';
    const consoleName = document.createElement('span');
    consoleName.className = 'console';
    consoleName.textContent = game.consoleName;
    item.append(makeImage(game), game.title, consoleName);
    return item;
  }));
  const current = list.children[selected];
  if (current) current.scrollIntoView({ block: 'nearest' });
}

async function play() {
  if (launching || !games[selected]) return;
  launching = true;
  try {
    const result = await window.tink.launch(games[selected].id);
    if (result && result.error) await showDialog({ message: result.error });
  } finally {
    launching = false;
  }
}

listenForInput((action) => {
  if (dialogTakesInput(action)) return;
  if (action === 'down') selected = Math.min(selected + 1, games.length - 1);
  else if (action === 'up') selected = Math.max(selected - 1, 0);
  else if (action === 'a') return play();
  else return;
  render();
});

async function start() {
  const library = await window.tink.getLibrary();
  // Grouped by console, then by title.
  games = library.games.sort((a, b) => a.consoleName.localeCompare(b.consoleName) || a.title.localeCompare(b.title));
  if (games.length === 0) showMessage('No games found yet.');
  else setHints([{ button: 'a', label: 'Play' }]);
  render();
  loadCovers();
}

async function loadCovers() {
  await Promise.all(games.filter((game) => !game.art).map(async (game) => {
    const cover = await window.tink.getCover(game.id);
    if (!cover) return;
    covers.set(game.id, cover);
    scheduleRender();
  }));
}

// Covers arrive one by one; redraw at most once a frame.
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

start();
