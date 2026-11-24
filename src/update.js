const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn, execFile } = require('node:child_process');

const LATEST_URL = 'https://api.github.com/repos/ObsidianAli/tink-emulator-frontend/releases/latest';
const JSON_TIMEOUT_MS = 15 * 1000;
const IDLE_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_LIMIT_MS = 15 * 60 * 1000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 1024 * 1024;
const SWAP_RETRY_MS = 500;
const SWAP_TRIES = 60;
const FINISH_FLAG = '--finish-update';
const ASSET_NAME = 'Tink.zip';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

// Only GitHub over https. A local release server over plain http is allowed when the test override is in use.
function allowedUrl(text, loopback) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (loopback) return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:') return false;
  return ['api.github.com', 'github.com'].includes(url.hostname) || url.hostname.endsWith('.githubusercontent.com');
}

function open(url, { loopback, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const go = (target, left) => {
      if (!allowedUrl(target, loopback)) return reject(new Error(`Refused ${new URL(target).host}`));
      const client = target.startsWith('https:') ? https : http;
      const request = client.get(target, { headers: { 'User-Agent': 'Tink', Accept: 'application/json, application/octet-stream' } }, (response) => {
        const status = response.statusCode;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (left === 0) return reject(new Error('Too many redirects'));
          return go(new URL(response.headers.location, target).href, left - 1);
        }
        if (status !== 200) {
          response.resume();
          return reject(new Error(`GitHub answered ${status}`));
        }
        resolve(response);
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error('Timed out')));
      request.on('error', reject);
    };
    go(url, MAX_REDIRECTS);
  });
}

async function fetchJson(url, { loopback }) {
  const response = await open(url, { loopback, timeoutMs: JSON_TIMEOUT_MS });
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) throw new Error('Answer too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function download(url, file, { loopback, size }) {
  const response = await open(url, { loopback, timeoutMs: IDLE_TIMEOUT_MS });
  const timer = setTimeout(() => response.destroy(new Error('Download took too long')), DOWNLOAD_LIMIT_MS);
  let total = 0;
  const count = new Transform({
    transform(chunk, _encoding, done) {
      total += chunk.length;
      done(total > size ? new Error('Download is bigger than listed') : null, chunk);
    },
  });
  try {
    await pipeline(response, count, fs.createWriteStream(file));
  } finally {
    clearTimeout(timer);
  }
}

function startsWithMZ(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(2);
      return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === 'MZ';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

// Antivirus often holds freshly written files for a moment, so removing is retried.
const remove = (file) => fs.rmSync(file, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

// Windows 10 and later ship tar.exe, which reads zips. The full path avoids picking up another tar from PATH.
function unzip(zip, dest) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  fs.mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', zip, '-C', dest, '--strip-components=1'], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
  });
}

function createUpdater({
  appDir,
  dataDir,
  version,
  log,
  releaseUrl = LATEST_URL,
  loopback = false,
  getJson = fetchJson,
  getFile = download,
  extract = unzip,
  launch = spawn,
  pause: wait = pause,
}) {
  const staging = `${appDir}.new`;
  const old = `${appDir}.old`;
  const zip = `${appDir}.zip`;
  const pendingFile = path.join(dataDir, 'update-pending.txt');
  const doneFile = path.join(dataDir, 'update-done.txt');
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  };

  const looksRight = (folder) => startsWithMZ(path.join(folder, 'Tink.exe')) && fs.existsSync(path.join(folder, 'resources', 'app.asar'));

  async function check() {
    const release = await getJson(releaseUrl, { loopback });
    const latest = release && release.tag_name;
    const newer = compareVersions(latest, version);
    if (newer === null) return log(`Update check: can't read the version "${latest}"`);
    if (newer <= 0) return;
    const waiting = read(pendingFile);
    if (waiting && fs.existsSync(staging) && compareVersions(waiting, latest) >= 0) return;
    const asset = (release.assets || []).find((item) => item && item.name === ASSET_NAME);
    if (!asset || !Number.isInteger(asset.size) || asset.size <= 0 || !allowedUrl(asset.browser_download_url, loopback)) {
      return log(`Update check: ${latest} has no usable ${ASSET_NAME}`);
    }
    try {
      await getFile(asset.browser_download_url, zip, { loopback, size: asset.size });
      if (fs.statSync(zip).size !== asset.size) throw new Error('Download is the wrong size');
      remove(staging);
      await extract(zip, staging);
      if (!looksRight(staging)) throw new Error('Download is not a Tink folder');
      fs.writeFileSync(pendingFile, latest.replace(/^v/, ''));
      log(`Update check: ${latest} is downloaded`);
    } catch (error) {
      remove(staging);
      throw error;
    } finally {
      remove(zip);
    }
  }

  async function checkInBackground() {
    try {
      await check();
    } catch (error) {
      log('Update check failed', error);
    }
  }

  async function checkNow() {
    await check();
    return pendingVersion();
  }

  const isNewer = (next) => compareVersions(next, version) > 0;

  function start(file, args, cwd) {
    return new Promise((resolve, reject) => {
      const child = launch(file, args, { detached: true, stdio: 'ignore', cwd });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  function pendingVersion() {
    const next = read(pendingFile);
    return fs.existsSync(staging) && isNewer(next) ? next : null;
  }

  // Windows won't let a running app's folder be replaced, so the staged copy does the swap (--finish-update) and the old process quits.
  async function applyPending() {
    if (!fs.existsSync(staging) || !isNewer(read(pendingFile)) || !looksRight(staging)) return false;
    try {
      await start(path.join(staging, 'Tink.exe'), [FINISH_FLAG], staging);
      return true;
    } catch (error) {
      log('Update: could not start the downloaded version', error);
      return false;
    }
  }

  function putBack(movedData) {
    try {
      if (movedData) fs.renameSync(path.join(appDir, 'data'), path.join(old, 'data'));
      remove(appDir);
      fs.renameSync(old, appDir);
    } catch (error) {
      log('Update: could not roll back', error);
    }
  }

  async function finishUpdate() {
    const next = read(pendingFile);
    let moved = false;
    let movedData = false;
    try {
      for (let tries = 0; ; tries++) {
        try {
          remove(old);
          fs.renameSync(appDir, old);
          moved = true;
          break;
        } catch (error) {
          if (tries >= SWAP_TRIES) throw error;
          await wait(SWAP_RETRY_MS);
        }
      }
      fs.cpSync(staging, appDir, { recursive: true });
      if (!looksRight(appDir)) throw new Error('Copy is damaged');
      remove(path.join(appDir, 'data'));
      if (fs.existsSync(path.join(old, 'data'))) {
        fs.renameSync(path.join(old, 'data'), path.join(appDir, 'data'));
        movedData = true;
      }
      fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'data', 'update-done.txt'), next || version);
      await start(path.join(appDir, 'Tink.exe'), [], appDir);
    } catch (error) {
      log('Update: could not finish, going back', error);
      if (moved) {
        if (movedData) remove(path.join(appDir, 'data', 'update-done.txt'));
        putBack(movedData);
      }
      return false;
    }
    log(`Updated to ${version}`);
    return true;
  }

  // The other process may still be shutting down, so deleting is retried.
  function removeOld(tries = SWAP_TRIES) {
    const keep = isNewer(read(pendingFile));
    const stale = [old, zip, ...(keep ? [] : [staging])].filter((file) => fs.existsSync(file));
    if (stale.length === 0) return keep ? undefined : remove(pendingFile);
    try {
      stale.forEach(remove);
      if (!keep) remove(pendingFile);
    } catch (error) {
      if (tries <= 1) return log('Update: could not delete the leftovers', error);
      setTimeout(() => removeOld(tries - 1), SWAP_RETRY_MS).unref();
    }
  }

  function takeNotice() {
    const done = read(doneFile);
    if (done === null) return null;
    remove(doneFile);
    return compareVersions(done, version) === 0 ? `Updated to ${version}` : null;
  }

  return { checkNow, checkInBackground, pendingVersion, applyPending, finishUpdate, removeOld, takeNotice };
}

module.exports = { compareVersions, allowedUrl, createUpdater, FINISH_FLAG, LATEST_URL };
