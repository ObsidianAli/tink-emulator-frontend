const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const DEFAULT_STEAM_DIR = 'C:\\Program Files (x86)\\Steam';

const SKIPPED_APP_IDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710']);
const SKIPPED_NAMES = /^(Steamworks Common Redistributables|Proton (\d|Experimental|Hotfix)|Steam Linux Runtime)/i;

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

function libraryFolders(steamDir) {
  const folders = [steamDir];
  const vdf = readVdfFile(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'));
  // Newer Steam calls the root "libraryfolders", older Steam "LibraryFolders". Folders are numbered "0", "1", ...
  const root = vdf && (vdf.libraryfolders || vdf.LibraryFolders);
  const entries = root ? Object.entries(root).filter(([key]) => /^\d+$/.test(key)).map(([, value]) => value) : [];
  for (const entry of entries) {
    // Newer Steam writes an object with a "path"; older Steam wrote just the path.
    const folder = typeof entry === 'string' ? entry : entry && entry.path;
    if (folder && path.resolve(folder) !== path.resolve(steamDir)) folders.push(folder);
  }
  return folders;
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
      if (SKIPPED_APP_IDS.has(state.appid) || SKIPPED_NAMES.test(state.name)) continue;
      const installDir = state.installdir ? path.join(folder, 'steamapps', 'common', state.installdir) : null;
      games.set(state.appid, { appId: state.appid, title: state.name, art: artUrls(state.appid), installDir });
    }
  }
  return [...games.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function artUrls(appId) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return { cover: `${base}/library_600x900.jpg`, fallback: `${base}/header.jpg` };
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

async function closeSteamGame(installDir, { waitMs = CLOSE_WAIT_MS, list = listProcesses, kill = taskkill, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const asked = gameProcesses(await list(), installDir);
  await Promise.all(asked.map((pid) => kill(['/PID', String(pid)])));
  if (asked.length === 0) return;
  await wait(waitMs);
  const left = gameProcesses(await list(), installDir).filter((pid) => asked.includes(pid));
  await Promise.all(left.map((pid) => kill(['/PID', String(pid), '/T', '/F'])));
}

module.exports = { parseVdf, getSteamGames, artUrls, findSteamDir, getRunningAppId, isSteamRunning, gameProcesses, closeSteamGame };
