// Finds installed emulators. Looks in a few known places and one folder level inside them, never a whole drive.
const fs = require('node:fs');
const path = require('node:path');
const { EMULATORS } = require('./presets');

// Where emulators usually live: beside Tink, Program Files, AppData and RetroArch's usual folders.
function defaultSearchDirs(env, tinkDir) {
  const dirs = [
    tinkDir,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA,
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.APPDATA,
    'C:\\RetroArch-Win64',
    'C:\\RetroArch',
  ];
  return [...new Set(dirs.filter(Boolean))];
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function subfolders(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

// The exe of every emulator found, e.g. { dolphin: "C:\\Program Files\\Dolphin\\Dolphin.exe" }.
function detectEmulators(searchDirs) {
  const found = {};
  for (const dir of searchDirs) {
    for (const candidate of [dir, ...subfolders(dir)]) {
      for (const [id, emulator] of Object.entries(EMULATORS)) {
        const exe = path.join(candidate, emulator.exe);
        if (!found[id] && isFile(exe)) found[id] = exe;
      }
    }
  }
  return found;
}

module.exports = { detectEmulators, defaultSearchDirs };
