// Reads the installed Steam library and checks which Steam game is running.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const DEFAULT_STEAM_DIR = 'C:\\Program Files (x86)\\Steam';

// Steam installs these as "games", but they are tools and runtimes, not something to play.
const SKIPPED_APP_IDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710']);
const SKIPPED_NAMES = /^(Steamworks Common Redistributables|Proton|Steam Linux Runtime|SteamVR)/i;

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
  const entries = vdf && vdf.libraryfolders ? Object.values(vdf.libraryfolders) : [];
  for (const entry of entries) {
    if (entry && entry.path && path.resolve(entry.path) !== path.resolve(steamDir)) {
      folders.push(entry.path);
    }
  }
  return folders;
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
      if (SKIPPED_APP_IDS.has(state.appid) || SKIPPED_NAMES.test(state.name)) continue;
      games.set(state.appid, { appId: state.appid, title: state.name });
    }
  }
  return [...games.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// Steam's own art: the tall library image, or the wide header image if that one doesn't exist.
function artUrls(appId) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return { cover: `${base}/library_600x900.jpg`, fallback: `${base}/header.jpg` };
}

function readRegistry(valueName) {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const match = out.match(new RegExp(`${valueName}\\s+REG_\\w+\\s+(.+)`));
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Steam's install folder: from the registry, else the default location.
function findSteamDir() {
  const fromRegistry = readRegistry('SteamPath');
  if (fromRegistry && fs.existsSync(fromRegistry)) return path.normalize(fromRegistry);
  return fs.existsSync(DEFAULT_STEAM_DIR) ? DEFAULT_STEAM_DIR : null;
}

// Steam keeps the id of the running game in the registry; 0 means nothing is running.
// Returns null if the registry couldn't be read.
function getRunningAppId() {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'],
      { windowsHide: true },
      (err, stdout) => {
        const match = !err && String(stdout).match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i);
        // null means "couldn't tell", which is different from 0 ("nothing is running").
        resolve(match ? parseInt(match[1], 16) : null);
      },
    );
  });
}

module.exports = { parseVdf, getSteamGames, artUrls, findSteamDir, getRunningAppId };
