// Tink's main process: the window, and the named things the UI can ask for.
const { app, BrowserWindow, ipcMain, shell, screen, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steam = require('./src/steam');
const { CONSOLES, EMULATORS, STEAM, coverColour, launchSpec } = require('./src/presets');
const { getEmulatedGames, groupShelves } = require('./src/library');
const { detectEmulators, defaultSearchDirs } = require('./src/detect');
const { loadSettings, saveSettings } = require('./src/settings');
const setup = require('./src/setup');
const profiles = require('./src/profiles');
const options = require('./src/options');
const { resolveDataDir, migrateOldData } = require('./src/paths');
const { createLog } = require('./src/log');
const { playGame, closeEmulator } = require('./src/launcher');
const { watchCombo, loadPadReader } = require('./src/pad');
const { createCovers } = require('./src/covers');
const { createGameInfo } = require('./src/gameinfo');
const { powerAction } = require('./src/power');
const { createUpdater, FINISH_FLAG } = require('./src/update');

const POLL_MS = 2000;
// How long to wait for Steam to actually start the game before giving up and showing Tink again.
// Generous, because a first launch can wait on an update or a Steam login.
const START_TIMEOUT_MS = 5 * 60 * 1000;
const HINT_MS = 3000;
// Let the shelf load first; the update check is not urgent.
const UPDATE_CHECK_DELAY_MS = 10 * 1000;

// An update is finished by the staged copy (Tink.new) started with the flag; its "Tink folder" is the real one.
const FINISHING = process.argv.includes(FINISH_FLAG) && /\.new$/i.test(path.dirname(process.execPath));
// The portable exe unpacks to a temp folder, so "beside Tink" means beside the exe the user started.
const TINK_DIR = process.env.PORTABLE_EXECUTABLE_DIR
  || (FINISHING ? path.dirname(process.execPath).slice(0, -'.new'.length) : path.dirname(process.execPath));
// Finishing an update must not be turned away by the Tink that is still shutting down. Source runs (tests) skip the lock.
const SECOND_INSTANCE = app.isPackaged && !FINISHING && !app.requestSingleInstanceLock();
if (SECOND_INSTANCE) app.quit();

const DATA_DIR = resolveDataDir({
  packaged: app.isPackaged,
  tinkDir: TINK_DIR,
  projectDir: __dirname,
  override: process.env.TINK_DATA_DIR,
});
const log = createLog(path.join(DATA_DIR, 'tink.log'));

try {
  migrateOldData(DATA_DIR, app.getPath('userData'));
} catch (error) {
  log('Could not move the old settings over', error);
}

// Details go to the log, never to the screen.
process.on('uncaughtException', (error) => log('Uncaught error', error));
process.on('unhandledRejection', (reason) => log('Unhandled rejection', reason));

let win = null;
// The games last sent to the UI. Launches are looked up here, so the UI never passes a path or exe.
let gamesById = new Map();
// Every Console's Shelf, before a profile hides anything. Settings lists these.
let allShelves = [];
let settings = { consoles: {} };
let emulators = {};
const settingsFile = () => path.join(DATA_DIR, 'settings.json');
let covers = null;

function makeCovers() {
  return createCovers({
    dir: path.join(DATA_DIR, 'covers'),
    enabled: settings.covers === true,
    steamGridKey: options.steamKey(settings),
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: options.wantsFullscreen(loadSettings(settingsFile())),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Chromium could otherwise fetch spelling dictionaries, and Tink only goes online for Covers.
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function getLibrary() {
  settings = loadSettings(settingsFile());
  emulators = detect();
  covers = makeCovers();
  const steamDir = await steam.findSteamDir();
  const steamGames = (steamDir ? steam.getSteamGames(steamDir) : []).map((game) => ({
    ...game,
    id: `steam:${game.appId}`,
    console: 'steam',
    consoleName: STEAM.name,
    // Steam Covers are cached by app id.
    fileName: game.appId,
    key: `steam:${game.appId}`,
  }));
  const games = [...getEmulatedGames(settings), ...steamGames];
  gamesById = new Map(games.map((game) => [game.id, game]));
  allShelves = groupShelves(games);
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  const profile = profiles.activeProfile(current);
  const shelves = profiles.buildShelves(allShelves, profile).map((shelf) => ({
    ...shelf,
    games: shelf.games.map(({ id, key, title }) => ({ id, title, fav: profile.favourites.includes(key) })),
  }));
  return { shelves };
}

const lookup = (id) => gamesById.get(profiles.realId(id));

const AVATAR_TYPES = /\.(png|jpe?g)$/i;
const AVATAR_MAX = 60;
const AVATAR_SIZE = 256;
const avatarDir = () => path.join(DATA_DIR, 'avatars');

// The picture files the user dropped into data/avatars.
function listAvatars() {
  fs.mkdirSync(avatarDir(), { recursive: true });
  return fs.readdirSync(avatarDir()).filter((name) => AVATAR_TYPES.test(name)).sort().slice(0, AVATAR_MAX);
}

// A picture cropped square and shrunk, as a data URL; the circle is drawn by the UI.
function avatarSrc(file) {
  const image = nativeImage.createFromPath(path.join(avatarDir(), file));
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  return square.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: 'good' }).toDataURL();
}

function getProfiles() {
  const current = loadSettings(settingsFile());
  if (profiles.ensureProfiles(current)) saveSettings(settingsFile(), current);
  const files = listAvatars();
  return {
    last: current.lastProfile,
    profiles: current.profiles.map(({ id, name, colour, avatar }) => ({
      id,
      name,
      colour,
      avatar: files.includes(avatar) ? avatarSrc(avatar) : null,
    })),
  };
}

function getAvatars() {
  return listAvatars().map((file) => ({ file, src: avatarSrc(file) })).filter((avatar) => avatar.src);
}

// Applies one change to the saved settings and returns what it returned.
function changeProfiles(change) {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  const result = change(current);
  saveSettings(settingsFile(), current);
  return result;
}

// Changes to the profile in use, like favourites and hidden shelves.
const changeActive = (change) => changeProfiles((current) => change(profiles.activeProfile(current)));

// A Game's Cover, as a data URL or a Plain cover colour. The UI itself never goes online.
async function getCover(id) {
  const game = lookup(id);
  if (!game || !covers) return null;
  const cover = await covers.getCover(game);
  if (cover.plain) return cover;
  try {
    const data = await fs.promises.readFile(cover.file);
    return { src: `data:${cover.mime};base64,${data.toString('base64')}` };
  } catch {
    return { plain: { colour: coverColour(game.console) } };
  }
}

// What the Game info page shows besides the Cover: the Console's name, and for a Steam game its overview and screenshots.
async function getGameInfo(id) {
  const game = lookup(id);
  if (!game) return null;
  const details = game.console === 'steam' ? await createGameInfo({ dir: path.join(DATA_DIR, 'info') }).get(game.appId) : null;
  return { consoleName: game.consoleName, overview: details ? details.overview : '', screenshots: details ? details.screenshots : [] };
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

// Loaded on the first game, so a missing XInput is logged once.
let padReader;
function getPadReader() {
  if (padReader === undefined) {
    padReader = loadPadReader();
    if (!padReader) log("Could not load XInput, so Select + Start won't close games. They still come back when the emulator closes.");
  }
  return padReader;
}

// While an emulated game runs: show the hint, and close the game when Select + Start is held.
function whilePlaying(child) {
  const closeHint = showHint();
  const reader = getPadReader();
  const stopWatching = reader
    ? watchCombo(() => closeEmulator(child), {
        read: reader.read,
        onFail: (error) => log("Reading the pad failed, so Select + Start won't work this time", error),
      })
    : () => {};
  return () => {
    stopWatching();
    closeHint();
  };
}

// Starts the game through Steam, hides Tink, and shows it again once Steam says the game has ended.
// While it runs, holding Select + Start closes the game's own processes, and Steam then reports it ended.
async function launchSteam(game) {
  const { appId } = game;
  if (!/^\d+$/.test(String(appId))) return;
  let stopWatching = () => {};
  try {
    await shell.openExternal(`steam://rungameid/${appId}`);
    win.hide();
    const reader = getPadReader();
    if (reader) {
      stopWatching = watchCombo(() => steam.closeSteamGame(game.installDir).catch((error) => log('Could not close the Steam game', error)), {
        read: reader.read,
        onFail: (error) => log("Reading the pad failed, so Select + Start won't work this time", error),
      });
    }
    await waitForGameToEnd();
  } finally {
    stopWatching();
    showTink();
  }
}

// The exe the user set for this console, else the detected one.
function emulatorExe(game) {
  const chosen = settings.consoles[game.console] && settings.consoles[game.console].exe;
  if (chosen) return chosen;
  const emulator = CONSOLES[game.console].emulator;
  return emulator ? setup.resolveEmulator(settings, emulators, emulator) : null;
}

function detect() {
  return detectEmulators(defaultSearchDirs(process.env, TINK_DIR));
}

// What the setup screens need. Cheap when setup isn't due, so every start can ask.
async function getSetup() {
  const current = loadSettings(settingsFile());
  if (!setup.needsSetup(current)) return { needed: false };
  return setupState(current);
}

async function setupState(current) {
  return setup.buildSetup(current, detect(), Boolean(await steam.findSteamDir()));
}

// Shows a native picker. The renderer only says which emulator or Console; paths never come from it.
async function pick(properties, filters) {
  const result = await dialog.showOpenDialog(win, { properties, filters });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

// Each setup change is applied to the saved file, then the fresh setup state goes back to the UI.
// Returns null when the user cancels the picker, or { error } for a pick that can't be used.
async function changeSetup(change) {
  const current = loadSettings(settingsFile());
  const inSetup = setup.needsSetup(current);
  const error = await change(current);
  if (error === null) return null;
  if (error) return { error };
  // Marks setup as started, so quitting halfway doesn't count as finished once a folder is saved.
  // Changes made later in Settings leave it alone.
  if (inSetup && current.setupDone === undefined) current.setupDone = false;
  saveSettings(settingsFile(), current);
  return { state: await setupState(current) };
}

async function pickExe(id) {
  return changeSetup(async (current) => {
    const exe = await pick(['openFile'], [{ name: 'Programs', extensions: ['exe'] }]);
    if (!exe) return null;
    if (!fs.statSync(exe, { throwIfNoEntry: false })?.isFile() || path.extname(exe).toLowerCase() !== '.exe') {
      return "That isn't a program.";
    }
    setup.setEmulatorExe(current, id, exe);
    return undefined;
  });
}

async function pickFolder(id) {
  return changeSetup(async (current) => {
    const folder = await pick(['openDirectory']);
    if (!folder) return null;
    setup.setConsoleFolder(current, id, folder);
    return undefined;
  });
}

async function clearFolder(id) {
  return changeSetup((current) => {
    setup.setConsoleFolder(current, id, null);
  });
}

function finishSetup(wantsCovers) {
  const current = loadSettings(settingsFile());
  setup.completeSetup(current, wantsCovers === true);
  saveSettings(settingsFile(), current);
}

// What the Settings screen shows. The SteamGridDB key stays here; the UI only learns whether there is one.
function getSettings() {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  return {
    ...options.buildSettings(current, detect(), app.getVersion()),
    ...profiles.settingsView(profiles.activeProfile(current), allShelves),
  };
}

// Applies one change to the saved settings, then sends back the fresh Settings state.
function changeSettings(change) {
  const current = loadSettings(settingsFile());
  change(current);
  saveSettings(settingsFile(), current);
  return getSettings();
}

function setFullscreen(on) {
  const state = changeSettings((current) => options.setFullscreen(current, on));
  win.setFullScreen(state.fullscreen);
  return state;
}

const setSteamKey = (key) => changeSettings((current) => options.setSteamKey(current, key));
const findAutomatically = (id) => changeSettings((current) => options.clearEmulator(current, id));

// Forgets every cached Cover and remembered miss, and turns Covers on. The Shelf fetches them again as it loads.
async function redownloadCovers() {
  const current = loadSettings(settingsFile());
  current.covers = true;
  saveSettings(settingsFile(), current);
  settings = current;
  await (covers || makeCovers()).redownload();
}

// Starts an emulated game. Returns { error, fix, console } for the UI if it can't; fix is "settings" or "rescan".
async function launchEmulated(game) {
  const emulator = CONSOLES[game.console].emulator;
  const name = emulator ? EMULATORS[emulator].label : `The ${game.consoleName} emulator`;
  const exe = emulatorExe(game);
  if (!exe || !fs.existsSync(exe)) return { error: `${name} isn't set up.`, fix: 'settings', console: game.console };
  if (!fs.existsSync(game.path)) return { error: "This game file can't be found.", fix: 'rescan' };
  try {
    const spec = launchSpec(game.console, exe, game.path, options.wantsFullscreen(settings));
    await playGame(spec, { hide: () => win.hide(), show: showTink, whilePlaying });
    changeActive((profile) => profiles.recordPlay(profile, game.key));
  } catch (error) {
    log(`Could not start ${name} for ${game.consoleName}`, error);
    return { error: `${name} couldn't be started.`, fix: 'settings', console: game.console };
  }
  return {};
}

async function launch(id) {
  const game = lookup(id);
  if (!game) return { error: "This game can't be found.", fix: 'rescan' };
  if (game.console === 'steam') {
    try {
      await launchSteam(game);
      changeActive((profile) => profiles.recordPlay(profile, game.key));
    } catch (error) {
      log('Could not start a Steam game', error);
      return { error: "Steam couldn't start this game." };
    }
    return {};
  }
  return launchEmulated(game);
}

// Every call goes through here: a failure is logged in full, and the UI only gets a plain error.
function handle(name, fn) {
  ipcMain.handle(name, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      log(`${name} failed`, error);
      throw new Error('Something went wrong.');
    }
  });
}

// Only an installed Tink folder can replace itself; the portable bridge exe can't. TINK_UPDATE_URL is honoured only
// for a local http://127.0.0.1 server (tests).
function makeUpdater() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return null;
  const local = (process.env.TINK_UPDATE_URL || '').startsWith('http://127.0.0.1');
  return createUpdater({
    appDir: TINK_DIR,
    dataDir: DATA_DIR,
    version: app.getVersion(),
    log,
    ...(local ? { releaseUrl: process.env.TINK_UPDATE_URL, loopback: true } : {}),
  });
}

let notice = null;
let updater = null;

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  if (SECOND_INSTANCE) return;
  updater = makeUpdater();
  if (updater && FINISHING) {
    if (await updater.finishUpdate()) return app.quit();
  } else if (updater) {
    updater.removeOld();
    notice = updater.takeNotice();
    setTimeout(() => updater.checkInBackground(), UPDATE_CHECK_DELAY_MS).unref();
  }
  handle('getUpdate', () => (updater ? updater.pendingVersion() : null));
  handle('checkForUpdates', async () => {
    if (!updater) return { status: 'current' };
    try {
      const version = await updater.checkNow();
      return version ? { status: 'ready', version } : { status: 'current' };
    } catch (error) {
      log('Update check failed', error);
      return { status: 'failed' };
    }
  });
  handle('applyUpdate', async () => {
    if (updater && await updater.applyPending()) app.quit();
  });
  handle('getNotice', () => {
    const text = notice;
    notice = null;
    return text;
  });
  handle('getSetup', getSetup);
  handle('pickExe', (id) => pickExe(String(id)));
  handle('pickFolder', (id) => pickFolder(String(id)));
  handle('clearFolder', (id) => clearFolder(String(id)));
  handle('finishSetup', (wantsCovers) => finishSetup(wantsCovers === true));
  handle('getSettings', getSettings);
  handle('setFullscreen', (on) => setFullscreen(on === true));
  handle('setSteamKey', (key) => setSteamKey(key));
  handle('findAutomatically', (id) => findAutomatically(String(id)));
  handle('redownloadCovers', redownloadCovers);
  handle('getProfiles', getProfiles);
  handle('getAvatars', getAvatars);
  handle('chooseProfile', (id) => changeProfiles((current) => {
    if (current.profiles.some((p) => p.id === String(id))) current.lastProfile = String(id);
  }));
  handle('addProfile', () => changeProfiles((current) => (profiles.addProfile(current) || {}).id || null));
  handle('saveProfile', (edit) => changeProfiles((current) => {
    const profile = current.profiles.find((p) => p.id === String(edit && edit.id));
    if (profile) profiles.editProfile(profile, edit, listAvatars());
  }));
  handle('removeProfile', (id) => changeProfiles((current) => profiles.removeProfile(current, String(id))));
  handle('toggleFavourite', (id) => changeActive((profile) => {
    const game = lookup(String(id));
    if (game) profiles.toggleFavourite(profile, game.key);
  }));
  handle('hideGame', (id) => changeActive((profile) => {
    const game = lookup(String(id));
    if (game) profiles.hideGame(profile, game.key);
  }));
  handle('toggleShelf', (id) => { changeActive((profile) => profiles.toggleConsole(profile, String(id))); return getSettings(); });
  handle('showHiddenGames', () => { changeActive(profiles.showAllGames); return getSettings(); });
  handle('getLibrary', getLibrary);
  handle('getCover', (id) => getCover(String(id)));
  handle('getGameInfo', (id) => getGameInfo(String(id)));
  handle('launch', (id) => launch(String(id)));
  handle('power', (action) => (action === 'close' ? app.quit() : powerAction(String(action))));
  ipcMain.handle('logError', (_event, text) => log('Screen error', String(text).slice(0, 2000)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
