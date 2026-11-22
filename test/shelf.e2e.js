// Runs Tink in Electron with a made-up library of about 1,000 Games, drives the Shelf with the keyboard and a
// simulated pad, measures frame times while scrolling and while a Case flips and opens, and saves screenshots.
// Usage: node test/shelf.e2e.js [screenshot folder]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'e2e'));
const WORDS = ['Star', 'Moon', 'Pixel', 'Deep', 'Castle', 'Sky', 'Quiet', 'Neon', 'Iron', 'Lost', 'Wild', 'Paper',
  'Garden', 'Knights', 'Racer', 'Forge', 'Woods', 'Drift', 'Coast', 'Tower', 'Harbor', 'Planet', 'River', 'Storm'];

// Folders of empty game files: a 1,000-Game PS2 Shelf and a few small ones for the other Case shapes.
function makeLibrary(root) {
  const counts = { ps2: 1000, gamecube: 24, snes: 24, gba: 16, switch: 12, ps1: 12, nes: 12 };
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

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-e2e-'));
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(makeLibrary(path.join(root, 'games'))));
  seedCovers(userData, path.join(root, 'games'));

  const app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`] });
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
  await page.screenshot({ path: path.join(outDir, 'sharp-cover.png'), clip: await coverClip(page) });

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await shot('shelf-moved');

  // Down to the PS2 Shelf (1,000 Games) and scroll it the way a held direction does.
  await goTo('PS2');
  await shot('shelf-ps2');
  const held = await frameTimes(page, async () => {
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(120);
    }
  });
  console.log('PS2, 120 steps one every 120 ms:', JSON.stringify(held));
  const fast = await frameTimes(page, async () => {
    for (let i = 0; i < 200; i++) await page.keyboard.press('ArrowRight');
    await sleep(800);
  });
  console.log('PS2, 200 steps as fast as keys arrive:', JSON.stringify(fast));
  const idle = await frameTimes(page, () => sleep(1000));
  console.log('idle second:', JSON.stringify(idle));
  const counts = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6));
  console.log('JS heap MB:', counts, 'title now:', await title());
  await shot('shelf-ps2-far');
  await caseSteps('case-plain');
  await page.screenshot({ path: path.join(outDir, 'sharp-plain.png'), clip: await coverClip(page) });

  // Flip and open 40 Cases in a row; the generated Backs and Discs must not pile up.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('f');
    await sleep(60);
    await page.keyboard.press(' ');
    await sleep(60);
    await page.keyboard.press('ArrowRight');
  }
  await sleep(1500);
  const after = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6));
  console.log('JS heap MB after opening 40 Cases:', after);

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
