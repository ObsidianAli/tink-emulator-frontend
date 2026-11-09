// Reads the installed Steam library and checks which Steam game is running.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const DEFAULT_STEAM_DIR = 'C:\\Program Files (x86)\\Steam';

// Steam installs these as "games", but they are tools and runtimes, not something to play.
const SKIPPED_APP_IDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710']);
const SKIPPED_NAMES = /^(Steamworks Common Redistributables|Proton (\d|Experimental|Hotfix)|Steam Linux Runtime)/i;

// Parses Steam's text format (.vdf / .acf) into nested objects. Only quoted strings and braces matter.
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
    pos++; // the closing brace
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

// Every library folder Steam knows about, including the main install.
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
// A manifest without the field is treated as installed.
function isFullyInstalled(state) {
  return state.StateFlags === undefined || (Number(state.StateFlags) & 4) !== 0;
}

// The installed games, sorted by title. A missing or unreadable Steam install gives an empty list.
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
      games.set(state.appid, { appId: state.appid, title: state.name, art: artUrls(state.appid) });
    }
  }
  return [...games.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// Steam's own art: the tall library image, or the wide header image if that one doesn't exist.
function artUrls(appId) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return { cover: `${base}/library_600x900.jpg`, fallback: `${base}/header.jpg` };
}

const STEAM_REGISTRY_KEY = 'HKCU\\Software\\Valve\\Steam';

// Reads one value from Steam's registry key. Returns its text, or null if it can't be read.
function readSteamRegistry(valueName) {
  return new Promise((resolve) => {
    execFile('reg', ['query', STEAM_REGISTRY_KEY, '/v', valueName], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      // Output looks like: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
      for (const line of String(stdout).split(/\r?\n/)) {
        const match = line.match(/^\s+(\S+)\s+REG_\w+\s+(.*)$/);
        if (match && match[1] === valueName) return resolve(match[2].trim());
      }
      resolve(null);
    });
  });
}

// Steam's install folder: from the registry, else the default location. Null if Steam isn't installed.
async function findSteamDir() {
  const fromRegistry = await readSteamRegistry('SteamPath');
  if (fromRegistry && fs.existsSync(fromRegistry)) return path.normalize(fromRegistry);
  return fs.existsSync(DEFAULT_STEAM_DIR) ? DEFAULT_STEAM_DIR : null;
}

// Steam keeps the id of the running game in the registry; 0 means nothing is running.
// Returns null if it couldn't be read (which is not the same as "nothing is running").
async function getRunningAppId() {
  const value = await readSteamRegistry('RunningAppID');
  return /^0x[0-9a-f]+$/i.test(value || '') ? parseInt(value, 16) : null;
}

// After a Steam crash the registry can still name a game that is long gone,
// so "a game is running" only counts while steam.exe itself is running.
function isSteamRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, stdout) => {
      resolve(!err && /"steam\.exe"/i.test(String(stdout)));
    });
  });
}

module.exports = { parseVdf, getSteamGames, artUrls, findSteamDir, getRunningAppId, isSteamRunning };
