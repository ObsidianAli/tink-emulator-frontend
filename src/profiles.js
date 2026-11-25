const crypto = require('node:crypto');

const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'];
const ICONS = ['controller', 'planet', 'star'];
const DEFAULT_ICON = 'star';
const RECENT_MAX = 200;
const NAME_MAX = 10;
const PROFILES_MAX = 8;
const SORTS = ['recent', 'az', 'console', 'favourites'];
const ROW_MAX = 12;

const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '');
const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);

function normalise(profile) {
  const avatar = typeof profile.avatar === 'string' && profile.avatar ? profile.avatar : null;
  return {
    id: typeof profile.id === 'string' && profile.id ? profile.id : crypto.randomBytes(4).toString('hex'),
    name: cleanName(profile.name) || 'Player',
    colour: COLOURS.includes(profile.colour) ? profile.colour : COLOURS[0],
    avatar,
    icon: avatar ? null : ICONS.includes(profile.icon) ? profile.icon : DEFAULT_ICON,
    recent: strings(profile.recent).slice(0, RECENT_MAX),
    favourites: strings(profile.favourites),
    hiddenConsoles: strings(profile.hiddenConsoles),
    hiddenGames: strings(profile.hiddenGames),
    sort: SORTS.includes(profile.sort) ? profile.sort : SORTS[0],
  };
}

function ensureProfiles(settings) {
  const before = JSON.stringify([settings.profiles, settings.lastProfile]);
  const list = Array.isArray(settings.profiles) ? settings.profiles.filter((p) => p && typeof p === 'object') : [];
  settings.profiles = list.length ? list.map(normalise) : [normalise({})];
  if (!settings.profiles.some((p) => p.id === settings.lastProfile)) settings.lastProfile = settings.profiles[0].id;
  return JSON.stringify([settings.profiles, settings.lastProfile]) !== before;
}

const activeProfile = (settings) => settings.profiles.find((p) => p.id === settings.lastProfile) || settings.profiles[0];

function addProfile(settings) {
  if (settings.profiles.length >= PROFILES_MAX) return null;
  const taken = settings.profiles.map((p) => p.colour);
  const colour = COLOURS.find((c) => !taken.includes(c)) || COLOURS[settings.profiles.length % COLOURS.length];
  const icon = ICONS[settings.profiles.length % ICONS.length];
  const profile = normalise({ name: `Player ${settings.profiles.length + 1}`, colour, icon });
  settings.profiles.push(profile);
  return profile;
}

function editProfile(profile, { name, colour, avatar, icon }, avatars = []) {
  if (cleanName(name)) profile.name = cleanName(name);
  if (COLOURS.includes(colour)) profile.colour = colour;
  if (ICONS.includes(icon)) Object.assign(profile, { icon, avatar: null });
  else if (avatars.includes(avatar)) Object.assign(profile, { icon: null, avatar });
}

function removeProfile(settings, id) {
  if (settings.profiles.length < 2 || !settings.profiles.some((p) => p.id === id)) return false;
  settings.profiles = settings.profiles.filter((p) => p.id !== id);
  if (settings.lastProfile === id) settings.lastProfile = settings.profiles[0].id;
  return true;
}

function recordPlay(profile, key) {
  profile.recent = [key, ...profile.recent.filter((k) => k !== key)].slice(0, RECENT_MAX);
}

function toggleFavourite(profile, key) {
  const had = profile.favourites.includes(key);
  profile.favourites = had ? profile.favourites.filter((k) => k !== key) : [...profile.favourites, key];
  return !had;
}

function hideGame(profile, key) {
  if (!profile.hiddenGames.includes(key)) profile.hiddenGames.push(key);
}

function showAllGames(profile) {
  profile.hiddenGames = [];
}

function showGame(profile, key) {
  profile.hiddenGames = profile.hiddenGames.filter((k) => k !== key);
}

function toggleConsole(profile, id) {
  const hidden = profile.hiddenConsoles.includes(id);
  profile.hiddenConsoles = hidden ? profile.hiddenConsoles.filter((c) => c !== id) : [...profile.hiddenConsoles, id];
}

function sortByHistory(games, recent) {
  const rank = new Map(recent.map((key, index) => [key, index]));
  const played = games.filter((game) => rank.has(game.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
  return [...played, ...games.filter((game) => !rank.has(game.key))];
}

function visibleGames(consoles, profile) {
  return consoles
    .filter((item) => !profile.hiddenConsoles.includes(item.console))
    .flatMap((item) => item.games)
    .filter((game) => !profile.hiddenGames.includes(game.key));
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'en', { numeric: true });

function sortGames(games, sort, profile) {
  const recent = sortByHistory([...games].sort(byTitle), profile.recent);
  if (sort === 'az') return [...games].sort(byTitle);
  if (sort === 'console') return games;
  if (sort === 'favourites') {
    return [...recent.filter((g) => profile.favourites.includes(g.key)), ...recent.filter((g) => !profile.favourites.includes(g.key))];
  }
  return recent;
}

const homeRow = (games, profile) => sortGames(games, 'recent', profile).slice(0, ROW_MAX);

function settingsView(profile, consoles) {
  return {
    consoleList: consoles.map((item) => ({ id: item.console, name: item.name, hidden: profile.hiddenConsoles.includes(item.console) })),
    hiddenGames: profile.hiddenGames.length,
    hiddenList: consoles
      .flatMap((item) => item.games.map((game) => ({ key: game.key, title: game.title, consoleName: item.name })))
      .filter((game) => profile.hiddenGames.includes(game.key))
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true })),
  };
}

module.exports = {
  COLOURS, ICONS, DEFAULT_ICON, RECENT_MAX, PROFILES_MAX, SORTS, ROW_MAX, ensureProfiles, activeProfile, addProfile, editProfile, removeProfile, recordPlay, toggleFavourite,
  hideGame, showGame, showAllGames, toggleConsole, visibleGames, sortGames, homeRow, sortByHistory, settingsView,
};
