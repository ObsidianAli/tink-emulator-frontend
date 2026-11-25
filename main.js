const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steam = require('./src/steam');
const { CONSOLES, EMULATORS, STEAM, coverColour, launchSpec } = require('./src/presets');
const { getEmulatedGames, groupConsoles } = require('./src/library');
const { detectEmulators, defaultSearchDirs } = require('./src/detect');
const { loadSettings, saveSettings } = require('./src/settings');
const setup = require('./src/setup');
const profiles = require('./src/profiles');
const options = require('./src/options');
const { resolveDataDir, migrateOldData } = require('./src/paths');
const { createLog } = require('./src/log');
const { playGame, closeEmulator } = require('./src/launcher');
const { startSession } = require('./src/session');
const win32 = require('./src/win32');
const { watchCombo, loadPadReader } = require('./src/pad');
const { createCovers } = require('./src/covers');
const { createGameInfo } = require('./src/gameinfo');
const { createNews } = require('./src/news');
const { powerAction } = require('./src/power');
const { createUpdater, FINISH_FLAG } = require('./src/update');

const BACKGROUND = '#0f1115';
const BACKDROP = '#000';
const MEMORY_LOG_DELAY_MS = 1500;
const AWAKE_CHECK_MS = 1000;
const REFOCUS_CHECK_MS = 100;
const UPDATE_CHECK_DELAY_MS = 10 * 1000;
const RESUME_CHECK_DELAY_MS = 15 * 1000;

const FINISHING = process.argv.includes(FINISH_FLAG) && /\.new$/i.test(path.dirname(process.execPath));
// The portable exe unpacks to a temp folder, so "beside Tink" means beside the exe the user started.
const TINK_DIR = process.env.PORTABLE_EXECUTABLE_DIR
  || (FINISHING ? path.dirname(process.execPath).slice(0, -'.new'.length) : path.dirname(process.execPath));
// A finishing update must not be turned away by the old Tink still shutting down; source runs (tests) skip the lock.
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

process.on('uncaughtException', (error) => log('Uncaught error', error));
process.on('unhandledRejection', (reason) => log('Unhandled rejection', reason));

let win = null;
let gamesById = new Map();
let allConsoles = [];
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
    backgroundColor: BACKGROUND,
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
  win.on('focus', () => {
    if (session && session.alive()) sendGame('awake');
  });
  win.on('blur', () => {
    if (session && session.state() === 'playing') sendGame('sleep');
  });
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
    fileName: game.appId,
    key: `steam:${game.appId}`,
  }));
  const games = [...getEmulatedGames(settings), ...steamGames];
  gamesById = new Map(games.map((game) => [game.id, game]));
  allConsoles = groupConsoles(games);
  return currentLibrary();
}

function currentLibrary() {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  const profile = profiles.activeProfile(current);
  const visible = profiles.visibleGames(allConsoles, profile);
  const show = ({ id, key, title, console, consoleName }) => ({ id, title, console, consoleName, fav: profile.favourites.includes(key) });
  return {
    row: profiles.homeRow(visible, profile).map(show),
    games: profiles.sortGames(visible, profile.sort, profile).map(show),
    sort: profile.sort,
  };
}

const lookup = (id) => gamesById.get(id);

const AVATAR_TYPES = /\.(png|jpe?g)$/i;
const AVATAR_MAX = 60;
const AVATAR_SIZE = 256;
const avatarDir = () => path.join(DATA_DIR, 'avatars');

function listAvatars() {
  fs.mkdirSync(avatarDir(), { recursive: true });
  return fs.readdirSync(avatarDir()).filter((name) => AVATAR_TYPES.test(name)).sort().slice(0, AVATAR_MAX);
}

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
    profiles: current.profiles.map(({ id, name, colour, avatar, icon }) => {
      const src = files.includes(avatar) ? avatarSrc(avatar) : null;
      return { id, name, colour, avatar: src, icon: src ? null : icon || profiles.DEFAULT_ICON };
    }),
  };
}

function getAvatars() {
  return listAvatars().map((file) => ({ file, src: avatarSrc(file) })).filter((avatar) => avatar.src);
}

function changeProfiles(change) {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  const result = change(current);
  saveSettings(settingsFile(), current);
  return result;
}

const changeActive = (change) => changeProfiles((current) => change(profiles.activeProfile(current)));

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

async function getGameInfo(id) {
  const game = lookup(id);
  if (!game) return null;
  const details = game.console === 'steam' ? await createGameInfo({ dir: path.join(DATA_DIR, 'info') }).get(game.appId) : null;
  return { consoleName: game.consoleName, overview: details ? details.overview : '', screenshots: details ? details.screenshots : [] };
}

let newsService = null;
function news() {
  if (!newsService) {
    newsService = createNews({
      dir: path.join(DATA_DIR, 'news'),
      getGames: () => [...gamesById.values()].filter((game) => game.console === 'steam'),
    });
  }
  return newsService;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let session = null;
let playing = null;
let lastGameState = null;

// The blur that follows a handoff repeats 'sleep', so only real changes between sleep and awake go through.
function sendGame(state, info) {
  if ((state === 'sleep' || state === 'awake') && state === lastGameState) return;
  lastGameState = state;
  if (win && !win.isDestroyed()) win.webContents.send('game', state, info);
}

function logMemory(where) {
  const metrics = app.getAppMetrics();
  const sum = (key) => Math.round(metrics.reduce((total, m) => total + (m.memory[key] || 0), 0) / 1024);
  log(`Memory ${where}: ${sum('workingSetSize')} MB in use, ${sum('privateBytes')} MB private`);
}

function ownHandle() {
  const handle = win.getNativeWindowHandle();
  return Number(handle.length >= 8 ? handle.readBigUInt64LE(0) : handle.readUInt32LE(0));
}

// Windows won't always let a background app take focus back, so Tink briefly goes on top to get there.
async function showTink() {
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.setAlwaysOnTop(false);
  await sleep(REFOCUS_CHECK_MS);
  const native = win32.native();
  if (native && !win.isDestroyed() && !win.isFocused()) native.bringToFront(ownHandle());
}

let padReader;
function getPadReader() {
  if (padReader === undefined) {
    padReader = loadPadReader();
    if (!padReader) log("Could not load XInput, so Select + Start won't close games. They still come back when the emulator closes.");
  }
  return padReader;
}

function watchQuit(close) {
  const reader = getPadReader();
  if (!reader) return () => {};
  return watchCombo(close, {
    read: reader.read,
    onFail: (error) => log("Reading the pad failed, so Select + Start won't work this time", error),
  });
}

function platform() {
  const native = win32.native();
  return {
    processes: native && native.listProcesses,
    windows: native && native.topWindows,
    bringToFront: native && native.bringToFront,
    runningAppId: steam.getRunningAppId,
    steamRunning: steam.isSteamRunning,
  };
}

async function play(game, target, close) {
  const native = win32.native();
  if (native) native.allowAnyForeground();
  const stopQuit = watchQuit(close);
  let memoryTimer = null;
  let awakeTimer = null;
  playing = { game, close };
  session = startSession(target, {
    platform: platform(),
    onState(state) {
      if (state === 'handoff') sendGame('handoff');
      if (state !== 'playing') return;
      win.setBackgroundColor(BACKDROP);
      sendGame('sleep');
      memoryTimer = setTimeout(() => logMemory('while playing'), MEMORY_LOG_DELAY_MS);
      // A game that never takes the foreground leaves Tink in front and black, with no focus change to wake it.
      awakeTimer = setTimeout(() => {
        if (session && session.state() === 'playing' && win.isFocused()) sendGame('awake');
      }, AWAKE_CHECK_MS);
    },
    async restore(outcome) {
      stopQuit();
      clearTimeout(memoryTimer);
      clearTimeout(awakeTimer);
      await showTink();
      win.setBackgroundColor(BACKGROUND);
      sendGame(outcome.status === 'failed' ? 'failed' : 'back');
    },
  });
  try {
    return await session.done;
  } finally {
    session = null;
    playing = null;
  }
}

function cancelLaunch() {
  if (session && session.cancel()) playing.close();
}

function focusGame() {
  if (!session || !session.focus()) return false;
  sendGame('sleep');
  return true;
}

async function launchSteam(game) {
  const { appId } = game;
  if (!/^\d+$/.test(String(appId))) return;
  sendGame('loading', { id: game.id, title: game.title });
  try {
    await shell.openExternal(`steam://rungameid/${appId}`);
  } catch (error) {
    sendGame('failed');
    throw error;
  }
  const close = () => steam.closeSteamGame(game.installDir).catch((error) => log('Could not close the Steam game', error));
  const outcome = await play(game, { kind: 'steam', installDir: game.installDir }, close);
  if (outcome.status === 'failed') throw outcome.error || new Error('The game did not start in time');
  if (outcome.status === 'ended') changeActive((profile) => profiles.recordPlay(profile, game.key));
}

function emulatorExe(game) {
  const chosen = settings.consoles[game.console] && settings.consoles[game.console].exe;
  if (chosen) return chosen;
  const emulator = CONSOLES[game.console].emulator;
  return emulator ? setup.resolveEmulator(settings, emulators, emulator) : null;
}

function detect() {
  return detectEmulators(defaultSearchDirs(process.env, TINK_DIR));
}

async function getSetup() {
  const current = loadSettings(settingsFile());
  if (!setup.needsSetup(current)) return { needed: false };
  return setupState(current);
}

async function setupState(current) {
  return setup.buildSetup(current, detect(), Boolean(await steam.findSteamDir()));
}

// The renderer only says which emulator or Console; paths never come from it.
async function pick(properties, filters) {
  const result = await dialog.showOpenDialog(win, { properties, filters });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

async function changeSetup(change) {
  const current = loadSettings(settingsFile());
  const inSetup = setup.needsSetup(current);
  const error = await change(current);
  if (error === null) return null;
  if (error) return { error };
  // Marks setup as started so quitting halfway doesn't count as finished.
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

// The SteamGridDB key stays here; the UI only learns whether there is one.
function getSettings() {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  return {
    ...options.buildSettings(current, detect(), app.getVersion()),
    ...profiles.settingsView(profiles.activeProfile(current), allConsoles),
  };
}

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

const setLeftEdge = (mode) => changeSettings((current) => options.setLeftEdge(current, mode));
const setFocusStyle = (mode) => changeSettings((current) => options.setFocusStyle(current, mode));
const setBackground = (mode) => changeSettings((current) => options.setBackground(current, mode));
const setKeyboard = (mode) => changeSettings((current) => options.setKeyboard(current, mode));
const setHomeProfiles = (on) => changeSettings((current) => options.setHomeProfiles(current, on));
const setSteamKey = (key) => changeSettings((current) => options.setSteamKey(current, key));
const findAutomatically = (id) => changeSettings((current) => options.clearEmulator(current, id));

async function redownloadCovers() {
  const current = loadSettings(settingsFile());
  current.covers = true;
  saveSettings(settingsFile(), current);
  settings = current;
  await (covers || makeCovers()).redownload();
}

async function launchEmulated(game) {
  const emulator = CONSOLES[game.console].emulator;
  const name = emulator ? EMULATORS[emulator].label : `The ${game.consoleName} emulator`;
  const exe = emulatorExe(game);
  if (!exe || !fs.existsSync(exe)) return { error: `${name} isn't set up.`, fix: 'settings', console: game.console };
  if (!fs.existsSync(game.path)) return { error: "This game file can't be found.", fix: 'rescan' };
  sendGame('loading', { id: game.id, title: game.title });
  let outcome;
  try {
    const spec = launchSpec(game.console, exe, game.path, options.wantsFullscreen(settings));
    const { child, exited } = playGame(spec);
    outcome = await play(game, { kind: 'emulator', child, exited }, () => closeEmulator(child));
  } catch (error) {
    sendGame('failed');
    outcome = { status: 'failed', error };
  }
  if (outcome.status === 'failed') {
    log(`Could not start ${name} for ${game.consoleName}`, outcome.error);
    return { error: `${name} couldn't be started.`, fix: 'settings', console: game.console };
  }
  if (outcome.status === 'ended') changeActive((profile) => profiles.recordPlay(profile, game.key));
  return {};
}

async function launch(id) {
  if (playing) return { error: `Close ${playing.game.title} first.` };
  const game = lookup(id);
  if (!game) return { error: "This game can't be found.", fix: 'rescan' };
  logMemory('on Home');
  if (game.console === 'steam') {
    try {
      await launchSteam(game);
    } catch (error) {
      log('Could not start a Steam game', error);
      return { error: "Steam couldn't start this game." };
    }
    return {};
  }
  return launchEmulated(game);
}

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

// Only an installed Tink folder can replace itself, not the portable exe. TINK_UPDATE_URL is honoured only for local http://127.0.0.1 (tests).
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
    const checkIn = (ms) => setTimeout(() => updater.checkInBackground(), ms).unref();
    checkIn(UPDATE_CHECK_DELAY_MS);
    powerMonitor.on('resume', () => checkIn(RESUME_CHECK_DELAY_MS));
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
  handle('setLeftEdge', (mode) => setLeftEdge(String(mode)));
  handle('setFocusStyle', (mode) => setFocusStyle(String(mode)));
  handle('setBackground', (mode) => setBackground(String(mode)));
  handle('setKeyboard', (mode) => setKeyboard(String(mode)));
  handle('setHomeProfiles', (on) => setHomeProfiles(on === true));
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
  handle('toggleConsole', (id) => { changeActive((profile) => profiles.toggleConsole(profile, String(id))); return getSettings(); });
  handle('setSort', (sort) => {
    changeActive((profile) => { if (profiles.SORTS.includes(sort)) profile.sort = sort; });
    return currentLibrary();
  });
  handle('showHiddenGames', () => { changeActive(profiles.showAllGames); return getSettings(); });
  handle('getLibrary', getLibrary);
  handle('refreshLibrary', currentLibrary);
  handle('getCover', (id) => getCover(String(id)));
  handle('getGameInfo', (id) => getGameInfo(String(id)));
  handle('getNews', async (cachedOnly) => ({ items: await news().getNews({ cachedOnly: cachedOnly === true }), unread: await news().hasUnread() }));
  handle('getNewsImage', (id) => (typeof id === 'string' && id.length < 64 ? news().getNewsImage(id) : null));
  handle('markNewsSeen', () => news().markSeen());
  handle('launch', (id) => launch(String(id)));
  handle('cancelLaunch', cancelLaunch);
  handle('focusGame', focusGame);
  handle('handoffReady', () => {
    if (session) session.ready();
  });
  handle('power', (action) => (action === 'close' ? app.quit() : powerAction(String(action))));
  ipcMain.handle('logError', (_event, text) => log('Screen error', String(text).slice(0, 2000)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
