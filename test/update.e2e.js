// Proves self-update with two real portable builds: the older one finds the newer one on a fake local release
// server, downloads it, swaps it in on the next start, and keeps the data folder.
// Usage: node test/update.e2e.js <old Tink.exe> <new Tink.exe> <old version> <new version>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const [oldBuild, newBuild, oldVersion, newVersion] = process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what, check, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function killTink(dir) {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${dir}\\*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  } catch {
    // nothing left to kill
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-update-e2e-'));
  const app = path.join(root, 'app');
  const data = path.join(app, 'data');
  fs.mkdirSync(path.join(data, 'covers'), { recursive: true });
  fs.copyFileSync(oldBuild, path.join(app, 'Tink.exe'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ consoles: {}, setupDone: true }));
  fs.writeFileSync(path.join(data, 'covers', 'keep.txt'), 'cover');
  const settingsBefore = fs.readFileSync(path.join(data, 'settings.json'), 'utf8');

  const payload = fs.readFileSync(newBuild);
  const server = http.createServer((req, res) => {
    if (req.url === '/latest') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        tag_name: `v${newVersion}`,
        assets: [{ name: 'Tink.exe', size: payload.length, browser_download_url: `http://127.0.0.1:${server.address().port}/Tink.exe` }],
      }));
    } else if (req.url === '/Tink.exe') {
      res.end(payload);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, TINK_UPDATE_URL: `http://127.0.0.1:${server.address().port}/latest` };
  const exe = path.join(app, 'Tink.exe');
  const logText = () => fs.readFileSync(path.join(data, 'tink.log'), 'utf8');

  try {
    spawn(exe, [], { env, stdio: 'ignore', detached: true }).unref();
    await until('the download', () => fs.existsSync(`${exe}.new`));
    await sleep(1000);
    console.log(`downloaded Tink.exe.new while ${oldVersion} was running`);
    killTink(app);
    await sleep(2000);

    // Starts Tink with a debugging port, waits for the update question, and answers it with a key.
    const answer = async (key, label) => {
      spawn(exe, ['--remote-debugging-port=9333'], { env, stdio: 'ignore', detached: true }).unref();
      let browser;
      for (let i = 0; i < 120 && !browser; i++) {
        try {
          browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
        } catch {
          await sleep(1000);
        }
      }
      const page = browser.contexts()[0].pages()[0];
      await page.waitForSelector('.dialog', { timeout: 90000 });
      const text = (await page.innerText('.dialog')).replace(/\s+/g, ' ');
      assert.ok(text.includes(`Update available (${newVersion}).`) && text.includes('Not now'), text);
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
      await page.keyboard.press(key).catch(() => {});
      console.log(`asked "${text}" and answered ${label}`);
      await browser.close().catch(() => {});
    };

    await answer('Escape', 'Not now');
    await sleep(2000);
    assert.ok(fs.existsSync(`${exe}.new`) && fs.readFileSync(exe).equals(fs.readFileSync(oldBuild)), 'Not now changes nothing');
    killTink(app);
    await sleep(2000);
    await answer('Enter', 'Update');
    await until('the swap', () => fs.existsSync(path.join(data, 'tink.log')) && logText().includes(`Updated to ${newVersion}`));
    await until('the old exe to be deleted', () => !fs.existsSync(`${exe}.old`) && !fs.existsSync(`${exe}.new`), 30000);
    assert.ok(fs.readFileSync(exe).equals(payload), 'Tink.exe is now the new build');
    assert.strictEqual(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'), settingsBefore);
    assert.strictEqual(fs.readFileSync(path.join(data, 'covers', 'keep.txt'), 'utf8'), 'cover');
    console.log(`swapped to ${newVersion}, relaunched, old exe deleted, data kept`);
    console.log(logText().trim());
  } catch (error) {
    console.log(fs.existsSync(path.join(data, 'tink.log')) ? logText() : 'no log', fs.readdirSync(app));
    throw error;
  } finally {
    killTink(app);
    server.close();
    await sleep(1500);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
