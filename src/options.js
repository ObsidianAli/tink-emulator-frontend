const { CONSOLES, EMULATORS, isConsole, isEmulator } = require('./presets');
const { resolveEmulator } = require('./setup');
const { isFile } = require('./detect');
const { buttonLabel } = require('./pad');

const wantsFullscreen = (settings) => settings.fullscreen !== false;

const showsHomeProfiles = (settings) => settings.homeProfiles !== false;

const LEFT_EDGES = ['slide', 'peek', 'fade'];
const leftEdge = (settings) => (LEFT_EDGES.includes(settings.leftEdge) ? settings.leftEdge : 'slide');
const FOCUS_STYLES = ['rim', 'snake', 'under'];
const focusStyle = (settings) => (FOCUS_STYLES.includes(settings.focusStyle) ? settings.focusStyle : 'rim');

const BACKGROUNDS = ['tint', 'art', 'drift'];
const background = (settings) => (BACKGROUNDS.includes(settings.background) ? settings.background : 'tint');

const KEYBOARDS = ['grid', 'full'];
const keyboard = (settings) => (KEYBOARDS.includes(settings.keyboard) ? settings.keyboard : 'grid');

const ICON_STYLES = ['grey', 'disc', 'glyph'];
const iconStyle = (settings) => (ICON_STYLES.includes(settings.iconStyle) ? settings.iconStyle : 'disc');

const ICON_ROWS = ['separate', 'bar'];
const iconRow = (settings) => (ICON_ROWS.includes(settings.iconRow) ? settings.iconRow : 'separate');

const steamKey = (settings) => (typeof settings.steamGridDbKey === 'string' ? settings.steamGridDbKey.trim() : '');

function screenshotButton(settings) {
  const id = settings.screenshotButton;
  const label = typeof id === 'string' ? buttonLabel(id) : null;
  return label ? { id, label } : null;
}

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
    focusStyle: focusStyle(settings),
    background: background(settings),
    keyboard: keyboard(settings),
    iconStyle: iconStyle(settings),
    iconRow: iconRow(settings),
    homeProfiles: showsHomeProfiles(settings),
    screenshotButton: screenshotButton(settings),
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

function setHomeProfiles(settings, on) {
  settings.homeProfiles = on === true;
}

function setLeftEdge(settings, mode) {
  if (LEFT_EDGES.includes(mode)) settings.leftEdge = mode;
}

function setFocusStyle(settings, mode) {
  if (FOCUS_STYLES.includes(mode)) settings.focusStyle = mode;
}

function setBackground(settings, mode) {
  if (BACKGROUNDS.includes(mode)) settings.background = mode;
}

function setKeyboard(settings, mode) {
  if (KEYBOARDS.includes(mode)) settings.keyboard = mode;
}

function setIconStyle(settings, mode) {
  if (ICON_STYLES.includes(mode)) settings.iconStyle = mode;
}

function setIconRow(settings, mode) {
  if (ICON_ROWS.includes(mode)) settings.iconRow = mode;
}

function setSteamKey(settings, key) {
  const clean = typeof key === 'string' ? key.trim().slice(0, 200) : '';
  if (clean) settings.steamGridDbKey = clean;
  else delete settings.steamGridDbKey;
}

function setScreenshotButton(settings, id) {
  if (typeof id === 'string' && buttonLabel(id)) settings.screenshotButton = id;
  else delete settings.screenshotButton;
}

module.exports = { buildSettings, clearEmulator, setFullscreen, setLeftEdge, setFocusStyle, setBackground, setKeyboard, setIconStyle, setIconRow, setHomeProfiles, setSteamKey, setScreenshotButton, screenshotButton, wantsFullscreen, steamKey };
