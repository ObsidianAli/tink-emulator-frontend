const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { install, progress } = require('../src/install');

function library(manifests) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-install-'));
  fs.mkdirSync(path.join(dir, 'steamapps'));
  for (const [id, fields] of Object.entries(manifests)) {
    const body = Object.entries(fields).map(([k, v]) => `\t"${k}"\t\t"${v}"`).join('\n');
    fs.writeFileSync(path.join(dir, 'steamapps', `appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n${body}\n}\n`);
  }
  return dir;
}

test('install opens the Steam install link and nothing else', async () => {
  const opened = [];
  assert.strictEqual(await install('620', async (url) => opened.push(url)), true);
  assert.deepStrictEqual(opened, ['steam://install/620']);
  for (const bad of ['', 'abc', '620/../x', '1 2', '-5', null, undefined, '620?x=1']) {
    assert.strictEqual(await install(bad, async (url) => opened.push(url)), false);
  }
  assert.strictEqual(opened.length, 1);
});

test('progress follows a download from queued to done', () => {
  const dir = library({
    1: { StateFlags: 2, BytesToDownload: 0, BytesDownloaded: 0 },
    2: { StateFlags: 1026, BytesToDownload: 2000, BytesDownloaded: 500 },
    3: { StateFlags: 1026, BytesToDownload: 2000, BytesDownloaded: 2000 },
    4: { StateFlags: 4, BytesToDownload: 0, BytesDownloaded: 0 },
    5: { StateFlags: 1048576 | 4, BytesToStage: 400, BytesStaged: 100, BytesToDownload: 2000, BytesDownloaded: 2000 },
  });
  const got = (id) => progress(id, dir);
  assert.deepStrictEqual(got('1'), { state: 'queued', percent: 0 });
  assert.deepStrictEqual(got('2'), { state: 'downloading', percent: 25 });
  assert.deepStrictEqual(got('3'), { state: 'installing', percent: 100 });
  assert.deepStrictEqual(got('4'), { state: 'done', percent: 100 });
  assert.deepStrictEqual(got('5'), { state: 'installing', percent: 25 });
  assert.deepStrictEqual(got('9'), { state: 'none', percent: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('progress finds a manifest in another library folder and survives bad input', () => {
  const main = library({});
  const second = library({ 7: { StateFlags: 4 } });
  const escaped = second.split(path.sep).join(path.sep + path.sep);
  fs.writeFileSync(path.join(main, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"
{
"0"
{
"path"		"${escaped}"
}
}
`);
  assert.strictEqual(progress('7', main).state, 'done');
  assert.strictEqual(progress('x', main).state, 'none');
  assert.strictEqual(progress('7', null).state, 'none');
  assert.strictEqual(progress('7', path.join(main, 'missing')).state, 'none');
  fs.rmSync(main, { recursive: true, force: true });
  fs.rmSync(second, { recursive: true, force: true });
});
