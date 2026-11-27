const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'setup'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch(root, userData) {
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const env = {
    ...process.env,
    PORTABLE_EXECUTABLE_DIR: path.join(root, 'tink'),
    TINK_DATA_DIR: userData,
    ProgramFiles: empty,
    'ProgramFiles(x86)': empty,
    LOCALAPPDATA: empty,
    APPDATA: empty,
  };
  const app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env });
  await app.evaluate(() => { process.mainModule.require('./src/steam').findSteamDir = async () => null; });
  const page = await app.firstWindow();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  return { app, page };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-setup-e2e-'));
  const userData = path.join(root, 'user');
  fs.mkdirSync(path.join(root, 'tink'), { recursive: true });

  let { app, page } = await launch(root, userData);
  const shot = async (name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(250);
  };
  const focused = () => page.evaluate(() => document.activeElement.textContent);
  const title = () => page.textContent('#setup h1');
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const saved = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));

  await page.waitForSelector('#setup h1');
  assert.strictEqual(await title(), 'Covers', 'first run goes straight to Covers');
  assert.strictEqual(await focused(), 'Download');
  console.log('screen 1:', await title(), '| focus:', await focused(), '| hints:', await hints());
  await shot('1-covers');
  await key('ArrowDown');
  assert.strictEqual(await focused(), 'Skip');
  await shot('1-covers-skip');
  await key('ArrowUp');

  await key('Enter');
  await page.waitForSelector('#title:not(:empty), #message:not([hidden])');
  await shot('home-after-setup');
  const done = saved(userData);
  console.log('saved settings:', JSON.stringify(done));
  assert.strictEqual(done.setupDone, true);
  assert.strictEqual(done.covers, true);
  assert.ok(!fs.existsSync(path.join(userData, 'settings.json.tmp')));
  console.log('errors:', page.errors.length ? page.errors : 'none');
  await app.close();

  ({ app, page } = await launch(root, userData));
  await page.waitForSelector('#profiles .profile, #title:not(:empty)');
  assert.strictEqual(await page.$('#setup:not([hidden])'), null, 'setup is gone on the next start');
  console.log('second start: home opens without setup');
  await app.close();

  const oldUser = path.join(root, 'old-user');
  fs.mkdirSync(oldUser);
  fs.writeFileSync(path.join(oldUser, 'settings.json'), JSON.stringify({ consoles: { snes: { folder: 'D:\\SNES' } }, emulators: {}, setupDone: true }));
  ({ app, page } = await launch(root, oldUser));
  await page.waitForSelector('#profiles .profile, #title:not(:empty)');
  assert.strictEqual(await page.$('#setup:not([hidden])'), null);
  console.log('old console and emulator keys are ignored');
  await app.close();

  const padUser = path.join(root, 'pad-user');
  ({ app, page } = await launch(root, padUser));
  await page.waitForSelector('#setup h1');
  await page.evaluate(() => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
  });
  const press = async (button) => {
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = true; }, button);
    await sleep(80);
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = false; }, button);
    await sleep(120);
  };
  await press(13);
  await press(0);
  await page.waitForSelector('#profiles .profile, #message:not([hidden]), #title:not(:empty)');
  const padSaved = saved(padUser);
  console.log('pad run saved:', JSON.stringify(padSaved));
  assert.deepStrictEqual([padSaved.covers, padSaved.setupDone], [false, true]);
  await app.close();

  fs.rmSync(root, { recursive: true, force: true });
  console.log('setup e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
