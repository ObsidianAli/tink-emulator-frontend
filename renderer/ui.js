// The shelf screen: LB/RB (Up/Down) switch Shelves, Left/Right move along one, A (Enter) plays,
// Y (F) flips the selected Case, X (Space) opens it and B (Esc) undoes either. L3 (L) favourites the Game, R3 (H) hides
// it, View (Tab) goes back to the profile picker. Menu (S) opens Settings.
import { createShelf } from './shelf.js';
import { runSetup } from './setup.js';
import { openSettings, settingsOpen } from './settings.js';
import { chooseProfile } from './profiles.js';

const nav = document.getElementById('shelves');
const title = document.getElementById('title');
const message = document.getElementById('message');

let shelves = [];
let current = 0;
// The selected Game on each Shelf, so coming back lands where you left.
const positions = new Map();
let launching = false;
let inSettings = false;
let inPicker = false;
let changing = false;

// Anything unexpected is logged in full and the player only sees a plain message, once per kind of failure.
const reported = new Set();
function report(reason) {
  const text = String((reason && reason.stack) || reason);
  if (reported.has(text)) return;
  reported.add(text);
  window.tink.logError(text).catch(() => {});
  if (!document.querySelector('.dialog-scrim')) {
    showDialog({ message: 'Something went wrong.' });
  }
}
window.addEventListener('error', (event) => report(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => report(event.reason));

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
  const game = shelf.game();
  hints.push({ button: 'a', label: game && game.all ? 'Browse' : 'Play' });
  if (game && !game.all) hints.push({ button: 'l3', label: game.fav ? 'Unfavourite' : 'Favourite' }, { button: 'r3', label: 'Hide' });
  hints.push({ button: 'view', label: 'Profile' }, { button: 'menu', label: 'Settings' });
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
  if (next < 0 || next >= shelves.length) return false;
  openShelf(next, step);
  return true;
}

// Switches profile from the shelf; B on the picker comes back to the same shelf.
async function switchProfile() {
  if (inPicker || launching) return;
  inPicker = true;
  try {
    if (await chooseProfile({ canCancel: true })) await loadLibrary({ fresh: true });
    else if (shelves.length) showHints();
  } finally {
    inPicker = false;
  }
}

// Favourites or hides the selected Game, then shows the Shelves again where they were.
async function changeGame(change) {
  const game = shelf.game();
  if (changing || !game || game.all) return;
  changing = true;
  try {
    await change(game.id);
    await loadLibrary();
  } finally {
    changing = false;
  }
}

async function play() {
  const game = shelf.game();
  if (launching || !game) return;
  launching = true;
  try {
    const result = await window.tink.launch(game.id);
    if (result && result.error) await explain(result);
  } finally {
    launching = false;
  }
}

// A launch failure in plain words, with a way to fix it when there is one.
async function explain({ error, fix, console }) {
  if (fix === 'settings') {
    const ok = await showDialog({ message: error, confirm: 'Open Settings', cancel: 'Not now' });
    if (ok) await goToSettings(console);
  } else if (fix === 'rescan') {
    const ok = await showDialog({ message: error, confirm: 'Rescan', cancel: 'Not now' });
    if (ok) await loadLibrary();
  } else {
    await showDialog({ message: error });
  }
}

async function goToSettings(focusConsole) {
  if (inSettings) return;
  inSettings = true;
  try {
    if (await openSettings({ focusConsole })) {
      shelf.forgetCovers();
      await loadLibrary();
    }
    else showHints();
  } finally {
    inSettings = false;
  }
}

// Returns the name of the sound the action made, if any.
listenForInput((action) => {
  const dialog = dialogTakesInput(action);
  if (dialog) return dialog.sound;
  if (settingsOpen() || inSettings || inPicker) return null;
  if (action === 'view') {
    switchProfile();
    return 'confirm';
  }
  if (action === 'menu') {
    goToSettings();
    return 'confirm';
  }
  if (shelves.length === 0) return null;
  if (action === 'left' || action === 'right') {
    if (!shelf.select(shelf.selected() + (action === 'right' ? 1 : -1))) return null;
    showTitle();
    showHints();
    return 'move';
  }
  if (action === 'up' || action === 'lb') return switchShelf(-1) ? 'shelf' : null;
  if (action === 'down' || action === 'rb') return switchShelf(1) ? 'shelf' : null;
  if (action === 'fav' || action === 'hide') {
    if (changing || !shelf.game() || shelf.game().all) return null;
    changeGame(action === 'fav' ? window.tink.toggleFavourite : window.tink.hideGame);
    return 'toggle';
  }
  if (action === 'a') {
    if (shelf.game() && shelf.game().all) {
      const first = shelves.findIndex((item) => item.console !== 'recent' && item.console !== 'favourites');
      if (first < 0) return null;
      openShelf(first, 1);
      return 'shelf';
    }
    if (launching || !shelf.game()) return null;
    play();
    return 'launch';
  }
  const moves = { y: shelf.flip, x: shelf.open, b: shelf.back };
  if (!moves[action] || !moves[action]()) return null;
  showHints();
  return { y: 'flip', x: 'open', b: 'back' }[action];
});

// Reads the library again and shows it, staying on the same Shelf and Game when they're still there.
// fresh starts from the first Shelf instead, for a newly chosen profile.
async function loadLibrary({ fresh = false } = {}) {
  const before = !fresh && shelves[current] && shelves[current].console;
  const selected = shelf.selected();
  const library = await window.tink.getLibrary();
  shelves = library.shelves;
  positions.clear();
  if (shelves.length === 0) {
    shelf.show({ console: '', name: '', games: [] }, 0);
    nav.replaceChildren();
    title.textContent = '';
    showMessage('No games found.');
    setHints([{ button: 'view', label: 'Profile' }, { button: 'menu', label: 'Settings' }]);
    return;
  }
  showMessage('');
  const found = shelves.findIndex((item) => item.console === before);
  current = Math.max(0, found);
  shelf.show(shelves[current], found >= 0 ? selected : 0);
  renderNav();
  showTitle();
  showHints();
}

const NOTICE_MS = 4000;

// A short note, like "Updated to 0.2.0", that goes away on its own.
async function showNotice() {
  const text = await window.tink.getNotice();
  if (!text) return;
  const notice = document.getElementById('notice');
  notice.textContent = text;
  notice.hidden = false;
  setTimeout(() => { notice.hidden = true; }, NOTICE_MS);
}

const UPDATE_POLL_MS = 15 * 1000;

// Offers a downloaded update once per start, and only while the shelf is idle (never during play).
function offerUpdate() {
  const timer = setInterval(async () => {
    if (launching || inSettings || inPicker || settingsOpen() || document.querySelector('.dialog-scrim')) return;
    const version = await window.tink.getUpdate();
    if (!version) return;
    clearInterval(timer);
    const ok = await showDialog({ message: `Update available (${version}).`, confirm: 'Update', cancel: 'Not now', sound: 'confirm' });
    if (ok) await window.tink.applyUpdate();
  }, UPDATE_POLL_MS);
}

async function start() {
  const setup = await window.tink.getSetup();
  if (setup.needed) await runSetup(setup);
  inPicker = true;
  try {
    await chooseProfile();
  } finally {
    inPicker = false;
  }
  await loadLibrary();
  showNotice().catch(() => {});
  offerUpdate();
}

start();
