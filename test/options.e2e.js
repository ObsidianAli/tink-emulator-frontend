const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { _electron: electron } = require('playwright');
const { pcGames, idFor } = require('./pcseed');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GRID = 'https://www.steamgriddb.com/api/v2';
const CDN = 'https://cdn2.steamgriddb.com';
const SIZE = '?dimensions=600x900&types=static';

function colourPng([r, g, b], width = 300, height = 450) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set([r, g, b], y * (width * 3 + 1) + 1 + x * 3);
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

const COLOURS = { red: [200, 20, 20], green: [20, 200, 20], blue: [20, 20, 200], yellow: [200, 200, 20] };
const tintOf = (name) => `rgb(${COLOURS[name].join(' ')})`;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-options-e2e-'));
  const data = path.join(root, 'data');
  const empty = path.join(root, 'empty');
  const seeded = path.join(data, 'covers', 'pc');
  for (const dir of [seeded, empty]) fs.mkdirSync(dir, { recursive: true });
  const names = ['Pixel Deep', 'Star Moon', 'Wild Woods'];
  for (const name of names) fs.writeFileSync(path.join(seeded, `${name}.png`), colourPng(COLOURS.red));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
    setupDone: true,
    covers: false,
    steamGridDbKey: 'test-key',
    pcGames: pcGames(root, names),
    profiles: [{ id: 'p1', name: 'Ali' }, { id: 'p2', name: 'Sam' }],
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
  const grid = (name) => ({ url: `${CDN}/grid/${name}.png`, thumb: `${CDN}/thumb/${name}.png` });
  const json = { [`${GRID}/grids/game/1${SIZE}`]: ['green', 'blue'].map(grid), [`${GRID}/grids/game/2${SIZE}`]: [grid('yellow')] };
  for (const title of ['Pixel Deep', 'Star Moon', 'Wild Woods']) json[`${GRID}/search/autocomplete/${encodeURIComponent(title)}`] = [{ id: 1 }, { id: 2 }];
  const images = {};
  for (const [name, colour] of Object.entries(COLOURS)) {
    images[grid(name).url] = colourPng(colour).toString('base64');
    images[grid(name).thumb] = colourPng(colour, 100, 150).toString('base64');
  }
  const page = await app.firstWindow();
  await app.evaluate((_electron, { json, images }) => {
    process.mainModule.require('./src/steam').findSteamDir = async () => null;
    globalThis.online = true;
    globalThis.fetch = async (url) => {
      if (!globalThis.online) throw new TypeError('fetch failed');
      if (json[url]) return new Response(JSON.stringify({ success: true, data: json[url] }));
      return images[url] ? new Response(Buffer.from(images[url], 'base64')) : new Response('', { status: 404 });
    };
  }, { json, images });

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const key = async (name, wait = 150) => {
    await page.keyboard.press(name);
    await sleep(wait);
  };
  const until = (check, arg) => page.waitForFunction(check, arg, { timeout: 5000 });
  const title = (text) => until((wanted) => document.getElementById('title').textContent === wanted, text);
  const tint = (name) => until((wanted) => document.body.style.getPropertyValue('--tint') === wanted, tintOf(name));
  const hints = () => page.$$eval('#hints .hint', (nodes) => nodes.map((node) => node.textContent).join(' '));
  const dialog = (text) => until((wanted) => document.querySelector('.dialog-scrim.open p')?.textContent === wanted, text);
  const dialogGone = () => until(() => !document.querySelector('.dialog-scrim'));
  const focusedRow = () => page.evaluate(() => document.activeElement.textContent);
  const optionsGone = () => until(() => document.getElementById('options').hidden);
  const rows = () => page.$$eval('#options .setup-row', (nodes) => nodes.map((node) => node.textContent));
  const opacity = (selector) => page.$eval(selector, (node) => Number(getComputedStyle(node).opacity));
  const settings = () => JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
  const picks = () => fs.readdirSync(path.join(data, 'covers-picked')).filter((name) => name.endsWith('.png'));
  const tiles = () => page.$$eval('#covers-list .tile', (nodes) => nodes.length);
  const focusedTile = (list) => page.$$eval(`${list} .tile`, (nodes) => nodes.findIndex((node) => node.classList.contains('focused')));
  const openOptions = async (look) => {
    await key('s');
    await page.waitForSelector(`#options.${look}.open`);
  };
  const changeCover = async (look) => {
    await openOptions(look);
    await key('ArrowDown');
    assert.strictEqual(await focusedRow(), 'Change cover');
    await key('Enter');
  };
  const backToOptions = async (look, row) => {
    await page.waitForSelector(`#options.${look}.open`);
    await until((wanted) => document.activeElement.textContent === wanted, row);
  };
  const leaveOptions = async () => {
    await key('Escape');
    await optionsGone();
  };
  const favourites = () => settings().profiles[0].favourites || [];

  await page.waitForSelector('#profiles .profile');
  await sleep(800);
  await key('Enter');
  await title('Pixel Deep');
  await tint('red');
  await sleep(600);

  await openOptions('beside');
  assert.deepStrictEqual(await rows(), ['FavouriteOff', 'Change cover', 'Hide', 'Game info']);
  assert.strictEqual(await hints(), 'ASwitch BBack');
  await until(() => getComputedStyle(document.getElementById('tray')).opacity === '0');
  assert.strictEqual(await opacity('#title'), 0);
  await key('Enter');
  await until(() => document.querySelector('#options .setup-status').textContent === 'On');
  assert.strictEqual(favourites().length, 1);
  await key('Enter');
  await until(() => document.querySelector('#options .setup-status').textContent === 'Off');
  assert.strictEqual(favourites().length, 0);
  await key('ArrowDown');
  assert.strictEqual(await hints(), 'AChoose BBack');
  await key('ArrowDown');
  await key('ArrowDown');
  assert.strictEqual(await focusedRow(), 'Game info');
  await key('Enter');
  await page.waitForSelector('#info:not([hidden])');
  assert.strictEqual(await page.$eval('#options', (node) => getComputedStyle(node).visibility), 'hidden');
  await key('Escape');
  await backToOptions('beside', 'Game info');
  await leaveOptions();
  await until(() => getComputedStyle(document.getElementById('tray')).opacity === '1');
  assert.strictEqual(await hints(), '');

  await changeCover('beside');
  await title('Pixel Deep1 of 4');
  assert.strictEqual(await hints(), '←→Cover AUse BBack');
  await until(() => getComputedStyle(document.getElementById('title')).opacity === '1');
  assert.ok(await page.$('#options:not(.open)'), 'the rows make room');
  await key('ArrowLeft');
  await title('Pixel Deep1 of 4');
  await key('ArrowRight');
  await title('Pixel Deep2 of 4');
  await tint('green');
  await key('ArrowRight');
  await key('ArrowRight');
  await title('Pixel Deep4 of 4');
  await tint('yellow');
  await key('ArrowRight');
  await title('Pixel Deep4 of 4');
  await key('ArrowDown');
  await key(',');
  assert.ok(await page.$('#settings[hidden]'), 'the shelf underneath takes no presses');
  await key('Escape');
  await title('Pixel Deep');
  await tint('red');
  await backToOptions('beside', 'Change cover');
  assert.ok(!fs.existsSync(path.join(data, 'covers-picked')), 'B keeps the old cover');

  await key('Enter');
  await title('Pixel Deep1 of 4');
  await key('ArrowRight');
  await key('Enter');
  await title('Pixel Deep');
  await tint('green');
  assert.strictEqual(picks().length, 1);
  await backToOptions('beside', 'Change cover');
  await leaveOptions();
  await key('ArrowRight');
  await title('Star Moon');
  await tint('red');
  await key('ArrowLeft');
  await title('Pixel Deep');
  await tint('green');

  await key('End');
  await title('All games');
  await key('Enter');
  await page.waitForSelector('#grid .tile.focused img');
  await sleep(500);
  await key('ArrowRight');
  const tileSrc = () => page.$eval('#grid .tile.focused img', (img) => img.src);
  const before = await tileSrc();
  await changeCover('side');
  await page.waitForSelector('#covers:not([hidden])');
  await until(() => document.querySelectorAll('#covers-list .tile').length === 4);
  assert.strictEqual(await page.textContent('#covers-title'), 'Star Moon');
  assert.strictEqual(await page.textContent('#covers-heading'), 'Covers');
  assert.strictEqual(await focusedTile('#covers-list'), 0);
  assert.strictEqual(await page.$eval('#grid', (node) => getComputedStyle(node).visibility), 'hidden');
  await key('ArrowRight');
  await key('ArrowRight');
  assert.strictEqual(await focusedTile('#covers-list'), 2);
  await key('Enter');
  await page.waitForSelector('#covers', { state: 'hidden' });
  assert.strictEqual(await focusedTile('#grid'), 1, 'All games keeps its place');
  await until((old) => document.querySelector('#grid .tile.focused img').src !== old, before);
  assert.strictEqual(picks().length, 2);
  await backToOptions('side', 'Change cover');
  assert.notStrictEqual(await page.$eval('#options .options-cover img', (img) => img.src), before);
  await leaveOptions();
  assert.strictEqual(await hints(), 'APlay YSort BBack');
  await key('Escape');
  await title('All games');
  await sleep(400);

  await key(',');
  await page.waitForSelector('#settings .settings-category.selected');
  await sleep(400);
  for (let i = 0; i < 6 && (await page.textContent('#settings .settings-pane h1')) !== 'Covers'; i++) await key('ArrowDown');
  await key('ArrowRight');
  await key('ArrowDown');
  await key('ArrowDown');
  assert.ok((await page.evaluate(() => document.activeElement.textContent)).startsWith('Change cover'));
  await key('ArrowLeft');
  assert.strictEqual(settings().coverPicker, 'page');
  await key('ArrowLeft');
  await key('Escape');
  await key('ArrowDown');
  await key('ArrowRight');
  for (let i = 0; i < 12 && !(await focusedRow()).startsWith('Game options'); i++) await key('ArrowDown');
  await key('ArrowRight');
  assert.strictEqual(settings().gameOptions, 'panel');
  await key('Escape');
  await key('Escape');
  await page.waitForSelector('#settings', { state: 'hidden' });
  await sleep(500);

  await key('Home');
  await title('Pixel Deep');
  await changeCover('side');
  await page.waitForSelector('#covers:not([hidden])');
  await until(() => document.querySelectorAll('#covers-list .tile').length === 4);
  assert.strictEqual(await hints(), 'AUse BBack');
  await key('Escape');
  await backToOptions('side', 'Change cover');
  await tint('green');
  await key('Enter');
  await page.waitForSelector('#covers:not([hidden])');
  await until(() => document.querySelectorAll('#covers-list .tile').length === 4);
  await key('ArrowRight');
  await key('Enter');
  await page.waitForSelector('#covers', { state: 'hidden' });
  await tint('red');
  assert.strictEqual(picks().length, 1, 'picking the default removes the pick');
  assert.strictEqual(await tiles(), 0);
  await backToOptions('side', 'Change cover');

  await app.evaluate(() => { globalThis.online = false; });
  await key('Enter');
  await dialog('No other covers found.');
  await key('Enter');
  await dialogGone();

  await app.evaluate(() => { globalThis.online = true; });
  await page.evaluate(() => window.tink.setSteamKey(''));
  await backToOptions('side', 'Change cover');
  await key('Enter');
  await dialog('Other covers need a SteamGridDB key.');
  await key('Enter');
  await page.waitForSelector('#settings:not([hidden])');
  await dialogGone();
  await until(() => document.querySelector('#settings .settings-pane h1')?.textContent === 'Covers');
  await until(() => document.activeElement.textContent.startsWith('SteamGridDB key'));
  await optionsGone();
  await key('Escape');
  await key('Escape');
  await page.waitForSelector('#settings', { state: 'hidden' });
  await sleep(500);

  await openOptions('side');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  await optionsGone();
  await title('Star Moon');
  assert.deepStrictEqual(settings().profiles[0].hiddenGames, [`pc:${idFor('Pixel Deep')}`]);

  assert.deepStrictEqual(errors, [], 'no page errors');
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('options e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
