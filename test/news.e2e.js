const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { _electron: electron } = require('playwright');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'news'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TEXT = 'Home is now one row with your recent games and an All games button. Profiles live in Settings and the keyboard works with a controller.\n\nThere is more to read here so the page has something to scroll through when the story is long enough to need it.';

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-news-e2e-'));
  const data = path.join(root, 'data');
  const empty = path.join(root, 'empty');
  const games = path.join(root, 'games', 'GameCube');
  fs.mkdirSync(path.join(data, 'news'), { recursive: true });
  fs.mkdirSync(empty);
  fs.mkdirSync(games, { recursive: true });
  fs.writeFileSync(path.join(games, 'Wind Waker (USA).rvz'), '');
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ consoles: { gamecube: { folder: games } }, setupDone: true }));
  const now = Date.now();
  const items = ['0.8.0', '0.7.0', '0.6.1', '0.6.0', '0.5.0', '0.4.1', '0.4.0'].map((version, i) => ({
    id: `tink:${version}`, kind: 'tink', title: `Tink ${version}`, game: '', date: now - i * 3 * 86400000, text: TEXT, image: null,
  }));
  fs.writeFileSync(path.join(data, 'news', 'news.json'), JSON.stringify({ tink: { at: now, items }, games: {} }));
  fs.writeFileSync(path.join(data, 'news', 'news-seen.json'), JSON.stringify({ date: now - 86400000 }));

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${path.join(root, 'user')}`],
    env: { ...process.env, TINK_DATA_DIR: data, PORTABLE_EXECUTABLE_DIR: path.join(root, 'tink'), ProgramFiles: empty, 'ProgramFiles(x86)': empty, LOCALAPPDATA: empty, APPDATA: empty },
  });
  await app.evaluate(() => { globalThis.fetch = async () => { throw new Error('offline'); }; });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const key = async (name) => {
    await page.keyboard.press(name);
    await sleep(350);
  };
  const shot = async (name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  const hints = () => page.$$eval('#hints .hint', (els) => els.map((el) => el.textContent).join(' '));
  const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.innerText.replace(/\n+/g, ' | '));

  try {
    await page.waitForSelector('#title:not(:empty)');
    await sleep(1500);
    await page.waitForSelector('.tray-icon[data-icon="News"] .news-dot');
    await key('ArrowDown');
    for (let i = 0; i < 4 && (await focused()) !== 'News'; i++) await key('ArrowRight');
    assert.strictEqual(await focused(), 'News');
    await key('Enter');
    await sleep(500);
    assert.ok(await page.$('#news:not([hidden])'), 'News opens');
    assert.strictEqual(await page.textContent('#news h1'), 'News');
    assert.strictEqual(await page.$$eval('.news-item', (n) => n.length), 7);
    assert.strictEqual(await hints(), 'ARead BBack');
    await key('ArrowDown');
    await key('ArrowRight');
    assert.ok((await focused()).includes('Tink 0.6.1'), await focused());
    await shot('1-cards');
    await key('Enter');
    assert.ok(await page.$('.news-read'), 'story opens');
    assert.strictEqual(await hints(), 'BBack');
    await shot('2-story');
    await key('Escape');
    assert.ok(await page.$('.news-list'), 'back to the list');
    assert.ok((await focused()).includes('Tink 0.6.1'), 'focus kept');
    await key('Escape');
    await sleep(600);
    assert.ok(!(await page.$('#news:not([hidden])')), 'News closes');
    assert.ok(!(await page.$('.news-dot')), 'dot is gone once seen');
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
