// The shelf screen: LB/RB (Page Up/Down) switch Shelves, Left/Right move along one, A (Enter) plays,
// Y (F) flips the selected Case, X (Space) opens it and B (Esc) undoes either. L3 (L) favourites the Game, R3 (H) hides
// it, View (Tab) goes back to the profile picker. Menu (S) opens the Game's panel: Favourite, Hide and Game info.
// Down moves into the row of icons under the title (profile, Controllers, Settings, Power), Left/Right move along it,
// A opens one and Up or B goes back to the shelf. Comma opens Settings; with no games on the Shelf, Menu does too.
import { createShelf } from './shelf.js';
import { runSetup } from './setup.js';
import { openSettings, settingsOpen } from './settings.js';
import { openCaseMenu, caseMenuOpen } from './casemenu.js';
import { openInfo, infoOpen } from './info.js';
import { chooseProfile, badge } from './profiles.js';
import { openPanel, updatePanel, panelOpen } from './panel.js';

const nav = document.getElementById('shelves');
const title = document.getElementById('title');
const message = document.getElementById('message');
const tray = document.getElementById('tray');

let shelves = [];
let current = 0;
// The selected Game on each Shelf, so coming back lands where you left.
const positions = new Map();
let launching = false;
let inSettings = false;
let inPicker = false;
let inPanel = false;
// False until the library has loaded once, so keys meant for setup don't move into the icon row.
let ready = false;
let changing = false;
let inMenu = false;

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

// The shelf has no button hints; this just puts focus back on the icon row when it was in there.
function showHints() {
  setHints([]);
  focusTray();
}

// The row of icons under the title. To add one, add an entry here: a name, how to draw it, and what A does.
const trayIcons = [
  { name: 'Profile', draw: (profile) => badge(profile), activate: () => switchProfile() },
  { name: 'Controllers', draw: () => controller(), activate: () => showControllers() },
  { name: 'Settings', draw: () => gear(), activate: () => goToSettings() },
  { name: 'Power', draw: () => power(), activate: () => showPower() },
];
let trayFocus = -1;

// A simple outline icon from its shapes, [tag, attributes] each.
function icon(...shapes) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const attributes = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const [tag, shape] of shapes) {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(shape)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}

const controller = () => icon(
  ['path', { d: 'M6.5 5h11a4.5 4.5 0 0 1 4.4 3.7l.9 6.3a3.2 3.2 0 0 1-5.6 2.6L15.4 15.5H8.6l-1.8 2.1a3.2 3.2 0 0 1-5.6-2.6l.9-6.3A4.5 4.5 0 0 1 6.5 5z' }],
  ['path', { d: 'M7.5 8.5v4M5.5 10.5h4' }],
  ['circle', { cx: 15.5, cy: 9.5, r: 1.1, fill: 'currentColor', stroke: 'none' }],
  ['circle', { cx: 17.5, cy: 11.8, r: 1.1, fill: 'currentColor', stroke: 'none' }],
);

const gear = () => icon(
  ['circle', { cx: 12, cy: 12, r: 3 }],
  ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }],
);

const power = () => icon(
  ['path', { d: 'M12 3v8' }],
  ['path', { d: 'M6.3 6.8a8 8 0 1 0 11.4 0' }],
);

// Connected controllers by name, without the vendor and product numbers the browser adds in brackets.
function controllerRows() {
  return [...navigator.getGamepads()].filter(Boolean).map((pad) => ({ label: pad.id.replace(/\s*\(.*\)\s*$/, '') || 'Controller' }));
}

// Opens a panel from the icon row. B comes back to the icon.
async function showPanel(options) {
  if (inPanel) return;
  inPanel = true;
  try {
    await openPanel(options);
  } finally {
    inPanel = false;
    showHints();
  }
}

async function showControllers() {
  const refresh = () => updatePanel(controllerRows());
  window.addEventListener('gamepadconnected', refresh);
  window.addEventListener('gamepaddisconnected', refresh);
  try {
    await showPanel({ title: 'Controllers', rows: controllerRows(), empty: 'No controllers' });
  } finally {
    window.removeEventListener('gamepadconnected', refresh);
    window.removeEventListener('gamepaddisconnected', refresh);
  }
}

function showPower() {
  return showPanel({
    title: 'Power',
    rows: [
      { label: 'Sleep', run: () => window.tink.power('sleep') },
      {
        label: 'Shut down',
        run: async () => {
          if (await showDialog({ message: 'Shut down this PC?', confirm: 'Shut down', cancel: 'Not now', sound: 'confirm' })) window.tink.power('shutdown');
        },
      },
      { label: 'Close Tink', run: () => window.tink.power('close') },
    ],
  });
}

// Draws the icons again, for the profile that is current now.
async function renderTray() {
  const { profiles, last } = await window.tink.getProfiles();
  const profile = profiles.find((p) => p.id === last) || profiles[0];
  tray.replaceChildren(...trayIcons.map((icon) => {
    const node = document.createElement('button');
    node.className = 'tray-icon';
    node.setAttribute('aria-label', icon.name);
    node.append(icon.draw(profile));
    return node;
  }));
  focusTray();
}

function focusTray() {
  if (trayFocus >= 0 && tray.children[trayFocus]) tray.children[trayFocus].focus({ preventScroll: true });
}

function leaveTray() {
  trayFocus = -1;
  if (document.activeElement) document.activeElement.blur();
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
    else showHints();
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

// The panel beside the selected Case. The Shelf stays where it is, whatever is picked.
async function openGameMenu() {
  const game = shelf.game();
  if (inMenu || changing || launching || !game || game.all) return;
  inMenu = true;
  try {
    const choice = await openCaseMenu({ fav: game.fav });
    if (choice === 'fav') await changeGame(window.tink.toggleFavourite);
    else if (choice === 'hide') await changeGame(window.tink.hideGame);
    else if (choice === 'info') await openInfo(game);
  } finally {
    inMenu = false;
    showHints();
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
  if (settingsOpen() || inSettings || inPicker || inMenu || caseMenuOpen() || infoOpen() || panelOpen() || inPanel) return null;
  if (action === 'view') {
    switchProfile();
    return 'confirm';
  }
  if (action === 'settings' || (action === 'menu' && (shelves.length === 0 || !shelf.game() || shelf.game().all))) {
    goToSettings();
    return 'confirm';
  }
  if (action === 'menu' && trayFocus < 0) {
    if (changing || launching) return null;
    openGameMenu();
    return 'confirm';
  }
  if (!ready) return null;
  if (trayFocus >= 0) {
    if (action === 'left' || action === 'right') {
      const next = trayFocus + (action === 'right' ? 1 : -1);
      if (next < 0 || next >= trayIcons.length) return null;
      trayFocus = next;
      focusTray();
      return 'move';
    }
    if (action === 'up' || action === 'b') {
      leaveTray();
      return 'move';
    }
    if (action === 'a') {
      trayIcons[trayFocus].activate();
      return 'confirm';
    }
    return null;
  }
  if (action === 'down' && (!shelves.length || shelf.caseState() === 'front')) {
    trayFocus = 0;
    focusTray();
    return 'move';
  }
  if (shelves.length === 0) return null;
  if (action === 'left' || action === 'right') {
    if (!shelf.select(shelf.selected() + (action === 'right' ? 1 : -1))) return null;
    showTitle();
    showHints();
    return 'move';
  }
  if (action === 'lb') return switchShelf(-1) ? 'shelf' : null;
  if (action === 'rb') return switchShelf(1) ? 'shelf' : null;
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
  renderTray().catch(report);
  ready = true;
  shelves = library.shelves;
  positions.clear();
  if (shelves.length === 0) {
    shelf.show({ console: '', name: '', games: [] }, 0);
    nav.replaceChildren();
    title.textContent = '';
    showMessage('No games found.');
    showHints();
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
    if (launching || inSettings || inPicker || inPanel || settingsOpen() || document.querySelector('.dialog-scrim')) return;
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
