const { CONSOLES, EMULATORS, isConsole, isEmulator } = require('./presets');
const { resolveEmulator } = require('./setup');
const { isFile } = require('./detect');

const wantsFullscreen = (settings) => settings.fullscreen !== false;

const LEFT_EDGES = ['slide', 'peek', 'fade'];
const leftEdge = (settings) => (LEFT_EDGES.includes(settings.leftEdge) ? settings.leftEdge : 'slide');

const steamKey = (settings) => (typeof settings.steamGridDbKey === 'string' ? settings.steamGridDbKey.trim() : '');

function buildSettings(settings, detected, version) {
  const consoles = Object.entries(CONSOLES).map(([id, preset]) => {
    const entry = settings.consoles[id] || {};
    let emulator;
    if (preset.emulator) {
      const chosen = settings.emulators && settings.emulators[preset.emulator];
      const found = Boolean(resolveEmulator(settings, detected, preset.emulator));
      emulator = {
        id: preset.emulator,
        label: EMULATORS[preset.emulator].label,
        status: chosen && isFile(chosen) ? 'Chosen' : found ? 'Found' : 'Not found',
        found,
      };
    } else {
      const found = Boolean(entry.exe && isFile(entry.exe));
      emulator = { id, label: 'Emulator', status: found ? 'Chosen' : 'Not chosen', found };
    }
    return { id, name: preset.name, emulator, folder: entry.folder || null };
  });
  return {
    version,
    fullscreen: wantsFullscreen(settings),
    leftEdge: leftEdge(settings),
    covers: settings.covers === true,
    hasKey: steamKey(settings) !== '',
    consoles,
  };
}

function clearEmulator(settings, id) {
  if (isConsole(id) && !CONSOLES[id].emulator) {
    if (settings.consoles[id]) delete settings.consoles[id].exe;
    return;
  }
  if (!isEmulator(id)) throw new Error('Unknown emulator');
  if (settings.emulators) delete settings.emulators[id];
}

function setFullscreen(settings, on) {
  settings.fullscreen = on === true;
}

function setLeftEdge(settings, mode) {
  if (LEFT_EDGES.includes(mode)) settings.leftEdge = mode;
}

function setSteamKey(settings, key) {
  const clean = typeof key === 'string' ? key.trim().slice(0, 200) : '';
  if (clean) settings.steamGridDbKey = clean;
  else delete settings.steamGridDbKey;
}

module.exports = { buildSettings, clearEmulator, setFullscreen, setLeftEdge, setSteamKey, wantsFullscreen, steamKey };
