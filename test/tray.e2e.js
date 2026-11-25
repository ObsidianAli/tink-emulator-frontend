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
  await app.evaluate(() => { process.mainModule.require('./src/steam').findSteamDir = async () => null; });
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

  await page.waitForSelector('#title:not(:empty)');
  await sleep(600);
  assert.strictEqual(await hints(), 0, 'the shelf has no hints');
  assert.deepStrictEqual(
    await page.$$eval('.tray-icon', (nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
    ['Profiles', 'Controllers', 'Settings', 'Power'],
  );
  const title = await page.textContent('#title');
  await shot('1-shelf');

  assert.strictEqual(await focusedIcon(), null);
  await key('ArrowDown');
  assert.strictEqual(await focusedIcon(), 'Profiles');
  assert.strictEqual(await page.$eval('#title', (el) => getComputedStyle(el).opacity), '0', 'the game title hides while the icons have focus');
  const label = await page.evaluate(() => {
    const text = document.getElementById('tray-label');
    const box = text.getBoundingClientRect();
    const icon = document.activeElement.getBoundingClientRect();
    return { text: text.textContent, opacity: getComputedStyle(text).opacity, below: box.top >= icon.bottom, centred: Math.abs(box.left + box.width / 2 - (icon.left + icon.width / 2)) < 2, bottom: box.bottom, height: innerHeight };
  });
  assert.strictEqual(label.text, 'Profiles');
  assert.strictEqual(label.opacity, '1');
  assert.ok(label.below && label.centred, 'the name sits under the selected icon');
  assert.ok(label.bottom <= label.height, 'and stays on screen');
  await shot('2-profile-focused');
  await key('ArrowLeft');
  assert.strictEqual(await focusedIcon(), 'Profiles', 'the row stops at its first icon');
  await key('ArrowRight');
  assert.strictEqual(await focusedIcon(), 'Controllers');
  await key('ArrowUp');
  assert.strictEqual(await focusedIcon(), null);
  assert.strictEqual(await page.textContent('#title'), title);
  assert.strictEqual(await page.$eval('#title', (el) => getComputedStyle(el).opacity), '1');

  await key('ArrowDown');
  await key('Enter');
  assert.ok(await visible('#profiles'), 'the picker opens');
  await key('Escape');
  assert.ok(!(await visible('#profiles')));
  assert.strictEqual(await focusedIcon(), 'Profiles');

  await key('ArrowRight');
  await key('Enter');
  await page.waitForSelector('#panel:not([hidden])');
  await sleep(500);
  assert.strictEqual(await page.textContent('#panel h1'), 'Controllers');
  assert.strictEqual(await page.textContent('#panel .setup-note'), 'No controllers');
  assert.ok(await page.$eval('#tray', (node) => getComputedStyle(node).visibility === 'hidden'), 'it is a full screen, Home is hidden');
  await page.evaluate(() => {
    const pad = { id: 'Test Pad (Vendor: 1234)', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [pad];
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await sleep(200);
  assert.deepStrictEqual(await page.$$eval('#panel .setup-row', (rows) => rows.map((r) => r.textContent)), ['Test Pad']);
  await shot('3-controllers');
  await key('Escape');
  await sleep(500);
  assert.ok(!(await visible('#panel')));
  await page.evaluate(() => { navigator.getGamepads = () => []; });
  assert.strictEqual(await focusedIcon(), 'Controllers');

  await key('ArrowRight');
  await key('Enter');
  assert.ok(await visible('#settings'));
  await key('Escape');
  assert.ok(!(await visible('#settings')));
  assert.strictEqual(await focusedIcon(), 'Settings');

  await key('ArrowRight');
  await key('Enter');
  assert.ok(await visible('#case-menu'), 'Power opens a popup');
  assert.ok(!(await visible('#panel')), 'and not a panel');
  assert.deepStrictEqual(await page.$$eval('#case-menu button', (rows) => rows.map((r) => r.textContent)), ['Sleep', 'Shut down', 'Close Tink']);
  const box = await page.evaluate(() => {
    const menu = document.getElementById('case-menu').getBoundingClientRect();
    const icon = document.querySelector('.tray-icon[aria-label="Power"]').getBoundingClientRect();
    return { menuBottom: menu.bottom, iconTop: icon.top, right: menu.right, width: innerWidth };
  });
  assert.ok(box.menuBottom <= box.iconTop && box.iconTop - box.menuBottom < 24, 'sits just above the icon');
  assert.ok(box.right <= box.width, 'stays on screen');
  await shot('4-power');
  await key('Escape');
  assert.ok(!(await visible('#case-menu')));
  assert.strictEqual(await focusedIcon(), 'Power', 'B returns to the Power icon');

  await key('Enter');
  await key('ArrowDown');
  await key('Enter');
  assert.strictEqual(await page.textContent('.dialog p'), 'Shut down this PC?');
  await shot('5-shut-down-asks');
  await key('Escape');
  assert.ok(!(await page.$('.dialog-scrim')), 'Not now closes the question');
  assert.ok(!(await visible('#case-menu')));
  assert.strictEqual(await focusedIcon(), 'Power');
  await key('Enter');
  await key('Enter');
  await sleep(300);
  assert.ok(!(await visible('#case-menu')), 'Sleep closes the popup');
  assert.strictEqual(await focusedIcon(), 'Power', 'and Tink keeps running here');
  await page.click('.tray-icon[aria-label="Power"]');
  await sleep(350);
  assert.ok(await visible('#case-menu'), 'a click opens the popup');
  await page.click('#case-menu button:nth-child(2)');
  await sleep(350);
  assert.strictEqual(await page.textContent('.dialog p'), 'Shut down this PC?', 'a click picks a row');
  await key('Escape');
  assert.strictEqual(await focusedIcon(), 'Power');

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
