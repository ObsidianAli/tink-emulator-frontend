const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readVdfFile, listedFolders, gameProcesses } = require('./steam');
const { parseAppInfo } = require('./steambin');
const { child, autoLogin } = require('./owned');
const { isAppId, manifestFile, findManifest, isDownloading } = require('./install');

const POLL_MS = 500;
const CLOSE_WAIT_MS = 30 * 1000;
const PICKUP_WAIT_MS = 3 * 60 * 1000;
const GB = 1024 ** 3;
const INSTALLED = 4;
// Steam downloads what is flagged as a started update.
const UPDATE_REQUIRED_AND_STARTED = 2 | 1024;
const MAX_NAME = 120;
const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f]|^\s|[\s.]$/;
const DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[\d¹²³])\s*(\.|$)/i;

const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const GENERAL = "Steam couldn't start this download.";
const MESSAGES = {
  'Steam would ask who is signing in': 'Steam needs to sign in on its own first.',
  'a download is active': 'Wait for the current download to finish.',
  'an install is running': 'Wait for the current download to finish.',
  'a game is running': 'Close the game first.',
  'a Steam game is running': 'Close the game first.',
  'not enough space': 'Not enough space on that drive.',
};
const explain = (error) => MESSAGES[error && error.message] || GENERAL;

const check = (ok, reason) => {
  if (!ok) throw new Error(reason);
};

function stat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}
const isFile = (file) => Boolean(stat(file)?.isFile());
const isDir = (dir) => Boolean(stat(dir)?.isDirectory());

function isSafeFolderName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME && !UNSAFE_NAME.test(name) && !DEVICE_NAME.test(name);
}

function libraries(steamDir) {
  const seen = new Set();
  return listedFolders(steamDir).filter((folder) => {
    const key = path.resolve(folder).toLowerCase();
    if (!path.isAbsolute(folder) || seen.has(key) || !isDir(path.join(folder, 'steamapps'))) return false;
    seen.add(key);
    return true;
  });
}

// Counts only what every install on Windows needs, so it can be too small but never too big.
function smallestSize(depots) {
  let total = 0;
  for (const [id, depot] of Object.entries(depots || {})) {
    if (!/^\d+$/.test(id) || !depot || typeof depot !== 'object') continue;
    if (depot.dlcappid || depot.optional || depot.sharedinstall) continue;
    const { oslist, osarch, ...special } = depot.config || {};
    if (Object.keys(special).length || (oslist && !String(oslist).split(',').includes('windows')) || (osarch && String(osarch) !== '64')) continue;
    total += Number(depot.manifests?.public?.size) || 0;
  }
  return total;
}

function gameDetails(app) {
  const common = child(app, 'common');
  const name = String(child(common, 'name') || '').trim();
  const installdir = child(child(app, 'config'), 'installdir');
  check(name && !/[\u0000-\u001f]/.test(name), 'no name');
  check(isSafeFolderName(installdir), 'no install folder');
  check(String(child(common, 'oslist') || 'windows').split(',').includes('windows'), 'not for Windows');
  check(/^(released)?$/i.test(child(common, 'releasestate') || ''), 'not released');
  return { name, installdir, size: smallestSize(child(app, 'depots')) };
}

async function readGame(steamDir, appId) {
  const buffer = await fs.promises.readFile(path.join(steamDir, 'appcache', 'appinfo.vdf'));
  const app = parseAppInfo(buffer, (id) => id === Number(appId)).get(Number(appId));
  check(app, 'unknown to Steam');
  return gameDetails(app);
}

const quote = (value) => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;

function manifestText({ appId, name, installdir, owner }) {
  const fields = {
    appid: appId,
    universe: 1,
    name,
    StateFlags: UPDATE_REQUIRED_AND_STARTED,
    installdir,
    LastUpdated: 0,
    LastPlayed: 0,
    SizeOnDisk: 0,
    StagingSize: 0,
    buildid: 0,
    LastOwner: owner,
    UpdateResult: 0,
    BytesToDownload: 0,
    BytesDownloaded: 0,
    BytesToStage: 0,
    BytesStaged: 0,
    TargetBuildID: 0,
    AutoUpdateBehavior: 0,
    AllowOtherDownloadsWhileRunning: 0,
    ScheduledAutoUpdate: 0,
  };
  return [
    '"AppState"',
    '{',
    ...Object.entries(fields).map(([key, value]) => `\t"${key}"\t\t${quote(value)}`),
    ...['InstalledDepots', 'UserConfig', 'MountedConfig'].flatMap((key) => [`\t"${key}"`, '\t{', '\t}']),
    '}',
    '',
  ].join('\n');
}

function writeManifest(library, appId, text) {
  const file = manifestFile(library, appId);
  const temp = path.join(path.dirname(file), `tink_${appId}.tmp`);
  try {
    fs.writeFileSync(temp, text);
    check(!fs.existsSync(file), 'already in this library');
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return { file, text };
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

function removeIfOurs({ file, text }) {
  if (readText(file) === text) fs.rmSync(file, { force: true });
}

// Steam fills these in once it has looked the game up and begun the download.
function isPickedUp({ file, text }) {
  if (readText(file) === text) return false;
  const state = (readVdfFile(file) || {}).AppState || {};
  return Number(state.BytesToDownload) > 0 || Number(state.TargetBuildID) > 0 || (Number(state.StateFlags) & INSTALLED) !== 0;
}

const driveName = (folder) => path.parse(folder).root.replace(/[\\/]+$/, '').toUpperCase();

function driveLabel(folder, folders, free) {
  const shared = folders.filter((other) => driveName(other) === driveName(folder)).length > 1;
  const name = shared ? folder : driveName(folder);
  return free === null ? name : `${name} ${Math.floor(free / GB)} GB free`;
}

const fits = (free, size) => free === null || free >= size;

const diskFree = (folder) => fs.promises.statfs(folder).then(({ bavail, bsize }) => bavail * bsize, () => null);

function start(exe, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    proc.once('error', reject);
    proc.once('spawn', () => {
      proc.unref();
      resolve();
    });
  });
}

const steamIn = (rows) => rows.some(({ exe }) => exe && path.basename(exe).toLowerCase() === 'steam.exe');

function createSteamInstall({ findSteamDir, processes, runningAppId, run = start, freeSpace = diskFree, inGame = () => false, clock = realClock, log = () => {} }) {
  let last = Promise.resolve();
  let unfinished = 0;
  let restarted = Promise.resolve();

  async function until(done, ms) {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      await clock.sleep(POLL_MS);
      if (await done()) return true;
    }
    return false;
  }

  async function steamRunning() {
    const rows = await processes();
    check(rows && rows.length, 'no process list');
    return steamIn(rows) ? rows : null;
  }

  // Steam may only be closed while nothing in it would be interrupted.
  async function checkIdle(folders) {
    check(!inGame(), 'a game is running');
    const rows = await steamRunning();
    if (!rows) return false;
    check((await runningAppId()) === 0, 'a Steam game is running');
    check(!folders.some((folder) => gameProcesses(rows, path.join(folder, 'steamapps', 'common')).length), 'a Steam game is running');
    check(!folders.some(isDownloading), 'a download is active');
    return true;
  }

  async function prepare(steamDir, appId) {
    check(isAppId(appId) && steamDir, 'no Steam');
    const exe = path.join(steamDir, 'steam.exe');
    const folders = libraries(steamDir);
    const owner = autoLogin(steamDir);
    check(isFile(exe), 'no steam.exe');
    check(folders.length, 'no library folders');
    check(owner, 'Steam would ask who is signing in');
    check(!findManifest(steamDir, appId), 'already in a library');
    const game = await readGame(steamDir, appId);
    return { ...game, appId, exe, folders, owner, steamOpen: await checkIdle(folders) };
  }

  async function closeSteam(exe) {
    await run(exe, ['-shutdown']);
    check(await until(async () => !(await steamRunning()), CLOSE_WAIT_MS), 'Steam did not close');
  }

  async function place(steamDir, appId, library) {
    const job = await prepare(steamDir, appId);
    check(job.folders.includes(library), 'unknown library');
    check(fits(await freeSpace(library), job.size), 'not enough space');
    if (job.steamOpen) await closeSteam(job.exe);
    // Steam saves its files as it closes.
    check(!findManifest(steamDir, appId) && libraries(steamDir).includes(library), 'the libraries changed');
    const manifest = writeManifest(library, appId, manifestText(job));
    try {
      await run(job.exe, ['-silent']);
    } catch (error) {
      removeIfOurs(manifest);
      throw error;
    }
    return manifest;
  }

  async function placeAndWait(steamDir, appId, library) {
    const placing = place(steamDir, appId, library);
    restarted = placing.then(() => {}, () => {});
    const manifest = await placing;
    if (await until(() => isPickedUp(manifest), PICKUP_WAIT_MS)) return;
    removeIfOurs(manifest);
    throw new Error('Steam did not start the download');
  }

  async function installOne(id, library) {
    const appId = String(Number(id));
    try {
      check(library, 'no library');
      await placeAndWait(await findSteamDir(), appId, library);
      return true;
    } catch (error) {
      log(`Could not install ${appId}: ${error.message}`);
      return explain(error);
    }
  }

  function install(id, library) {
    if (!isAppId(id)) return Promise.resolve(GENERAL);
    unfinished++;
    const job = last.then(() => installOne(id, library)).finally(() => { unfinished--; });
    last = job.catch(() => {});
    return job;
  }

  async function drives(id) {
    if (unfinished) return explain(new Error('an install is running'));
    if (!isAppId(id)) return GENERAL;
    try {
      const { folders, size } = await prepare(await findSteamDir(), String(Number(id)));
      return await Promise.all(folders.map(async (folder) => {
        const free = await freeSpace(folder);
        return { id: folder, label: driveLabel(folder, folders, free), fits: fits(free, size) };
      }));
    } catch (error) {
      log(`No choice of drive for ${id}: ${error.message}`);
      return explain(error);
    }
  }

  async function warm() {
    const steamDir = await findSteamDir();
    const exe = steamDir && path.join(steamDir, 'steam.exe');
    if (!exe || !isFile(exe)) return;
    const rows = await processes();
    if (!rows || !rows.length || steamIn(rows)) return;
    await run(exe, ['-silent']);
  }

  return { drives, install, warm, settled: () => restarted };
}

module.exports = { createSteamInstall, isSafeFolderName, smallestSize, manifestText };
