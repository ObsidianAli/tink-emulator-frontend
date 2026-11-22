const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanTitle } = require('../src/titles');
const { getEmulatedGames } = require('../src/library');
const { detectEmulators, defaultSearchDirs } = require('../src/detect');
const { launchSpec, CONSOLES } = require('../src/presets');
const { playGame } = require('../src/launcher');

// Builds a folder tree from a list of relative paths. A path ending in "/" is an empty folder.
function makeTree(paths) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-games-'));
  for (const rel of paths) {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
  }
  return root;
}

const titlesFor = (consoleId, folder) =>
  getEmulatedGames({ consoles: { [consoleId]: { folder } } }).map((g) => g.title).sort();

test('file names become clean titles', () => {
  assert.strictEqual(cleanTitle('Legend of Zelda, The - Wind Waker (USA) [!].rvz'), 'The Legend of Zelda: The Wind Waker');
  assert.strictEqual(cleanTitle('Super Mario World (USA).sfc'), 'Super Mario World');
  assert.strictEqual(cleanTitle('Metroid Prime (USA) (Rev 1).iso'), 'Metroid Prime');
  assert.strictEqual(cleanTitle('Sims 2, The - Pets (Europe) (En,Fr,De).iso'), 'The Sims 2: Pets');
  assert.strictEqual(cleanTitle('Pokemon - Emerald Version (USA, Europe).zip'), 'Pokemon: Emerald Version');
  assert.strictEqual(cleanTitle('Bloodborne v1.09', { isFolder: true }), 'Bloodborne v1.09');
});

test('each console only lists its own file types', () => {
  const root = makeTree([
    'Metroid Prime (USA).rvz',
    'Super Mario Sunshine (USA).iso',
    'Wii Sports (USA).wbfs',
    'notes.txt',
    'cover.png',
    'More/Pikmin (USA).gcz',
  ]);
  assert.deepStrictEqual(titlesFor('gamecube', root), ['Metroid Prime', 'Pikmin', 'Super Mario Sunshine']);
  assert.deepStrictEqual(titlesFor('wii', root), ['Metroid Prime', 'Pikmin', 'Super Mario Sunshine', 'Wii Sports']);
  assert.deepStrictEqual(titlesFor('switch', root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('PS4 games are folders with eboot.bin', () => {
  const root = makeTree(['Bloodborne/eboot.bin', 'Bloodborne/sce_sys/', 'Not A Game/readme.txt', 'stray.pkg']);
  const games = getEmulatedGames({ consoles: { ps4: { folder: root } } });
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepStrictEqual(games.map((g) => g.title), ['Bloodborne']);
  assert.strictEqual(games[0].path, path.join(root, 'Bloodborne'));
});

test('Switch 2 and PS5 take every file and folder in the games folder', () => {
  const root = makeTree(['Some Game.iso', 'Another Game/', 'Third.bin']);
  assert.deepStrictEqual(titlesFor('switch2', root), ['Another Game', 'Some Game', 'Third']);
  assert.deepStrictEqual(titlesFor('ps5', root), ['Another Game', 'Some Game', 'Third']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('zipped cartridge games are listed, zipped discs are not', () => {
  const root = makeTree(['Super Metroid (USA).zip', 'Tetris (World).gb']);
  assert.deepStrictEqual(titlesFor('snes', root), ['Super Metroid']);
  assert.deepStrictEqual(titlesFor('gb', root), ['Super Metroid', 'Tetris']);
  assert.deepStrictEqual(titlesFor('ps1', root), []);
  assert.deepStrictEqual(titlesFor('gamecube', root), []);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [id, preset] of Object.entries(CONSOLES)) {
    if (preset.emulator === 'retroarch' && !['ps1', 'dreamcast'].includes(id)) {
      assert.ok(preset.extensions.includes('.zip'), `${id} takes .zip`);
    }
  }
});

test('a .bin with a matching .cue is one game', () => {
  const root = makeTree(['Ico (USA).cue', 'Ico (USA).bin', 'Okami (USA).iso', 'Lone (USA).bin']);
  assert.deepStrictEqual(titlesFor('ps2', root), ['Ico', 'Lone', 'Okami']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('games keep their file name and know their console', () => {
  const root = makeTree(['Legend of Zelda, The - Wind Waker (USA) [!].rvz']);
  const [game] = getEmulatedGames({ consoles: { gamecube: { folder: root } } });
  fs.rmSync(root, { recursive: true, force: true });
  assert.strictEqual(game.fileName, 'Legend of Zelda, The - Wind Waker (USA) [!]');
  assert.strictEqual(game.consoleName, 'GameCube');
  assert.strictEqual(game.id, `gamecube:${game.path}`);
});

test('consoles without a folder, or with a missing one, have no games', () => {
  assert.deepStrictEqual(getEmulatedGames({ consoles: {} }), []);
  assert.deepStrictEqual(getEmulatedGames({ consoles: { nes: { folder: path.join(os.tmpdir(), 'no-such-folder') } } }), []);
});

test('emulators are found in a search folder or one level inside it', () => {
  const root = makeTree([
    'Programs/Dolphin-x64/Dolphin.exe',
    'Programs/RetroArch/retroarch.exe',
    'Tink/Cemu/Cemu.exe',
    'Programs/Deep/Nested/pcsx2-qt.exe',
  ]);
  const found = detectEmulators([path.join(root, 'Programs'), path.join(root, 'Tink')]);
  fs.rmSync(root, { recursive: true, force: true });
  assert.strictEqual(found.dolphin, path.join(root, 'Programs', 'Dolphin-x64', 'Dolphin.exe'));
  assert.strictEqual(found.retroarch, path.join(root, 'Programs', 'RetroArch', 'retroarch.exe'));
  assert.strictEqual(found.cemu, path.join(root, 'Tink', 'Cemu', 'Cemu.exe'));
  // Two levels down is too deep: detection never walks a whole tree.
  assert.strictEqual(found.pcsx2, undefined);
});

test('detection only looks in known folders, never a drive root', () => {
  const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  const dirs = defaultSearchDirs(env, 'D:\\Tink');
  assert.ok(dirs.includes('D:\\Tink'));
  assert.ok(dirs.includes('C:\\Program Files'));
  assert.ok(dirs.every((dir) => !/^[A-Z]:\\?$/i.test(dir)));
});

test('launch arguments per emulator', () => {
  const rom = 'D:\\Games\\game.file';
  assert.deepStrictEqual(launchSpec('gamecube', 'Dolphin.exe', rom).args, ['-b', '-e', rom]);
  assert.deepStrictEqual(launchSpec('wiiu', 'Cemu.exe', rom).args, ['-f', '-g', rom]);
  assert.deepStrictEqual(launchSpec('switch', 'eden.exe', rom).args, ['-f', '-g', rom]);
  assert.deepStrictEqual(launchSpec('ps2', 'pcsx2-qt.exe', rom).args, ['-batch', '-fullscreen', '--', rom]);
  assert.deepStrictEqual(launchSpec('3ds', 'azahar.exe', rom).args, ['-f', rom]);
  assert.deepStrictEqual(launchSpec('snes', 'retroarch.exe', rom).args, ['-f', '-L', 'cores\\snes9x_libretro.dll', rom]);
  assert.deepStrictEqual(launchSpec('ps5', 'my-ps5.exe', rom), { exe: 'my-ps5.exe', args: [rom] });
  assert.deepStrictEqual(launchSpec('switch2', 'my-switch2.exe', rom).args, [rom]);
});

test('Tink hides while the emulator runs and comes back when it closes', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tink-stub-')), 'args.json');
  const events = [];
  const spec = { exe: process.execPath, args: [path.join(__dirname, 'stub-emulator.js'), out, 'D:\\Games\\game.iso'] };
  const played = playGame(spec, { hide: () => events.push('hide'), show: () => events.push('show') });
  assert.deepStrictEqual(events, ['hide']);
  await played;
  assert.deepStrictEqual(events, ['hide', 'show']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')), ['D:\\Games\\game.iso']);
});

test('Tink comes back if the emulator can\'t be started', async () => {
  const events = [];
  const spec = { exe: path.join(os.tmpdir(), 'no-such-emulator.exe'), args: [] };
  await assert.rejects(playGame(spec, { hide: () => events.push('hide'), show: () => events.push('show') }));
  assert.deepStrictEqual(events, ['hide', 'show']);
});
