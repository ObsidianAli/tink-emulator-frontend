const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { pcGames } = require('./pcseed');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'menu'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function colourPng(r, g, b, width = 320, height = 180) {
  const zlib = require('node:zlib');
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set([r, g + (x % 64), b], y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-menu-e2e-'));
  const data = path.join(root, 'data');
  const empty = path.join(root, 'empty');
  fs.mkdirSync(data);
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ pcGames: pcGames(root, ['Luigis Mansion', 'Wind Waker']), setupDone: true }));
  const info = path.join(data, 'info');
  fs.mkdirSync(path.join(info, '620'), { recursive: true });
  const files = [];
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(info, '620', `${i + 1}.png`), colourPng(40 + i * 40, 60, 160 - i * 25));
    files.push(`${i + 1}.png`);
  }
  fs.writeFileSync(path.join(info, '620.json'), JSON.stringify({
    overview: 'The sequel to the acclaimed Portal, with a new set of test chambers, new characters and a lot more cake.',
    files,
  }));

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
  const shot = async (name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(300);
  };
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const visible = (selector) => page.$(`${selector}:not([hidden])`).then(Boolean);
  const menuRows = () => page.$$eval('#options .setup-row', (els) => els.map((el) => el.textContent));
  const focused = () => page.evaluate(() => document.activeElement.textContent);
  const title = () => page.textContent('#title');
  const readSettings = () => JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));

  await page.waitForSelector('#title:not(:empty)');
  await sleep(600);
  assert.strictEqual(await hints(), '', 'no hints on the shelf');

  await key('s');
  assert.ok(await visible('#options'), 'Menu opens the options');
  assert.ok(!(await visible('#settings')), 'Menu no longer opens Settings');
  assert.deepStrictEqual(await menuRows(), ['FavouriteOff', 'Change cover', 'Hide', 'Game info']);
  assert.strictEqual(await hints(), 'ASwitch BBack');
  await shot('1-panel');
  await key('Escape');
  assert.ok(!(await visible('#options')), 'B closes the options');
  assert.strictEqual(await hints(), '', 'no hints on the shelf');
  assert.strictEqual(await title(), 'Luigis Mansion');

  await key('s');
  await key('Enter');
  assert.strictEqual(readSettings().profiles[0].favourites.length, 1);
  assert.deepStrictEqual(await menuRows(), ['FavouriteOn', 'Change cover', 'Hide', 'Game info']);
  await key('Escape');
  await key('l');
  assert.strictEqual(readSettings().profiles[0].favourites.length, 0, 'L still favourites');
  await sleep(400);

  await key('ArrowRight');
  assert.strictEqual(await title(), 'Wind Waker');
  await key('s');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowDown');
  assert.strictEqual(await focused(), 'Game info');
  await key('Enter');
  await sleep(300);
  assert.ok(await visible('#info'), 'Game info opens');
  assert.strictEqual(await page.textContent('#info h1'), 'Wind Waker');
  assert.strictEqual(await page.textContent('#info .info-console'), 'PC');
  assert.ok(await page.$('#info .info-overview[hidden]'), 'no overview for a PC game');
  assert.ok(await page.$('#info .info-shots[hidden]'), 'no screenshots for a PC game');
  assert.strictEqual(await hints(), 'BBack');
  await shot('2-info-pc');
  await key('Escape');
  assert.ok(!(await visible('#info')));
  assert.strictEqual(await title(), 'Wind Waker', 'B returns to the same game');
  assert.strictEqual(await focused(), 'Game info', 'B returns to the same row');
  await key('Escape');

  await key('s');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  await sleep(500);
  assert.strictEqual(readSettings().profiles[0].hiddenGames.length, 1);
  assert.strictEqual(await title(), 'Luigis Mansion');

  await key(',');
  assert.ok(await visible('#settings'), 'comma opens Settings');
  await key('ArrowDown');
  await key('ArrowRight');
  assert.ok((await focused()).startsWith('Hidden games1'), await focused());
  await key('Enter');
  assert.strictEqual(await page.textContent('#settings .settings-pane h1'), 'Hidden games');
  assert.deepStrictEqual(await page.$$eval('#settings .setup-row', (rows) => rows.map((r) => r.textContent)), ['Show all', 'Wind WakerPC']);
  await key('ArrowDown');
  await key('Enter');
  await sleep(300);
  assert.strictEqual(readSettings().profiles[0].hiddenGames.length, 0, 'one game can be shown again');
  assert.strictEqual(await page.textContent('#settings .settings-pane h1'), 'Library', 'the empty list goes back');
  await key('Escape');
  await key('Escape');
  await sleep(800);
  assert.ok(!(await visible('#settings')));
  assert.strictEqual(await title(), 'Luigis Mansion');

  await app.evaluate((_electron, dir) => {
    const steam = process.mainModule.require('./src/steam');
    steam.findSteamDir = async () => dir;
  }, path.join(__dirname, 'fixtures', 'steam'));
  await key('Tab');
  await key('Enter');
  await sleep(700);
  while ((await title()) !== 'Portal 2') await key('ArrowRight');
  await key('s');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  await sleep(600);
  assert.strictEqual(await page.textContent('#info .info-console'), 'Steam');
  assert.ok((await page.textContent('#info .info-overview')).includes('more cake'));
  assert.strictEqual(await page.$$eval('#info .info-shot', (els) => els.length), 5);
  assert.strictEqual(await hints(), 'Screenshots BBack');
  const current = () => page.$$eval('#info .info-shot', (els) => els.findIndex((el) => el.classList.contains('current')));
  assert.strictEqual(await current(), 0);
  await key('ArrowRight');
  await key('ArrowRight');
  assert.strictEqual(await current(), 2);
  await key('ArrowLeft');
  assert.strictEqual(await current(), 1);
  await shot('3-info-steam');
  await key('Escape');
  assert.strictEqual(await title(), 'Portal 2');
  assert.ok(!(await visible('#info')));

  assert.deepStrictEqual(errors, [], 'no page errors');
  await app.close();
  console.log('menu e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
