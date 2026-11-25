const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/profiles');
const { getEmulatedGames } = require('../src/library');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const game = (console, name) => ({ id: `${console}:D:\${name}`, key: `${console}:${name}`, console, title: name });
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
    id: undefined, name: 'Player', colour: 'blue', avatar: null, icon: 'star', recent: [], favourites: [], hiddenConsoles: [], hiddenGames: [], sort: 'recent',
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

const lib = (names) => names.map((n) => game('gamecube', n));
const consoles = [
  { console: 'gamecube', name: 'GameCube', games: lib(['Beta', 'Delta']) },
  { console: 'snes', name: 'SNES', games: [game('snes', 'Alpha'), game('snes', 'Gamma')] },
];
const titles = (list) => list.map((g) => g.title);

test('the row starts with what the profile played last, then unplayed games A to Z', () => {
  const profile = fresh().profiles[0];
  const games = p.visibleGames(consoles, profile);
  assert.deepStrictEqual(titles(p.homeRow(games, profile)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  p.recordPlay(profile, 'gamecube:Delta');
  p.recordPlay(profile, 'snes:Gamma');
  p.recordPlay(profile, 'gamecube:Delta');
  assert.deepStrictEqual(titles(p.homeRow(games, profile)), ['Delta', 'Gamma', 'Alpha', 'Beta']);
});

test('the row holds twelve games at most', () => {
  const profile = fresh().profiles[0];
  const many = [{ console: 'ps2', name: 'PS2', games: Array.from({ length: 20 }, (_, i) => game('ps2', `G${String(i).padStart(2, '0')}`)) }];
  const games = p.visibleGames(many, profile);
  p.recordPlay(profile, 'ps2:G19');
  const row = p.homeRow(games, profile);
  assert.strictEqual(row.length, p.ROW_MAX);
  assert.deepStrictEqual(titles(row.slice(0, 3)), ['G19', 'G00', 'G01']);
});

test("one profile's play history does not order another profile's row", () => {
  const settings = fresh();
  const other = p.addProfile(settings);
  p.recordPlay(settings.profiles[0], 'snes:Gamma');
  assert.deepStrictEqual(titles(p.homeRow(p.visibleGames(consoles, other), other)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
});

test('sorting by history ignores unknown keys and leaves never-played games in place', () => {
  const list = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
  assert.deepStrictEqual(p.sortByHistory(list, []).map((g) => g.key), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(p.sortByHistory(list, ['d', 'gone', 'b']).map((g) => g.key), ['d', 'b', 'a', 'c']);
});

test('the All games orders: last played, A to Z, console, favourites first', () => {
  const profile = fresh().profiles[0];
  const games = p.visibleGames(consoles, profile);
  p.recordPlay(profile, 'snes:Gamma');
  p.recordPlay(profile, 'gamecube:Beta');
  p.toggleFavourite(profile, 'gamecube:Delta');
  p.toggleFavourite(profile, 'snes:Gamma');
  assert.deepStrictEqual(titles(p.sortGames(games, 'recent', profile)), ['Beta', 'Gamma', 'Alpha', 'Delta']);
  assert.deepStrictEqual(titles(p.sortGames(games, 'az', profile)), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  assert.deepStrictEqual(titles(p.sortGames(games, 'console', profile)), ['Beta', 'Delta', 'Alpha', 'Gamma']);
  assert.deepStrictEqual(titles(p.sortGames(games, 'favourites', profile)), ['Gamma', 'Delta', 'Beta', 'Alpha']);
});

test('a profile remembers its sort, and an unknown one falls back to last played', () => {
  const settings = fresh();
  assert.strictEqual(settings.profiles[0].sort, 'recent');
  settings.profiles[0].sort = 'az';
  p.ensureProfiles(settings);
  assert.strictEqual(settings.profiles[0].sort, 'az');
  settings.profiles[0].sort = 'sideways';
  p.ensureProfiles(settings);
  assert.strictEqual(settings.profiles[0].sort, 'recent');
});

test('hidden games and consoles leave the list, and come back', () => {
  const profile = fresh().profiles[0];
  p.hideGame(profile, 'gamecube:Beta');
  p.toggleConsole(profile, 'snes');
  assert.deepStrictEqual(titles(p.visibleGames(consoles, profile)), ['Delta']);
  p.showAllGames(profile);
  p.toggleConsole(profile, 'snes');
  assert.strictEqual(p.visibleGames(consoles, profile).length, 4);
});

test('the settings view lists consoles with whether this profile hides them', () => {
  const profile = fresh().profiles[0];
  p.toggleConsole(profile, 'snes');
  assert.deepStrictEqual(p.settingsView(profile, consoles).consoleList, [
    { id: 'gamecube', name: 'GameCube', hidden: false },
    { id: 'snes', name: 'SNES', hidden: true },
  ]);
});

test('one hidden game can come back, and the settings view lists the hidden ones', () => {
  const profile = fresh().profiles[0];
  p.hideGame(profile, 'gamecube:Beta');
  p.hideGame(profile, 'snes:Gamma');
  const view = p.settingsView(profile, consoles);
  assert.strictEqual(view.hiddenGames, 2);
  assert.deepStrictEqual(view.hiddenList.map((g) => [g.key, g.title, g.consoleName]), [['gamecube:Beta', 'Beta', 'GameCube'], ['snes:Gamma', 'Gamma', 'SNES']]);
  p.showGame(profile, 'gamecube:Beta');
  assert.deepStrictEqual(profile.hiddenGames, ['snes:Gamma']);
  assert.ok(titles(p.visibleGames(consoles, profile)).includes('Beta'));
});

test('favourites toggle on and off', () => {
  const [profile] = fresh().profiles;
  assert.strictEqual(p.toggleFavourite(profile, 'a'), true);
  assert.strictEqual(p.toggleFavourite(profile, 'a'), false);
  assert.deepStrictEqual(profile.favourites, []);
});

test('editing ignores bad names, colours, icons and pictures', () => {
  const [profile] = fresh().profiles;
  p.editProfile(profile, { name: '  Sam  ', colour: 'red', avatar: 'sam.png' }, ['sam.png']);
  assert.deepStrictEqual([profile.name, profile.colour, profile.avatar, profile.icon], ['Sam', 'red', 'sam.png', null]);
  p.editProfile(profile, { name: '   ', colour: 'pink', avatar: '../x.png', icon: 'moon' }, ['sam.png']);
  assert.deepStrictEqual([profile.name, profile.colour, profile.avatar, profile.icon], ['Sam', 'red', 'sam.png', null]);
  p.editProfile(profile, { icon: 'star' }, []);
  assert.deepStrictEqual([profile.avatar, profile.icon], [null, 'star']);
  p.editProfile(profile, { name: 'A very long nickname' }, []);
  assert.strictEqual(profile.name, 'A very lon');
});

test('a profile has a built-in icon or a picture, never neither or both', () => {
  const settings = { profiles: [{ name: 'Old' }, { name: 'Pic', avatar: 'sam.png', icon: 'star' }, { name: 'Odd', icon: 'moon' }] };
  p.ensureProfiles(settings);
  assert.deepStrictEqual(settings.profiles.map((profile) => [profile.icon, profile.avatar]), [
    ['star', null], [null, 'sam.png'], ['star', null],
  ]);
  assert.strictEqual(p.ensureProfiles(settings), false);
});

test('adding picks a free colour, and the last profile cannot be removed', () => {
  const settings = fresh();
  const added = p.addProfile(settings);
  assert.notStrictEqual(added.colour, settings.profiles[0].colour);
  assert.strictEqual(added.name, 'Player 2');
  assert.ok(p.ICONS.includes(added.icon));
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
