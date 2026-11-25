const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { captureWindow, shotName, safeName } = require('../src/capture');
const { bgraToPng } = require('../src/png');

const target = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tink-capture-')), 'Tink', 'shot.png');

function fakeWorker(run) {
  const calls = [];
  const fork = (args) => {
    const child = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('exit', 1));
    calls.push(args);
    setImmediate(() => run(child, args));
    return child;
  };
  return { fork, calls };
}

test('a finished capture gives the file back', async () => {
  const file = target();
  const { fork, calls } = fakeWorker((child) => child.emit('exit', 0));
  assert.strictEqual(await captureWindow(1234, file, { fork }), file);
  assert.deepStrictEqual(calls, [['1234', file]]);
  assert.ok(fs.existsSync(path.dirname(file)), 'the folder is made first');
});

test('a failed capture gives null and says why', async () => {
  const reasons = [];
  const { fork } = fakeWorker((child) => {
    child.emit('message', 'No frame arrived');
    child.emit('exit', 1);
  });
  assert.strictEqual(await captureWindow(1234, target(), { fork, onFail: (reason) => reasons.push(reason) }), null);
  assert.deepStrictEqual(reasons, ['No frame arrived']);
});

test('a hung capture is stopped', async () => {
  const reasons = [];
  const { fork } = fakeWorker(() => {});
  assert.strictEqual(await captureWindow(1234, target(), { fork, timeoutMs: 50, onFail: (reason) => reasons.push(reason) }), null);
  assert.deepStrictEqual(reasons, ['the capture took too long']);
});

test('a worker that cannot start gives null', async () => {
  const fork = () => { throw new Error('no process'); };
  assert.strictEqual(await captureWindow(1234, target(), { fork }), null);
});

test('file names match Game Bar and stay valid', () => {
  const date = new Date(2026, 8, 7, 2, 13, 42);
  assert.strictEqual(shotName('Monster Hunter Wilds', date), 'Monster Hunter Wilds 2026-09-07 02-13-42.png');
  assert.strictEqual(shotName('Zelda: Wind Waker', date), 'Zelda Wind Waker 2026-09-07 02-13-42.png');
  assert.strictEqual(shotName('..\\..\\x/y?', date), '.. .. x y 2026-09-07 02-13-42.png');
  assert.strictEqual(shotName('', date), 'Screenshot 2026-09-07 02-13-42.png');
  assert.strictEqual(safeName('Wait...'), 'Wait');
});

test('pixels survive into the PNG, without the padding at the end of each row', () => {
  const width = 3;
  const height = 2;
  const stride = 16;
  const pixels = Buffer.alloc(stride * height, 0xee);
  const colours = [[10, 20, 30], [255, 0, 1], [0, 128, 255], [7, 7, 7], [1, 2, 3], [250, 251, 252]];
  colours.forEach(([r, g, b], i) => pixels.set([b, g, r, 0], Math.floor(i / width) * stride + (i % width) * 4));
  const png = bgraToPng({ pixels, width, height, stride });

  assert.strictEqual(png.toString('latin1', 1, 4), 'PNG');
  assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
  const at = png.indexOf('IDAT');
  const length = png.readUInt32BE(at - 4);
  assert.strictEqual(png.readUInt32BE(at + 4 + length), zlib.crc32(png.subarray(at, at + 4 + length)));
  const raw = zlib.inflateSync(png.subarray(at + 4, at + 4 + length));
  const read = [];
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (width * 3 + 1) + 1);
    let last = [0, 0, 0];
    for (let x = 0; x < width; x++) {
      last = last.map((value, channel) => (value + row[x * 3 + channel]) & 0xff);
      read.push(last);
    }
  }
  assert.deepStrictEqual(read, colours);
});
