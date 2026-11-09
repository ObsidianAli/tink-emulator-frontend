// Tink's main process: the window, and the two things the UI can ask for.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const steam = require('./src/steam');

const POLL_MS = 2000;
// How long to wait for Steam to actually start the game before giving up and showing Tink again.
const START_TIMEOUT_MS = 90000;

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

function getLibrary() {
  const steamDir = steam.findSteamDir();
  const games = steamDir ? steam.getSteamGames(steamDir) : [];
  return {
    steamFound: Boolean(steamDir),
    games: games.map((game) => ({ ...game, art: steam.artUrls(game.appId) })),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the game through Steam, hides Tink, and shows it again once Steam says the game has ended.
async function launch(appId) {
  if (!/^\d+$/.test(String(appId))) return;
  win.hide();
  await shell.openExternal(`steam://rungameid/${appId}`);

  const wanted = Number(appId);
  const deadline = Date.now() + START_TIMEOUT_MS;
  let started = false;
  while (Date.now() < deadline || started) {
    await sleep(POLL_MS);
    const running = await steam.getRunningAppId();
    if (running === wanted) started = true;
    else if (started && running === 0) break;
  }

  win.show();
  win.focus();
}

app.whenReady().then(() => {
  ipcMain.handle('getLibrary', getLibrary);
  ipcMain.handle('launch', (_event, appId) => launch(appId));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
