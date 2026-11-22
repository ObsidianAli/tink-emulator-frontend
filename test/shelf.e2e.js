// Runs Tink in Electron with a made-up library of about 1,000 Games, drives the Shelf with the keyboard and a
// simulated pad, measures frame times while scrolling and saves screenshots.
// Usage: node test/shelf.e2e.js [screenshot folder]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
