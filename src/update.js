// Self-update for the portable exe. It checks GitHub's latest release, downloads the new Tink.exe beside the
// running one as Tink.exe.new, and swaps it in the next time Tink starts. Nothing here touches the data folder.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

const LATEST_URL = 'https://api.github.com/repos/ObsidianAli/tink-emulator-frontend/releases/latest';
const JSON_TIMEOUT_MS = 15 * 1000;
const IDLE_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_LIMIT_MS = 15 * 60 * 1000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 1024 * 1024;
const SWAP_RETRY_MS = 500;
const SWAP_TRIES = 60;
const FINISH_FLAG = '--finish-update';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

// Positive when a is newer than b, negative when older, 0 when equal. Null when either isn't a plain x.y.z.
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

// Opens a response, following redirects that stay on allowed hosts. Resolves only for a 200.
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
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(2);
    return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === 'MZ';
  } finally {
    fs.closeSync(fd);
  }
}

const remove = (file) => fs.rmSync(file, { force: true });

// exe is the real path of Tink.exe, even while running as Tink.exe.new. The injected pieces let tests fake the network and the relaunch.
function createUpdater({
  exe,
  dataDir,
  version,
  log,
  releaseUrl = LATEST_URL,
  loopback = false,
  getJson = fetchJson,
  getFile = download,
  launch = spawn,
  pause: wait = pause,
}) {
  const fresh = `${exe}.new`;
  const old = `${exe}.old`;
  const partial = `${exe}.download`;
  const pendingFile = path.join(dataDir, 'update-pending.txt');
  const doneFile = path.join(dataDir, 'update-done.txt');
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  };

  async function check() {
    const release = await getJson(releaseUrl, { loopback });
    const latest = release && release.tag_name;
    const newer = compareVersions(latest, version);
    if (newer === null) return log(`Update check: can't read the version "${latest}"`);
    if (newer <= 0) return;
    const waiting = read(pendingFile);
    if (waiting && fs.existsSync(fresh) && compareVersions(waiting, latest) >= 0) return;
    const asset = (release.assets || []).find((item) => item && item.name === 'Tink.exe');
    if (!asset || !Number.isInteger(asset.size) || asset.size <= 0 || !allowedUrl(asset.browser_download_url, loopback)) {
      return log(`Update check: ${latest} has no usable Tink.exe`);
    }
    try {
      await getFile(asset.browser_download_url, partial, { loopback, size: asset.size });
      if (fs.statSync(partial).size !== asset.size) throw new Error('Download is the wrong size');
      if (!startsWithMZ(partial)) throw new Error('Download is not a program');
      fs.writeFileSync(pendingFile, latest.replace(/^v/, ''));
      fs.renameSync(partial, fresh);
      log(`Update check: ${latest} is downloaded`);
    } catch (error) {
      remove(partial);
      throw error;
    }
  }

  // Never throws and never blocks play: a failed check is just a line in the log.
  async function checkInBackground() {
    try {
      await check();
    } catch (error) {
      log('Update check failed', error);
    }
  }

  const isNewer = (next) => compareVersions(next, version) > 0;

  function start(file, args) {
    return new Promise((resolve, reject) => {
      const child = launch(file, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  // The version of a downloaded update that is waiting to be installed, or null.
  function pendingVersion() {
    const next = read(pendingFile);
    return fs.existsSync(fresh) && isNewer(next) ? next : null;
  }

  // Windows won't let a running portable exe be renamed or replaced, so the downloaded exe does the swap itself:
  // this starts it with --finish-update and the old process quits. True means this process should quit now.
  async function applyPending() {
    if (!fs.existsSync(fresh)) return false;
    if (!isNewer(read(pendingFile)) || !startsWithMZ(fresh)) return false;
    try {
      await start(fresh, [FINISH_FLAG]);
      return true;
    } catch (error) {
      log('Update: could not start the downloaded version', error);
      return false;
    }
  }

  // Runs in the downloaded exe (started as Tink.exe.new) once the old one has quit and let go of Tink.exe.
  // True means the new Tink.exe is running and this process should quit; false means it carries on as it is.
  async function finishUpdate() {
    const next = read(pendingFile);
    let moved = false;
    try {
      for (let tries = 0; ; tries++) {
        try {
          remove(old);
          fs.renameSync(exe, old);
          moved = true;
          break;
        } catch (error) {
          if (tries >= SWAP_TRIES) throw error;
          await wait(SWAP_RETRY_MS);
        }
      }
      fs.copyFileSync(fresh, partial);
      if (fs.statSync(partial).size !== fs.statSync(fresh).size || !startsWithMZ(partial)) throw new Error('Copy is damaged');
      fs.renameSync(partial, exe);
      fs.writeFileSync(doneFile, next || version);
      await start(exe, []);
    } catch (error) {
      log('Update: could not finish, going back', error);
      remove(doneFile);
      remove(partial);
      if (moved) {
        try {
          remove(exe);
          fs.renameSync(old, exe);
        } catch (undoError) {
          log('Update: could not roll back', undoError);
        }
      }
      return false;
    }
    log(`Updated to ${version}`);
    return true;
  }

  // What is left from an update: the old exe, and a downloaded one that is no longer needed.
  // The other process may still be shutting down for a moment, so deleting is retried.
  function removeOld(tries = SWAP_TRIES) {
    const keep = isNewer(read(pendingFile));
    const stale = [old, ...(keep ? [] : [fresh])].filter((file) => fs.existsSync(file));
    if (stale.length === 0) return keep ? undefined : remove(pendingFile);
    try {
      stale.forEach(remove);
      if (!keep) remove(pendingFile);
    } catch (error) {
      if (tries <= 1) return log('Update: could not delete the leftovers', error);
      setTimeout(() => removeOld(tries - 1), SWAP_RETRY_MS).unref();
    }
  }

  // "Updated to 0.2.0" once, right after an update, otherwise null.
  function takeNotice() {
    const done = read(doneFile);
    if (done === null) return null;
    remove(doneFile);
    return compareVersions(done, version) === 0 ? `Updated to ${version}` : null;
  }

  return { checkInBackground, pendingVersion, applyPending, finishUpdate, removeOld, takeNotice };
}

module.exports = { compareVersions, allowedUrl, createUpdater, FINISH_FLAG, LATEST_URL };
