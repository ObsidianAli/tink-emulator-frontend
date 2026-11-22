// The shelf screen: LB/RB (Up/Down) switch Shelves, Left/Right move along one, A (Enter) plays,
// Y (F) flips the selected Case, X (Space) opens it and B (Esc) undoes either.
import { createShelf } from './shelf.js';

const nav = document.getElementById('shelves');
const title = document.getElementById('title');
const message = document.getElementById('message');

let shelves = [];
let current = 0;
// The selected Game on each Shelf, so coming back lands where you left.
const positions = new Map();
let launching = false;

const shelf = createShelf(document.getElementById('shelf'), {
  onTint: (colour) => document.body.style.setProperty('--tint', colour),
});

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function renderNav() {
  nav.replaceChildren(...shelves.map((item, index) => {
    const name = document.createElement('span');
    name.className = index === current ? 'current' : '';
    name.textContent = item.name;
    return name;
  }));
  nav.children[current].scrollIntoView({ inline: 'center', block: 'nearest' });
}

function showTitle() {
  const game = shelf.game();
  title.textContent = game ? game.title : '';
}

// The hints for what the selected Case can do next.
function showHints() {
  const state = shelf.caseState();
  const hints = [];
  if (shelves.length > 1) hints.push({ button: ['lb', 'rb'], label: 'Shelf' });
  if (state !== 'open') hints.push({ button: 'y', label: 'Flip' }, { button: 'x', label: 'Open' });
  if (state !== 'front') hints.push({ button: 'b', label: 'Back' });
  hints.push({ button: 'a', label: 'Play' });
  setHints(hints);
}

function openShelf(index, from = 0) {
  positions.set(current, shelf.selected());
  current = index;
  shelf.show(shelves[current], positions.get(current) || 0, from);
  renderNav();
  showTitle();
  showHints();
}

function switchShelf(step) {
  const next = current + step;
  if (next < 0 || next >= shelves.length) return;
  openShelf(next, step);
}

async function play() {
  const game = shelf.game();
  if (launching || !game) return;
  launching = true;
  try {
    const result = await window.tink.launch(game.id);
    if (result && result.error) await showDialog({ message: result.error });
  } finally {
    launching = false;
  }
}

listenForInput((action) => {
  if (dialogTakesInput(action) || shelves.length === 0) return;
  if (action === 'left' || action === 'right') {
    if (shelf.select(shelf.selected() + (action === 'right' ? 1 : -1))) {
      showTitle();
      showHints();
    }
  } else if (action === 'up' || action === 'lb') {
    switchShelf(-1);
  } else if (action === 'down' || action === 'rb') {
    switchShelf(1);
  } else if (action === 'a') {
    play();
  } else if (action === 'y') {
    if (shelf.flip()) showHints();
  } else if (action === 'x') {
    if (shelf.open()) showHints();
  } else if (action === 'b') {
    if (shelf.back()) showHints();
  }
});

async function start() {
  const library = await window.tink.getLibrary();
  shelves = library.shelves;
  if (shelves.length === 0) {
    showMessage('No games found yet.');
    return;
  }
  openShelf(0);
}

start();
