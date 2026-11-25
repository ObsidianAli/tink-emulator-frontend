const fs = require('node:fs');
const path = require('node:path');
const { CONSOLES } = require('./presets');
const { cleanTitle } = require('./titles');

const MAX_DEPTH = 3;

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function filesWithExtensions(dir, extensions, depth = 0) {
  const found = [];
  for (const entry of readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) found.push(...filesWithExtensions(full, extensions, depth + 1));
    } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

// A disc image can be a .bin plus a .cue; then only the .cue is the game.
function dropBinsWithCue(files) {
  const stem = (file) => file.slice(0, -4).toLowerCase();
  const cues = new Set(files.filter((f) => /\.cue$/i.test(f)).map(stem));
  return files.filter((f) => !(/\.bin$/i.test(f) && cues.has(stem(f))));
}

function findGames(preset, folder) {
  if (preset.kind === 'anything') {
    return readDir(folder).map((entry) => ({ path: path.join(folder, entry.name), isFolder: entry.isDirectory() }));
  }
  if (preset.kind === 'folders') {
    return readDir(folder)
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(folder, entry.name, 'eboot.bin')))
      .map((entry) => ({ path: path.join(folder, entry.name), isFolder: true }));
  }
  return dropBinsWithCue(filesWithExtensions(folder, preset.extensions)).map((file) => ({ path: file, isFolder: false }));
}

function getEmulatedGames(settings) {
  const games = [];
  const consoles = (settings && settings.consoles) || {};
  for (const [consoleId, preset] of Object.entries(CONSOLES)) {
    const folder = consoles[consoleId] && consoles[consoleId].folder;
    if (!folder) continue;
    for (const game of findGames(preset, folder)) {
      const base = path.basename(game.path);
      games.push({
        id: `${consoleId}:${game.path}`,
        key: `${consoleId}:${base}`,
        console: consoleId,
        consoleName: preset.name,
        title: cleanTitle(base, { isFolder: game.isFolder }),
        fileName: game.isFolder ? base : base.replace(/\.[^.]+$/, ''),
        path: game.path,
      });
    }
  }
  return games;
}

function groupConsoles(games) {
  const order = [...Object.keys(CONSOLES), 'steam', 'pc'];
  const found = new Map();
  for (const game of games) {
    if (!found.has(game.console)) found.set(game.console, { console: game.console, name: game.consoleName, games: [] });
    found.get(game.console).games.push(game);
  }
  return [...found.values()]
    .sort((a, b) => order.indexOf(a.console) - order.indexOf(b.console))
    .map((item) => ({ ...item, games: item.games.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true })) }));
}

module.exports = { getEmulatedGames, groupConsoles };
