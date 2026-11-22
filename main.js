// Tink's main process: the window, and the two things the UI can ask for.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const steam = require('./src/steam');

const POLL_MS = 2000;
// How long to wait for Steam to actually start the game before giving up and showing Tink again.
// Generous, because a first launch can wait on an update or a Steam login.
const START_TIMEOUT_MS = 5 * 60 * 1000;

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,
    backgroundColor: '#101114',
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
  const steamDir = await steam.findSteamDir();
  return {
    steamFound: Boolean(steamDir),
    games: steamDir ? steam.getSteamGames(steamDir) : [],
  };
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

// Starts the game through Steam, hides Tink, and shows it again once Steam says the game has ended.
async function launch(appId) {
  if (!/^\d+$/.test(String(appId))) return;
  try {
    await shell.openExternal(`steam://rungameid/${appId}`);
    win.hide();
    await waitForGameToEnd();
  } finally {
    win.show();
    win.focus();
  }
}

app.whenReady().then(() => {
  ipcMain.handle('getLibrary', getLibrary);
  ipcMain.handle('launch', (_event, appId) => launch(appId));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
