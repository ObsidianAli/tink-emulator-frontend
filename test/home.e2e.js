const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-home-e2e-'));
  const data = path.join(root, 'data');
  const folder = path.join(root, 'snes');
  fs.mkdirSync(data);
  fs.mkdirSync(folder);
  for (const name of ['Star Moon', 'Pixel Deep']) fs.writeFileSync(path.join(folder, `${name} (USA).sfc`), '');
  const file = path.join(data, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({
    setupDone: true,
    consoles: { snes: { folder } },
    profiles: [
      { id: 'p1', name: 'Ali', colour: 'blue', icon: 'planet' },
      { id: 'p2', name: 'Sam', colour: 'green', icon: 'star' },
    ],
    lastProfile: 'p1',
  }));

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${path.join(root, 'user')}`],
    env: { ...process.env, TINK_DATA_DIR: data, PORTABLE_EXECUTABLE_DIR: path.join(root, 'tink') },
  });
  await app.evaluate(() => { process.mainModule.require('./src/steam').findSteamDir = async () => null; });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const key = async (name, wait = 400) => {
    await page.keyboard.press(name);
    await sleep(wait);
  };
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = () => page.$$eval('#home-profiles .home-badge', (nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  const label = () => page.$eval('#home-label', (node) => ({ text: node.textContent, opacity: getComputedStyle(node).opacity }));
  const shown = () => page.$eval('#home-profiles', (node) => !node.hidden);

  await page.waitForSelector('#profiles .profile');
  await sleep(800);
  await key('Enter', 1500);
  await page.waitForSelector('#title:not(:empty)');
  await sleep(800);
  assert.deepStrictEqual(await names(), ['Ali', 'Sam']);

  await key('ArrowUp');
  assert.strictEqual(await focused(), 'Ali');
  assert.deepStrictEqual(await label(), { text: 'Ali', opacity: '1' });
  assert.strictEqual(
    await page.evaluate(() => getComputedStyle(document.getElementById('title')).color === getComputedStyle(document.getElementById('home-label')).color),
    true,
    'the game title and the icon labels share one colour',
  );
  await key('ArrowLeft');
  assert.strictEqual(await focused(), 'Ali');
  await key('ArrowRight');
  assert.strictEqual(await focused(), 'Sam');
  await key('ArrowRight');
  assert.strictEqual(await focused(), 'Sam');

  await key('ArrowLeft');
  await key('Enter');
  assert.strictEqual(read().lastProfile, 'p1', 'A on the current profile changes nothing');

  await key('ArrowRight');
  await key('Enter', 1500);
  assert.strictEqual(read().lastProfile, 'p2');
  assert.deepStrictEqual(await names(), ['Sam', 'Ali']);
  assert.strictEqual(await focused(), 'Sam');

  await key('ArrowDown');
  assert.notStrictEqual(await focused(), 'Sam');
  assert.strictEqual((await label()).opacity, '0');
  assert.ok(await page.textContent('#title'));

  const heading = () => page.textContent('#settings .settings-pane h1').catch(() => null);
  await key(',', 800);
  for (let i = 0; i < 8 && (await heading()) !== 'Display'; i++) await key('ArrowDown');
  assert.strictEqual(await heading(), 'Display');
  await key('ArrowRight');
  for (let i = 0; i < 4; i++) await key('ArrowDown');
  assert.ok((await page.evaluate(() => document.activeElement.innerText)).startsWith('Profiles on Home'));
  await key('Enter');
  assert.strictEqual(read().homeProfiles, false);
  await key('Escape');
  await key('Escape', 1200);
  assert.strictEqual(await shown(), false);
  await key('ArrowUp');
  assert.strictEqual(await focused(), null, 'the hidden row cannot be focused');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await app.close();
  console.log('home e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
