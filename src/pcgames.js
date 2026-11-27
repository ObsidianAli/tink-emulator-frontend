const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX_EXE_DEPTH = 3;
const MAX_SHORTCUT_DEPTH = 3;
const PRIORITY = { epic: 4, gog: 4, shortcut: 3, folder: 2 };

// Whole words only, so a game called "Updated Plains" still shows.
const JUNK_WORDS = new Set([
  'setup', 'install', 'installer', 'update', 'updater', 'patch', 'patcher', 'launcher', 'config', 'configure', 'configuration',
  'settings', 'editor', 'server', 'dedicated', 'service', 'bootstrap', 'bootstrapper', 'benchmark', 'handler', 'activation',
  'register', 'support', 'cleanup', 'helper', 'crash', 'report', 'reporter', 'redist', 'uninstall', 'uninstaller', 'repair',
  'diagnostics', 'readme', 'manual', 'website', 'soundtrack', 'tool', 'tools', 'modkit', 'sdk', 'wizard',
]);
const JUNK_PARTS = /unins|crashpad|crashhandler|crashreport|bugsplat|bugreport|redist|vcredist|dxsetup|dxwebsetup|dotnet|netfx|physx|easyanticheat|battleye|cefprocess|webhelper|prereq|oalinst|notification_helper|unitycrash|vc_redist|cleanup|sendreport|werfault/i;
const LAUNCHERS = /^(epicgameslauncher|epicwebhelper|battle\.?net|ubisoftconnect|upc|eadesktop|eabackgroundservice|ealauncher|origin|galaxyclient|riotclientservices|riotclientux|rockstarlauncher|playnite\w*|xboxapp|steam|steamservice|steamwebhelper|gamingservices|bethesdanetlauncher|goggalaxy|itch|heroic|lutris|amazongames|jackbox\s?launcher)$/i;
const APPS = /^(chrome|msedge|firefox|brave|opera|discord|spotify|obs64|obs32|vlc|zoom|teams|slack|code|devenv|notepad\+\+|winword|excel|powerpnt|outlook|onenote|7zfm|winrar|gimp|blender|audacity|handbrake|qbittorrent|cheatengine\S*|msiafterburner|nvidia\S*|geforce\S*|razer\S*|logi\S*|corsair\S*|icue|armoury\S*|steelseries\S*|python\w*|node|java\w*|powershell|cmd)$/i;
const OTHER_EMULATORS = /^(ryujinx|yuzu|citra|rpcs3|xenia\S*|duckstation\S*|ppsspp\S*|melonds|mgba|bsnes|snes9x\S*|project64\S*|flycast|redream|desmume|visualboyadvance\S*|mesen\S*|xemu|scummvm|dolphin|cemu|eden|pcsx2\S*|shadps4|azahar|retroarch|mame\S*|higan|ares|lime3ds|vita3k|yuzu-early-access|suyu|sudachi)$/i;

const SYSTEM_FOLDERS = /^(windows|\$recycle\.bin|system volume information|recovery|perflogs|config\.msi|msocache|documents and settings|windowsapps|programdata|appdata|boot|\$winreagent|\$sysreset|intel|amd|nvidia|drivers|swsetup)$/i;
const IGNORE_GAME_FOLDERS = /^(launcher|epic online services|directxredist|directx|_commonredist|__installer|common files|redist|redistributables|support|tools|sdk|dotnet|vcredist|\.egstore|emulators?|roms?|saves?|mods?|downloads?|installers?)$/i;
const ROOT_NAME = /games$/i;
const NESTED_ROOTS = [['GOG Galaxy', 'Games'], ['Ubisoft', 'Ubisoft Game Launcher', 'games'], ['Ubisoft', 'Ubisoft Game Launcher', 'Games']];
const GENERIC_FOLDERS = /^(bin|bin32|bin64|binaries|win64|win32|x64|x86|release|game|app|windows|windowsnoeditor|shipping|retail|exe|program)$/i;
const BROAD_FOLDERS = /^(program files( \(x86\))?|games?|my games|pc games|windows|users|desktop|downloads|documents|appdata|programdata|local|roaming)$/i;
const SKIP_EXE_DIRS = /^(redist|_commonredist|directx|dotnet|vcredist|installer|__installer|support|crashpad|easyanticheat\w*|eac|battleye|tools|\.egstore|prereq\w*|ue4prereqsetup\w*|mono|logs|saves?|mods?)$/i;
const MARKER_FILES = /^(unityplayer\.dll|steam_api(64)?\.dll|steam_appid\.txt|data\.win|.+\.(pck|vpk|bsa|ba2|xp3)|goggame-\d+\.info)$/i;

const readDir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};

const lower = (value) => path.resolve(value).toLowerCase();

function inside(folder, file) {
  const root = lower(folder).replace(/[\\/]+$/, '') + path.sep;
  return lower(file).startsWith(root);
}

function words(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function isJunkExe(file) {
  const stem = path.basename(file).replace(/\.exe$/i, '');
  return JUNK_PARTS.test(stem) || words(stem).some((word) => JUNK_WORDS.has(word)) || LAUNCHERS.test(stem) || APPS.test(stem);
}

const isEmulatorExe = (file) => OTHER_EMULATORS.test(path.basename(file).replace(/\.exe$/i, ''));

function cleanPcTitle(raw) {
  let name = String(raw || '').replace(/\.(exe|lnk)$/i, '');
  name = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  if (!/\s/.test(name)) {
    name = name.replace(/[_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
    name = name.replace(/-/g, ' ');
  }
  name = name.replace(/_/g, ' ').replace(/[-\s]+(GOG|x64|x86|win64|win32|64[- ]?bit|32[- ]?bit)\s*$/i, '');
  name = name.replace(/\s+v?\d+(\.\d+){1,3}\s*$/i, '').replace(/\s+/g, ' ').trim();
  return name || String(raw || '').trim();
}

function isBroad(folder) {
  const parsed = path.parse(path.resolve(folder));
  return parsed.root === path.resolve(folder) || parsed.dir === parsed.root || BROAD_FOLDERS.test(path.basename(folder));
}

// The folder holding the whole game: steps out of bin/Win64-style subfolders but never into a shared one like D:\Games.
function gameFolder(exe) {
  let folder = path.dirname(exe);
  for (let i = 0; i < 4 && GENERIC_FOLDERS.test(path.basename(folder)); i++) {
    const parent = path.dirname(folder);
    if (parent === folder || isBroad(parent)) break;
    folder = parent;
  }
  return { folder, exact: isBroad(folder) };
}

function titleFor(exe, folder) {
  const base = isBroad(folder) || GENERIC_FOLDERS.test(path.basename(folder)) ? path.basename(exe) : path.basename(folder);
  return cleanPcTitle(base);
}

function exesIn(folder, depth = 0) {
  const found = [];
  for (const entry of readDir(folder)) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_EXE_DEPTH && !SKIP_EXE_DIRS.test(entry.name)) found.push(...exesIn(full, depth + 1));
    } else if (/\.exe$/i.test(entry.name)) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
      }
      found.push({ file: full, depth, size });
    }
  }
  return found;
}

const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Better to skip a game than to start the wrong program, so an unclear folder gives nothing.
function pickExe(folder, title) {
  const candidates = exesIn(folder).filter((hit) => !isJunkExe(hit.file) && !isEmulatorExe(hit.file));
  if (!candidates.length) return null;
  const want = squash(title);
  const named = candidates.filter((hit) => {
    const stem = squash(path.basename(hit.file, path.extname(hit.file)).replace(/-win(64|32)-shipping$/i, ''));
    return stem.length >= 3 && want.length >= 3 && (stem === want || want.includes(stem) || stem.includes(want));
  });
  const pool = named.length ? named : candidates;
  const shallow = Math.min(...pool.map((hit) => hit.depth));
  const top = pool.filter((hit) => hit.depth === shallow).sort((a, b) => b.size - a.size);
  const pick = (hit) => ({ file: hit.file, named: named.length > 0 });
  if (top.length === 1) return pick(top[0]);
  return top[0].size >= 3 * top[1].size ? pick(top[0]) : null;
}

function fromGogInfo(folder) {
  for (const entry of readDir(folder)) {
    if (!/^goggame-\d+\.info$/i.test(entry.name)) continue;
    const info = readJson(path.join(folder, entry.name));
    if (!info || !info.name) continue;
    if (info.rootGameId && String(info.rootGameId) !== String(info.gameId)) return { dlc: true };
    const tasks = Array.isArray(info.playTasks) ? info.playTasks : [];
    const task = tasks.find((t) => t.isPrimary && t.path && !t.arguments) || tasks.find((t) => t.type === 'FileTask' && t.path && !t.arguments);
    if (!task) return { dlc: true };
    return { title: String(info.name), exe: path.join(folder, task.path) };
  }
  return null;
}

function gameRoots(env, drives) {
  const roots = new Set();
  const addChildren = (base) => {
    for (const entry of readDir(base)) {
      if (!entry.isDirectory() || /steam/i.test(entry.name) || SYSTEM_FOLDERS.test(entry.name)) continue;
      if (ROOT_NAME.test(entry.name)) {
        const root = path.join(base, entry.name);
        roots.add(root);
        for (const inner of readDir(root)) {
          if (inner.isDirectory() && ROOT_NAME.test(inner.name) && !/steam/i.test(inner.name)) roots.add(path.join(root, inner.name));
        }
      }
    }
  };
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean);
  for (const drive of drives) programFiles.push(path.join(drive, 'Program Files'), path.join(drive, 'Program Files (x86)'));
  for (const base of new Set(programFiles.map((dir) => path.resolve(dir)))) {
    addChildren(base);
    for (const parts of NESTED_ROOTS) {
      const nested = path.join(base, ...parts);
      if (isDir(nested)) roots.add(nested);
    }
  }
  for (const drive of drives) addChildren(drive);
  return [...roots];
}

function fromRoots(roots) {
  const found = [];
  for (const root of roots) {
    for (const entry of readDir(root)) {
      if (!entry.isDirectory() || IGNORE_GAME_FOLDERS.test(entry.name) || /steam/i.test(entry.name)) continue;
      const folder = path.join(root, entry.name);
      if (ROOT_NAME.test(entry.name) && roots.some((other) => lower(other) === lower(folder))) continue;
      const gog = fromGogInfo(folder);
      if (gog) {
        if (!gog.dlc && isFile(gog.exe) && !isJunkExe(gog.exe) && !isEmulatorExe(gog.exe)) found.push({ title: gog.title, exe: gog.exe, folder, source: 'gog' });
        continue;
      }
      const title = cleanPcTitle(entry.name);
      if (JUNK_TITLE.test(title)) continue;
      const pick = pickExe(folder, title);
      // An exe that doesn't match the folder's name needs other signs of a game, or a ROM folder with a checksum tool would count.
      if (pick && (pick.named || looksLikeAGame(path.dirname(pick.file)) || looksLikeAGame(folder))) found.push({ title, exe: pick.file, folder, source: 'folder' });
    }
  }
  return found;
}

function fromEpic(env) {
  const dir = path.join(env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  const found = [];
  for (const entry of readDir(dir)) {
    if (!/\.item$/i.test(entry.name)) continue;
    const item = readJson(path.join(dir, entry.name));
    if (!item || !item.DisplayName || !item.InstallLocation || !item.LaunchExecutable || item.bIsIncompleteInstall) continue;
    if (Array.isArray(item.AppCategories) && !item.AppCategories.includes('games')) continue;
    if (item.MainGameAppName && item.AppName && item.MainGameAppName !== item.AppName) continue;
    if (item.LaunchCommand && String(item.LaunchCommand).trim()) continue;
    const exe = path.join(item.InstallLocation, item.LaunchExecutable);
    if (!/\.exe$/i.test(exe) || !isFile(exe) || LAUNCHERS.test(path.basename(exe, '.exe')) || isEmulatorExe(exe)) continue;
    found.push({ title: String(item.DisplayName), exe, folder: item.InstallLocation, source: 'epic' });
  }
  return found;
}

const GOG_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';

function readRegistryTree(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function parseRegistryKeys(text) {
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) keys.push({ values: {} });
    const match = line.match(/^\s+(\S+)\s+REG_\w+\s*(.*)$/);
    if (match && keys.length) keys[keys.length - 1].values[match[1]] = match[2].trim();
  }
  return keys;
}

function fromGogRegistry(text) {
  const found = [];
  for (const { values } of parseRegistryKeys(text)) {
    if (!values.gameName || !values.exe || values.dependsOn || values.launchParam) continue;
    const exe = values.exe;
    if (!/\.exe$/i.test(exe) || !isFile(exe) || isJunkExe(exe) || isEmulatorExe(exe)) continue;
    found.push({ title: values.gameName, exe, folder: values.path || path.dirname(exe), source: 'gog' });
  }
  return found;
}

function shortcutDirs(env) {
  return [env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')].filter(Boolean);
}

function shortcutFiles(dir, depth = 0) {
  const found = [];
  for (const entry of readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_SHORTCUT_DEPTH) found.push(...shortcutFiles(full, depth + 1));
    } else if (/\.lnk$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function looksLikeAGame(folder) {
  const entries = readDir(folder);
  if (entries.some((entry) => entry.isFile() && MARKER_FILES.test(entry.name))) return true;
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return dirs.some((name) => name.toLowerCase() === 'engine') && dirs.some((name) => isDir(path.join(folder, name, 'Binaries')));
}

const JUNK_TITLE = /\b(launcher|installer|setup files|redist\w*|tools?|sdk|season|bluray|1080p|720p|2160p|x26[45])\b/i;
const SHORTCUT_JUNK = /\b(uninstall|readme|manual|website|support|help|soundtrack|editor|configur\w*|settings|launcher|server|tools?|benchmark|workshop|mod ?kit|dedicated|artbook|wallpapers?)\b/i;

function fromShortcuts(env, readShortcut, roots) {
  const found = [];
  const seen = new Set();
  for (const dir of shortcutDirs(env)) {
    for (const file of shortcutFiles(dir)) {
      let link;
      try {
        link = readShortcut(file);
      } catch {
        continue;
      }
      const exe = link && link.target;
      if (!exe || !/\.exe$/i.test(exe) || (link.args && String(link.args).trim()) || seen.has(lower(exe))) continue;
      const name = path.basename(file, '.lnk');
      if (SHORTCUT_JUNK.test(name) || isJunkExe(exe) || isEmulatorExe(exe) || /steamapps/i.test(exe) || /^[a-z]:\\windows\\/i.test(exe)) continue;
      if (!isFile(exe)) continue;
      const known = roots.some((root) => inside(root, exe));
      const { folder } = gameFolder(exe);
      if (!known && !looksLikeAGame(path.dirname(exe)) && !looksLikeAGame(folder)) continue;
      seen.add(lower(exe));
      found.push({ title: cleanPcTitle(name), exe, folder, source: 'shortcut' });
    }
  }
  return found;
}

function fixedDrives(exists = fs.existsSync) {
  const drives = [];
  for (let code = 67; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (exists(drive)) drives.push(drive);
  }
  return drives;
}

function merge(entries) {
  const sorted = [...entries].sort((a, b) => PRIORITY[b.source] - PRIORITY[a.source]);
  const kept = [];
  for (const entry of sorted) {
    const same = kept.some((other) => lower(other.exe) === lower(entry.exe)
      || (!isBroad(other.folder) && inside(other.folder, entry.exe))
      || (!isBroad(entry.folder) && inside(entry.folder, other.exe))
      || squash(other.title) === squash(entry.title));
    if (!same) kept.push(entry);
  }
  return kept.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
}

async function findPcGames({ env = process.env, drives = fixedDrives(), readShortcut = () => null, readRegistry = readRegistryTree } = {}) {
  const roots = gameRoots(env, drives);
  const gog = fromGogRegistry(await readRegistry(GOG_KEY).catch(() => ''));
  const epic = fromEpic(env);
  const folders = fromRoots(roots);
  const known = [...roots, ...epic.map((game) => game.folder), ...gog.map((game) => game.folder)];
  const shortcuts = fromShortcuts(env, readShortcut, known);
  return merge([...epic, ...gog, ...shortcuts, ...folders]).map(({ title, exe, folder, source }) => ({ title, exe, folder, source }));
}

function listFolder(dir, { drives = fixedDrives() } = {}) {
  if (typeof dir !== 'string' || dir === '' || dir.includes('\0') || dir.length > 1000) {
    return { path: '', parent: null, entries: drives.map((drive) => ({ name: drive.replace(/\\$/, ''), path: drive, kind: 'drive' })) };
  }
  const resolved = path.resolve(dir);
  const parsed = path.parse(resolved);
  const parent = resolved === parsed.root ? '' : path.dirname(resolved);
  const entries = [];
  for (const entry of readDir(resolved)) {
    if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory()) {
      if (!SYSTEM_FOLDERS.test(entry.name)) entries.push({ name: entry.name, path: full, kind: 'folder' });
    } else if (/\.exe$/i.test(entry.name) && !isJunkExe(entry.name)) {
      entries.push({ name: entry.name, path: full, kind: 'exe' });
    }
  }
  const rank = { folder: 0, exe: 1 };
  entries.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { path: resolved, parent, entries };
}

module.exports = { findPcGames, listFolder, cleanPcTitle, gameFolder, titleFor, isJunkExe, isBroad, inside, parseRegistryKeys };
