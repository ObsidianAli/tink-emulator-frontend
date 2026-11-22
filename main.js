// Tink's main process: the window, and the two things the UI can ask for.
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steam = require('./src/steam');
const { CONSOLES, EMULATORS, launchSpec } = require('./src/presets');
const { getEmulatedGames, groupShelves } = require('./src/library');
const { detectEmulators, defaultSearchDirs } = require('./src/detect');
const { loadSettings } = require('./src/settings');
const { playGame, closeEmulator } = require('./src/launcher');
const { watchCombo } = require('./src/pad');
const { createCovers } = require('./src/covers');

const POLL_MS = 2000;
// How long to wait for Steam to actually start the game before giving up and showing Tink again.
// Generous, because a first launch can wait on an update or a Steam login.
const START_TIMEOUT_MS = 5 * 60 * 1000;
const HINT_MS = 3000;

// The portable exe unpacks to a temp folder, so "beside Tink" means beside the exe the user started.
const TINK_DIR = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);

let win = null;
// The games last sent to the UI. Launches are looked up here, so the UI never passes a path or exe.
let gamesById = new Map();
let settings = { consoles: {} };
let emulators = {};
let covers = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function getLibrary() {
  settings = loadSettings(path.join(app.getPath('userData'), 'settings.json'));
  emulators = detectEmulators(defaultSearchDirs(process.env, TINK_DIR));
  covers = createCovers({
    dir: path.join(app.getPath('userData'), 'covers'),
    enabled: settings.covers === true,
    steamGridKey: typeof settings.steamGridDbKey === 'string' ? settings.steamGridDbKey.trim() : '',
  });
  const steamDir = await steam.findSteamDir();
  const steamGames = (steamDir ? steam.getSteamGames(steamDir) : []).map((game) => ({
    ...game,
    id: `steam:${game.appId}`,
    console: 'steam',
    consoleName: 'Steam',
  }));
  const games = [...getEmulatedGames(settings), ...steamGames];
  gamesById = new Map(games.map((game) => [game.id, game]));
  return {
    steamFound: Boolean(steamDir),
    shelves: groupShelves(games).map((shelf) => ({
      ...shelf,
      games: shelf.games.map(({ id, title, art }) => ({ id, title, art: art || null })),
    })),
  };
}

// The Cover of an emulated Game, as a data URL or a Plain cover colour. Steam games bring their own art.
async function getCover(id) {
  const game = gamesById.get(id);
  if (!game || game.console === 'steam' || !covers) return null;
  const cover = await covers.getCover(game);
  if (cover.plain) return cover;
  try {
    const data = await fs.promises.readFile(cover.file);
    return { src: `data:${cover.mime};base64,${data.toString('base64')}` };
  } catch {
    return { plain: { colour: CONSOLES[game.console].colour } };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until Steam reports a game running, then until it reports none.
// Any running game counts as started, since some games start through a launcher with another id.
// A failed registry read is ignored rather than taken as "the game ended".
async function waitForGameToEnd() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let started = false;
  while (started || Date.now() < deadline) {
    await sleep(POLL_MS);
    const running = await steam.getRunningAppId();
    if (running === null) continue;
    if (running === 0) {
      if (started) return;
    } else if (await steam.isSteamRunning()) {
      started = true;
    } else if (started) {
      // Steam itself is gone (it crashed), so the game id is stale and nothing is left to wait for.
      return;
    }
  }
}

// Windows won't always let a hidden app take focus back, so Tink briefly goes on top to get there.
function showTink() {
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.setAlwaysOnTop(false);
}

// A small note over the game for a few seconds. It can't take focus or clicks, so the game keeps them.
function showHint() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 720;
  const height = 96;
  const hint = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 48,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  hint.setAlwaysOnTop(true, 'screen-saver');
  hint.setIgnoreMouseEvents(true);
  hint.once('ready-to-show', () => hint.showInactive());
  hint.loadFile(path.join(__dirname, 'renderer', 'hint.html'));
  const timer = setTimeout(() => close(), HINT_MS);
  function close() {
    clearTimeout(timer);
    if (!hint.isDestroyed()) hint.destroy();
  }
  return close;
}

// While an emulated game runs: show the hint, and close the game when Select + Start is held.
function whilePlaying(child) {
  const closeHint = showHint();
  const stopWatching = watchCombo(() => closeEmulator(child));
  return () => {
    stopWatching();
    closeHint();
  };
}

// Starts the game through Steam, hides Tink, and shows it again once Steam says the game has ended.
async function launchSteam(appId) {
  if (!/^\d+$/.test(String(appId))) return;
  try {
    await shell.openExternal(`steam://rungameid/${appId}`);
    win.hide();
    await waitForGameToEnd();
  } finally {
    showTink();
  }
}

// The exe the user set for this console, else the detected one.
function emulatorExe(game) {
  const chosen = settings.consoles[game.console] && settings.consoles[game.console].exe;
  if (chosen) return chosen;
  const emulator = CONSOLES[game.console].emulator;
  return emulator ? emulators[emulator] : null;
}

// Starts an emulated game. Returns an error message for the UI if it can't.
async function launchEmulated(game) {
  const exe = emulatorExe(game);
  if (!exe || !fs.existsSync(exe)) {
    const emulator = CONSOLES[game.console].emulator;
    const name = emulator ? EMULATORS[emulator].label : `The ${game.consoleName} emulator`;
    return { error: `${name} isn't set up yet.` };
  }
  if (!fs.existsSync(game.path)) return { error: "This game file can't be found." };
  try {
    await playGame(launchSpec(game.console, exe, game.path), { hide: () => win.hide(), show: showTink, whilePlaying });
  } catch {
    return { error: "The emulator couldn't be started." };
  }
  return {};
}

async function launch(id) {
  const game = gamesById.get(id);
  if (!game) return { error: "This game can't be found." };
  if (game.console === 'steam') {
    await launchSteam(game.appId);
    return {};
  }
  return launchEmulated(game);
}

app.whenReady().then(() => {
  ipcMain.handle('getLibrary', getLibrary);
  ipcMain.handle('getCover', (_event, id) => getCover(String(id)));
  ipcMain.handle('launch', (_event, id) => launch(String(id)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
