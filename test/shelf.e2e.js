const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'e2e'));
const WORDS = ['Star', 'Moon', 'Pixel', 'Deep', 'Castle', 'Sky', 'Quiet', 'Neon', 'Iron', 'Lost', 'Wild', 'Paper',
  'Garden', 'Knights', 'Racer', 'Forge', 'Woods', 'Drift', 'Coast', 'Tower', 'Harbor', 'Planet', 'River', 'Storm'];

function makeLibrary(root) {
  const counts = { ps2: 40, gamecube: 24, snes: 24, gba: 16, switch: 12, ps1: 12, nes: 12 };
  const extensions = { ps2: '.iso', gamecube: '.rvz', snes: '.sfc', gba: '.gba', switch: '.nsp', ps1: '.chd', nes: '.nes' };
  const consoles = {};
  for (const [id, count] of Object.entries(counts)) {
    const folder = path.join(root, id);
    fs.mkdirSync(folder, { recursive: true });
    for (let i = 0; i < count; i++) {
      const name = `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} ${Math.floor(i / 24) + 1} (USA)`;
      fs.writeFileSync(path.join(folder, name + extensions[id]), '');
    }
    consoles[id] = { folder };
  }
  const waiter = path.join(root, 'switch2');
  fs.mkdirSync(waiter);
  fs.writeFileSync(path.join(waiter, 'Waiting Game.js'), 'setTimeout(() => {}, 1500);\n');
  fs.writeFileSync(path.join(waiter, 'Aardvark Game.js'), 'setTimeout(() => {}, 1500);\n');
  consoles.switch2 = { folder: waiter, exe: process.execPath };
  return { consoles, covers: false, profiles: [{ id: 'player', name: 'Player', hiddenConsoles: ['steam'] }] };
}

function fakeCover(seed, width = 400, height = 560) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  const hue = (seed * 47) % 360;
  const rgb = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
  };
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const hill = height * 0.68 + Math.sin(x / 37 + seed) * 30 + Math.sin(x / 13) * 8;
      const sun = Math.hypot(x - width * 0.68, y - height * 0.36) < width * 0.16;
      const letters = y > height * 0.08 && y < height * 0.18 && x > width * 0.1 && x < width * 0.9 && (x >> 4) % 3 !== 2;
      let colour;
      if (letters) colour = [245, 245, 240];
      else if (y > hill) colour = rgb((hue + 140) % 360, 0.45, 0.22 + (y - hill) / height * 0.3);
      else if (sun) colour = rgb((hue + 40) % 360, 0.9, 0.62);
      else colour = rgb(hue, 0.6, 0.25 + (y / height) * 0.35);
      pixels.set(colour, row + 1 + x * 3);
    }
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

function seedCovers(userData, gamesRoot) {
  const dir = path.join(userData, 'covers', 'gamecube');
  fs.mkdirSync(dir, { recursive: true });
  fs.readdirSync(path.join(gamesRoot, 'gamecube')).forEach((file, i) => {
    fs.writeFileSync(path.join(dir, file.replace(/\.[^.]+$/, '') + '.png'), fakeCover(i));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function frameTimes(page, fn) {
  await page.evaluate(() => {
    window.__long = [];
    window.__observer = new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => e.duration)));
    window.__observer.observe({ type: 'longtask' });
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      if (!window.__frames) return;
      window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await fn();
  const frameData = await page.evaluate(() => {
    const result = window.__frames.slice(1);
    window.__frames = null;
    window.__observer.disconnect();
    return { result, long: window.__long };
  });
  const { result: frames, long } = frameData;
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    frames: frames.length,
    median: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    p99: +at(0.99).toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
    over33ms: frames.filter((f) => f > 33.4).length,
    longTasks: long.length,
    longestTask: long.length ? Math.round(Math.max(...long)) : 0,
  };
}

async function drawing(page, ms) {
  return page.evaluate(async (wait) => {
    const proto = WebGL2RenderingContext.prototype;
    const clear = proto.clear;
    let count = 0;
    proto.clear = function (...args) {
      count++;
      return clear.apply(this, args);
    };
    await new Promise((resolve) => setTimeout(resolve, wait));
    proto.clear = clear;
    const canvas = document.getElementById('shelf');
    return { framesPerSecond: Math.round((count * 1000) / wait), pixelRatio: +(canvas.width / canvas.clientWidth).toFixed(2), devicePixelRatio };
  }, ms);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-e2e-'));
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(makeLibrary(path.join(root, 'games'))));
  seedCovers(userData, path.join(root, 'games'));
  fs.mkdirSync(path.join(userData, 'avatars'));
  fs.writeFileSync(path.join(userData, 'avatars', 'sam.png'), fakeCover(3));

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--force-device-scale-factor=3'],
    env: { ...process.env, TINK_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  const shot = async (name) => {
    await sleep(700);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const title = async () => {
    await page.waitForSelector('#title:not(.away)', { timeout: 8000 });
    await sleep(150);
    return page.textContent('#title');
  };
  const gridTitle = () => page.textContent('#grid-title');
  const sortName = () => page.textContent('#grid-sort');
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const readSettings = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(350);
  };
  const centreOf = (selector) => page.$eval(selector, (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, bottom: box.bottom };
  });
  const buttonSelected = () => page.$eval('#all-games', (el) => el.classList.contains('selected'));
  const visibleWindow = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocusable()));

  const caseSteps = async (prefix) => {
    await page.keyboard.press('f');
    await shot(`${prefix}-back`);
    await page.keyboard.press(' ');
    await sleep(450);
    await shot(`${prefix}-disc-out`);
    for (const step of ['closed', 'flipped', 'front-again']) {
      await page.keyboard.press('Escape');
      await shot(`${prefix}-${step}`);
    }
  };

  await page.waitForSelector('#title:not(:empty)');
  assert.strictEqual(await title(), 'Aardvark Game', 'a profile that has played nothing sees games A to Z');
  assert.strictEqual(await page.$('#shelves'), null, 'no shelf names');
  assert.ok(!(await buttonSelected()));
  const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const start = await centreOf('#title');
  assert.ok(start.x < view.width / 2, `the row starts at the left, title centre was ${start.x}`);
  assert.ok(start.bottom < view.height / 3, 'the title sits above the selected game');
  await shot('home-row');
  await page.keyboard.press('ArrowRight');
  await sleep(20);
  const mid = await page.$eval('#title', (el) => ({ shown: getComputedStyle(el).opacity === '1' && !el.classList.contains('away'), text: el.textContent }));
  assert.ok(!mid.shown || mid.text === 'Aardvark Game', 'right after a move the new title is not shown over the old place');
  await page.waitForSelector('#title:not(.away)', { timeout: 8000 });
  await sleep(300);
  assert.strictEqual(await page.$eval('#title', (el) => getComputedStyle(el).opacity), '1', 'the title returns once the row has settled');
  await page.keyboard.press('ArrowLeft');
  await sleep(1200);
  await caseSteps('case-art');

  const flipping = await frameTimes(page, async () => {
    await page.keyboard.press('f');
    await sleep(700);
    await page.keyboard.press(' ');
    await sleep(1500);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      await sleep(800);
    }
  });
  console.log('flip, open and back again:', JSON.stringify(flipping));
  const settled = await frameTimes(page, () => sleep(1000));
  console.log('settled second after that:', JSON.stringify(settled));
  const rest = await drawing(page, 1000);
  console.log('at rest, drawn:', JSON.stringify(rest));
  assert.ok(rest.framesPerSecond <= 31, 'at rest only the focus outline is redrawn, at a lower rate');
  await page.screenshot({ path: path.join(outDir, 'sharp-cover.png'), clip: await coverClip(page) });

  const held = await frameTimes(page, async () => {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(120);
    }
  });
  console.log('12 steps along the row, one every 120 ms:', JSON.stringify(held));
  await sleep(500);
  assert.strictEqual(await title(), 'All games');
  assert.ok(await buttonSelected(), 'the button is selected at the end of the row');
  await shot('home-row-end');
  const box = await page.$eval('#all-games', (el) => el.getBoundingClientRect().toJSON());
  assert.ok(box.x + box.width / 2 <= view.width / 2 + 1, 'the button is never right of the middle');
  assert.ok(Math.abs(box.width - 96) < 1, `the button is 96px, was ${box.width}`);
  assert.strictEqual(await page.$$eval('#all-games svg rect', (rects) => rects.length), 4, 'a 2x2 blocks icon');
  assert.strictEqual(await page.$eval('#all-games', (el) => el.textContent.trim()), '', 'nothing is written on the button');
  assert.strictEqual(await hints(), '');
  await key('ArrowRight');
  assert.strictEqual(await title(), 'All games', 'the button is the last place');
  const jumped = await frameTimes(page, async () => {
    await key('Home');
    assert.strictEqual(await title(), 'Aardvark Game', 'Home jumps to the first game');
    await key('End');
  });
  console.log('Home and End along the row:', JSON.stringify(jumped));
  assert.strictEqual(await title(), 'All games', 'End lands on the button, the true end of the row');
  assert.ok(await buttonSelected());
  await key('End');
  assert.ok(await buttonSelected(), 'End at the end stays put');
  await page.keyboard.press('ArrowLeft');
  await sleep(1500);
  const lastX = (await centreOf('#title')).x;
  assert.ok(Math.abs(lastX - (box.x + box.width / 2)) < 12, `the last game holds the button's place, ${lastX} against ${box.x + box.width / 2}`);
  assert.ok(Math.abs(lastX - start.x) < 12, 'the selected game stays in the first slot while the row scrolls');
  await key('ArrowRight');
  await key('ArrowDown');
  assert.ok(!(await buttonSelected()), 'down leaves the button for the icon row');
  await key('ArrowUp');
  assert.ok(await buttonSelected());

  await key('Enter');
  const total = 40 + 24 + 24 + 16 + 12 + 12 + 12 + 2;
  assert.strictEqual(await page.$$eval('#grid-list .tile', (tiles) => tiles.length), total, 'every game is in the grid');
  assert.strictEqual(await sortName(), 'Last played');
  assert.strictEqual(await hints(), 'APlay YSort BBack');
  assert.strictEqual(await page.$eval('#shelf', (el) => getComputedStyle(el).visibility), 'hidden');
  assert.strictEqual(await gridTitle(), 'Aardvark Game');
  await sleep(500);
  await shot('all-games');
  assert.strictEqual((await drawing(page, 1000)).framesPerSecond, 0, 'nothing is drawn under the grid');
  assert.strictEqual(await page.$eval('#grid-list', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 6);
  await key('ArrowDown');
  const below = await gridTitle();
  await key('ArrowUp');
  await key('ArrowRight');
  await key('ArrowLeft');
  assert.strictEqual(await gridTitle(), 'Aardvark Game');
  await key('ArrowDown');
  assert.strictEqual(await gridTitle(), below);
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  await sleep(500);
  await shot('all-games-scrolled');
  assert.ok(await page.$eval('#grid-list .tile.focused', (el) => {
    const tile = el.getBoundingClientRect();
    const list = el.parentElement.getBoundingClientRect();
    return tile.top >= list.top && tile.bottom <= list.bottom;
  }), 'the focused game is scrolled into view');

  const sorts = [];
  for (let i = 0; i < 4; i++) {
    await key('f');
    sorts.push(await sortName());
    if (sorts.length === 3) {
      assert.strictEqual(await page.$$eval('#grid-list .tile', (els) => els.length), 0, 'Favourites shows only favourites');
      assert.strictEqual(await page.textContent('#grid-list .store-empty'), 'No favourites');
    }
  }
  assert.deepStrictEqual(sorts, ['A–Z', 'Console', 'Favourites', 'Last played']);
  await key('f');
  assert.strictEqual(readSettings().profiles[0].sort, 'az');

  const tileCount = () => page.$$eval('#grid-list .tile', (els) => els.length);
  const allTiles = await tileCount();
  await key('l');
  await sleep(500);
  await key('f');
  await key('f');
  assert.strictEqual(await sortName(), 'Favourites');
  assert.strictEqual(await tileCount(), 1, 'only the favourite is listed');
  await key('l');
  await sleep(500);
  assert.strictEqual(await tileCount(), 0, 'unfavouriting removes the tile');
  assert.strictEqual(await page.textContent('#grid-list .store-empty'), 'No favourites');
  await key('ArrowRight');
  await key('l');
  await key('f');
  assert.strictEqual(await sortName(), 'Last played', 'sorting still works when empty');
  await key('f');
  assert.strictEqual(await sortName(), 'A–Z');
  assert.strictEqual(await tileCount(), allTiles);
  await key('End');
  assert.strictEqual(await page.$eval('#grid-list .tile.focused', (el) => el === el.parentElement.lastElementChild), true, 'End jumps to the last game');
  assert.notStrictEqual(await gridTitle(), 'Aardvark Game');
  await key('Home');
  assert.strictEqual(await gridTitle(), 'Aardvark Game', 'Home jumps to the first game');

  await key('s');
  assert.strictEqual(await page.$$eval('#case-menu button', (els) => els.map((el) => el.textContent).join()), 'Favourite,Hide,Game info');
  await key('Escape');
  assert.strictEqual(await hints(), 'APlay YSort BBack');

  while ((await gridTitle()) !== 'Waiting Game') await page.keyboard.press('ArrowRight');
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#loading:not([hidden])', { timeout: 2000 });
  await page.waitForSelector('#loading-cover.shown canvas, #loading-cover.shown.plain', { timeout: 2000 });
  assert.strictEqual(await page.textContent('#loading-hint'), 'Hold Select + Start to quit');
  assert.strictEqual(await page.$eval('#shelf', (el) => getComputedStyle(el).visibility), 'hidden', 'only the loading screen shows');
  await shot('loading');
  const shown = await visibleWindow();
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 10000 });
  await page.waitForFunction(() => !document.getElementById('blackout').classList.contains('black'), null, { timeout: 2000 });
  console.log('play: window shown while running', shown, '/ back after exit', await visibleWindow());
  assert.ok(await page.$('#grid:not([hidden])'), 'the grid is still open after a play');
  assert.strictEqual(await gridTitle(), 'Waiting Game', 'the cursor stays on the played game');
  assert.deepStrictEqual(readSettings().profiles[0].recent, ['switch2:Waiting Game.js']);

  await key('Escape');
  assert.strictEqual(await title(), 'All games');
  assert.ok(await buttonSelected());
  for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowLeft');
  await sleep(500);
  assert.strictEqual(await title(), 'Aardvark Game', 'the row has twelve games');
  await key('ArrowLeft');
  assert.strictEqual(await title(), 'Waiting Game', 'the played game is at the front of the row');
  await key('ArrowLeft');
  assert.strictEqual(await title(), 'Waiting Game', 'nothing comes before it');
  await shot('home-after-play');

  await key('ArrowRight');
  assert.strictEqual(await title(), 'Aardvark Game');
  await page.keyboard.press('Enter');
  await sleep(3000);
  assert.strictEqual(await title(), 'Aardvark Game', 'the cursor stays on the played game');
  await key('ArrowLeft');
  assert.strictEqual(await title(), 'Aardvark Game', 'the played game leads the row at once');
  await key('ArrowRight');
  assert.strictEqual(await title(), 'Waiting Game');

  const [first] = readSettings().profiles;
  assert.deepStrictEqual(first.recent, ['switch2:Aardvark Game.js', 'switch2:Waiting Game.js']);
  assert.ok(first.name && first.id, 'old settings got a profile');
  await key('Tab');
  await page.waitForSelector('#profiles:not([hidden])');
  const heading = async () => {
    await page.waitForFunction(() => !document.querySelector('main').matches('.screen-out, .screen-hold'));
    return page.textContent('#profiles .profile-header > span:first-child');
  };
  const dots = () => page.$$eval('#profiles .profile-dots i', (items) => items.length);
  const focusedName = () => page.evaluate(() => document.activeElement.innerText.trim());
  await key('ArrowRight');
  assert.strictEqual(await focusedName(), '+\nAdd user');
  await key('Enter');
  assert.strictEqual(await heading(), 'Choose an icon');
  assert.strictEqual(await dots(), 3);
  assert.strictEqual(await page.$$eval('.profile-option', (tiles) => tiles.length), 2, 'the initial, then the picture');
  assert.strictEqual(await page.$$eval('.profile-option .tick', (ticks) => ticks.length), 1, 'the current choice has a tick');
  await shot('profiles-new-icon');
  await key('ArrowRight');
  assert.strictEqual(await page.$$eval('.badge.profile-preview img', (images) => images.length), 1, 'the preview follows the focused icon');
  await key('Enter');
  assert.strictEqual(await heading(), 'Nickname', 'a picture skips the background step');
  assert.strictEqual(await dots(), 2, 'two steps are left once the background is skipped');
  const typed = () => page.textContent('.profile-name-text');
  assert.strictEqual(await typed(), 'Player 2', 'an empty name shows the fallback');
  for (const step of ['ArrowDown', 'ArrowDown', 'Enter', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter']) await page.keyboard.press(step);
  assert.strictEqual(await typed(), 'Sam', 'the keyboard types with arrows and A, each word starting with a capital');
  await shot('profiles-new-name');
  await page.keyboard.type('antha Jones');
  assert.strictEqual(await typed(), 'Samantha J', 'nicknames stop at ten letters');
  for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');
  assert.strictEqual(await typed(), 'Sam');
  for (const step of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'Enter']) await page.keyboard.press(step);
  await page.waitForSelector('#profiles .profile-row');
  await sleep(300);
  assert.strictEqual(readSettings().profiles[1].name, 'Sam');
  assert.strictEqual(readSettings().profiles[1].avatar, 'sam.png');
  assert.strictEqual(await focusedName(), 'Sam', 'adding returns to the picker on the new user');
  await shot('profiles-picker');
  assert.strictEqual(await page.$$eval('.profile img', (images) => images.length), 1, 'the picture shows on the badge');
  const initials = () => page.$$eval('.profile .badge:not(:has(img))', (badges) => badges.map((badge) => badge.textContent));
  assert.strictEqual((await initials())[0], 'P', 'the first profile shows its initial');
  await key('ArrowLeft');
  await key(' ');
  assert.strictEqual(await heading(), 'Choose an icon', 'X changes the icon');
  assert.strictEqual(await dots(), 2);
  await key('ArrowLeft');
  await key('Enter');
  assert.strictEqual(await heading(), 'Choose a background');
  const background = () => page.$eval('.badge.profile-preview', (el) => el.style.background);
  const before = await background();
  await key('ArrowRight');
  assert.notStrictEqual(await background(), before, 'the preview follows the swatch');
  await key('Enter');
  await page.waitForSelector('#profiles .profile-row');
  await sleep(300);
  assert.strictEqual(readSettings().profiles[0].colour, 'green');
  await key('Enter');
  await sleep(500);
  assert.strictEqual(await title(), 'Aardvark Game', 'a profile opens on its last played game');
  await key('l');
  assert.strictEqual(readSettings().profiles[0].favourites.length, 1);
  await sleep(600);
  assert.strictEqual(await title(), 'Aardvark Game', 'favouriting keeps the cursor');
  await key('h');
  assert.strictEqual(readSettings().profiles[0].hiddenGames.length, 1);
  await sleep(600);
  assert.notStrictEqual(await title(), 'Aardvark Game', 'a hidden game leaves the row');
  await key('Tab');
  await page.waitForSelector('#profiles:not([hidden])');
  await key('ArrowRight');
  await key('Enter');
  await sleep(500);
  assert.strictEqual(await title(), 'Aardvark Game', 'another profile has its own history and hidden games');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await sleep(500);
  await key('Enter');
  assert.strictEqual(await sortName(), 'Last played', 'another profile has its own sort');
  await key('Escape');

  console.log('errors:', errors.length ? errors : 'none');
  assert.deepStrictEqual(errors, [], 'no page errors');
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}

async function coverClip(page) {
  const box = await page.$eval('#shelf', (el) => el.getBoundingClientRect().toJSON());
  const width = box.height * 0.3;
  return { x: box.x + (box.width - width) / 2, y: box.y + box.height * 0.3, width, height: box.height * 0.4 };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
