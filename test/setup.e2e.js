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
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      const next = globalThis.nextPick;
      globalThis.nextPick = null;
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
    };
  });
  const pick = (file) => app.evaluate((_electron, value) => { globalThis.nextPick = value; }, file);
  return { app, page, pick };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-setup-e2e-'));
  const userData = path.join(root, 'user');
  fs.mkdirSync(path.join(root, 'tink'), { recursive: true });
  for (const exe of ['Dolphin.exe', 'Cemu.exe', 'pcsx2-qt.exe']) fs.writeFileSync(path.join(root, 'tink', exe), '');
  const eden = path.join(root, 'picked', 'eden.exe');
  const stub = path.join(root, 'picked', 'ps5.exe');
  fs.mkdirSync(path.dirname(eden), { recursive: true });
  fs.writeFileSync(eden, '');
  fs.writeFileSync(stub, '');
  const notExe = path.join(root, 'picked', 'notes.txt');
  fs.writeFileSync(notExe, '');
  const gamecube = path.join(root, 'games', 'GameCube');
  const snes = path.join(root, 'games', 'SNES');
  fs.mkdirSync(gamecube, { recursive: true });
  fs.mkdirSync(snes, { recursive: true });
  for (const name of ['Wind Waker (USA).rvz', 'Luigis Mansion (USA).rvz']) fs.writeFileSync(path.join(gamecube, name), '');
  fs.writeFileSync(path.join(snes, 'Super Metroid (USA).sfc'), '');

  let { app, page, pick } = await launch(root, userData);
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
  const down = async (times) => { for (let i = 0; i < times; i++) await key('ArrowDown'); };

  await page.waitForSelector('#setup h1');
  console.log('screen 1:', await title(), '| focus:', await focused(), '| hints:', await hints());
  await shot('1-emulators-found-and-missing');

  await down(2);
  await pick(notExe);
  await key('Enter');
  await shot('1-not-a-program');
  assert.ok(await page.$('.dialog'), 'a friendly message shows for a non-exe');
  await key('Enter');
  await pick(eden);
  await key('Enter');
  console.log('after picking Eden:', (await page.textContent('.setup-row:nth-child(3)')));
  await shot('1-eden-picked');

  await down(5);
  await pick(stub);
  await key('Enter');
  await shot('1-switch2-picked');
  await down(2);
  console.log('focus on Next:', await focused(), '| hints:', await hints());
  await shot('1-next-focused');
  await key('Enter');

  console.log('screen 2:', await title(), '| hints:', await hints());
  await shot('2-folders-empty');
  await pick(gamecube);
  await key('Enter');
  await down(10);
  await pick(snes);
  await key('Enter');
  console.log('hints on a Console with a folder:', await hints());
  await shot('2-folders-picked');
  await key(' ');
  assert.ok(!(await page.textContent('.setup-row:nth-child(11)')).includes(snes), 'X clears the folder');
  await pick(snes);
  await key('Enter');

  await key('Escape');
  console.log('back on:', await title());
  await down(20);
  await key('Enter');
  await down(30);
  await key('Enter');
  console.log('screen 3:', await title(), '| focus:', await focused(), '| hints:', await hints());
  await shot('3-covers');
  await key('ArrowDown');
  await shot('3-covers-not-now');
  await key('ArrowUp');

  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  assert.strictEqual(saved().setupDone, false, 'half-way settings are marked unfinished');
  await key('Enter');
  await page.waitForSelector('#title:not(:empty)');
  await shot('home-after-setup');
  const done = saved();
  console.log('saved settings:', JSON.stringify(done));
  assert.strictEqual(done.setupDone, true);
  assert.strictEqual(done.covers, true);
  assert.strictEqual(done.consoles.gamecube.folder, gamecube);
  assert.strictEqual(done.emulators.eden, eden);
  assert.ok(!fs.existsSync(path.join(userData, 'settings.json.tmp')));
  console.log('errors:', page.errors.length ? page.errors : 'none');
  await app.close();

  ({ app, page } = await launch(root, userData));
  await page.waitForSelector('#title:not(:empty)');
  assert.strictEqual(await page.$('#setup:not([hidden])'), null, 'setup is gone on the next start');
  console.log('second start: home opens without setup');
  await app.close();

  const oldUser = path.join(root, 'old-user');
  fs.mkdirSync(oldUser);
  fs.writeFileSync(path.join(oldUser, 'settings.json'), JSON.stringify({ consoles: { snes: { folder: snes } } }));
  ({ app, page } = await launch(root, oldUser));
  await page.waitForSelector('#title:not(:empty)');
  assert.strictEqual(await page.$('#setup:not([hidden])'), null);
  console.log('existing settings: home opens without setup');
  await app.close();

  const padUser = path.join(root, 'pad-user');
  ({ app, page, pick } = await launch(root, padUser));
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
  for (let i = 0; i < 10; i++) await press(13);
  await press(0);
  assert.strictEqual(await title(), 'Games folders', 'pad: A on Next moves on');
  await press(1);
  assert.strictEqual(await title(), 'Emulators', 'pad: B goes back');
  for (let i = 0; i < 10; i++) await press(13);
  await press(0);
  for (let i = 0; i < 22; i++) await press(13);
  await press(0);
  await press(13);
  await press(0);
  await page.waitForSelector('#message:not([hidden])');
  const padSaved = JSON.parse(fs.readFileSync(path.join(padUser, 'settings.json'), 'utf8'));
  console.log('pad run saved:', JSON.stringify(padSaved));
  assert.deepStrictEqual([padSaved.covers, padSaved.setupDone], [false, true]);
  await shot('pad-no-games-shelf');
  await app.close();

  fs.rmSync(root, { recursive: true, force: true });
  console.log('setup e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
