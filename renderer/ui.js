import { createShelf } from './shelf.js';
import { grid } from './grid.js';
import { runSetup } from './setup.js';
import { openSettings, hideSettings, settingsOpen } from './settings.js';
import { openStore, hideStore } from './store.js';
import { openCaseMenu, openMenu, caseMenuOpen } from './casemenu.js';
import { openAlbum, hideAlbum } from './album.js';
import { openNews, hideNews, checkNews, newsTrayIcon } from './news.js';
import { openInfo, infoOpen } from './info.js';
import { chooseProfile, closeProfiles } from './profiles.js';
import { badge } from './badge.js';
import { focusGlow } from './dom.js';
import { transition, screen, changingScreen, fadeToBlack } from './transition.js';
import { openPanel, updatePanel, panelOpen } from './panel.js';
import { showLoading, hideLoading, loadingOpen } from './loading.js';
import { trayDrawing } from './icons.js';
import './clock.js';
import { setBackground, setArt, rest } from './backdrop.js';

const main = document.querySelector('main');
const allGamesButton = document.getElementById('all-games');
const title = document.getElementById('title');
const message = document.getElementById('message');
const tray = document.getElementById('tray');
const homeProfiles = document.getElementById('home-profiles');
const homeLabel = document.createElement('span');
homeLabel.id = 'home-label';
const trayLabel = document.createElement('span');
trayLabel.id = 'tray-label';

let row = [];
let games = [];
let sort = 'recent';
let inGrid = false;
let sorting = false;
let launching = false;
let inSettings = false;
let inPicker = false;
let inPanel = false;
// False until the library has loaded once, so keys meant for setup don't move into the icon row.
let ready = false;
let changing = false;
let inMenu = false;
let running = null;
let asleep = false;
let cancelled = false;

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

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

const focusedGame = () => (inGrid ? grid.game() : shelf.game());

const titleOutMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-title-out'));
let titleKey = null;
let titleTimer = 0;

function swapTitle(text) {
  const key = `${shelf.selected()} ${text}`;
  if (key === titleKey) return;
  titleKey = key;
  clearTimeout(titleTimer);
  title.classList.add('away');
  const reveal = () => shelf.whenSettled(() => title.classList.remove('away'));
  if (!title.textContent) {
    title.textContent = text;
    reveal();
    return;
  }
  titleTimer = setTimeout(() => {
    title.textContent = text;
    reveal();
  }, titleOutMs);
}

function showTitle() {
  const game = shelf.game();
  swapTitle(shelf.onButton() ? 'All games' : game ? game.title : '');
  allGamesButton.classList.toggle('selected', shelf.onButton() && trayFocus < 0 && topFocus < 0);
  main.classList.toggle('tray-focused', trayFocus >= 0);
  main.classList.toggle('top-focused', topFocus >= 0);
  shelf.showRing(trayFocus < 0 && topFocus < 0);
}

function showHints() {
  setHints(inGrid ? [{ button: 'a', label: 'Play' }, { button: 'y', label: 'Sort' }, { button: 'b', label: 'Back' }] : []);
  focusTray();
}

const trayIcons = [
  { name: 'Profiles', sound: 'profiles', draw: (profile) => badge(profile), activate: () => switchProfile() },
  { name: 'Store', sound: 'store', draw: () => trayDrawing('store'), activate: () => goToStore() },
  { name: 'Album', sound: 'album', draw: () => trayDrawing('album'), activate: () => goToAlbum() },
  { name: 'News', sound: 'news', draw: () => newsTrayIcon(), activate: () => goToNews() },
  { name: 'Controllers', sound: 'controllers', draw: () => trayDrawing('controllers'), activate: () => showControllers() },
  { name: 'Settings', sound: 'settings', draw: () => trayDrawing('settings'), activate: () => goToSettings() },
  { name: 'Power', sound: 'power', draw: () => trayDrawing('power'), activate: () => showPower() },
];
let trayFocus = -1;
let topFocus = -1;
let topProfiles = [];
let currentProfile = null;

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

const blocks = () => icon(
  ['rect', { x: 3, y: 3, width: 8, height: 8, rx: 2.4 }],
  ['rect', { x: 13, y: 3, width: 8, height: 8, rx: 2.4 }],
  ['rect', { x: 3, y: 13, width: 8, height: 8, rx: 2.4 }],
  ['rect', { x: 13, y: 13, width: 8, height: 8, rx: 2.4 }],
);

allGamesButton.append(blocks(), focusGlow());

const shelf = createShelf(document.getElementById('shelf'), {
  onTint: (colour, art) => {
    document.body.style.setProperty('--tint', colour);
    setArt(art);
  },
  button: allGamesButton,
  title,
});

function controllerRows() {
  return [...navigator.getGamepads()].filter(Boolean).map((pad) => ({ label: pad.id.replace(/\s*\(.*\)\s*$/, '') || 'Controller' }));
}

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

async function showPower() {
  if (inMenu) return;
  inMenu = true;
  let choice;
  try {
    choice = await openMenu({
      choices: [
        { id: 'sleep', label: 'Sleep' },
        { id: 'shutdown', label: 'Shut down' },
        { id: 'close', label: 'Close Tink' },
      ],
      anchor: tray.children[trayFocus],
    });
  } finally {
    inMenu = false;
    showHints();
  }
  if (choice === 'shutdown') {
    inMenu = true;
    try {
      if (await showDialog({ message: 'Shut down this PC?', confirm: 'Shut down', cancel: 'Not now', sound: 'confirm' })) window.tink.power('shutdown');
    } finally {
      inMenu = false;
      showHints();
    }
  } else if (choice) {
    window.tink.power(choice);
  }
}

function renderTop(profiles, current, shown) {
  topProfiles = shown ? [current, ...profiles.filter((p) => p !== current)] : [];
  homeProfiles.hidden = !shown;
  if (topFocus >= topProfiles.length) topFocus = -1;
  homeProfiles.replaceChildren(...topProfiles.map((profile, index) => {
    const node = document.createElement('button');
    node.className = 'home-badge';
    node.setAttribute('aria-label', profile.name);
    node.append(badge(profile), focusGlow());
    node.addEventListener('click', () => {
      if (!ready || inMenu || inPicker || inPanel || inSettings || launching || settingsOpen() || document.querySelector('.dialog-scrim')) return;
      topFocus = index;
      trayFocus = -1;
      showTitle();
      focusTop();
      playSound(pressTop());
    });
    return node;
  }), homeLabel);
  focusTop();
}

function focusTop() {
  const node = homeProfiles.children[topFocus];
  if (topFocus < 0 || !node || node === homeLabel) return;
  node.focus({ preventScroll: true });
  homeLabel.textContent = topProfiles[topFocus].name;
  homeLabel.style.left = `${node.offsetLeft + node.offsetWidth / 2}px`;
}

function leaveTop() {
  topFocus = -1;
  if (document.activeElement) document.activeElement.blur();
  showTitle();
}

function pressTop() {
  const profile = topProfiles[topFocus];
  if (profile !== currentProfile) pickProfile(profile);
  return 'confirm';
}

async function pickProfile(profile) {
  if (inPicker || launching) return;
  inPicker = true;
  try {
    await window.tink.chooseProfile(profile.id);
    await screen(async () => {
      await loadLibrary({ fresh: true });
      await shelf.ready();
      if (topProfiles.length) topFocus = 0;
      focusTop();
      showTitle();
    });
  } finally {
    inPicker = false;
  }
}

async function renderTray() {
  const [{ profiles, last }, shown] = await Promise.all([window.tink.getProfiles(), window.tink.getSettings()]);
  const profile = profiles.find((p) => p.id === last) || profiles[0];
  currentProfile = profile;
  renderTop(profiles, profile, shown.homeProfiles !== false);
  tray.dataset.icons = shown.iconStyle;
  tray.dataset.row = shown.iconRow;
  tray.replaceChildren(...trayIcons.map((icon) => {
    const node = document.createElement('button');
    node.className = 'tray-icon';
    node.setAttribute('aria-label', icon.name);
    node.dataset.icon = icon.name;
    node.append(icon.draw(profile), focusGlow());
    node.addEventListener('click', () => {
      if (!ready || inMenu || inPicker || inPanel || inSettings || launching || settingsOpen() || document.querySelector('.dialog-scrim')) return;
      trayFocus = trayIcons.indexOf(icon);
      topFocus = -1;
      showTitle();
      playSound(pressTray(icon));
    });
    return node;
  }), trayLabel);
  focusTray();
}

function pressTray(icon) {
  const node = tray.children[trayIcons.indexOf(icon)];
  node.classList.remove('pressed');
  void node.offsetWidth;
  node.classList.add('pressed');
  icon.activate();
  return icon.sound;
}

function focusTray() {
  const node = tray.children[trayFocus];
  if (trayFocus < 0 || !node || node === trayLabel) return;
  node.focus({ preventScroll: true });
  trayLabel.textContent = trayIcons[trayFocus].name;
  trayLabel.style.left = `${node.offsetLeft + node.offsetWidth / 2}px`;
}

function leaveTray() {
  trayFocus = -1;
  if (document.activeElement) document.activeElement.blur();
  showTitle();
}

async function switchProfile() {
  if (inPicker || launching) return;
  inPicker = true;
  try {
    if (await chooseProfile({ canCancel: true, stay: true })) {
      await screen(async () => {
        closeProfiles();
        await loadLibrary({ fresh: true });
        await shelf.ready();
      });
    } else showHints();
  } finally {
    inPicker = false;
  }
}

async function changeGame(change) {
  const game = focusedGame();
  if (changing || !game) return;
  changing = true;
  try {
    await change(game.id);
    showLibrary(await window.tink.refreshLibrary());
  } finally {
    changing = false;
  }
}

async function openGameMenu() {
  const game = focusedGame();
  if (inMenu || changing || launching || !game) return;
  inMenu = true;
  try {
    const choice = await openCaseMenu({ fav: game.fav, removable: game.console === 'pc' });
    if (choice === 'fav') await changeGame(window.tink.toggleFavourite);
    else if (choice === 'hide') await changeGame(window.tink.hideGame);
    else if (choice === 'info') await openInfo(game);
    else if (choice === 'remove') await changeGame(window.tink.removePcGame);
  } finally {
    inMenu = false;
    showHints();
  }
}

function sleep() {
  if (asleep) return;
  asleep = true;
  rest(true);
  hideLoading();
  shelf.sleep();
  grid.sleep();
  suspendSound();
  window.tink.releaseCaches?.();
}

async function wake({ played = false } = {}) {
  hideLoading();
  if (!asleep && !played) {
    showHints();
    return;
  }
  asleep = false;
  rest(false);
  shelf.wake();
  showLibrary(await window.tink.refreshLibrary(), { played });
  await shelf.ready();
}

// States arrive while earlier ones are still fading, so they run one after another.
let states = Promise.resolve();
let shownLoading = false;
function onGameState(state) {
  states = states.then(async () => {
    if (state === 'loading') {
      shownLoading = true;
      await screen(() => showLoading(running, shelf.art));
    } else if (state === 'handoff') {
      await fadeToBlack();
      window.tink.handoffReady?.();
    } else if (state === 'sleep') {
      launching = true;
      await fadeToBlack();
      sleep();
    } else if (state === 'awake') {
      launching = false;
      await transition(wake);
    } else if (state === 'back' || state === 'failed') {
      await fadeToBlack();
    }
  }).catch(report);
}

const launchSound = () => (!running ? 'launch' : running.id === focusedGame()?.id ? 'confirm' : null);

async function play() {
  const game = focusedGame();
  if (!game) return;
  if (running) {
    if (running.id === game.id) window.tink.focusGame?.();
    else {
      const result = await window.tink.launch(game.id);
      if (result && result.error) await explain(result);
    }
    return;
  }
  if (launching) return;
  launching = true;
  cancelled = false;
  running = game;
  const stop = window.tink.onGame?.(onGameState);
  try {
    shownLoading = false;
    const result = await window.tink.launch(game.id);
    await states;
    const played = !cancelled && !(result && result.error);
    if (shownLoading) await transition(() => wake({ played }));
    if (result && result.error) await explain(result);
  } finally {
    if (stop) stop();
    running = null;
    launching = false;
  }
}

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

async function goToAlbum() {
  if (inSettings) return;
  inSettings = true;
  try {
    await openAlbum();
    await screen(async () => {
      hideAlbum();
      await renderTray().catch(report);
      showTitle();
      showHints();
    });
  } finally {
    inSettings = false;
  }
}

async function goToNews() {
  if (inSettings) return;
  inSettings = true;
  try {
    await openNews();
    await screen(async () => {
      hideNews();
      await renderTray().catch(report);
      showTitle();
      showHints();
    });
  } finally {
    inSettings = false;
  }
}

async function goToSettings(focusConsole) {
  if (inSettings) return;
  inSettings = true;
  try {
    const changed = await openSettings({ focusConsole });
    const shown = await window.tink.getSettings();
    shelf.setLeftEdge(shown.leftEdge);
    shelf.setFocusStyle(shown.focusStyle);
    await screen(async () => {
      hideSettings();
      setBackground(shown.background);
      if (changed) {
        shelf.forgetCovers();
        grid.forgetCovers();
        await loadLibrary();
      } else {
        await renderTray().catch(report);
        showTitle();
        showHints();
      }
    });
  } finally {
    inSettings = false;
  }
}

async function goToStore() {
  if (inSettings) return;
  inSettings = true;
  try {
    const changed = await openStore();
    await screen(async () => {
      hideStore();
      if (changed) {
        await loadLibrary();
      } else {
        await renderTray().catch(report);
        showTitle();
        showHints();
      }
    });
  } finally {
    inSettings = false;
  }
}

window.addEventListener('store-installed', () => {
  if (!launching && !inSettings) loadLibrary().catch(report);
});

listenForInput((action) => {
  const dialog = dialogTakesInput(action);
  if (dialog) return dialog.sound;
  if (loadingOpen()) {
    if (action !== 'b' || !window.tink.cancelLaunch || cancelled) return null;
    cancelled = true;
    window.tink.cancelLaunch();
    return 'back';
  }
  if (changingScreen() || settingsOpen() || inSettings || inPicker || inMenu || caseMenuOpen() || infoOpen() || panelOpen() || inPanel) return null;
  if (action === 'view') {
    switchProfile();
    return 'confirm';
  }
  if (action === 'settings' || (action === 'menu' && !focusedGame())) {
    goToSettings();
    return 'confirm';
  }
  if (action === 'menu' && trayFocus < 0 && topFocus < 0) {
    if (changing || launching) return null;
    openGameMenu();
    return 'confirm';
  }
  if (!ready) return null;
  if (topFocus >= 0) {
    if (action === 'left' || action === 'right') {
      const next = topFocus + (action === 'right' ? 1 : -1);
      if (next < 0 || next >= topProfiles.length) return null;
      topFocus = next;
      focusTop();
      return 'move';
    }
    if (action === 'down' || action === 'b') {
      leaveTop();
      return 'move';
    }
    if (action === 'a') return pressTop();
    return null;
  }
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
      return pressTray(trayIcons[trayFocus]);
    }
    return null;
  }
  if (inGrid) return gridAction(action);
  if (action === 'down' && (!row.length || shelf.caseState() === 'front')) {
    trayFocus = 0;
    showTitle();
    focusTray();
    return 'move';
  }
  if (action === 'up' && topProfiles.length && (!row.length || shelf.caseState() === 'front')) {
    topFocus = 0;
    showTitle();
    focusTop();
    return 'move';
  }
  if (row.length === 0) return null;
  if (action === 'left' || action === 'right') {
    if (!shelf.select(shelf.selected() + (action === 'right' ? 1 : -1))) return null;
    showTitle();
    showHints();
    return 'move';
  }
  if (action === 'fav' || action === 'hide') {
    if (changing || !shelf.game()) return null;
    changeGame(action === 'fav' ? window.tink.toggleFavourite : window.tink.hideGame);
    return 'toggle';
  }
  if (action === 'a') {
    if (shelf.onButton()) {
      openGrid();
      return 'confirm';
    }
    if (launching || !shelf.game()) return null;
    const sound = launchSound();
    play();
    return sound;
  }
  const moves = { y: shelf.flip, x: shelf.open, b: shelf.back };
  if (!moves[action] || !moves[action]()) return null;
  showHints();
  return { y: 'flip', x: 'open', b: 'back' }[action];
});

function gridAction(action) {
  if (['left', 'right', 'up', 'down'].includes(action)) return grid.move(action) ? 'move' : null;
  if (action === 'fav' || action === 'hide') {
    if (changing || !grid.game()) return null;
    changeGame(action === 'fav' ? window.tink.toggleFavourite : window.tink.hideGame);
    return 'toggle';
  }
  if (action === 'a') {
    if (launching || !grid.game()) return null;
    const sound = launchSound();
    play();
    return sound;
  }
  if (action === 'y') {
    changeSort();
    return 'list';
  }
  if (action === 'b') {
    closeGrid();
    return 'back';
  }
  return null;
}

function openGrid() {
  screen(() => {
    inGrid = true;
    main.classList.add('grid-open');
    grid.set(games, sort, null, 0);
    grid.open(true);
    showHints();
  });
}

function leaveGrid() {
  inGrid = false;
  main.classList.remove('grid-open');
  grid.open(false);
  showTitle();
  showHints();
}

const closeGrid = () => screen(leaveGrid);

async function changeSort() {
  if (sorting) return;
  sorting = true;
  try {
    const library = await window.tink.setSort(grid.nextSort(sort));
    games = library.games;
    sort = library.sort;
    const game = grid.game();
    grid.set(games, sort, game && game.id);
  } finally {
    sorting = false;
  }
}

function showLibrary(library, { fresh = false, played = false } = {}) {
  const wasButton = shelf.onButton();
  const selected = shelf.selected();
  const selectedId = shelf.game() && shelf.game().id;
  const gridId = grid.game() && grid.game().id;
  row = library.row;
  games = library.games;
  sort = library.sort;
  if (fresh || games.length === 0) leaveGrid();
  if (games.length === 0) {
    shelf.show([], 0);
    clearTimeout(titleTimer);
    titleKey = null;
    title.textContent = '';
    showMessage('No games found.');
    showHints();
    return;
  }
  showMessage('');
  const found = row.findIndex((game) => game.id === selectedId);
  let place = Math.min(selected, wasButton ? row.length : row.length - 1);
  if (fresh) place = 0;
  else if (played && !inGrid) place = 0;
  else if (found >= 0) place = found;
  shelf.show(row, place);
  if (inGrid) grid.set(games, sort, gridId);
  showTitle();
  showHints();
}

async function loadLibrary({ fresh = false } = {}) {
  const [library] = await Promise.all([window.tink.getLibrary(), renderTray().catch(report)]);
  ready = true;
  showLibrary(library, { fresh });
}

const NOTICE_MS = 4000;

async function showNotice() {
  const text = await window.tink.getNotice();
  if (!text) return;
  const notice = document.getElementById('notice');
  notice.textContent = text;
  notice.hidden = false;
  setTimeout(() => { notice.hidden = true; }, NOTICE_MS);
}

const UPDATE_POLL_MS = 3 * 1000;

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
    await chooseProfile({ stay: true });
  } finally {
    inPicker = false;
  }
  await screen(async () => {
    closeProfiles();
    await loadLibrary();
    await shelf.ready();
  });
  showNotice().catch(() => {});
  offerUpdate();
  checkNews().then(() => renderTray()).catch(() => {});
}

start();
