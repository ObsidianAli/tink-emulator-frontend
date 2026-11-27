const crypto = require('node:crypto');

const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'];
const RECENT_MAX = 200;
const NAME_MAX = 10;
const PROFILES_MAX = 8;
const SORTS = ['az', 'favourites'];
const ROW_MAX = 12;

const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '');
const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);

function times(map, keep) {
  const source = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  return Object.fromEntries(keep.filter((key) => Number.isFinite(source[key])).map((key) => [key, source[key]]));
}

function normalise(profile) {
  const avatar = typeof profile.avatar === 'string' && profile.avatar ? profile.avatar : null;
  const recent = strings(profile.recent).slice(0, RECENT_MAX);
  return {
    id: typeof profile.id === 'string' && profile.id ? profile.id : crypto.randomBytes(4).toString('hex'),
    name: cleanName(profile.name) || 'Player',
    colour: COLOURS.includes(profile.colour) ? profile.colour : COLOURS[0],
    avatar,
    recent,
    favourites: strings(profile.favourites),
    hiddenConsoles: strings(profile.hiddenConsoles),
    hiddenGames: strings(profile.hiddenGames),
    playedAt: times(profile.playedAt, recent),
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
  const profile = normalise({ name: `Player ${settings.profiles.length + 1}`, colour });
  settings.profiles.push(profile);
  return profile;
}

function editProfile(profile, { name, colour, avatar }, avatars = []) {
  if (cleanName(name)) profile.name = cleanName(name);
  if (COLOURS.includes(colour)) profile.colour = colour;
  if (avatar === null) profile.avatar = null;
  else if (avatars.includes(avatar)) profile.avatar = avatar;
}

function removeProfile(settings, id) {
  if (settings.profiles.length < 2 || !settings.profiles.some((p) => p.id === id)) return false;
  settings.profiles = settings.profiles.filter((p) => p.id !== id);
  if (settings.lastProfile === id) settings.lastProfile = settings.profiles[0].id;
  return true;
}

function recordPlay(profile, key, now = Date.now()) {
  profile.recent = [key, ...profile.recent.filter((k) => k !== key)].slice(0, RECENT_MAX);
  profile.playedAt = { ...times(profile.playedAt, profile.recent), [key]: now };
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

function sortByRecency(games, profile, seen) {
  const stamp = (game) => Math.max((profile.playedAt || {})[game.key] || 0, seen[game.key] || 0);
  return sortByHistory([...games].sort(byTitle), profile.recent).sort((a, b) => stamp(b) - stamp(a));
}

function sortGames(games, sort, profile, seen = {}) {
  if (sort === 'az') return [...games].sort(byTitle);
  const recent = sortByRecency(games, profile, seen);
  return [...recent.filter((g) => profile.favourites.includes(g.key)), ...recent.filter((g) => !profile.favourites.includes(g.key))];
}

const homeRow = (games, profile, seen = {}) => sortByRecency(games, profile, seen).slice(0, ROW_MAX);

function settingsView(profile, consoles, hiddenOwned = []) {
  return {
    consoleList: consoles.map((item) => ({ id: item.console, name: item.name, hidden: profile.hiddenConsoles.includes(item.console) })),
    hiddenGames: profile.hiddenGames.length,
    hiddenList: consoles
      .flatMap((item) => item.games.map((game) => ({ key: game.key, title: game.title, consoleName: item.name })))
      .concat(hiddenOwned.map((game) => ({ key: `steam:${game.appId}`, title: game.title, consoleName: 'Steam' })))
      .filter((game) => profile.hiddenGames.includes(game.key))
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true })),
  };
}

module.exports = {
  COLOURS, RECENT_MAX, PROFILES_MAX, SORTS, ROW_MAX, ensureProfiles, activeProfile, addProfile, editProfile, removeProfile, recordPlay, toggleFavourite,
  hideGame, showGame, showAllGames, toggleConsole, visibleGames, sortGames, homeRow, sortByHistory, settingsView,
};
