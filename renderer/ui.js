// The plain list screen: Up/Down to move, Enter to play.
const list = document.getElementById('games');
const message = document.getElementById('message');

let games = [];
let selected = 0;
let launching = false;

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

// Library image first; if it doesn't exist, the wide header image.
function makeImage(art) {
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
    item.append(makeImage(game.art), game.title);
    return item;
  }));
  const current = list.children[selected];
  if (current) current.scrollIntoView({ block: 'nearest' });
}

async function play() {
  if (launching || !games[selected]) return;
  launching = true;
  try {
    await window.tink.launch(games[selected].appId);
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
  games = library.games;
  if (!library.steamFound) showMessage("Steam isn't installed on this PC.");
  else if (games.length === 0) showMessage('No Steam games are installed yet.');
  render();
}

start();
