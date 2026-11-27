const { app, BrowserWindow, ipcMain, shell, nativeImage, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steam = require('./src/steam');
const { STEAM, coverColour } = require('./src/kinds');
const { loadSettings, saveSettings } = require('./src/settings');
const setup = require('./src/setup');
const profiles = require('./src/profiles');
const options = require('./src/options');
const { resolveDataDir, migrateOldData } = require('./src/paths');
const { createLog } = require('./src/log');
const { playGame } = require('./src/launcher');
const { startSession } = require('./src/session');
const win32 = require('./src/win32');
const { watchCombo, watchPress, learnButton, openButtons, loadPadReader } = require('./src/pad');
const { captureWindow, shotName, safeName } = require('./src/capture');
const { createAlbum } = require('./src/album');
const { createCovers } = require('./src/covers');
const { createHeroes } = require('./src/heroes');
const { openChoices } = require('./src/coverchoices');
const owned = require('./src/owned');
const { updateFirstSeen } = require('./src/firstseen');
const installs = require('./src/install');
const { createSteamInstall } = require('./src/steaminstall');
const pcgames = require('./src/pcgames');
const pcadded = require('./src/pcadded');
const { createGameInfo } = require('./src/gameinfo');
const { createNews } = require('./src/news');
const { powerAction } = require('./src/power');
const { createUpdater, FINISH_FLAG } = require('./src/update');
const shellMode = require('./src/shell');
const { spawn } = require('node:child_process');

const BACKGROUND = '#0f1115';
const BACKDROP = '#000';
const MEMORY_LOG_DELAY_MS = 1500;
const AWAKE_CHECK_MS = 1000;
const REFOCUS_CHECK_MS = 100;
const UPDATE_CHECK_DELAY_MS = 10 * 1000;
const RESUME_CHECK_DELAY_MS = 15 * 1000;

const tinkExe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const FINISHING =process.argv.includes(FINISH_FLAG) && /\.new$/i.test(path.dirname(process.execPath));
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
let allGames = [];
let settings = {};
const settingsFile = () => path.join(DATA_DIR, 'settings.json');
const firstSeenFile = () => path.join(DATA_DIR, 'firstseen.json');
let firstSeen = {};
let covers = null;
let heroes = null;

function makeCovers() {
  return createCovers({
    dir: path.join(DATA_DIR, 'covers'),
    enabled: settings.covers === true,
    steamGridKey: options.steamKey(settings),
  });
}

function makeHeroes() {
  const current = loadSettings(settingsFile());
  return createHeroes({
    dir: path.join(DATA_DIR, 'heroes'),
    enabled: current.covers === true,
    steamGridKey: options.steamKey(current),
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
  covers = makeCovers();
  heroes = null;
  const steamDir = await steam.findSteamDir();
  lastSteamDir = steamDir;
  const steamGames = (steamDir ? steam.getSteamGames(steamDir) : []).map((game) => ({
    ...game,
    id: `steam:${game.appId}`,
    console: 'steam',
    consoleName: STEAM.name,
    fileName: game.appId,
    key: `steam:${game.appId}`,
  }));
  const games = [...steamGames, ...pcadded.getAddedGames(settings)];
  gamesById = new Map(games.map((game) => [game.id, game]));
  allGames = games;
  firstSeen = updateFirstSeen(firstSeenFile(), games.map((game) => game.key));
  return currentLibrary();
}

function currentLibrary() {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  const profile = profiles.activeProfile(current);
  const visible = profiles.visibleGames(allGames, profile);
  const show = ({ id, key, title, console }) => ({ id, title, console, fav: profile.favourites.includes(key) });
  return {
    row: profiles.homeRow(visible, profile, firstSeen).map(show),
    games: profiles.sortGames(visible, profile.sort, profile, firstSeen).map(show),
    sort: profile.sort,
  };
}

const ownedById = new Map();
let lastSteamDir = null;

function loadProfiles() {
  const current = loadSettings(settingsFile());
  profiles.ensureProfiles(current);
  return current;
}

function hiddenOwned(profile) {
  if (!lastSteamDir || !profile.hiddenGames.some((key) => key.startsWith('steam:'))) return [];
  const installed = steam.getSteamGames(lastSteamDir).map((game) => game.appId);
  return owned.getHiddenOwnedGames(lastSteamDir, installed, profile.hiddenGames);
}
const lookup = (id) => gamesById.get(id) || ownedById.get(id);

// Games the account owns but hasn't installed; they get covers through the same lookup as library games.
async function getOwnedGames() {
  const steamDir = await steam.findSteamDir();
  lastSteamDir = steamDir;
  const installed = steamDir ? steam.getSteamGames(steamDir).map((game) => game.appId) : [];
  const { hiddenGames } = profiles.activeProfile(loadProfiles());
  const list = owned.getOwnedGames(steamDir, installed, { hidden: hiddenGames }).map((game) => ({
    ...game,
    id: `own:${game.appId}`,
    key: `steam:${game.appId}`,
    console: 'steam',
    consoleName: STEAM.name,
    fileName: game.appId,
  }));
  ownedById.clear();
  for (const game of list) ownedById.set(game.id, game);
  return list.map(({ id, appId, title }) => ({ id, appId, title }));
}

const steamInstall = createSteamInstall({
  findSteamDir: steam.findSteamDir,
  processes: steam.listProcesses,
  runningAppId: steam.getRunningAppId,
  inGame: () => playing !== null,
  log,
});

async function ownedAppId(appId) {
  const id = String(appId);
  if (!ownedById.has(`own:${id}`)) await getOwnedGames();
  return ownedById.has(`own:${id}`) ? id : null;
}

async function getInstallDrives(appId) {
  const id = await ownedAppId(appId);
  return id ? steamInstall.drives(id) : "Steam couldn't start this download.";
}

async function installGame(appId, library) {
  const id = await ownedAppId(appId);
  if (!id) return "Steam couldn't start this download.";
  const outcome = await steamInstall.install(id, typeof library === 'string' ? library : null);
  if (outcome === true) await comeBack();
  return outcome;
}

function loginItemPath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function setStartWithWindows(on) {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, path: loginItemPath() });
  return getSettings();
}

async function comeBack() {
  if (win && !win.isDestroyed() && !playing) await showTink();
}

async function getFileIcon(exe) {
  if (typeof exe !== 'string' || exe.length > 1000 || exe.includes('\0') || !path.isAbsolute(exe) || !/\.exe$/i.test(exe)) return null;
  try {
    const image = await app.getFileIcon(exe, { size: 'large' });
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

async function getInstallProgress(appId) {
  const id = String(appId);
  if (!installs.isAppId(id)) return { state: 'none', percent: 0 };
  return installs.progress(id, await steam.findSteamDir());
}

async function findPcGames() {
  const have = new Set(pcadded.getAddedGames(loadSettings(settingsFile())).map((game) => game.path.toLowerCase()));
  const found = await pcgames.findPcGames({ readShortcut: (file) => shell.readShortcutLink(file) });
  return found.filter((game) => !have.has(game.exe.toLowerCase()));
}

function changePcGames(change) {
  const current = loadSettings(settingsFile());
  const result = change(current);
  saveSettings(settingsFile(), current);
  settings = current;
  const games = [...gamesById.values()].filter((game) => game.console !== 'pc').concat(pcadded.getAddedGames(current));
  gamesById = new Map(games.map((game) => [game.id, game]));
  allGames = games;
  firstSeen = updateFirstSeen(firstSeenFile(), games.map((game) => game.key));
  return result;
}

function addPcGame(entry) {
  if (!entry || typeof entry !== 'object') return { error: "That isn't a program." };
  const { exe, title } = entry;
  return changePcGames((current) => pcadded.addPcGame(current, { exe, title }));
}

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
    profiles: current.profiles.map(({ id, name, colour, avatar }) => {
      const src = files.includes(avatar) ? avatarSrc(avatar) : null;
      return { id, name, colour, avatar: src };
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

async function getHero(id) {
  const game = lookup(id);
  if (!game) return null;
  if (!heroes) heroes = makeHeroes();
  return heroes.getHero(game);
}

let picker = null;
const pickerFor = (id) => (picker && picker.game.id === id ? picker : null);

function getCoverChoices(id, known) {
  const game = gamesById.get(id);
  if (!game || !covers) return null;
  if (!known) {
    if (picker) picker.close();
    picker = openChoices({ game, covers, steamGridKey: options.steamKey(loadSettings(settingsFile())) });
  }
  const open = pickerFor(id);
  return open && open.more(known);
}

function closeCoverChoices(id) {
  const open = pickerFor(id);
  if (!open) return;
  open.close();
  picker = null;
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
    if (!padReader) log("Could not load XInput, so Select + Start won't close games. They still come back when the game closes.");
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

const capturesDir = () => path.join(app.getPath('videos'), 'Captures');
const shotsDir = () => path.join(capturesDir(), 'Tink');

let albumStore = null;
function album() {
  albumStore ||= createAlbum({
    capturesDir: capturesDir(),
    tinkDir: shotsDir(),
    findSteamDir: steam.findSteamDir,
    steamTitle: (appId) => lookup(`steam:${appId}`)?.title,
    fileTitle: (name) => [...gamesById.values()].find((game) => safeName(game.title) === name)?.title ?? name,
    nativeImage,
    trash: (file) => shell.trashItem(file),
  });
  return albumStore;
}

let shooting = false;
async function takeShot(game) {
  const native = win32.native();
  if (shooting || !native || !session || session.state() !== 'playing') return;
  const front = native.foreground();
  if (front === ownHandle()) return;
  // Some games start through a launcher Tink can't follow, so the window in front stands in for them.
  const hwnd = session.window() ?? front;
  if (!hwnd) return;
  shooting = true;
  try {
    const file = path.join(shotsDir(), shotName(game.title, new Date()));
    const saved = await captureWindow(hwnd, file, { onFail: (reason) => log(`Could not take a screenshot: ${reason}`) });
    if (saved && !win.isDestroyed()) win.webContents.send('shot');
  } finally {
    shooting = false;
  }
}

function watchShots(game) {
  const button = options.screenshotButton(loadSettings(settingsFile()));
  const buttons = button && openButtons({ xinput: getPadReader() });
  if (!buttons) return () => {};
  const stop = watchPress(() => takeShot(game), {
    read: () => buttons.pressed().has(button.id),
    onFail: (error) => log("Reading the pad failed, so the screenshot button won't work this time", error),
  });
  return () => {
    stop();
    buttons.close();
  };
}

let learning = null;
async function learnScreenshotButton() {
  if (learning) learning.cancel();
  const buttons = openButtons({ xinput: getPadReader() });
  if (!buttons) return null;
  const mine = learnButton({ buttons });
  learning = mine;
  try {
    const id = await mine.done;
    return id ? changeSettings((current) => options.setScreenshotButton(current, id)).screenshotButton : null;
  } finally {
    buttons.close();
    if (learning === mine) learning = null;
  }
}

function clearScreenshotButton() {
  if (learning) learning.cancel();
  return changeSettings((current) => options.setScreenshotButton(current, null)).screenshotButton;
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
  const stopShots = watchShots(game);
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
      stopShots();
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

async function startPc(game) {
  const { child, exited } = playGame({ exe: game.path, args: [] });
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } catch {
    // A program that asks for administrator rights can't be spawned directly, so Windows starts it instead.
    const problem = await shell.openPath(game.path);
    if (problem) throw new Error(problem);
    return { child: { pid: 0, exitCode: 0, signalCode: null }, exited: Promise.resolve() };
  }
  exited.catch(() => {});
  return { child, exited };
}

async function launchPc(game) {
  if (!fs.existsSync(game.path)) return { error: "This game can't be found.", fix: 'rescan' };
  sendGame('loading', { id: game.id, title: game.title });
  let outcome;
  try {
    const { child, exited } = await startPc(game);
    const match = pcadded.pcMatcher(game, child.pid);
    const target = {
      kind: 'pc',
      child,
      exited,
      installDir: game.installDir,
      match,
      realExe: () => game.realExe,
      onExe: (exe) => {
        const current = loadSettings(settingsFile());
        if (!pcadded.rememberRealExe(current, game.id, exe)) return;
        saveSettings(settingsFile(), current);
        game.realExe = path.resolve(exe);
      },
    };
    outcome = await play(game, target, () => steam.closeSteamGame(match).catch((error) => log('Could not close the game', error)));
  } catch (error) {
    sendGame('failed');
    outcome = { status: 'failed', error };
  }
  if (outcome.status === 'failed') {
    log(`Could not start ${game.title}`, outcome.error);
    return { error: "This game couldn't be started." };
  }
  if (outcome.status === 'ended') changeActive((profile) => profiles.recordPlay(profile, game.key));
  return {};
}

async function launchSteam(game) {
  const { appId } = game;
  if (!/^\d+$/.test(String(appId))) return;
  sendGame('loading', { id: game.id, title: game.title });
  try {
    await steamInstall.settled();
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

function getSetup() {
  return { needed: setup.needsSetup(loadSettings(settingsFile())) };
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
    ...options.buildSettings(current, app.getVersion()),
    packaged: app.isPackaged,
    startWithWindows: app.isPackaged && app.getLoginItemSettings({ path: loginItemPath() }).openAtLogin,
    ...profiles.settingsView(profiles.activeProfile(current), allGames, hiddenOwned(profiles.activeProfile(current))),
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

const setFocusStyle = (mode) => changeSettings((current) => options.setFocusStyle(current, mode));
const setBackground = (mode) => changeSettings((current) => options.setBackground(current, mode));
const setCorners = (mode) => changeSettings((current) => options.setCorners(current, mode));
const setTextStyle = (mode) => changeSettings((current) => options.setTextStyle(current, mode));
const setKeyboard = (mode) => changeSettings((current) => options.setKeyboard(current, mode));
const setSounds = (picked) => changeSettings((current) => options.setSounds(current, picked));
const setNames = (mode) => changeSettings((current) => options.setNames(current, mode));
const setHeart = (mode) => changeSettings((current) => options.setHeart(current, mode));
const setCases = (mode) => changeSettings((current) => options.setCases(current, mode));
const setGameOptions = (mode) => changeSettings((current) => options.setGameOptions(current, mode));
const setCoverPicker = (mode) => changeSettings((current) => options.setCoverPicker(current, mode));
const setHomeProfiles = (on) => changeSettings((current) => options.setHomeProfiles(current, on));
const setSteamKey = (key) => {
  heroes = null;
  return changeSettings((current) => options.setSteamKey(current, key));
};

async function redownloadCovers() {
  const current = loadSettings(settingsFile());
  current.covers = true;
  saveSettings(settingsFile(), current);
  settings = current;
  await (covers || makeCovers()).redownload();
  await (heroes || makeHeroes()).redownload();
  heroes = null;
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
  return launchPc(game);
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
  if (app.isPackaged && !FINISHING) steamInstall.warm().catch((error) => log('Steam did not start quietly', error));
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
  handle('finishSetup', (wantsCovers) => finishSetup(wantsCovers === true));
  handle('getSettings', getSettings);
  handle('setFullscreen', (on) => setFullscreen(on === true));
  handle('setStartWithWindows', (on) => setStartWithWindows(on === true));
  handle('setFocusStyle', (mode) => setFocusStyle(String(mode)));
  handle('setBackground', (mode) => setBackground(String(mode)));
  handle('setCorners', (mode) => setCorners(String(mode)));
  handle('setTextStyle', (mode) => setTextStyle(String(mode)));
  handle('setKeyboard', (mode) => setKeyboard(String(mode)));
  handle('setSounds', (picked) => setSounds(picked && typeof picked === 'object' ? picked : {}));
  handle('setNames', (mode) => setNames(String(mode)));
  handle('setHeart', (mode) => setHeart(String(mode)));
  handle('setCases', (mode) => setCases(String(mode)));
  handle('setGameOptions', (mode) => setGameOptions(String(mode)));
  handle('setCoverPicker', (mode) => setCoverPicker(String(mode)));
  handle('setHomeProfiles', (on) => setHomeProfiles(on === true));
  handle('setSteamKey', (key) => setSteamKey(key));
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
  handle('setSort', (sort) => {
    changeActive((profile) => { if (profiles.SORTS.includes(sort)) profile.sort = sort; });
    return currentLibrary();
  });
  handle('showGame', (key) => { changeActive((profile) => profiles.showGame(profile, String(key))); return getSettings(); });
  handle('showHiddenGames', () => { changeActive(profiles.showAllGames); return getSettings(); });
  handle('getLibrary', getLibrary);
  handle('refreshLibrary', currentLibrary);
  handle('getCover', (id) => getCover(String(id)));
  handle('getHero', (id) => getHero(String(id)));
  handle('getCoverChoices', (id, known) => getCoverChoices(String(id), Number(known) || 0));
  handle('getCoverChoice', (id, index, whole) => pickerFor(String(id))?.image(Number(index), whole === true) ?? null);
  handle('useCoverChoice', (id, index) => pickerFor(String(id))?.use(Number(index)) ?? false);
  handle('closeCoverChoices', (id) => closeCoverChoices(String(id)));
  handle('getGameInfo', (id) => getGameInfo(String(id)));
  handle('getNews', async (cachedOnly) => ({ items: await news().getNews({ cachedOnly: cachedOnly === true }), unread: await news().hasUnread() }));
  handle('getNewsImage', (id) => (typeof id === 'string' && id.length < 64 ? news().getNewsImage(id) : null));
  handle('markNewsSeen', () => news().markSeen());
  handle('launch', (id) => launch(String(id)));
  handle('getOwnedGames', getOwnedGames);
  handle('getInstallDrives', (appId) => getInstallDrives(appId));
  handle('installGame', (appId, library) => installGame(appId, library));
  handle('getInstallProgress', (appId) => getInstallProgress(appId));
  handle('findPcGames', findPcGames);
  handle('getFileIcon', (exe) => getFileIcon(exe));
  handle('listFolder', (dir) => pcgames.listFolder(typeof dir === 'string' ? dir : ''));
  handle('addPcGame', (entry) => addPcGame(entry));
  handle('removePcGame', (id) => changePcGames((current) => pcadded.removePcGame(current, String(id))));
  handle('cancelLaunch', cancelLaunch);
  handle('focusGame', focusGame);
  handle('handoffReady', () => {
    if (session) session.ready();
  });
  handle('getAlbum', () => album().list());
  handle('getThumb', (id) => album().getThumb(String(id)));
  handle('getShot', (id) => album().getShot(String(id)));
  handle('deleteShot', (id) => album().remove(String(id)));
  handle('learnScreenshotButton', learnScreenshotButton);
  handle('clearScreenshotButton', clearScreenshotButton);
  handle('getBoot', async () => ({ available: app.isPackaged, on: app.isPackaged && await shellMode.isShell(tinkExe()) }));
  handle('setBoot', async (on) => {
    if (!app.isPackaged) return { available: false, on: false };
    await shellMode.setShell(tinkExe(), on === true);
    return { available: true, on: await shellMode.isShell(tinkExe()) };
  });
  handle('power', async (action) => {
    if (action !== 'close') return app.isPackaged && powerAction(String(action));
    if (app.isPackaged && await shellMode.isShell(tinkExe())) spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  });
  ipcMain.handle('logError', (_event, text) => log('Screen error', String(text).slice(0, 2000)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
