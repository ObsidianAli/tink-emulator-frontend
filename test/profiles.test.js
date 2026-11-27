const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/profiles');

const game = (console, name) => ({ id: `${console}:D:\${name}`, key: `${console}:${name}`, console, consoleName: console === 'steam' ? 'Steam' : 'PC', title: name });
const fresh = () => {
  const settings = {};
  p.ensureProfiles(settings);
  return settings;
};

test('old settings get one profile with nothing hidden, and the rest is kept', () => {
  const settings = { consoles: { ps2: { folder: 'D:\PS2' } }, covers: true };
  assert.strictEqual(p.ensureProfiles(settings), true);
  assert.strictEqual(settings.profiles.length, 1);
  const [profile] = settings.profiles;
  assert.deepStrictEqual({ ...profile, id: undefined }, {
    id: undefined, name: 'Player', colour: 'blue', avatar: null, recent: [], favourites: [], hiddenGames: [], playedAt: {}, sort: 'az',
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
  for (let i = 0; i < p.RECENT_MAX + 3; i++) p.recordPlay(profile, `k${i}`);
  p.recordPlay(profile, 'k10');
  assert.strictEqual(profile.recent.length, p.RECENT_MAX);
  assert.deepStrictEqual(profile.recent.slice(0, 3), ['k10', `k${p.RECENT_MAX + 2}`, `k${p.RECENT_MAX + 1}`]);
  assert.strictEqual(new Set(profile.recent).size, p.RECENT_MAX);
});

const library = [game('steam', 'Beta'), game('steam', 'Delta'), game('pc', 'Alpha'), game('pc', 'Gamma')];
const titles = (list) => list.map((g) => g.title);

test('the row starts with what the profile played last, then unplayed games A to Z', () => {
  const profile = fresh().profiles[0];
  const games = p.visibleGames(library, profile);
  assert.deepStrictEqual(titles(p.homeRow(games, profile)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  p.recordPlay(profile, 'steam:Delta');
  p.recordPlay(profile, 'pc:Gamma');
  p.recordPlay(profile, 'steam:Delta');
  assert.deepStrictEqual(titles(p.homeRow(games, profile)), ['Delta', 'Gamma', 'Alpha', 'Beta']);
});

test('the row holds twelve games at most', () => {
  const profile = fresh().profiles[0];
  const many = Array.from({ length: 20 }, (_, i) => game('pc', `G${String(i).padStart(2, '0')}`));
  const games = p.visibleGames(many, profile);
  p.recordPlay(profile, 'pc:G19');
  const row = p.homeRow(games, profile);
  assert.strictEqual(row.length, p.ROW_MAX);
  assert.deepStrictEqual(titles(row.slice(0, 3)), ['G19', 'G00', 'G01']);
});

test("one profile's play history does not order another profile's row", () => {
  const settings = fresh();
  const other = p.addProfile(settings);
  p.recordPlay(settings.profiles[0], 'pc:Gamma');
  assert.deepStrictEqual(titles(p.homeRow(p.visibleGames(library, other), other)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
});

test('sorting by history ignores unknown keys and leaves never-played games in place', () => {
  const list = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
  assert.deepStrictEqual(p.sortByHistory(list, []).map((g) => g.key), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(p.sortByHistory(list, ['d', 'gone', 'b']).map((g) => g.key), ['d', 'b', 'a', 'c']);
});

test('the All games orders: A to Z and favourites first', () => {
  const profile = fresh().profiles[0];
  const games = p.visibleGames(library, profile);
  p.recordPlay(profile, 'pc:Gamma');
  p.recordPlay(profile, 'steam:Beta');
  p.toggleFavourite(profile, 'steam:Delta');
  p.toggleFavourite(profile, 'pc:Gamma');
  assert.deepStrictEqual(titles(p.sortGames(games, 'az', profile)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  assert.deepStrictEqual(titles(p.sortGames(games, 'favourites', profile)), ['Gamma', 'Delta', 'Beta', 'Alpha']);
});

test('a profile remembers its sort, and an unknown one falls back to A to Z', () => {
  const settings = fresh();
  assert.strictEqual(settings.profiles[0].sort, 'az');
  settings.profiles[0].sort = 'favourites';
  p.ensureProfiles(settings);
  assert.strictEqual(settings.profiles[0].sort, 'favourites');
  settings.profiles[0].sort = 'console';
  p.ensureProfiles(settings);
  assert.strictEqual(settings.profiles[0].sort, 'az');
});

test('a game installed after one was played comes first, and a game played since comes before it', () => {
  const profile = fresh().profiles[0];
  const games = p.visibleGames(library, profile);
  p.recordPlay(profile, 'steam:Beta', 1000);
  const seen = { 'steam:Beta': 0, 'steam:Delta': 0, 'pc:Alpha': 0, 'pc:Gamma': 2000 };
  assert.deepStrictEqual(titles(p.homeRow(games, profile, seen)), ['Gamma', 'Beta', 'Alpha', 'Delta']);
  p.recordPlay(profile, 'pc:Alpha', 3000);
  assert.deepStrictEqual(titles(p.homeRow(games, profile, seen)), ['Alpha', 'Gamma', 'Beta', 'Delta']);
  assert.deepStrictEqual(titles(p.sortGames(games, 'az', profile, seen)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
});

test('games from the baseline scan do not outrank played ones, and ties fall back to play order then A to Z', () => {
  const profile = fresh().profiles[0];
  const games = p.visibleGames(library, profile);
  profile.recent = ['pc:Gamma'];
  const seen = Object.fromEntries(games.map((g) => [g.key, 0]));
  assert.deepStrictEqual(titles(p.homeRow(games, profile, seen)), ['Gamma', 'Alpha', 'Beta', 'Delta']);
  p.recordPlay(profile, 'steam:Delta', 5);
  assert.deepStrictEqual(titles(p.homeRow(games, profile, seen)), ['Delta', 'Gamma', 'Alpha', 'Beta']);
});

test('hidden games leave the list, and come back', () => {
  const profile = fresh().profiles[0];
  p.hideGame(profile, 'steam:Beta');
  p.hideGame(profile, 'pc:Alpha');
  assert.deepStrictEqual(titles(p.visibleGames(library, profile)), ['Delta', 'Gamma']);
  p.showAllGames(profile);
  assert.strictEqual(p.visibleGames(library, profile).length, 4);
});

test('one hidden game can come back, and the settings view lists the hidden ones', () => {
  const profile = fresh().profiles[0];
  p.hideGame(profile, 'steam:Beta');
  p.hideGame(profile, 'pc:Gamma');
  const view = p.settingsView(profile, library);
  assert.strictEqual(view.hiddenGames, 2);
  assert.deepStrictEqual(view.hiddenList.map((g) => [g.key, g.title, g.consoleName]), [['steam:Beta', 'Beta', 'Steam'], ['pc:Gamma', 'Gamma', 'PC']]);
  p.showGame(profile, 'steam:Beta');
  assert.deepStrictEqual(profile.hiddenGames, ['pc:Gamma']);
  assert.ok(titles(p.visibleGames(library, profile)).includes('Beta'));
});

test('hidden store games share the hidden list and come back with showGame', () => {
  const profile = fresh().profiles[0];
  p.hideGame(profile, 'steam:20');
  p.hideGame(profile, 'pc:Gamma');
  const view = p.settingsView(profile, library, [{ appId: '20', title: 'Alpha Quest' }]);
  assert.deepStrictEqual(view.hiddenList.map((g) => [g.key, g.title, g.consoleName]), [['steam:20', 'Alpha Quest', 'Steam'], ['pc:Gamma', 'Gamma', 'PC']]);
  p.showGame(profile, 'steam:20');
  assert.deepStrictEqual(profile.hiddenGames, ['pc:Gamma']);
  assert.strictEqual(p.settingsView(profile, library).hiddenList.length, 1);
});

test('favourites toggle on and off', () => {
  const [profile] = fresh().profiles;
  assert.strictEqual(p.toggleFavourite(profile, 'a'), true);
  assert.strictEqual(p.toggleFavourite(profile, 'a'), false);
  assert.deepStrictEqual(profile.favourites, []);
});

test('editing ignores bad names, colours and pictures, and null clears the picture', () => {
  const [profile] = fresh().profiles;
  p.editProfile(profile, { name: '  Sam  ', colour: 'red', avatar: 'sam.png' }, ['sam.png']);
  assert.deepStrictEqual([profile.name, profile.colour, profile.avatar], ['Sam', 'red', 'sam.png']);
  p.editProfile(profile, { name: '   ', colour: 'pink', avatar: '../x.png' }, ['sam.png']);
  assert.deepStrictEqual([profile.name, profile.colour, profile.avatar], ['Sam', 'red', 'sam.png']);
  p.editProfile(profile, { name: 'Kim' }, ['sam.png']);
  assert.strictEqual(profile.avatar, 'sam.png');
  p.editProfile(profile, { avatar: null }, ['sam.png']);
  assert.strictEqual(profile.avatar, null);
  p.editProfile(profile, { name: 'A very long nickname' }, []);
  assert.strictEqual(profile.name, 'A very lon');
});

test('old built-in icons are dropped and the profile keeps its picture or falls back to its initial', () => {
  const settings = { profiles: [{ name: 'Old', icon: 'planet' }, { name: 'Pic', avatar: 'sam.png', icon: 'star' }] };
  assert.strictEqual(p.ensureProfiles(settings), true);
  assert.deepStrictEqual(settings.profiles.map((profile) => [profile.avatar, 'icon' in profile]), [[null, false], ['sam.png', false]]);
  assert.strictEqual(p.ensureProfiles(settings), false);
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
