const fs = require('node:fs');
const path = require('node:path');
const { readVdfFile, libraryFolders } = require('./steam');

const INSTALLED = 4;
const UPDATE_RUNNING = 256 | 1024;
const FINISHING = 262144 | 524288 | 1048576 | 2097152;

const isAppId = (appId) => /^\d{1,10}$/.test(String(appId));

// Steam does the download itself; Tink only asks it to start.
async function install(appId, open) {
  if (!isAppId(appId)) return false;
  await open(`steam://install/${Number(appId)}`);
  return true;
}

function findManifest(steamDir, appId) {
  for (const folder of libraryFolders(steamDir)) {
    const file = path.join(folder, 'steamapps', `appmanifest_${appId}.acf`);
    if (fs.existsSync(file)) return readVdfFile(file);
  }
  return null;
}

const percentOf = (done, total) => (total > 0 ? Math.max(0, Math.min(100, Math.floor((done / total) * 100))) : 0);

function progress(appId, steamDir) {
  const none = { state: 'none', percent: 0 };
  if (!isAppId(appId) || !steamDir) return none;
  const state = (findManifest(steamDir, Number(appId)) || {}).AppState;
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

module.exports = { install, progress, isAppId };
