// Runs Tink in Electron with a made-up library of a few dozen Games per Shelf, drives the Shelf with the keyboard and a
// simulated pad, measures frame times while scrolling and while a Case flips and opens, and saves screenshots.
// Usage: node test/shelf.e2e.js [screenshot folder]
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'e2e'));
const WORDS = ['Star', 'Moon', 'Pixel', 'Deep', 'Castle', 'Sky', 'Quiet', 'Neon', 'Iron', 'Lost', 'Wild', 'Paper',
  'Garden', 'Knights', 'Racer', 'Forge', 'Woods', 'Drift', 'Coast', 'Tower', 'Harbor', 'Planet', 'River', 'Storm'];

// Folders of empty game files: a 40-Game PS2 Shelf and smaller ones for the other Case shapes.
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
  // A Switch 2 "game" that is really a script: run with node as the emulator, it waits a moment and exits.
  const waiter = path.join(root, 'switch2');
  fs.mkdirSync(waiter);
  fs.writeFileSync(path.join(waiter, 'Waiting Game.js'), 'setTimeout(() => {}, 1500);\n');
  consoles.switch2 = { folder: waiter, exe: process.execPath };
  return { consoles, covers: false };
}

// A made-up painted Cover as a PNG: a sky, a sun, hills and a band of "lettering", different per seed.
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

// Puts a painted Cover in the cache for every GameCube Game, so that Shelf shows real-looking art offline.
function seedCovers(userData, gamesRoot) {
  const dir = path.join(userData, 'covers', 'gamecube');
  fs.mkdirSync(dir, { recursive: true });
  fs.readdirSync(path.join(gamesRoot, 'gamecube')).forEach((file, i) => {
    fs.writeFileSync(path.join(dir, file.replace(/\.[^.]+$/, '') + '.png'), fakeCover(i));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Records the gap between frames the page actually gets while fn runs.
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

// How many frames the Shelf actually draws per second, and at what pixel ratio, over ms.
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
  // A picture the user dropped into data/avatars, which is not square.
  fs.mkdirSync(path.join(userData, 'avatars'));
  fs.writeFileSync(path.join(userData, 'avatars', 'sam.png'), fakeCover(3));

  const app = await electron.launch({
    // A 4K screen at 300% scale, where any blur from a low pixel ratio shows.
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
  const title = () => page.textContent('#title');
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));

  // Y flips, X opens, then B undoes every step, with a screenshot and the hints at each one.
  const caseSteps = async (prefix) => {
    const seen = [`front: ${await hints()}`];
    await page.keyboard.press('f');
    await shot(`${prefix}-back`);
    seen.push(`back: ${await hints()}`);
    await page.keyboard.press(' ');
    await sleep(450);
    await page.screenshot({ path: path.join(outDir, `${prefix}-lid-open.png`) });
    await shot(`${prefix}-disc-out`);
    seen.push(`open: ${await hints()}`);
    for (const step of ['closed', 'flipped', 'front-again']) {
      await page.keyboard.press('Escape');
      await shot(`${prefix}-${step}`);
      seen.push(`${step}: ${await hints()}`);
    }
    console.log(`${prefix} hints:`, seen.join(' | '));
  };

  // Up/Down until the named Shelf is current.
  const goTo = async (name) => {
    const target = shelfNames.indexOf(name);
    const now = shelfNames.indexOf(await page.textContent('#shelves .current'));
    const key = target > now ? 'ArrowDown' : 'ArrowUp';
    for (let i = 0; i < Math.abs(target - now); i++) await page.keyboard.press(key);
  };

  const readSettings = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(350);
  };
  const currentShelf = () => page.textContent('#shelves .current');

  // Recent after a play, a second profile with a picture, Favourites, hiding, and the picker's two ways in.
  async function profileSteps() {
    const [first] = readSettings().profiles;
    assert.deepStrictEqual(first.recent, ['switch2:Waiting Game.js'], 'a played game goes into Recent');
    assert.ok(first.name && first.id, 'old settings got a profile');
    await key('Tab');
    await key('ArrowRight');
    await key('Enter');
    await shot('profiles-new-picture');
    await key('ArrowRight');
    await key('Enter');
    await shot('profiles-new-name');
    await page.keyboard.type('Sam');
    await key('Enter');
    assert.strictEqual(readSettings().profiles[1].name, 'Sam');
    assert.strictEqual(readSettings().profiles[1].avatar, 'sam.png');
    await shot('profiles-picker');
    assert.strictEqual(await page.$$eval('.profile img', (images) => images.length), 1, 'the picture shows on the badge');
    await key('ArrowLeft');
    await key('Enter');
    await sleep(500);
    assert.strictEqual(await currentShelf(), 'Recent');
    await key('ArrowRight');
    assert.strictEqual(await title(), 'All games');
    await shot('shelf-recent');
    await key('Enter');
    const first2 = await currentShelf();
    assert.notStrictEqual(first2, 'Recent', 'All games jumps to the first Console shelf');
    const liked = await title();
    await key('l');
    assert.deepStrictEqual(readSettings().profiles[0].favourites.length, 1);
    await key('ArrowUp');
    assert.strictEqual(await currentShelf(), 'Favourites');
    assert.strictEqual(await title(), liked);
    await shot('shelf-favourites');
    await key('h');
    assert.strictEqual(readSettings().profiles[0].hiddenGames.length, 1);
    assert.ok(!(await page.$$eval('#shelves span', (spans) => spans.map((s) => s.textContent))).includes('Favourites'), 'a hidden game leaves Favourites');
    // Sam has their own shelves.
    await key('Tab');
    await key('ArrowRight');
    await key('Enter');
    await sleep(500);
    assert.ok(!(await page.$$eval('#shelves span', (spans) => spans.map((s) => s.textContent))).includes('Recent'), 'another profile has no Recent');
  }

  await page.waitForSelector('#shelves .current');
  const shelfNames = await page.$$eval('#shelves span', (spans) => spans.map((s) => s.textContent));
  console.log('shelves:', shelfNames.join(', '));
  await shot('shelf-gamecube');
  await caseSteps('case-art');

  // Open from the front, then move away: the Case should close and the next one stay at rest.
  await page.keyboard.press(' ');
  await sleep(1500);
  const open = await frameTimes(page, async () => {
    await sleep(1000);
  });
  console.log('Disc out and turning, one second:', JSON.stringify(open));
  console.log('Disc turning, drawn:', JSON.stringify(await drawing(page, 2000)));
  await page.keyboard.press('ArrowRight');
  await shot('case-reset-after-move');
  console.log('after moving on, hints:', await hints());

  const flipping = await frameTimes(page, async () => {
    await page.keyboard.press('f');
    await sleep(700);
    await page.keyboard.press(' ');
    await sleep(1500);
    await page.keyboard.press('Escape');
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(800);
  });
  console.log('flip, open and back again:', JSON.stringify(flipping));
  const settled = await frameTimes(page, () => sleep(1000));
  console.log('settled second after that:', JSON.stringify(settled));
  console.log('at rest, drawn:', JSON.stringify(await drawing(page, 1000)));
  await page.screenshot({ path: path.join(outDir, 'sharp-cover.png'), clip: await coverClip(page) });

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await shot('shelf-moved');
  // Halfway through a move, which has to be as sharp as at rest.
  await page.keyboard.press('ArrowRight');
  await sleep(110);
  await page.screenshot({ path: path.join(outDir, 'shelf-mid-move.png') });

  // Down to the PS2 Shelf and scroll it the way a held direction does.
  await goTo('PS2');
  await shot('shelf-ps2');
  const held = await frameTimes(page, async () => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(120);
    }
  });
  console.log('PS2, 30 steps one every 120 ms:', JSON.stringify(held));
  const fast = await frameTimes(page, async () => {
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
    await sleep(800);
  });
  console.log('PS2, 30 steps back as fast as keys arrive:', JSON.stringify(fast));
  const idle = await frameTimes(page, () => sleep(1000));
  console.log('idle second:', JSON.stringify(idle));
  const counts = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6));
  console.log('JS heap MB:', counts, 'title now:', await title());
  await shot('shelf-ps2-far');
  await caseSteps('case-plain');
  await page.screenshot({ path: path.join(outDir, 'sharp-plain.png'), clip: await coverClip(page) });

  // Flip and open 20 Cases in a row; the generated Backs and Discs must not pile up.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('f');
    await sleep(60);
    await page.keyboard.press(' ');
    await sleep(60);
    await page.keyboard.press('ArrowRight');
  }
  await sleep(1500);
  const after = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6));
  console.log('JS heap MB after opening 20 Cases:', after);

  for (const name of ['SNES', 'Game Boy Advance', 'NES', 'PS1', 'Switch', 'Steam'].filter((n) => shelfNames.includes(n))) {
    await goTo(name);
    await page.keyboard.press('ArrowRight');
    await shot(`shelf-${name.toLowerCase().replace(/\s+/g, '-')}`);
  }

  // A simulated pad: RB moves to the next Shelf, the D-pad moves along it.
  await page.evaluate(() => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
  });
  const press = async (button) => {
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = true; }, button);
    await sleep(80);
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = false; }, button);
    await sleep(80);
  };
  const before = await page.textContent('#shelves .current');
  await press(4);
  await press(15);
  await press(15);
  console.log('pad: LB moved from', before, 'to', await page.textContent('#shelves .current'), '/', await title());
  await shot('shelf-pad');

  // Play the Switch 2 stub: Tink should hide, then come back when it exits.
  await goTo('Switch 2');
  await page.keyboard.press('Enter');
  await sleep(500);
  const hidden = !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocusable())));
  await sleep(2500);
  const back = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocusable()));
  console.log('play: hidden while running', hidden, '/ back after exit', back);
  await shot('shelf-after-play');

  await profileSteps();

  console.log('errors:', errors.length ? errors : 'none');
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}

// The selected Case's spot on screen, for a close-up of its Cover.
async function coverClip(page) {
  const box = await page.$eval('#shelf', (el) => el.getBoundingClientRect().toJSON());
  const width = box.height * 0.3;
  return { x: box.x + (box.width - width) / 2, y: box.y + box.height * 0.3, width, height: box.height * 0.4 };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
