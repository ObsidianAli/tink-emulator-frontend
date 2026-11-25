const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAlbum, titleFromName, steamTime } = require('../src/album');

const fakeImage = (text, empty = false) => ({ isEmpty: () => empty, toJPEG: () => Buffer.from(text) });

function setUp(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-album-'));
  const captures = path.join(root, 'Captures');
  const tink = path.join(captures, 'Tink');
  const steam = path.join(root, 'Steam');
  const downwell = path.join(steam, 'userdata', '1', '760', 'remote', '360740', 'screenshots');
  fs.mkdirSync(tink, { recursive: true });
  fs.mkdirSync(path.join(downwell, 'thumbnails'), { recursive: true });
  const put = (file, when) => {
    fs.writeFileSync(file, `pixels of ${path.basename(file)}`);
    const time = new Date(when);
    fs.utimesSync(file, time, time);
    return file;
  };
  const made = [];
  const trashed = [];
  const album = createAlbum({
    capturesDir: captures,
    tinkDir: tink,
    findSteamDir: async () => steam,
    steamTitle: (appId) => (appId === '360740' ? 'Downwell' : undefined),
    fileTitle: (name) => (name === 'Zelda Wind Waker' ? 'Zelda: Wind Waker' : name),
    nativeImage: {
      createThumbnailFromPath: async (file) => {
        made.push(file);
        return fakeImage('thumb');
      },
      createFromPath: () => fakeImage('', true),
    },
    trash: async (file) => {
      trashed.push(file);
      fs.rmSync(file);
    },
    ...extra,
  });
  return { root, captures, tink, steam, downwell, put, album, made, trashed };
}

test('game names come from Game Bar and Tink file names', () => {
  assert.strictEqual(titleFromName('Monster Hunter Wilds 2026-09-07 02-13-42.png'), 'Monster Hunter Wilds');
  assert.strictEqual(titleFromName('Hades II 2026-09-07 02-13-42 (2).png'), 'Hades II');
  assert.strictEqual(titleFromName('Celeste 9_7_2026 2_13_42 AM.png'), 'Celeste');
  assert.strictEqual(titleFromName('F-Zero 99 25.11.2026 14-05-09.jpg'), 'F-Zero 99');
  assert.strictEqual(titleFromName('holiday.png'), null);
});

test('Steam file names give the time', () => {
  assert.strictEqual(steamTime('20260907021342_1.jpg'), new Date(2026, 8, 7, 2, 13, 42).getTime());
  assert.strictEqual(steamTime('cover.jpg'), null);
});

test('lists every folder newest first, without videos or Steam thumbnails', async () => {
  const { captures, tink, downwell, put, album } = setUp();
  put(path.join(captures, 'Celeste 2026-01-02 10-00-00.png'), '2026-01-02T10:00:00');
  put(path.join(captures, 'Celeste 2026-01-03 10-00-00.mp4'), '2026-01-03T10:00:00');
  put(path.join(tink, 'Zelda Wind Waker 2026-03-01 09-00-00.png'), '2026-03-01T09:00:00');
  put(path.join(downwell, '20260201120000_1.jpg'), '2026-05-01T12:00:00');
  put(path.join(downwell, 'thumbnails', '20260201120000_1.jpg'), '2026-05-01T12:00:00');
  const shots = await album.list();
  assert.deepStrictEqual(shots.map((shot) => shot.title), ['Zelda: Wind Waker', 'Downwell', 'Celeste']);
  assert.strictEqual(shots[1].takenAt, new Date(2026, 1, 1, 12).getTime());
  for (const shot of shots) assert.deepStrictEqual(Object.keys(shot), ['id', 'title', 'takenAt']);
  assert.strictEqual(new Set(shots.map((shot) => shot.id)).size, 3);
});

test('missing folders and no Steam give an empty album', async () => {
  const { album } = setUp({ capturesDir: 'Z:\\nowhere', tinkDir: 'Z:\\nowhere\\Tink', findSteamDir: async () => null });
  assert.deepStrictEqual(await album.list(), []);
});

test('shots come back as data URLs of their own type', async () => {
  const { captures, downwell, put, album } = setUp();
  put(path.join(captures, 'Celeste 2026-01-02 10-00-00.png'), '2026-01-02T10:00:00');
  put(path.join(downwell, '20260201120000_1.jpg'), '2026-02-01T12:00:00');
  const [steam, celeste] = await album.list();
  assert.ok((await album.getShot(steam.id)).startsWith('data:image/jpeg;base64,'));
  const [head, body] = (await album.getShot(celeste.id)).split(',');
  assert.strictEqual(head, 'data:image/png;base64');
  assert.strictEqual(Buffer.from(body, 'base64').toString(), 'pixels of Celeste 2026-01-02 10-00-00.png');
});

test('only listed shots can be read or deleted', async () => {
  const { root, captures, put, album, trashed } = setUp();
  const secret = put(path.join(root, 'secret.png'), '2026-01-01T00:00:00');
  put(path.join(captures, 'Celeste 2026-01-02 10-00-00.png'), '2026-01-02T10:00:00');
  await album.list();
  for (const id of [secret, '..\\secret.png', 'undefined', '__proto__']) {
    assert.strictEqual(await album.getThumb(id), null);
    assert.strictEqual(await album.getShot(id), null);
    assert.strictEqual(await album.remove(id), false);
  }
  assert.deepStrictEqual(trashed, []);
});

test('thumbs are made once, and only the latest 60 are kept', async () => {
  const { captures, put, album, made } = setUp();
  for (let i = 10; i < 72; i++) put(path.join(captures, `Celeste 2026-01-02 10-00-${i}.png`), new Date(2026, 0, 2, 10, i).getTime());
  const shots = await album.list();
  for (const shot of shots) await album.getThumb(shot.id);
  assert.strictEqual(made.length, 62);
  assert.strictEqual(await album.getThumb(shots[61].id), `data:image/jpeg;base64,${Buffer.from('thumb').toString('base64')}`);
  assert.strictEqual(made.length, 62);
  await album.getThumb(shots[0].id);
  assert.strictEqual(made.length, 63);
});

test('an unreadable picture has no thumb', async () => {
  const { captures, put, album } = setUp({
    nativeImage: {
      createThumbnailFromPath: async () => { throw new Error('bad file'); },
      createFromPath: () => fakeImage('', true),
    },
  });
  put(path.join(captures, 'Celeste 2026-01-02 10-00-00.png'), '2026-01-02T10:00:00');
  const [shot] = await album.list();
  assert.strictEqual(await album.getThumb(shot.id), null);
});

test('deleting sends the file to the bin and forgets it', async () => {
  const { captures, put, album, trashed } = setUp();
  const file = put(path.join(captures, 'Celeste 2026-01-02 10-00-00.png'), '2026-01-02T10:00:00');
  const [shot] = await album.list();
  assert.strictEqual(await album.remove(shot.id), true);
  assert.deepStrictEqual(trashed, [file]);
  assert.strictEqual(await album.getShot(shot.id), null);
  assert.deepStrictEqual(await album.list(), []);
});
