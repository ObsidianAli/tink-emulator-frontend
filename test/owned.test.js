const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appInfo, packageInfo } = require('./binvdf');
const { parseAppInfo, parsePackageInfo } = require('../src/steambin');
const { getOwnedGames, getOwnedStatus } = require('../src/owned');

const BASE = 76561197960265728n;
const app = (name, type = 'game') => ({ common: { name, type } });
const APPS = {
  10: app('Zebra Run'),
  20: app('Alpha Quest'),
  30: app('Alpha Quest Soundtrack', 'Music'),
  40: app('Alpha Quest Demo', 'Demo'),
  50: app('Alpha Quest Expansion', 'DLC'),
  60: app('Level Editor', 'Tool'),
  70: app('Beta Land'),
  80: app('Proton 9.0'),
  90: app('Free Thing'),
  100: app('Their Game'),
};

function steamDir({ accounts = ['1000'], signedIn = '1000', packages, evidence = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-owned-'));
  fs.mkdirSync(path.join(dir, 'appcache'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'appcache', 'appinfo.vdf'), appInfo(APPS));
  fs.writeFileSync(path.join(dir, 'appcache', 'packageinfo.vdf'), packageInfo(packages));
  const id64 = (account) => String(BASE + BigInt(account));
  fs.writeFileSync(path.join(dir, 'config', 'loginusers.vdf'), `"users"\n{\n"${id64(signedIn)}"\n{\n"MostRecent"\t"1"\n"timestamp"\t"5"\n}\n}\n`);
  for (const account of accounts) {
    const config = path.join(dir, 'userdata', account, 'config');
    fs.mkdirSync(config, { recursive: true });
    const tickets = (evidence[account] || []).map((id) => `"${id}" "x"`).join('\n');
    fs.writeFileSync(path.join(config, 'localconfig.vdf'), `"UserLocalConfigStore"\n{\n"apptickets"\n{\n${tickets}\n}\n}\n`);
  }
  return dir;
}

const appids = (...ids) => ({ appids: Object.fromEntries(ids.map((id, i) => [i, id])) });

test('reads names and types from a v41 appinfo and packages from a v40 packageinfo', () => {
  const apps = parseAppInfo(appInfo(APPS));
  assert.strictEqual(apps.size, 10);
  assert.strictEqual(apps.get(20).common.name, 'Alpha Quest');
  const packages = parsePackageInfo(packageInfo({ 5: appids(10, 20), 6: appids(70) }));
  assert.deepStrictEqual([...packages.keys()], [5, 6]);
  assert.deepStrictEqual(Object.values(packages.get(5).appids), [10, 20]);
});

test('truncated or unknown files give nothing instead of throwing', () => {
  assert.strictEqual(parseAppInfo(Buffer.from('nonsense')).size, 0);
  assert.strictEqual(parseAppInfo(appInfo(APPS).subarray(0, 60)).size, 0);
  assert.strictEqual(parsePackageInfo(packageInfo({ 5: appids(10) }).subarray(0, 50)).size, 0);
});

test('lists owned games that are not installed, without DLC, demos, soundtracks, tools or Proton', () => {
  const dir = steamDir({ packages: { 0: appids(90), 5: appids(10, 20, 30, 40, 50, 60), 6: appids(70, 80) } });
  const titles = getOwnedGames(dir, ['70']).map((game) => game.title);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(titles, ['Alpha Quest', 'Zebra Run']);
});

test('with one account every cached package counts', () => {
  const dir = steamDir({ packages: { 5: appids(10) } });
  const games = getOwnedGames(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(games.map((g) => [g.appId, g.art.cover.includes('/10/')]), [['10', true]]);
});

test('with two accounts only packages the signed-in account has files for are listed', () => {
  const dir = steamDir({
    accounts: ['1000', '2000'],
    signedIn: '1000',
    packages: { 5: appids(10), 6: appids(20), 7: appids(70), 8: appids(100) },
    evidence: { 1000: [10], 2000: [20, 100] },
  });
  const sure = getOwnedGames(dir).map((g) => g.title);
  const all = getOwnedGames(dir, [], { includeUnsure: true }).map((g) => g.title);
  const status = getOwnedStatus(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(sure, ['Zebra Run']);
  assert.strictEqual(all.length, 4);
  assert.deepStrictEqual(status, { accounts: 2, signedIn: true, sure: 1, unsure: 3 });
});

test('missing Steam files give an empty list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-owned-'));
  assert.deepStrictEqual(getOwnedGames(dir), []);
  assert.deepStrictEqual(getOwnedGames(path.join(dir, 'nope')), []);
  assert.deepStrictEqual(getOwnedGames(null), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the parsed result is reused until a file changes', () => {
  const dir = steamDir({ packages: { 5: appids(10) } });
  assert.strictEqual(getOwnedGames(dir).length, 1);
  fs.writeFileSync(path.join(dir, 'appcache', 'packageinfo.vdf'), packageInfo({ 5: appids(10, 20) }));
  assert.strictEqual(getOwnedGames(dir).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
