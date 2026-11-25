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
  await app.evaluate(() => { process.mainModule.require('./src/steam').findSteamDir = async () => null; });
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
  const heading = () => page.textContent('#settings .settings-pane h1');
  const selectedCategory = () => page.textContent('#settings .settings-category.selected');
  const dialogText = () => page.$eval('.dialog p', (el) => el.textContent).catch(() => null);
  const readSettings = () => JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
  const isFullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());

  await page.waitForSelector('#title:not(:empty)');
  await sleep(600);
  assert.strictEqual(await hints(), '', 'the shelf shows no hints');
  await shot('1-shelf-with-settings-hint');

  await key('Enter');

  assert.strictEqual(await dialogText(), "Dolphin isn't set up.");
  console.log('error 1:', await dialogText(), '| hints:', await hints());
  await shot('2-error-not-set-up');
  await key('Enter');
  await sleep(300);
  assert.ok(await settingsOpen(), 'Open Settings opens it');
  console.log('opened on:', await focusedRow(), '| hints:', await hints());
  assert.ok((await focusedRow()).startsWith('GameCube'), 'focus lands on the GameCube emulator row');
  assert.strictEqual(await heading(), 'Emulators');
  assert.strictEqual(await selectedCategory(), 'Library');
  await shot('3-settings-on-gamecube-emulator');

  await pick(dolphin);
  await key('Enter');
  assert.strictEqual(readSettings().emulators.dolphin, dolphin);
  console.log('after pick:', await focusedRow());
  await shot('4-emulator-chosen');

  await key(' ');
  assert.strictEqual(readSettings().emulators.dolphin, undefined);
  console.log('after Find automatically:', await focusedRow());
  await pick(dolphin);
  await key('Enter');

  await key('Escape');
  assert.ok(await settingsOpen(), 'B in a sub-list does not close Settings');
  assert.strictEqual(await heading(), 'Library');
  assert.ok((await focusedRow()).startsWith('Emulators'), await focusedRow());
  const fits = await page.$eval('#settings .setup-list', (list) => list.scrollHeight <= list.clientHeight);
  assert.ok(fits, 'the Library pane fits on one screen');
  await shot('5-library');

  await key('Escape');
  assert.ok(await settingsOpen(), 'B in the pane goes back to the categories');
  assert.strictEqual(await focusedRow(), 'Library');
  console.log('categories hints:', await hints());
  await key('ArrowUp');
  assert.strictEqual(await focusedRow(), 'Users');
  await key('ArrowDown');
  assert.strictEqual(await focusedRow(), 'Library');
  await key('ArrowRight');
  assert.ok((await focusedRow()).startsWith('Emulators'), await focusedRow());

  await key('ArrowDown');
  await key('Enter');
  assert.strictEqual(await heading(), 'Games folders');
  assert.ok((await focusedRow()).startsWith('GameCube'));
  console.log('folder row:', await focusedRow(), '| hints:', await hints());
  await key('ArrowLeft');
  assert.ok((await focusedRow()).startsWith('Games folders'));

  await key('ArrowDown');
  await key('Enter');
  assert.strictEqual(await heading(), 'Consoles');
  await key('Escape');
  assert.ok((await focusedRow()).startsWith('Consoles'));

  await key('ArrowDown');
  assert.ok((await focusedRow()).startsWith('Hidden games | None'), await focusedRow());
  await key('ArrowDown');
  assert.ok((await focusedRow()).startsWith('Rescan games'), await focusedRow());
  await key('Enter');
  assert.ok((await focusedRow()).endsWith('Done'));

  await key('ArrowLeft');
  await key('ArrowDown');
  assert.strictEqual(await focusedRow(), 'Covers');
  assert.strictEqual(await heading(), 'Covers');
  await key('Enter');
  console.log('key row:', await focusedRow(), '| hints:', await hints());
  await key('Enter');
  console.log('typing hints:', await hints());
  await page.keyboard.type(`${SECRET} f s`.replace(/ /g, ''));
  assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(SECRET), 'the key is not shown');
  assert.strictEqual(await page.$eval('.settings-key', (input) => input.type), 'password');
  await key('Enter');
  assert.strictEqual(readSettings().steamGridDbKey, `${SECRET}fs`);
  console.log('key saved:', await focusedRow(), '| hints:', await hints());
  assert.ok(!(await page.evaluate(() => document.body.innerHTML)).includes(SECRET), 'the key never reaches the page');
  await key(' ');
  assert.strictEqual(readSettings().steamGridDbKey, undefined);
  console.log('key cleared');

  await key('ArrowDown');
  assert.ok((await focusedRow()).startsWith('Re-download covers'), await focusedRow());
  console.log('re-download hints:', await hints());
  await key('Enter');
  assert.ok((await dialogText()).startsWith('Replace all covers?'));
  await shot('10-redownload-confirm');
  await key('Escape');
  assert.ok((await focusedRow()).startsWith('Re-download covers'), await focusedRow());

  await key('Escape');
  await key('ArrowDown');
  assert.strictEqual(await heading(), 'Display');
  await key('ArrowRight');
  assert.ok((await focusedRow()).startsWith('Start in fullscreen | On'), await focusedRow());
  assert.strictEqual(await isFullscreen(), true);
  await key('Enter');
  assert.strictEqual(readSettings().fullscreen, false);
  assert.strictEqual(await isFullscreen(), false);
  await key('Enter');
  assert.strictEqual(await isFullscreen(), true);

  const pickValue = async (row, current, target, settingsKey, stored, shotName) => {
    assert.ok((await focusedRow()).startsWith(`${row} | ${current}`), await focusedRow());
    await key('Enter');
    assert.strictEqual(await heading(), row);
    assert.strictEqual(await focusedRow(), current, 'the list opens on the current value');
    assert.strictEqual(await page.$$eval('#settings .setup-row > .tick', (ticks) => ticks.length), 1, 'one tick');
    assert.ok(await page.$eval('#settings .setup-row:focus > .tick', () => true).catch(() => false), 'the tick is on the current value');
    assert.ok((await hints()).includes('Choose'), await hints());
    if (shotName) await shot(shotName);
    const names = await page.$$eval('#settings .setup-row', (rows) => rows.map((row) => row.innerText));
    const steps = names.indexOf(target) - names.indexOf(current);
    for (let i = 0; i < Math.abs(steps); i++) await key(steps > 0 ? 'ArrowDown' : 'ArrowUp');
    assert.strictEqual(await focusedRow(), target);
    await key('Enter');
    assert.strictEqual(await heading(), 'Display', 'A picks and goes back');
    assert.ok((await focusedRow()).startsWith(`${row} | ${target}`), await focusedRow());
    assert.strictEqual(readSettings()[settingsKey], stored);
  };

  await key('ArrowDown');
  await pickValue('Left edge', 'Slide off', 'Peek', 'leftEdge', 'peek');
  await key('Enter');
  await key('Escape');
  assert.strictEqual(await heading(), 'Display', 'B leaves the list without changing it');
  assert.ok((await focusedRow()).startsWith('Left edge | Peek'), await focusedRow());
  assert.strictEqual(readSettings().leftEdge, 'peek');
  await pickValue('Left edge', 'Peek', 'Slide off', 'leftEdge', 'slide', '6-value-list');

  await key('ArrowDown');
  await pickValue('Highlight', 'Rim', 'Snake', 'focusStyle', 'snake');
  await pickValue('Highlight', 'Snake', 'Rim', 'focusStyle', 'rim');
  await key('ArrowDown');
  await pickValue('Keyboard', 'Grid', 'Full', 'keyboard', 'full');
  await pickValue('Keyboard', 'Full', 'Grid', 'keyboard', 'grid');
  await key('ArrowDown');
  assert.ok((await focusedRow()).startsWith('Profiles on Home | On'), await focusedRow());
  await key('Enter');
  assert.ok((await focusedRow()).startsWith('Profiles on Home | Off'), await focusedRow());
  assert.strictEqual(readSettings().homeProfiles, false);
  await key('Enter');
  assert.ok((await focusedRow()).startsWith('Profiles on Home | On'), await focusedRow());
  assert.strictEqual(readSettings().homeProfiles, true);
  await key('ArrowDown');
  await pickValue('Background', 'Tint', 'Drift', 'background', 'drift');

  await key('Escape');
  await key('ArrowDown');
  assert.strictEqual(await heading(), 'System');
  await key('ArrowDown');
  assert.strictEqual(await focusedRow(), 'System');
  await key('Enter');
  assert.ok((await focusedRow()).startsWith('Check for updates'), await focusedRow());
  assert.ok((await page.innerText('#settings .settings-pane')).includes(`Version\n${require('../package.json').version}`));
  await key('ArrowUp');
  assert.ok((await focusedRow()).startsWith('Check for updates'), 'Version is not focusable');
  await key('Enter');
  await sleep(300);
  assert.ok((await focusedRow()).endsWith('Up to date'), await focusedRow());
  await key('Escape');
  assert.strictEqual(await focusedRow(), 'System');

  const stepTitle = async () => {
    await page.waitForSelector('#profiles:not([hidden])');
    await page.waitForFunction(() => !document.querySelector('main').matches('.screen-out, .screen-hold'));
    return page.textContent('#profiles .profile-header > span:first-child');
  };
  const backInSettings = async () => {
    await page.waitForSelector('#settings:not([hidden])');
    await page.waitForFunction(() => !document.querySelector('main').matches('.screen-out, .screen-hold'));
    await sleep(200);
  };
  for (let i = 0; i < 4; i++) await key('ArrowUp');
  assert.strictEqual(await focusedRow(), 'Users');
  assert.strictEqual(await heading(), 'Users');
  await key('Enter');
  assert.strictEqual(await focusedRow(), 'Player | Current');
  await key('ArrowDown');
  assert.strictEqual(await focusedRow(), 'Add user');
  await key('Enter');
  assert.strictEqual(await stepTitle(), 'Choose an icon');
  await key('Enter');
  assert.strictEqual(await stepTitle(), 'Choose a background');
  await key('Enter');
  assert.strictEqual(await stepTitle(), 'Nickname');
  await page.keyboard.type('Kim');
  await key('Enter');
  await backInSettings();
  assert.strictEqual(readSettings().profiles[1].name, 'Kim');
  assert.strictEqual(await focusedRow(), 'Kim', 'adding returns to Users on the new user');
  assert.strictEqual(await selectedCategory(), 'Users');
  await key('Enter');
  assert.strictEqual(await heading(), 'Kim');
  assert.strictEqual(await page.innerText('#settings .setup-list'), 'Nickname\nKim\nIcon\nRemove');
  await key('Enter');
  assert.strictEqual(await stepTitle(), 'Nickname');
  assert.strictEqual(await page.$$eval('#profiles .profile-dots[hidden]', (items) => items.length), 1, 'one step shows no dots');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('Jo');
  await key('Enter');
  await backInSettings();
  assert.strictEqual(readSettings().profiles[1].name, 'Jo');
  assert.strictEqual(await focusedRow(), 'Nickname | Jo');
  await key('ArrowDown');
  await key('Enter');
  assert.strictEqual(await stepTitle(), 'Choose an icon');
  await key('Escape');
  await backInSettings();
  assert.strictEqual(await focusedRow(), 'Icon', 'B on the first step goes back');
  await key('ArrowDown');
  await key('Enter');
  assert.strictEqual(await dialogText(), 'Remove Jo?');
  await key('Enter');
  await sleep(300);
  assert.strictEqual(readSettings().profiles.length, 1);
  assert.strictEqual(await heading(), 'Users');
  assert.strictEqual(await page.$$eval('#settings .setup-row', (rows) => rows.length), 2);
  await key('Escape');
  assert.strictEqual(await focusedRow(), 'Users');

  fs.rmSync(path.join(games, 'Luigis Mansion (USA).rvz'));
  await key('Escape');
  assert.ok(!(await settingsOpen()), 'B closes Settings');
  await sleep(600);
  assert.strictEqual(await page.evaluate(() => document.body.dataset.background), 'drift');
  assert.strictEqual(await page.textContent('#title'), 'Wind Waker');
  console.log('row reloaded, title:', await page.textContent('#title'));
  await shot('15-shelf-after-settings');

  fs.rmSync(path.join(games, 'Wind Waker (USA).rvz'));
  await key('Enter');
  assert.strictEqual(await dialogText(), "This game file can't be found.");
  await shot('16-error-file-missing');
  await key('Enter');
  await sleep(600);
  assert.notStrictEqual(await page.textContent('#title'), 'Wind Waker', 'the rescan drops the missing game');
  assert.strictEqual(await hints(), '');

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

  await page.evaluate(() => { setTimeout(() => Promise.reject(new Error('boom from the screen'))); });
  await sleep(400);
  assert.strictEqual(await dialogText(), 'Something went wrong.');
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
