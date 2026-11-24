const test = require('node:test');
const assert = require('node:assert');
const { native, isGameWindow, pickGameWindow, descendants } = require('../src/win32');

const windowLike = (extra) => ({ visible: true, owner: 0, exStyle: 0, width: 1280, height: 720, ...extra });

test('only visible, unowned, full-size windows count as a game window', () => {
  assert.strictEqual(isGameWindow(windowLike()), true);
  assert.strictEqual(isGameWindow(windowLike({ visible: false })), false);
  assert.strictEqual(isGameWindow(windowLike({ owner: 1234 })), false);
  assert.strictEqual(isGameWindow(windowLike({ exStyle: 0x80 })), false);
  assert.strictEqual(isGameWindow(windowLike({ width: 150 })), false);
  assert.strictEqual(isGameWindow(windowLike({ height: 199 })), false);
});

test('the topmost window of the game is picked', () => {
  const windows = [{ hwnd: 1, pid: 9 }, { hwnd: 2, pid: 20 }, { hwnd: 3, pid: 10 }];
  assert.strictEqual(pickGameWindow(windows, new Set([10, 20])), 2);
  assert.strictEqual(pickGameWindow(windows, new Set([30])), null);
  assert.strictEqual(pickGameWindow(null, new Set([10])), null);
});

test('descendants follow every generation and survive reused ids', () => {
  const processes = [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 11 },
    { pid: 13, ppid: 99 },
    { pid: 10, ppid: 12 },
    { pid: 0, ppid: 0 },
  ];
  assert.deepStrictEqual(descendants(processes, 10).sort(), [11, 12]);
  assert.deepStrictEqual(descendants(processes, 50), []);
});

test('without Windows there is no native access', { skip: process.platform === 'win32' }, () => {
  assert.strictEqual(native(), null);
});

test('the native calls see this process', { skip: process.platform !== 'win32' }, () => {
  const api = native();
  assert.ok(api, 'koffi bound the Windows calls');
  const self = api.listProcesses().find((row) => row.pid === process.pid);
  assert.strictEqual(self.exe.toLowerCase(), process.execPath.toLowerCase());
  assert.strictEqual(api.isAlive(process.pid), true);
  assert.ok(Array.isArray(api.topWindows()));
  const appId = api.runningAppId();
  assert.ok(appId === null || Number.isInteger(appId));
});
