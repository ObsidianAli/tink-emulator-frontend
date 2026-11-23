// Runs Tink in Electron and drives the row of icons under the title: down into it, along it, A on each icon and B back,
// then up to the shelf on the same game. Saves a screenshot of the shelf and of each panel.
// Usage: node test/tray.e2e.js [screenshot folder]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'tray'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-tray-e2e-'));
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
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(350);
  };
  const shot = async (name) => {
    await sleep(400);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const focusedIcon = () => page.evaluate(() => {
    const node = document.activeElement;
    return node && node.classList.contains('tray-icon') ? node.getAttribute('aria-label') : null;
  });
  const visible = (selector) => page.$(`${selector}:not([hidden])`).then(Boolean);
  const hints = () => page.$$eval('#hints .hint', (els) => els.length);

  await page.waitForSelector('#shelves .current');
  await sleep(600);
  assert.strictEqual(await hints(), 0, 'the shelf has no hints');
  assert.deepStrictEqual(
    await page.$$eval('.tray-icon', (nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
    ['Profile', 'Controllers', 'Settings', 'Power'],
  );
  const title = await page.textContent('#title');
  await shot('1-shelf');

  // Down goes into the row, Left/Right move along it, Up goes back to the same game.
  assert.strictEqual(await focusedIcon(), null);
  await key('ArrowDown');
  assert.strictEqual(await focusedIcon(), 'Profile');
  await shot('2-profile-focused');
  await key('ArrowLeft');
  assert.strictEqual(await focusedIcon(), 'Profile', 'the row stops at its first icon');
  await key('ArrowRight');
  assert.strictEqual(await focusedIcon(), 'Controllers');
  await key('ArrowUp');
  assert.strictEqual(await focusedIcon(), null);
  assert.strictEqual(await page.textContent('#title'), title);

  // Page Down still switches shelves, with no shelf to go to when there is only one.
  await key('PageDown');
  assert.strictEqual(await page.textContent('#title'), title);

  // A on the profile icon opens the picker, B comes back to the icon.
  await key('ArrowDown');
  await key('Enter');
  assert.ok(await visible('#profiles'), 'the picker opens');
  await key('Escape');
  assert.ok(!(await visible('#profiles')));
  assert.strictEqual(await focusedIcon(), 'Profile');

  // Controllers.
  await key('ArrowRight');
  await key('Enter');
  assert.ok(await visible('#panel'));
  assert.strictEqual(await page.textContent('#panel h1'), 'Controllers');
  assert.strictEqual(await page.textContent('#panel .setup-note'), 'No controllers');
  await shot('3-controllers');
  await key('Escape');
  assert.ok(!(await visible('#panel')));
  assert.strictEqual(await focusedIcon(), 'Controllers');

  // Settings.
  await key('ArrowRight');
  await key('Enter');
  assert.ok(await visible('#settings'));
  await key('Escape');
  assert.ok(!(await visible('#settings')));
  assert.strictEqual(await focusedIcon(), 'Settings');

  // Power: three options; Shut down asks first and Not now leaves everything alone.
  await key('ArrowRight');
  await key('Enter');
  assert.strictEqual(await page.textContent('#panel h1'), 'Power');
  assert.deepStrictEqual(await page.$$eval('#panel .setup-row', (rows) => rows.map((r) => r.textContent)), ['Sleep', 'Shut down', 'Close Tink']);
  await shot('4-power');
  await key('ArrowDown');
  await key('Enter');
  assert.strictEqual(await page.textContent('.dialog p'), 'Shut down this PC?');
  await shot('5-shut-down-asks');
  await key('Escape');
  assert.ok(!(await page.$('.dialog-scrim')), 'Not now closes the question');
  assert.ok(await visible('#panel'), 'and stays on the Power panel');
  await key('ArrowUp');
  await key('Enter');
  await sleep(300);
  assert.ok(await visible('#panel'), 'Sleep does nothing here and Tink keeps running');
  await key('Escape');
  assert.strictEqual(await focusedIcon(), 'Power');

  // B from the row goes back to the shelf too.
  await key('Escape');
  assert.strictEqual(await focusedIcon(), null);
  assert.strictEqual(await page.textContent('#title'), title);

  assert.deepStrictEqual(errors, [], 'no page errors');
  await app.close();
  console.log('tray ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
