const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/profiles');
const { getEmulatedGames } = require('../src/library');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const game = (console, name) => ({ id: `${console}:D:\${name}`, key: `${console}:${name}`, console, title: name });
const shelves = [
  { console: 'gamecube', name: 'GameCube', games: [game('gamecube', 'Luigi'), game('gamecube', 'Wind Waker')] },
  { console: 'steam', name: 'Steam', games: [{ id: 'steam:620', key: 'steam:620', console: 'steam', title: 'Portal 2' }] },
];
const fresh = () => {
  const settings = { consoles: {} };
  p.ensureProfiles(settings);
  return settings;
};

test('old settings get one profile with nothing hidden, and the rest is kept', () => {
  const settings = { consoles: { ps2: { folder: 'D:\PS2' } }, covers: true };
  assert.strictEqual(p.ensureProfiles(settings), true);
  assert.strictEqual(settings.profiles.length, 1);
  const [profile] = settings.profiles;
  assert.deepStrictEqual({ ...profile, id: undefined }, {
    id: undefined, name: 'Player', colour: 'blue', avatar: null, recent: [], favourites: [], hiddenConsoles: [], hiddenGames: [],
  });
  assert.ok(profile.id);
  assert.strictEqual(settings.lastProfile, profile.id);
  assert.deepStrictEqual(settings.consoles, { ps2: { folder: 'D:\PS2' } });
});

test('profiles that are already there are left alone', () => {
  const settings = fresh();
  assert.strictEqual(p.ensureProfiles(settings), false);
});

test('a missing last profile falls back to the first', () => {
  const settings = fresh();
  settings.lastProfile = 'gone';
  p.ensureProfiles(settings);
  assert.strictEqual(settings.lastProfile, settings.profiles[0].id);
});

test('recent lists the newest first, without repeats, up to the limit', () => {
  const [profile] = fresh().profiles;
  for (let i = 0; i < 15; i++) p.recordPlay(profile, `k${i}`);
  p.recordPlay(profile, 'k10');
  assert.strictEqual(profile.recent.length, p.RECENT_MAX);
  assert.deepStrictEqual(profile.recent.slice(0, 3), ['k10', 'k14', 'k13']);
  assert.strictEqual(new Set(profile.recent).size, p.RECENT_MAX);
});

test('the Recent shelf ends with the All games tile, and Favourites follows it', () => {
  const profile = fresh().profiles[0];
  p.recordPlay(profile, 'gamecube:Luigi');
  p.recordPlay(profile, 'steam:620');
  p.toggleFavourite(profile, 'gamecube:Wind Waker');
  const built = p.buildShelves(shelves, profile);
  assert.deepStrictEqual(built.map((s) => s.console), ['recent', 'favourites', 'gamecube', 'steam']);
  assert.deepStrictEqual(built[0].games.map((g) => g.title), ['Portal 2', 'Luigi', 'All games']);
  assert.strictEqual(p.realId(built[0].games[0].id), 'steam:620');
  assert.deepStrictEqual(built[1].games.map((g) => g.title), ['Wind Waker']);
});

test('empty Recent and Favourites shelves do not show', () => {
  const built = p.buildShelves(shelves, fresh().profiles[0]);
  assert.deepStrictEqual(built.map((s) => s.console), ['gamecube', 'steam']);
});

test('hidden games and shelves disappear everywhere, and come back', () => {
  const profile = fresh().profiles[0];
  p.recordPlay(profile, 'gamecube:Luigi');
  p.toggleFavourite(profile, 'steam:620');
  p.hideGame(profile, 'gamecube:Luigi');
  p.toggleConsole(profile, 'steam');
  let built = p.buildShelves(shelves, profile);
  assert.deepStrictEqual(built.map((s) => s.console), ['gamecube']);
  assert.deepStrictEqual(built[0].games.map((g) => g.title), ['Wind Waker']);
  p.showAllGames(profile);
  p.toggleConsole(profile, 'steam');
  built = p.buildShelves(shelves, profile);
  assert.deepStrictEqual(built.map((s) => s.console), ['recent', 'favourites', 'gamecube', 'steam']);
});

test('favourites toggle on and off', () => {
  const [profile] = fresh().profiles;
  assert.strictEqual(p.toggleFavourite(profile, 'a'), true);
  assert.strictEqual(p.toggleFavourite(profile, 'a'), false);
  assert.deepStrictEqual(profile.favourites, []);
});

test('editing ignores bad names, colours and pictures', () => {
  const [profile] = fresh().profiles;
  p.editProfile(profile, { name: '  Sam  ', colour: 'red', avatar: 'sam.png' }, ['sam.png']);
  assert.deepStrictEqual([profile.name, profile.colour, profile.avatar], ['Sam', 'red', 'sam.png']);
  p.editProfile(profile, { name: '   ', colour: 'pink', avatar: '../x.png' }, ['sam.png']);
  assert.deepStrictEqual([profile.name, profile.colour, profile.avatar], ['Sam', 'red', 'sam.png']);
  p.editProfile(profile, { avatar: null }, []);
  assert.strictEqual(profile.avatar, null);
});

test('adding picks a free colour, and the last profile cannot be removed', () => {
  const settings = fresh();
  const added = p.addProfile(settings);
  assert.notStrictEqual(added.colour, settings.profiles[0].colour);
  assert.strictEqual(added.name, 'Player 2');
  settings.lastProfile = added.id;
  assert.strictEqual(p.removeProfile(settings, added.id), true);
  assert.strictEqual(settings.lastProfile, settings.profiles[0].id);
  assert.strictEqual(p.removeProfile(settings, settings.profiles[0].id), false);
});

test('game keys stay the same when the games folder moves', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-keys-'));
  const keys = [];
  for (const folder of ['a', 'b']) {
    fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, folder, 'Luigis Mansion (USA).rvz'), '');
    keys.push(getEmulatedGames({ consoles: { gamecube: { folder: path.join(root, folder) } } })[0].key);
  }
  assert.strictEqual(keys[0], 'gamecube:Luigis Mansion (USA).rvz');
  assert.strictEqual(keys[0], keys[1]);
});
