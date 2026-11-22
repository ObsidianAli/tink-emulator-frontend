// The plain list screen: Up/Down to move, Enter to play.
const list = document.getElementById('games');
const message = document.getElementById('message');

let games = [];
let selected = 0;
let launching = false;

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

// Steam games: library image first; if it doesn't exist, the wide header image.
// Emulated games have no cover yet, so they get an empty box of the same size.
function makeImage(art) {
  if (!art) {
    const box = document.createElement('div');
    box.className = 'no-cover';
    return box;
  }
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
    item.append(makeImage(game.art), game.title, consoleName);
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
    showMessage(result && result.error ? result.error : '');
  } finally {
    launching = false;
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') selected = Math.min(selected + 1, games.length - 1);
  else if (event.key === 'ArrowUp') selected = Math.max(selected - 1, 0);
  else if (event.key === 'Enter') return play();
  else return;
  render();
});

async function start() {
  const library = await window.tink.getLibrary();
  // Grouped by console, then by title.
  games = library.games.sort((a, b) => a.consoleName.localeCompare(b.consoleName) || a.title.localeCompare(b.title));
  if (games.length === 0) showMessage('No games found yet.');
  render();
}

start();
