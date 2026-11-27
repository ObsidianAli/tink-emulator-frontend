const { buttonLabel } = require('./pad');
const { SOUND_CHOICES } = require('../renderer/sound');

const wantsFullscreen = (settings) => settings.fullscreen !== false;

const showsHomeProfiles = (settings) => settings.homeProfiles !== false;

const FOCUS_STYLES = ['rim', 'snake', 'under'];
const focusStyle = (settings) => (FOCUS_STYLES.includes(settings.focusStyle) ? settings.focusStyle : 'rim');

const BACKGROUNDS = ['tint', 'flat', 'colour', 'picture', 'soft', 'art', 'drift'];
const background = (settings) => (BACKGROUNDS.includes(settings.background) ? settings.background : 'tint');

const TEXT_STYLES = ['plain', 'outline', 'pill', 'fade'];
const textStyle = (settings) => (TEXT_STYLES.includes(settings.textStyle) ? settings.textStyle : 'plain');

const KEYBOARDS = ['grid', 'full'];
const keyboard = (settings) => (KEYBOARDS.includes(settings.keyboard) ? settings.keyboard : 'grid');

const HEARTS = ['sticker', 'small'];
const heart = (settings) => (HEARTS.includes(settings.heart) ? settings.heart : 'sticker');

const GAME_OPTIONS = ['case', 'panel'];
const gameOptions = (settings) => (GAME_OPTIONS.includes(settings.gameOptions) ? settings.gameOptions : 'case');

const COVER_PICKERS = ['page', 'case'];
const coverPicker = (settings) => (COVER_PICKERS.includes(settings.coverPicker) ? settings.coverPicker : 'case');

const isSound = (name, id) => Object.hasOwn(SOUND_CHOICES, name) && SOUND_CHOICES[name].options.some(([option]) => option === id);
const sounds = (settings) => Object.fromEntries(Object.entries(settings.sounds || {}).filter(([name, id]) => isSound(name, id)));

const steamKey = (settings) => (typeof settings.steamGridDbKey === 'string' ? settings.steamGridDbKey.trim() : '');

function screenshotButton(settings) {
  const id = settings.screenshotButton;
  const label = typeof id === 'string' ? buttonLabel(id) : null;
  return label ? { id, label } : null;
}

function buildSettings(settings, version) {
  return {
    version,
    fullscreen: wantsFullscreen(settings),
    focusStyle: focusStyle(settings),
    background: background(settings),
    textStyle: textStyle(settings),
    keyboard: keyboard(settings),
    heart: heart(settings),
    gameOptions: gameOptions(settings),
    coverPicker: coverPicker(settings),
    sounds: sounds(settings),
    homeProfiles: showsHomeProfiles(settings),
    screenshotButton: screenshotButton(settings),
    covers: settings.covers === true,
    hasKey: steamKey(settings) !== '',
  };
}

function setFullscreen(settings, on) {
  settings.fullscreen = on === true;
}

function setHomeProfiles(settings, on) {
  settings.homeProfiles = on === true;
}

function setFocusStyle(settings, mode) {
  if (FOCUS_STYLES.includes(mode)) settings.focusStyle = mode;
}

function setBackground(settings, mode) {
  if (BACKGROUNDS.includes(mode)) settings.background = mode;
}

function setTextStyle(settings, mode) {
  if (TEXT_STYLES.includes(mode)) settings.textStyle = mode;
}

function setKeyboard(settings, mode) {
  if (KEYBOARDS.includes(mode)) settings.keyboard = mode;
}

function setHeart(settings, mode) {
  if (HEARTS.includes(mode)) settings.heart = mode;
}

function setGameOptions(settings, mode) {
  if (GAME_OPTIONS.includes(mode)) settings.gameOptions = mode;
}

function setCoverPicker(settings, mode) {
  if (COVER_PICKERS.includes(mode)) settings.coverPicker = mode;
}

function setSounds(settings, picked) {
  settings.sounds = { ...sounds(settings), ...sounds({ sounds: picked }) };
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

module.exports = { buildSettings, setFullscreen, setFocusStyle, setBackground, setTextStyle, setKeyboard, setHeart, setGameOptions, setCoverPicker, setSounds, setHomeProfiles, setSteamKey, setScreenshotButton, screenshotButton, wantsFullscreen, steamKey };
