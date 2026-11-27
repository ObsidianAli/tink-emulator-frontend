const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { _electron: electron } = require('playwright');
const { pcGames } = require('./pcseed');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'album'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GAMES = ['Hades', 'Celeste', 'Hollow Knight', 'Wind Waker', 'Stardew Valley'];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-album-e2e-'));
  const data = path.join(root, 'data');
  const empty = path.join(root, 'empty');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ pcGames: pcGames(root, ['Wind Waker']), setupDone: true }));

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${path.join(root, 'user')}`],
    env: { ...process.env, TINK_DATA_DIR: data, PORTABLE_EXECUTABLE_DIR: path.join(root, 'tink'), ProgramFiles: empty, 'ProgramFiles(x86)': empty, LOCALAPPDATA: empty, APPDATA: empty },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pics = await page.evaluate(() => {
    const pic = (i, w, h) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      const fill = g.createLinearGradient(0, 0, w, h);
      fill.addColorStop(0, `hsl(${i * 40} 60% 50%)`);
      fill.addColorStop(1, `hsl(${i * 40 + 60} 50% 18%)`);
      g.fillStyle = fill;
      g.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/jpeg');
    };
    return Array.from({ length: 9 }, (_, i) => ({ thumb: pic(i, 320, 180), shot: pic(i, 1280, 720) }));
  });
  await app.evaluate(({ ipcMain }, { now, GAMES, pics }) => {
    let shots = pics.map((_, i) => ({ id: 's' + i, title: i === 8 ? null : GAMES[i % GAMES.length], takenAt: now - i * 5 * 3600000 }));
    const stubs = {
      getAlbum: () => shots,
      getThumb: (id) => pics[Number(id.slice(1))].thumb,
      getShot: (id) => pics[Number(id.slice(1))].shot,
      deleteShot: (id) => {
        shots = shots.filter((shot) => shot.id !== id);
        return true;
      },
    };
    for (const [name, run] of Object.entries(stubs)) {
      ipcMain.removeHandler(name);
      ipcMain.handle(name, (event, id) => run(id));
    }
  }, { now: Date.now(), GAMES, pics });
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(350);
  };
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.className);

  try {
    await page.waitForSelector('#title:not(:empty)');
    await sleep(1500);
    await key('ArrowDown');
    for (let i = 0; i < 4 && (await focused()) !== 'Album'; i++) await key('ArrowRight');
    assert.strictEqual(await focused(), 'Album');
    await key('Enter');
    await sleep(600);
    assert.strictEqual(await page.textContent('#album h1'), 'Album');
    assert.strictEqual(await page.$$eval('.album-shot', (n) => n.length), 9);
    assert.strictEqual(await hints(), 'AView XDelete BBack');
    await key('ArrowRight');
    await key('ArrowDown');
    assert.ok((await page.textContent('.album-caption')).includes('Stardew Valley'));
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, '1-grid.png') });
    await key('Enter');
    await sleep(600);
    assert.ok(await page.$('.album-viewer.open img'), 'viewer shows a shot');
    assert.strictEqual(await hints(), 'XDelete BBack');
    await key('ArrowRight');
    await sleep(500);
    assert.ok((await page.textContent('.album-viewer-caption')).includes('Hades'));
    await page.screenshot({ path: path.join(outDir, '2-viewer.png') });
    await key('Escape');
    assert.ok(!(await page.$('.album-viewer')), 'viewer closes');
    assert.ok((await page.textContent('.album-caption')).includes('Hades'), 'grid follows the viewer');
    await key('Space');
    await page.waitForSelector('.dialog-scrim');
    assert.ok((await page.textContent('.dialog')).includes('Delete this screenshot?'));
    await key('Enter');
    await sleep(400);
    assert.strictEqual(await page.$$eval('.album-shot', (n) => n.length), 8);
    await key('Escape');
    await sleep(600);
    assert.ok(!(await page.$('#album:not([hidden])')), 'Album closes');
    assert.deepStrictEqual(errors, []);
    console.log('ok');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
