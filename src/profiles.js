// Profiles live in settings.json as
// "profiles": [{ id, name, colour, avatar, recent: [gameKey], favourites: [gameKey], hiddenConsoles: [], hiddenGames: [] }]
// plus "lastProfile". A game key is "<console>:<file name>" or "steam:<appid>", so it survives a rescan or a moved folder.
const crypto = require('node:crypto');

const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'];
const RECENT_MAX = 200;
const NAME_MAX = 16;
const PROFILES_MAX = 8;

const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '');
const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);

function normalise(profile) {
  return {
    id: typeof profile.id === 'string' && profile.id ? profile.id : crypto.randomBytes(4).toString('hex'),
    name: cleanName(profile.name) || 'Player',
    colour: COLOURS.includes(profile.colour) ? profile.colour : COLOURS[0],
    avatar: typeof profile.avatar === 'string' && profile.avatar ? profile.avatar : null,
    recent: strings(profile.recent).slice(0, RECENT_MAX),
    favourites: strings(profile.favourites),
    hiddenConsoles: strings(profile.hiddenConsoles),
    hiddenGames: strings(profile.hiddenGames),
  };
}

// First start after the update: settings without profiles get one, with nothing hidden.
// Returns true when something had to be filled in, so the caller saves.
function ensureProfiles(settings) {
  const before = JSON.stringify([settings.profiles, settings.lastProfile]);
  const list = Array.isArray(settings.profiles) ? settings.profiles.filter((p) => p && typeof p === 'object') : [];
  settings.profiles = list.length ? list.map(normalise) : [normalise({})];
  if (!settings.profiles.some((p) => p.id === settings.lastProfile)) settings.lastProfile = settings.profiles[0].id;
  return JSON.stringify([settings.profiles, settings.lastProfile]) !== before;
}

const activeProfile = (settings) => settings.profiles.find((p) => p.id === settings.lastProfile) || settings.profiles[0];

// Returns the new profile, or null when there are already as many as fit on the picker.
function addProfile(settings) {
  if (settings.profiles.length >= PROFILES_MAX) return null;
  const taken = settings.profiles.map((p) => p.colour);
  const colour = COLOURS.find((c) => !taken.includes(c)) || COLOURS[settings.profiles.length % COLOURS.length];
  const profile = normalise({ name: `Player ${settings.profiles.length + 1}`, colour });
  settings.profiles.push(profile);
  return profile;
}

// Changes the parts of a profile the edit view offers; anything invalid is ignored.
// avatars is the list of picture files that exist.
function editProfile(profile, { name, colour, avatar }, avatars = []) {
  if (cleanName(name)) profile.name = cleanName(name);
  if (COLOURS.includes(colour)) profile.colour = colour;
  if (avatar === null) profile.avatar = null;
  else if (avatars.includes(avatar)) profile.avatar = avatar;
}

// The last profile can't be removed. Returns false when nothing was removed.
function removeProfile(settings, id) {
  if (settings.profiles.length < 2 || !settings.profiles.some((p) => p.id === id)) return false;
  settings.profiles = settings.profiles.filter((p) => p.id !== id);
  if (settings.lastProfile === id) settings.lastProfile = settings.profiles[0].id;
  return true;
}

function recordPlay(profile, key) {
  profile.recent = [key, ...profile.recent.filter((k) => k !== key)].slice(0, RECENT_MAX);
}

// Returns true when the game is a favourite afterwards.
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

function toggleConsole(profile, id) {
  const hidden = profile.hiddenConsoles.includes(id);
  profile.hiddenConsoles = hidden ? profile.hiddenConsoles.filter((c) => c !== id) : [...profile.hiddenConsoles, id];
}

// Games played before come first, the one played last at the front; the rest stay in the order they had.
function sortByHistory(games, recent) {
  const rank = new Map(recent.map((key, index) => [key, index]));
  const played = games.filter((game) => rank.has(game.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
  return [...played, ...games.filter((game) => !rank.has(game.key))];
}

// The Shelves one profile sees: Favourites, then every Console's Shelf, minus hidden Consoles and Games, each in
// the profile's play order. Favourites holds copies of the Games under their own ids, so it keeps its own Cover textures.
function buildShelves(shelves, profile) {
  const visible = shelves
    .filter((shelf) => !profile.hiddenConsoles.includes(shelf.console))
    .map((shelf) => ({ ...shelf, games: shelf.games.filter((game) => !profile.hiddenGames.includes(game.key)) }))
    .filter((shelf) => shelf.games.length)
    .map((shelf) => ({ ...shelf, games: sortByHistory(shelf.games, profile.recent) }));
  const byKey = new Map(visible.flatMap((shelf) => shelf.games).map((game) => [game.key, game]));
  const favourites = profile.favourites.filter((key) => byKey.has(key)).map((key) => ({ ...byKey.get(key), id: `favourites/${byKey.get(key).id}` }));
  return [
    ...(favourites.length ? [{ console: 'favourites', name: 'Favourites', games: sortByHistory(favourites, profile.recent) }] : []),
    ...visible,
  ];
}

// Favourites ids point back at the real Game.
const realId = (id) => id.replace(/^favourites\//, '');

// What the Settings screen needs about the profile: its Consoles and how many Games are hidden.
function settingsView(profile, shelves) {
  return {
    shelves: shelves.map((shelf) => ({ id: shelf.console, name: shelf.name, hidden: profile.hiddenConsoles.includes(shelf.console) })),
    hiddenGames: profile.hiddenGames.length,
  };
}

module.exports = {
  COLOURS, RECENT_MAX, PROFILES_MAX, ensureProfiles, activeProfile, addProfile, editProfile, removeProfile, recordPlay, toggleFavourite,
  hideGame, showAllGames, toggleConsole, buildShelves, sortByHistory, realId, settingsView,
};
