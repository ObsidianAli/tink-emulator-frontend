// Runs Tink in Electron with a throwaway data folder and stubbed file pickers, opens Settings from the Shelf,
// checks the friendly errors, and saves a screenshot of each screen and state.
// Usage: node test/settings.e2e.js [screenshot folder]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'settings'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SECRET = 'abc123-very-secret-key';

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-settings-e2e-'));
  const data = path.join(root, 'data');
  const empty = path.join(root, 'empty');
  const games = path.join(root, 'games', 'GameCube');
  fs.mkdirSync(data);
  fs.mkdirSync(empty);
  fs.mkdirSync(games, { recursive: true });
  for (const name of ['Luigis Mansion (USA).rvz', 'Wind Waker (USA).rvz']) fs.writeFileSync(path.join(games, name), '');
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ consoles: { gamecube: { folder: games } }, setupDone: true }));
  const dolphin = path.join(root, 'picked', 'Dolphin.exe');
  fs.mkdirSync(path.dirname(dolphin));
  fs.writeFileSync(dolphin, '');

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
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      const next = globalThis.nextPick;
      globalThis.nextPick = null;
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
    };
  });
  const pick = (file) => app.evaluate((_electron, value) => { globalThis.nextPick = value; }, file);
  const shot = async (name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(250);
  };
  const down = async (times) => { for (let i = 0; i < times; i++) await key('ArrowDown'); };
  const settingsOpen = () => page.$('#settings:not([hidden])').then(Boolean);
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const focusedRow = () => page.evaluate(() => document.activeElement.innerText.replace(/\n+/g, ' | '));
  const dialogText = () => page.$eval('.dialog p', (el) => el.textContent).catch(() => null);
  const readSettings = () => JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
  const isFullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());

  await page.waitForSelector('#shelves .current');
  await sleep(600);
  assert.ok((await hints()).includes('MENUSettings'), 'the shelf shows a Settings hint');
  await shot('1-shelf-with-settings-hint');

  // Play with no emulator: the friendly message, then straight into Settings on that Console.
  await key('Enter');
  assert.strictEqual(await dialogText(), "Dolphin isn't set up yet. Open Settings?");
  console.log('error 1:', await dialogText(), '| hints:', await hints());
  await shot('2-error-not-set-up');
  await key('Enter');
  await sleep(300);
  assert.ok(await settingsOpen(), 'Open Settings opens it');
  console.log('opened on:', await focusedRow(), '| hints:', await hints());
  assert.ok((await focusedRow()).startsWith('Emulator | Dolphin'), 'focus lands on the GameCube emulator row');
  await shot('3-settings-on-gamecube-emulator');

  // Pick the emulator with A.
  await pick(dolphin);
  await key('Enter');
  assert.strictEqual(readSettings().emulators.dolphin, dolphin);
  console.log('after pick:', await focusedRow());
  await shot('4-emulator-chosen');

  // X on that row is Find automatically: the pick is forgotten and detection decides (nothing found here).
  await key(' ');
  assert.strictEqual(readSettings().emulators.dolphin, undefined);
  console.log('after Find automatically:', await focusedRow());
  await shot('5-find-automatically');
  await pick(dolphin);
  await key('Enter');

  // Games folder row.
  await key('ArrowDown');
  console.log('folder row:', await focusedRow(), '| hints:', await hints());
  await shot('6-folder-row-focused');

  // Top of the list: fullscreen, rescan, covers, key.
  await key('Home').catch(() => {});
  await down(0);
  for (let i = 0; i < 2; i++) await key('ArrowUp');
  console.log('focus:', await focusedRow());
  for (let i = 0; i < 20; i++) {
    if ((await focusedRow()).startsWith('Start in fullscreen')) break;
    await key('ArrowUp');
  }
  assert.ok((await focusedRow()).startsWith('Start in fullscreen | On'));
  assert.strictEqual(await isFullscreen(), true);
  await shot('7-fullscreen-on');
  await key('Enter');
  assert.strictEqual(readSettings().fullscreen, false);
  assert.strictEqual(await isFullscreen(), false);
  console.log('fullscreen toggled:', await focusedRow());
  await shot('8-fullscreen-off');
  await key('Enter');
  assert.strictEqual(await isFullscreen(), true);

  // Rescan, Re-download, key.
  await key('ArrowDown');
  await key('Enter');
  console.log('rescan:', await focusedRow());
  await shot('9-rescan-done');
  await key('ArrowDown');
  console.log('re-download hints:', await hints());
  await key('Enter');
  assert.ok((await dialogText()).startsWith('Download every cover again?'));
  await shot('10-redownload-confirm');
  await key('Escape');
  await key('ArrowDown');
  console.log('key row:', await focusedRow(), '| hints:', await hints());
  await shot('11-key-row-focused');
  await key('Enter');
  console.log('typing hints:', await hints());
  await page.keyboard.type(`${SECRET} f s`.replace(/ /g, ''));
  assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(SECRET), 'the key is not shown');
  assert.strictEqual(await page.$eval('.settings-key', (input) => input.type), 'password');
  await shot('12-key-typing');
  await key('Enter');
  assert.strictEqual(readSettings().steamGridDbKey, `${SECRET}fs`);
  console.log('key saved:', await focusedRow(), '| hints:', await hints());
  assert.ok(!(await page.evaluate(() => document.body.innerHTML)).includes(SECRET), 'the key never reaches the page');
  await shot('13-key-saved');
  await key(' ');
  assert.strictEqual(readSettings().steamGridDbKey, undefined);
  console.log('key cleared');

  // About, at the bottom.
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
  await sleep(300);
  assert.ok((await page.textContent('#settings')).includes(`About: Tink ${require('../package.json').version}`));
  await shot('14-bottom-with-about');

  // Closing reloads the Shelf. One game file goes missing meanwhile.
  fs.rmSync(path.join(games, 'Luigis Mansion (USA).rvz'));
  await key('Escape');
  assert.ok(!(await settingsOpen()), 'B closes Settings');
  await sleep(600);
  assert.strictEqual(await page.textContent('#title'), 'Wind Waker');
  console.log('shelf reloaded, title:', await page.textContent('#title'));
  await shot('15-shelf-after-settings');

  // A game that vanishes after the scan: delete it, then play.
  fs.rmSync(path.join(games, 'Wind Waker (USA).rvz'));
  await key('Enter');
  assert.strictEqual(await dialogText(), "This game file can't be found. Rescan?");
  await shot('16-error-file-missing');
  await key('Enter');
  await sleep(600);
  // The GameCube Shelf is gone after the rescan (a real Steam Shelf may remain on a PC that has Steam).
  const names = await page.$$eval('#shelves span', (spans) => spans.map((s) => s.textContent));
  assert.ok(!names.includes('GameCube'), 'the rescan drops the empty Shelf');
  assert.ok((await hints()).includes('MENUSettings'));

  // Settings still opens with no games, and S/Menu on a pad do the same.
  await page.evaluate(() => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
  });
  await page.evaluate(() => { window.__pad.buttons[9].pressed = true; });
  await sleep(120);
  await page.evaluate(() => { window.__pad.buttons[9].pressed = false; });
  await sleep(300);
  assert.ok(await settingsOpen(), 'the pad Menu button opens Settings');
  await page.evaluate(() => { window.__pad.buttons[1].pressed = true; });
  await sleep(120);
  await page.evaluate(() => { window.__pad.buttons[1].pressed = false; });
  await sleep(300);
  assert.ok(!(await settingsOpen()), 'the pad B button closes it');

  // An unexpected error is logged in full and only a plain message shows.
  await page.evaluate(() => { setTimeout(() => Promise.reject(new Error('boom from the screen'))); });
  await sleep(400);
  assert.strictEqual(await dialogText(), 'Something went wrong. Tink saved the details in its log file.');
  assert.ok(!(await page.textContent('.dialog')).includes('boom'));
  await shot('18-error-unexpected');
  await key('Enter');
  const log = fs.readFileSync(path.join(data, 'tink.log'), 'utf8');
  assert.ok(log.includes('boom from the screen'));
  assert.ok(!log.includes(SECRET));
  console.log('log:\n' + log.trim());

  console.log('page errors:', errors.length ? errors : 'none');
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('settings e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
