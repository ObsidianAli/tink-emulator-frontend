const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { gameProcesses } = require('./steam');
const { descendants } = require('./win32');
const { cleanPcTitle, gameFolder, titleFor, inside } = require('./pcgames');
const { PC } = require('./presets');

const MAX_GAMES = 500;
const MAX_TITLE = 120;
const MAX_PATH = 1000;

const idFor = (exe) => crypto.createHash('sha1').update(path.resolve(exe).toLowerCase()).digest('hex').slice(0, 10);
const isPcId = (id) => typeof id === 'string' && /^[0-9a-f]{10}$/.test(id);
const bareId = (id) => String(id).replace(/^pc:/, '');

function validExe(exe) {
  return typeof exe === 'string' && exe.length <= MAX_PATH && !exe.includes('\0') && path.isAbsolute(exe) && /\.exe$/i.test(exe);
}

function addPcGame(settings, { exe, title } = {}, { isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true } = {}) {
  if (!validExe(exe) || !isFile(exe)) return { error: "That isn't a program." };
  if (!Array.isArray(settings.pcGames)) settings.pcGames = [];
  const id = idFor(exe);
  const existing = settings.pcGames.find((game) => game.id === id);
  if (existing) return { id };
  if (settings.pcGames.length >= MAX_GAMES) return { error: 'Too many games.' };
  const resolved = path.resolve(exe);
  const { folder, exact } = gameFolder(resolved);
  const chosen = typeof title === 'string' ? cleanPcTitle(title).slice(0, MAX_TITLE) : '';
  settings.pcGames.push({ id, title: chosen || titleFor(resolved, folder), exe: resolved, folder, exact });
  return { id };
}

function removePcGame(settings, id) {
  const bare = bareId(id);
  if (!isPcId(bare) || !Array.isArray(settings.pcGames)) return false;
  const before = settings.pcGames.length;
  settings.pcGames = settings.pcGames.filter((game) => game.id !== bare);
  return settings.pcGames.length !== before;
}

function rememberRealExe(settings, id, exe) {
  const game = (settings.pcGames || []).find((entry) => entry.id === bareId(id));
  if (!game || !validExe(exe) || path.resolve(exe).toLowerCase() === game.exe.toLowerCase()) return false;
  if (!game.exact && !inside(game.folder, exe)) return false;
  game.realExe = path.resolve(exe);
  return true;
}

function getAddedGames(settings) {
  return (Array.isArray(settings.pcGames) ? settings.pcGames : [])
    .filter((game) => game && isPcId(game.id) && typeof game.exe === 'string' && typeof game.title === 'string')
    .map((game) => ({
      id: `pc:${game.id}`,
      key: `pc:${game.id}`,
      console: 'pc',
      consoleName: PC.name,
      title: game.title,
      fileName: game.title,
      path: game.exe,
      installDir: game.folder,
      exact: game.exact === true,
      realExe: game.realExe || null,
    }));
}

// Launchers quit early, so the game counts as open while anything from its folder runs; a game sitting in a shared folder only counts by its own exe.
function pcMatcher(game, childPid) {
  const exes = new Set([game.path, game.realExe].filter(Boolean).map((exe) => path.resolve(exe).toLowerCase()));
  return (processes) => {
    const pids = new Set(game.exact ? [] : gameProcesses(processes, game.installDir));
    for (const { pid, exe } of processes) if (exe && exes.has(path.resolve(exe).toLowerCase())) pids.add(pid);
    if (childPid && processes.some((row) => row.pid === childPid)) {
      pids.add(childPid);
      for (const pid of descendants(processes, childPid)) pids.add(pid);
    }
    return [...pids];
  };
}

module.exports = { addPcGame, removePcGame, rememberRealExe, getAddedGames, pcMatcher, isPcId, bareId };
