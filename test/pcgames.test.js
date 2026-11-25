const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findPcGames, listFolder, cleanPcTitle, gameFolder, isJunkExe } = require('../src/pcgames');

function touch(root, rel, size = 10) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size));
  return file;
}

function pcWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-pc-'));
  touch(root, 'Games/Hollow Quest/HollowQuest.exe', 5000);
  touch(root, 'Games/Hollow Quest/unins000.exe');
  touch(root, 'Games/Hollow Quest/UnityCrashHandler64.exe');
  touch(root, 'Games/Hollow Quest/Redist/vc_redist.x64.exe');
  touch(root, 'Games/Plain Folder/tool.exe');
  touch(root, 'Games/Marker Game/run.exe', 5000);
  touch(root, 'Games/Marker Game/steam_api64.dll');
  touch(root, 'Games/Two Exes/a.exe', 100);
  touch(root, 'Games/Two Exes/b.exe', 110);
  touch(root, 'Games/RetroArch Stuff/retroarch.exe', 5000);
  touch(root, 'Games/Steam Stuff/Steam Game/Steam Game.exe');
  touch(root, 'Games/Bin Game/Binaries/Win64/BinGame.exe', 5000);
  touch(root, 'Games/GOG Thing/gogthing.exe', 5000);
  const info = (extra) => JSON.stringify({ gameId: '123', rootGameId: '123', name: 'GOG Thing Deluxe', playTasks: [{ isPrimary: true, type: 'FileTask', path: 'gogthing.exe' }], ...extra });
  fs.writeFileSync(path.join(root, 'Games/GOG Thing/goggame-123.info'), info());
  touch(root, 'Games/GOG Thing DLC/dlc.exe', 5000);
  fs.writeFileSync(path.join(root, 'Games/GOG Thing DLC/goggame-124.info'), info({ gameId: '124', name: 'GOG Thing DLC' }));
  touch(root, 'PF/Epic Games/Fort Epic/FortEpic.exe', 5000);
  touch(root, 'PF/Epic Games/Launcher/EpicGamesLauncher.exe', 5000);
  const manifests = path.join(root, 'PD', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  fs.mkdirSync(manifests, { recursive: true });
  const item = (name, extra) => JSON.stringify({
    DisplayName: name,
    InstallLocation: path.join(root, 'PF', 'Epic Games', 'Fort Epic'),
    LaunchExecutable: 'FortEpic.exe',
    AppName: 'a',
    MainGameAppName: 'a',
    AppCategories: ['public', 'games'],
    ...extra,
  });
  fs.writeFileSync(path.join(manifests, 'a.item'), item('Fort Epic!'));
  fs.writeFileSync(path.join(manifests, 'b.item'), item('Fort Epic DLC', { AppName: 'b' }));
  fs.writeFileSync(path.join(manifests, 'c.item'), item('An App', { AppCategories: ['applications'] }));
  fs.writeFileSync(path.join(manifests, 'd.item'), item('Half Installed', { bIsIncompleteInstall: true }));
  const cool = touch(root, 'Other/Cool Game/CoolGame.exe', 5000);
  touch(root, 'Other/Cool Game/steam_api.dll');
  const note = touch(root, 'Apps/Notepad/notepad2.exe', 5000);
  const chrome = touch(root, 'Apps/Chrome/chrome.exe', 5000);
  const withArgs = touch(root, 'Other/Args Game/ArgsGame.exe', 5000);
  touch(root, 'Other/Args Game/steam_api.dll');
  const hollow = path.join(root, 'Games/Hollow Quest/HollowQuest.exe');
  const links = {};
  const programs = path.join(root, 'AD', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const link = (name, target, args = '') => {
    links[touch(programs, `Stuff/${name}.lnk`)] = { target, args };
  };
  link('Hollow Quest', hollow);
  link('Cool Game', cool);
  link('Notepad Two', note);
  link('Chrome', chrome);
  link('Args Game', withArgs, '-windowed');
  link('Cool Game Uninstall', cool);
  const registered = touch(root, 'GOGREG/rg.exe', 5000);
  const gogKey = ['HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\9', '    gameName    REG_SZ    Registry Game', `    exe    REG_SZ    ${registered}`, ''].join('\r\n');
  const env = { ProgramFiles: path.join(root, 'PF'), ProgramData: path.join(root, 'PD'), APPDATA: path.join(root, 'AD') };
  return { root, env, links, gogKey, drives: [root + path.sep] };
}

const run = (world, extra = {}) => findPcGames({
  env: world.env,
  drives: world.drives,
  readShortcut: (file) => world.links[file],
  readRegistry: async () => world.gogKey,
  ...extra,
});

test('finds real games and hides installers, helpers, launchers, apps and unclear folders', async () => {
  const world = pcWorld();
  const games = await run(world);
  fs.rmSync(world.root, { recursive: true, force: true });
  const bySource = Object.fromEntries(games.map((g) => [g.title, g.source]));
  assert.deepStrictEqual(bySource, {
    'Bin Game': 'folder',
    'Cool Game': 'shortcut',
    'Fort Epic!': 'epic',
    'GOG Thing Deluxe': 'gog',
    'Hollow Quest': 'shortcut',
    'Marker Game': 'folder',
    'Registry Game': 'gog',
  });
});

test('a game from several sources is listed once with the best exe and its folder', async () => {
  const world = pcWorld();
  const games = await run(world);
  fs.rmSync(world.root, { recursive: true, force: true });
  const hollow = games.filter((g) => /hollow/i.test(g.title));
  assert.strictEqual(hollow.length, 1);
  assert.ok(hollow[0].exe.endsWith('HollowQuest.exe'));
  assert.ok(hollow[0].folder.endsWith('Hollow Quest'));
  assert.strictEqual(games.filter((g) => /fort epic/i.test(g.title)).length, 1);
});

test('emulators Tink already has are left out', async () => {
  const world = pcWorld();
  touch(world.root, 'Games/Dol Stuff/Dolphin.exe', 5000);
  touch(world.root, 'Games/My Custom Emu/emu.exe', 5000);
  const games = await run(world, { exclude: { exes: [path.join(world.root, 'Games', 'My Custom Emu', 'emu.exe')] } });
  fs.rmSync(world.root, { recursive: true, force: true });
  assert.ok(!games.some((g) => /dol|emu|retro/i.test(g.title)));
});

test('missing folders and a failing registry give an empty list instead of throwing', async () => {
  const games = await findPcGames({
    env: {},
    drives: ['Z:\\nope\\'],
    readShortcut: () => { throw new Error('x'); },
    readRegistry: async () => { throw new Error('x'); },
  });
  assert.deepStrictEqual(games, []);
});

test('titles are cleaned and junk exe names are spotted', () => {
  assert.strictEqual(cleanPcTitle('The_Witcher_3'), 'The Witcher 3');
  assert.strictEqual(cleanPcTitle('Urban.Myth.Dissolution.Center'), 'Urban Myth Dissolution Center');
  assert.strictEqual(cleanPcTitle('HollowKnight'), 'Hollow Knight');
  assert.strictEqual(cleanPcTitle('Doom Eternal [FitGirl Repack]'), 'Doom Eternal');
  assert.strictEqual(cleanPcTitle('Some Game v1.2.3'), 'Some Game');
  for (const junk of ['unins000.exe', 'UnityCrashHandler64.exe', 'vc_redist.x64.exe', 'Updater.exe', 'GameLauncher.exe', 'DXSETUP.exe', 'Battle.net.exe', 'EpicGamesLauncher.exe']) assert.ok(isJunkExe(junk), junk);
  for (const fine of ['Hades.exe', 'Updated Plains.exe', 'Celeste.exe']) assert.ok(!isJunkExe(fine), fine);
});

test('a game folder steps out of Binaries/Win64 but never up into a shared Games folder', () => {
  assert.strictEqual(gameFolder(path.join('D:', 'Games', 'Foo', 'Binaries', 'Win64', 'Foo.exe')).folder, path.join('D:', 'Games', 'Foo'));
  const loose = gameFolder(path.join('D:', 'Games', 'foo.exe'));
  assert.deepStrictEqual([loose.folder, loose.exact], [path.join('D:', 'Games'), true]);
  assert.strictEqual(gameFolder(path.join('D:', 'Games', 'Foo', 'Foo.exe')).exact, false);
});

test('the folder browser lists drives, then folders and programs only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-browse-'));
  touch(root, 'Beta/readme.txt');
  touch(root, 'alpha/x.txt');
  touch(root, 'Windows/x.txt');
  touch(root, '$Recycle.Bin/x.txt');
  touch(root, 'z game.exe');
  touch(root, 'unins000.exe');
  touch(root, 'notes.txt');
  const drives = ['C:\\', 'D:\\'];
  assert.deepStrictEqual(listFolder('', { drives }).entries.map((e) => [e.name, e.kind]), [['C:', 'drive'], ['D:', 'drive']]);
  assert.strictEqual(listFolder(null, { drives }).parent, null);
  const listing = listFolder(root, { drives });
  assert.deepStrictEqual(listing.entries.map((e) => [e.name, e.kind]), [['alpha', 'folder'], ['Beta', 'folder'], ['z game.exe', 'exe']]);
  assert.strictEqual(listing.parent, path.dirname(root));
  assert.deepStrictEqual(listFolder(path.join(root, 'missing'), { drives }).entries, []);
  assert.strictEqual(listFolder('C:\\', { drives }).parent, '');
  assert.deepStrictEqual(listFolder('a\0b', { drives }).entries.map((e) => e.kind), ['drive', 'drive']);
  fs.rmSync(root, { recursive: true, force: true });
});
