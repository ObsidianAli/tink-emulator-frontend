const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const win32 = require('./win32');

const DEFAULT_STEAM_DIR = 'C:\\Program Files (x86)\\Steam';

const SKIPPED_APP_IDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710']);
const SKIPPED_NAMES = /^(Steamworks Common Redistributables|Proton (\d|Experimental|Hotfix)|Steam Linux Runtime)/i;

function isSkippedApp(appId, name) {
  return SKIPPED_APP_IDS.has(String(appId)) || SKIPPED_NAMES.test(name || '');
}

function parseVdf(text) {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}]/g) || [];
  let pos = 0;

  function readObject() {
    const result = {};
    while (pos < tokens.length && tokens[pos] !== '}') {
      const key = unquote(tokens[pos++]);
      if (tokens[pos] === '{') {
        pos++;
        result[key] = readObject();
      } else {
        result[key] = unquote(tokens[pos++]);
      }
    }
    pos++;
    return result;
  }

  return readObject();
}

function unquote(token) {
  return token.slice(1, -1).replace(/\\(.)/g, '$1');
}

function readVdfFile(file) {
  try {
    return parseVdf(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listedFolders(steamDir) {
  const vdf = readVdfFile(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'));
  // Newer Steam calls the root "libraryfolders", older Steam "LibraryFolders". Folders are numbered "0", "1", ...
  const root = vdf && (vdf.libraryfolders || vdf.LibraryFolders);
  const entries = root ? Object.entries(root).filter(([key]) => /^\d+$/.test(key)).map(([, value]) => value) : [];
  // Newer Steam writes an object with a "path"; older Steam wrote just the path.
  return entries.map((entry) => (typeof entry === 'string' ? entry : entry && entry.path)).filter((folder) => typeof folder === 'string' && folder);
}

function libraryFolders(steamDir) {
  return [steamDir, ...listedFolders(steamDir).filter((folder) => path.resolve(folder) !== path.resolve(steamDir))];
}

// StateFlags bit 4 means "fully installed"; half-downloaded or uninstalling games don't have it.
function isFullyInstalled(state) {
  return state.StateFlags === undefined || (Number(state.StateFlags) & 4) !== 0;
}

function getSteamGames(steamDir) {
  const games = new Map();
  for (const folder of libraryFolders(steamDir)) {
    const appsDir = path.join(folder, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(appsDir);
    } catch {
      continue;
    }
    for (const file of files.filter((f) => /^appmanifest_\d+\.acf$/.test(f))) {
      const manifest = readVdfFile(path.join(appsDir, file));
      const state = manifest && manifest.AppState;
      if (!state || !state.appid || !state.name) continue;
      if (!isFullyInstalled(state)) continue;
      if (isSkippedApp(state.appid, state.name)) continue;
      const installDir = state.installdir ? path.join(folder, 'steamapps', 'common', state.installdir) : null;
      games.set(state.appid, { appId: state.appid, title: state.name, art: artUrls(state.appid), installDir });
    }
  }
  return [...games.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function artUrls(appId) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return { cover: `${base}/library_600x900.jpg`, fallback: `${base}/header.jpg`, hero: `${base}/library_hero.jpg` };
}

const STEAM_REGISTRY_KEY = 'HKCU\\Software\\Valve\\Steam';

function readSteamRegistry(valueName) {
  return new Promise((resolve) => {
    execFile('reg', ['query', STEAM_REGISTRY_KEY, '/v', valueName], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      for (const line of String(stdout).split(/\r?\n/)) {
        const match = line.match(/^\s+(\S+)\s+REG_\w+\s+(.*)$/);
        if (match && match[1] === valueName) return resolve(match[2].trim());
      }
      resolve(null);
    });
  });
}

async function findSteamDir() {
  const fromRegistry = await readSteamRegistry('SteamPath');
  if (fromRegistry && fs.existsSync(fromRegistry)) return path.normalize(fromRegistry);
  return fs.existsSync(DEFAULT_STEAM_DIR) ? DEFAULT_STEAM_DIR : null;
}

// Returns null if it couldn't be read (which is not the same as "nothing is running").
async function getRunningAppId() {
  const native = win32.native();
  const fast = native ? native.runningAppId() : null;
  if (fast !== null) return fast;
  const value = await readSteamRegistry('RunningAppID');
  return /^0x[0-9a-f]+$/i.test(value || '') ? parseInt(value, 16) : null;
}

// After a Steam crash the registry can name a long gone game, so a game only counts while steam.exe runs.
function isSteamRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, stdout) => {
      resolve(!err && /"steam\.exe"/i.test(String(stdout)));
    });
  });
}

function gameProcesses(processes, installDir) {
  if (!installDir) return [];
  const root = path.resolve(installDir).toLowerCase() + path.sep;
  return processes
    .filter(({ exe }) => exe && path.resolve(exe).toLowerCase().startsWith(root) && path.basename(exe).toLowerCase() !== 'steam.exe')
    .map(({ pid }) => pid);
}

function listProcesses() {
  const native = win32.native();
  const rows = native ? native.listProcesses() : null;
  if (rows) return Promise.resolve(rows);
  const script = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const rows = [].concat(JSON.parse(String(stdout) || '[]'));
        resolve(rows.map((row) => ({ pid: row.ProcessId, exe: row.ExecutablePath })));
      } catch {
        resolve([]);
      }
    });
  });
}

const taskkill = (args) =>
  new Promise((resolve) => {
    const proc = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    proc.once('error', resolve);
    proc.once('exit', resolve);
  });

const CLOSE_WAIT_MS = 5000;
const CLOSE_POLL_MS = 100;

function nativeAlive() {
  const native = win32.native();
  return native ? native.isAlive : null;
}

async function closeSteamGame(target, { waitMs = CLOSE_WAIT_MS, list = listProcesses, kill = taskkill, alive = nativeAlive(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const pick = typeof target === 'function' ? target : (rows) => gameProcesses(rows, target);
  const asked = pick(await list());
  await Promise.all(asked.map((pid) => kill(['/PID', String(pid)])));
  if (asked.length === 0) return;
  let left;
  if (alive) {
    for (let waited = 0; waited < waitMs; waited += CLOSE_POLL_MS) {
      await wait(CLOSE_POLL_MS);
      if (!asked.some(alive)) return;
    }
    left = asked.filter(alive);
  } else {
    await wait(waitMs);
    left = pick(await list()).filter((pid) => asked.includes(pid));
  }
  await Promise.all(left.map((pid) => kill(['/PID', String(pid), '/T', '/F'])));
}

module.exports = { parseVdf, readVdfFile, listedFolders, libraryFolders, isSkippedApp, getSteamGames, artUrls, findSteamDir, getRunningAppId, isSteamRunning, gameProcesses, listProcesses, closeSteamGame };
