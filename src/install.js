const fs = require('node:fs');
const path = require('node:path');
const { readVdfFile, libraryFolders } = require('./steam');

const INSTALLED = 4;
const UPDATE_RUNNING = 256 | 1024;
const FINISHING = 262144 | 524288 | 1048576 | 2097152;

const isAppId = (appId) => /^\d{1,10}$/.test(String(appId));

const manifestFile = (folder, appId) => path.join(folder, 'steamapps', `appmanifest_${appId}.acf`);

const findManifest = (steamDir, appId) => libraryFolders(steamDir).map((folder) => manifestFile(folder, appId)).find((file) => fs.existsSync(file));

function readDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDownloading(folder) {
  const dir = path.join(folder, 'steamapps');
  return readDir(dir).filter((file) => /^appmanifest_\d+\.acf$/.test(file)).some((file) => {
    const state = (readVdfFile(path.join(dir, file)) || {}).AppState;
    return Boolean(state && Number(state.StateFlags) & (UPDATE_RUNNING | FINISHING));
  });
}

const percentOf = (done, total) => (total > 0 ? Math.max(0, Math.min(100, Math.floor((done / total) * 100))) : 0);

function progress(appId, steamDir) {
  const none = { state: 'none', percent: 0 };
  if (!isAppId(appId) || !steamDir) return none;
  const file = findManifest(steamDir, Number(appId));
  const state = file && (readVdfFile(file) || {}).AppState;
  if (!state) return none;
  const flags = Number(state.StateFlags) || 0;
  const downloaded = Number(state.BytesDownloaded) || 0;
  const toDownload = Number(state.BytesToDownload) || 0;
  if (flags & INSTALLED && !(flags & (UPDATE_RUNNING | FINISHING))) return { state: 'done', percent: 100 };
  if (flags & FINISHING || (toDownload > 0 && downloaded >= toDownload)) {
    return { state: 'installing', percent: percentOf(Number(state.BytesStaged) || 0, Number(state.BytesToStage) || 0) || 100 };
  }
  if (flags & UPDATE_RUNNING && toDownload > 0) return { state: 'downloading', percent: percentOf(downloaded, toDownload) };
  return { state: 'queued', percent: 0 };
}

module.exports = { progress, isAppId, manifestFile, findManifest, isDownloading };
