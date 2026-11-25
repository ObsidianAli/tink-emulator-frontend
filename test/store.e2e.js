const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'store'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-store-e2e-'));
  const data = path.join(root, 'data');
  const empty = path.join(root, 'empty');
  const games = path.join(root, 'games', 'GameCube');
  fs.mkdirSync(data);
  fs.mkdirSync(empty);
  fs.mkdirSync(games, { recursive: true });
  for (const name of ['Luigis Mansion (USA).rvz', 'Wind Waker (USA).rvz']) fs.writeFileSync(path.join(games, name), '');
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ consoles: { gamecube: { folder: games } }, setupDone: true }));

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${path.join(root, 'user')}`],
    env: {
      ...process.env,
      TINK_DATA_DIR: data,
      PORTABLE_EXECUTABLE_DIR: path.join(root, 'tink'),
      ProgramFiles: empty,
      'ProgramFiles(x86)': empty,
      LOCALAPPDATA: empty,
      APPDATA: empty,
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Every main-side answer is stubbed, so nothing here can reach Steam or the real disk.
  await app.evaluate(({ ipcMain }) => {
    const calls = { installs: [], added: [], removed: [] };
    globalThis.storeCalls = calls;
    const stub = (name, fn) => {
      ipcMain.removeHandler(name);
      ipcMain.handle(name, async (_event, ...args) => fn(...args));
    };
    const titles = ['Alpha Quest', 'Beta Land', 'Cave Story', 'Dust Trail', 'Ember Run', 'Frost Keep', 'Glow Tide', 'Hollow Hill', 'Iron Harbor', 'Jade Orchard',
      'Kite Valley', 'Lunar Mill', 'Moss Court', 'Night Ferry', 'Oak Arena', 'Pine Circuit', 'Quartz Lane', 'Reed Tower', 'Salt Mesa', 'Tide Garden'];
    stub('getOwnedGames', () => titles.map((title, i) => ({ id: `own:${100 + i}`, appId: String(100 + i), title })));
    stub('getCover', (id) => {
      const hue = (Number(id.split(':')[1]) * 37) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="hsl(${hue} 45% 32%)"/><circle cx="150" cy="190" r="70" fill="hsl(${hue} 50% 55%)"/></svg>`;
      return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
    });
    stub('getInstallDrives', () => [
      { id: 'C:\\Steam', label: 'C: 3 GB free', fits: false },
      { id: 'D:\\SteamLibrary', label: 'D: 412 GB free', fits: true },
      { id: 'E:\\SteamLibrary', label: 'E: 96 GB free', fits: true },
    ]);
    stub('installGame', (appId, library) => { calls.installs.push([appId, library]); return true; });
    stub('getInstallProgress', () => ({ state: 'downloading', percent: 42 }));
    stub('findPcGames', () => [
      { title: 'Copper Sky', exe: 'D:\\Games\\Copper Sky\\sky.exe', folder: 'D:\\Games\\Copper Sky', source: 'epic' },
      { title: 'Marsh Light', exe: 'D:\\Games\\Marsh\\marsh.exe', folder: 'D:\\Games\\Marsh', source: 'folder' },
      { title: 'Nova Drift', exe: 'C:\\Games\\Nova\\nova.exe', folder: 'C:\\Games\\Nova', source: 'gog' },
    ]);
    stub('getFileIcon', () => null);
    stub('addPcGame', ({ exe }) => { calls.added.push(exe); return { id: 'abcdef0123' }; });
    stub('removePcGame', (id) => { calls.removed.push(id); return true; });
    stub('listFolder', (dir) => (dir ? { path: dir, parent: '', entries: [{ name: 'Games', path: 'C:\\Games', kind: 'folder' }, { name: 'tool.exe', path: 'C:\\tool.exe', kind: 'exe' }] }
      : { path: '', parent: null, entries: [{ name: 'C:', path: 'C:\\', kind: 'drive' }] }));
  });

  const key = async (name, wait = 350) => {
    await page.keyboard.press(name);
    await sleep(wait);
  };
  const shot = async (name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const storeShown = () => page.$('#store:not([hidden])').then(Boolean);

  await page.waitForSelector('#title:not(:empty)');
  await sleep(600);
  await key('ArrowDown');
  await key('ArrowRight');
  assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Store');
  await key('Enter', 900);
  assert.ok(await storeShown(), 'the Store opens');
  assert.strictEqual(await page.$$eval('.store-tile', (t) => t.length), 20);
  assert.match(await hints(), /Open/);

  await key('Enter');
  await key('ArrowRight');
  await key('ArrowDown');
  assert.match(await hints(), /Install/);
  const name = await page.textContent('.store-name');
  assert.strictEqual(name, 'Glow Tide');
  await key('Enter', 600);
  assert.match(await page.textContent('.dialog p'), new RegExp(`Install ${name}\\?`));
  await shot('1-install-dialog');
  await key('Enter', 600);
  assert.deepStrictEqual(await page.$$eval('#case-menu .setup-row', (rows) => rows.map((row) => row.textContent)), ['D: 412 GB free', 'E: 96 GB free']);
  await shot('2-drives');
  await key('ArrowDown');
  await key('Enter', 600);
  await sleep(2600);
  assert.deepStrictEqual(await app.evaluate(() => globalThis.storeCalls.installs), [['106', 'E:\\SteamLibrary']]);
  assert.strictEqual(await page.$$eval('.store-tile.installing', (t) => t.length), 1);
  assert.match(await page.textContent('.store-tile.installing .store-percent'), /42%/);
  assert.doesNotMatch(await hints(), /Install/);
  await shot('3-progress');

  await key('Escape');
  await key('ArrowDown');
  await sleep(500);
  await key('Enter');
  await key('Enter');
  assert.deepStrictEqual(await app.evaluate(() => globalThis.storeCalls.added), ['D:\\Games\\Copper Sky\\sky.exe']);
  assert.match(await page.textContent('#store .setup-row'), /Added/);
  assert.match(await hints(), /Remove/);
  await shot('4-add-games');

  await key('Escape');
  await key('Escape', 900);
  assert.ok(!(await storeShown()), 'B twice leaves the Store');
  assert.deepStrictEqual(errors, []);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
