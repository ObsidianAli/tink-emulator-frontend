// The logic behind first-run setup: whether to show it, what to list on each screen, and how choices are stored.
const { CONSOLES, EMULATORS, isConsole, isEmulator } = require('./presets');
const { isFile } = require('./detect');

// Setup shows until it has been finished once (setupDone is false while it's under way). Settings from before setup existed that already have a games
// folder count as finished, so nobody who is already set up gets sent through it.
function needsSetup(settings) {
  if (typeof settings.setupDone === 'boolean') return !settings.setupDone;
  return !Object.values(settings.consoles).some((entry) => entry && entry.folder);
}

// The exe for an emulator: the one the user picked, else the detected one.
function resolveEmulator(settings, detected, id) {
  const chosen = settings.emulators && settings.emulators[id];
  if (chosen && isFile(chosen)) return chosen;
  return detected[id] || null;
}

// What the setup screens show, as plain data. Exe and folder paths stay in the main process, except the folders.
function buildSetup(settings, detected, steamFound) {
  const emulators = Object.entries(EMULATORS).map(([id, emulator]) => ({
    id,
    label: emulator.label,
    consoles: Object.values(CONSOLES).filter((preset) => preset.emulator === id).map((preset) => preset.name).join(', '),
    found: Boolean(resolveEmulator(settings, detected, id)),
  }));
  const manual = Object.entries(CONSOLES)
    .filter(([, preset]) => !preset.emulator)
    .map(([id, preset]) => {
      const exe = settings.consoles[id] && settings.consoles[id].exe;
      return { id, label: preset.name, found: Boolean(exe && isFile(exe)) };
    });
  const consoles = Object.entries(CONSOLES).map(([id, preset]) => ({
    id,
    name: preset.name,
    folder: (settings.consoles[id] && settings.consoles[id].folder) || null,
  }));
  return { needed: true, steamFound, covers: settings.covers === true, emulators, manual, consoles };
}

function consoleEntry(settings, id) {
  if (!isConsole(id)) throw new Error('Unknown console');
  if (!settings.consoles[id] || typeof settings.consoles[id] !== 'object') settings.consoles[id] = {};
  return settings.consoles[id];
}

function setEmulatorExe(settings, id, exe) {
  if (isConsole(id) && !CONSOLES[id].emulator) {
    consoleEntry(settings, id).exe = exe;
    return;
  }
  if (!isEmulator(id)) throw new Error('Unknown emulator');
  settings.emulators = { ...settings.emulators, [id]: exe };
}

// One folder per Console; null clears it, which leaves that Console without a Shelf.
function setConsoleFolder(settings, id, folder) {
  const entry = consoleEntry(settings, id);
  if (folder) entry.folder = folder;
  else delete entry.folder;
}

function completeSetup(settings, covers) {
  settings.covers = covers === true;
  settings.setupDone = true;
}

module.exports = { needsSetup, resolveEmulator, buildSetup, setEmulatorExe, setConsoleFolder, completeSetup };
