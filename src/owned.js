const fs = require('node:fs');
const path = require('node:path');
const { parseVdf, artUrls, isSkippedApp } = require('./steam');
const { parseAppInfo, parsePackageInfo } = require('./steambin');

const STEAM_ID_BASE = 76561197960265728n;
const FREE_FOR_ALL_PACKAGE = 0;

const cache = new Map();

const stamp = (file) => {
  try {
    const stat = fs.statSync(file);
    return `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${file}:-`;
  }
};

const read = (file) => {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
};

const readText = (file) => {
  const data = read(file);
  return data ? data.toString('utf8') : null;
};

function child(object, name) {
  if (!object || typeof object !== 'object') return undefined;
  const key = Object.keys(object).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

function accountDirs(steamDir) {
  try {
    return fs.readdirSync(path.join(steamDir, 'userdata'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// Steam writes the signed-in account's 64-bit id first in loginusers.vdf; the 32-bit folder name is what userdata uses.
function loginAccounts(steamDir) {
  const text = readText(path.join(steamDir, 'config', 'loginusers.vdf'));
  const users = text ? child(parseVdf(text), 'users') || {} : {};
  return Object.entries(users)
    .filter(([id, value]) => /^\d{17}$/.test(id) && value && typeof value === 'object')
    .map(([id, value]) => ({
      account: String(BigInt(id) - STEAM_ID_BASE),
      recent: String(child(value, 'MostRecent')) === '1',
      time: Number(child(value, 'timestamp')) || 0,
    }));
}

function signedInAccount(steamDir, dirs, logins) {
  const recent = logins.find((login) => login.recent) || [...logins].sort((a, b) => b.time - a.time)[0];
  if (recent) return recent.account;
  if (dirs.length === 1) return dirs[0];
  return null;
}

// What this account's own files mention: tickets, per-app settings, cloud saves, library cache, per-app data folders.
function accountEvidence(steamDir, account) {
  const found = new Set();
  const addKeys = (object) => {
    if (object && typeof object === 'object') for (const key of Object.keys(object)) if (/^\d+$/.test(key)) found.add(Number(key));
  };
  const base = path.join(steamDir, 'userdata', account);
  const text = readText(path.join(base, 'config', 'localconfig.vdf'));
  if (text) {
    const root = child(parseVdf(text), 'UserLocalConfigStore');
    const steam = child(child(child(root, 'Software'), 'Valve'), 'Steam');
    for (const name of ['apptickets', 'UserAppConfig', 'nettickets']) addKeys(child(root, name));
    addKeys(child(steam, 'apps'));
  }
  try {
    for (const file of fs.readdirSync(path.join(base, 'config', 'librarycache'))) {
      const match = file.match(/^(\d+)\.json$/);
      if (match) found.add(Number(match[1]));
    }
    for (const entry of fs.readdirSync(base)) if (/^\d+$/.test(entry)) found.add(Number(entry));
  } catch {
  }
  return found;
}

function gamesFromAppInfo(steamDir) {
  const apps = parseAppInfo(read(path.join(steamDir, 'appcache', 'appinfo.vdf')) || Buffer.alloc(0));
  const games = new Map();
  for (const [appId, app] of apps) {
    const common = app.common;
    if (!common || typeof common.type !== 'string' || common.type.toLowerCase() !== 'game') continue;
    const title = typeof common.name === 'string' ? common.name.trim() : '';
    if (!title || isSkippedApp(appId, title)) continue;
    games.set(appId, title);
  }
  return games;
}

function compute(steamDir) {
  const titles = gamesFromAppInfo(steamDir);
  const packages = parsePackageInfo(read(path.join(steamDir, 'appcache', 'packageinfo.vdf')) || Buffer.alloc(0));
  const dirs = accountDirs(steamDir);
  const logins = loginAccounts(steamDir);
  const known = new Set([...dirs, ...logins.map((login) => login.account)]);
  const account = signedInAccount(steamDir, dirs, logins);
  const single = known.size <= 1;
  const mine = account && dirs.includes(account) ? accountEvidence(steamDir, account) : new Set();

  const sure = new Set();
  const unsure = new Set();
  for (const [packageId, info] of packages) {
    if (packageId === FREE_FOR_ALL_PACKAGE || Number(info.status) !== 0) continue;
    const apps = Object.values(info.appids || {}).filter((id) => Number.isInteger(id));
    const games = apps.filter((id) => titles.has(id));
    if (!games.length) continue;
    const confirmed = single || apps.some((id) => mine.has(id));
    for (const id of games) (confirmed ? sure : unsure).add(id);
  }
  for (const id of sure) unsure.delete(id);
  return { titles, sure, unsure, accounts: known.size, signedIn: Boolean(account) };
}

function owned(steamDir) {
  if (!steamDir) return null;
  const dirs = accountDirs(steamDir);
  const logins = loginAccounts(steamDir);
  const files = [
    path.join(steamDir, 'appcache', 'appinfo.vdf'),
    path.join(steamDir, 'appcache', 'packageinfo.vdf'),
    path.join(steamDir, 'config', 'loginusers.vdf'),
    path.join(steamDir, 'userdata'),
    ...dirs.flatMap((dir) => [
      path.join(steamDir, 'userdata', dir, 'config', 'localconfig.vdf'),
      path.join(steamDir, 'userdata', dir, 'config', 'librarycache'),
      path.join(steamDir, 'userdata', dir),
    ]),
  ];
  const signature = files.map(stamp).join('|') + logins.length;
  const hit = cache.get(steamDir);
  if (hit && hit.signature === signature) return hit.value;
  let value;
  try {
    value = compute(steamDir);
  } catch {
    value = { titles: new Map(), sure: new Set(), unsure: new Set(), accounts: 0, signedIn: false };
  }
  cache.set(steamDir, { signature, value });
  return value;
}

// Games the signed-in Steam account owns and hasn't installed. With several accounts on the PC, only games tied
// to this account by its own files are listed; the rest are counted in getOwnedStatus.
function getOwnedGames(steamDir, installedIds = [], { includeUnsure = false } = {}) {
  const found = owned(steamDir);
  if (!found) return [];
  const installed = new Set([...installedIds].map(String));
  return [...found.sure, ...(includeUnsure ? found.unsure : [])]
    .filter((id) => !installed.has(String(id)))
    .map((id) => ({ appId: String(id), title: found.titles.get(id), art: artUrls(String(id)) }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
}

function getOwnedStatus(steamDir) {
  const found = owned(steamDir);
  if (!found) return { accounts: 0, signedIn: false, sure: 0, unsure: 0 };
  return { accounts: found.accounts, signedIn: found.signedIn, sure: found.sure.size, unsure: found.unsure.size };
}

module.exports = { getOwnedGames, getOwnedStatus };
