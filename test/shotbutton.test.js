const test = require('node:test');
const assert = require('node:assert');
const { watchPress, learnButton, openButtons, loadPadReader, buttonLabel } = require('../src/pad');
const { openHidPads, knownButtons } = require('../src/hid');
const options = require('../src/options');

function advance(t, ms) {
  for (let i = 0; i < ms; i += 10) t.mock.timers.tick(10);
}

function fakeButtons() {
  const held = new Set();
  return { held, pressed: () => new Set(held) };
}

function report(length, bytes) {
  const out = new Uint8Array(length);
  for (const [at, value] of Object.entries(bytes)) out[at] = value;
  return out;
}

test('each press counts once, and one held from the start does not', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let down = true;
  let pressed = 0;
  const stop = watchPress(() => pressed++, { read: () => down });
  advance(t, 500);
  assert.strictEqual(pressed, 0);
  down = false;
  advance(t, 100);
  down = true;
  advance(t, 500);
  assert.strictEqual(pressed, 1);
  stop();
});

test('XInput buttons get their names, on any pad', () => {
  const pads = [null, 0x0020, null, 0x1100];
  const reader = loadPadReader({ open: () => (index) => pads[index] });
  assert.deepStrictEqual([...reader.pressed()].sort(), ['xinput:0020', 'xinput:0100', 'xinput:1000']);
  assert.strictEqual(buttonLabel('xinput:0020'), 'View');
  assert.strictEqual(buttonLabel('xinput:0100'), 'LB');
});

test('PlayStation and Switch buttons get their names', () => {
  assert.strictEqual(buttonLabel('hid:054c:0ce6:9'), 'Create');
  assert.strictEqual(buttonLabel('hid:054c:09cc:9'), 'Share');
  assert.strictEqual(buttonLabel('hid:057e:2009:14'), 'Capture');
  assert.strictEqual(buttonLabel('hid:2dc8:3106:12'), 'Button 12');
  for (const id of ['', 'xinput:0003', 'hid:054c:0ce6:0', 'hid:54c:ce6:9', 'x']) assert.strictEqual(buttonLabel(id), null);
});

test('Bluetooth reports Windows cannot describe are read directly', () => {
  assert.deepStrictEqual(knownButtons(0x054c, report(78, { 0: 0x31, 9: 0x28, 10: 0x10, 11: 0x02 })), [2, 9, 14]);
  assert.deepStrictEqual(knownButtons(0x054c, report(78, { 0: 0x11, 7: 0x88, 8: 0x10, 9: 0xfd })), [4, 9, 13]);
  assert.deepStrictEqual(knownButtons(0x057e, report(49, { 0: 0x30, 1: 0xff, 2: 0xff, 3: 0x08, 4: 0x20 })), [2, 14]);
  assert.strictEqual(knownButtons(0x054c, report(64, { 0: 0x01 })), null);
  assert.strictEqual(knownButtons(0x057e, report(12, { 0: 0x3f })), null);
  assert.strictEqual(knownButtons(0x2dc8, report(64, { 0: 0x31 })), null);
});

function fakeHid() {
  const world = { paths: ['\\\\?\\hid#vid_054c&pid_0ce6#1'], queued: [], opened: [], closed: 0, now: 0 };
  world.system = () => ({
    paths: () => world.paths,
    open(file) {
      world.opened.push(file);
      return {
        vid: 0x054c,
        pid: 0x0ce6,
        next: () => world.queued.shift() ?? null,
        close: () => world.closed++,
      };
    },
  });
  return world;
}

test('a quick tap between two reads is still seen, and a held button stays held', () => {
  const world = fakeHid();
  const pads = openHidPads({ system: world.system, now: () => world.now });
  world.queued = [[], [9], []];
  assert.deepStrictEqual([...pads.pressed()], ['hid:054c:0ce6:9']);
  assert.deepStrictEqual([...pads.pressed()], []);
  world.queued = [[9]];
  pads.pressed();
  assert.deepStrictEqual([...pads.pressed()], ['hid:054c:0ce6:9']);
});

test('pads come and go, and XInput pads are left to XInput', () => {
  const world = fakeHid();
  const pads = openHidPads({ system: world.system, now: () => world.now });
  world.paths.push('\\\\?\\hid#vid_045e&pid_028e&ig_00#2');
  pads.pressed();
  assert.deepStrictEqual(world.opened, ['\\\\?\\hid#vid_054c&pid_0ce6#1']);
  world.paths = [];
  pads.pressed();
  assert.strictEqual(world.closed, 0, 'it only looks every few seconds');
  world.now = 5000;
  pads.pressed();
  assert.strictEqual(world.closed, 1);
  world.paths = ['\\\\?\\hid#vid_054c&pid_0ce6#3'];
  world.now = 10000;
  pads.pressed();
  pads.close();
  assert.strictEqual(world.closed, 2);
});

test('without XInput or HID there are no buttons', () => {
  assert.strictEqual(openHidPads({ system: () => { throw new Error('missing'); } }), null);
  assert.strictEqual(openButtons({ xinput: null, hid: null }), null);
});

test('the real HID pads open, read and close', { skip: process.platform !== 'win32' }, () => {
  const pads = openHidPads();
  assert.ok(pads.pressed() instanceof Set);
  pads.close();
});

test('learning takes the next button pressed, not the one that started it', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const buttons = fakeButtons();
  buttons.held.add('xinput:1000');
  const { done } = learnButton({ buttons });
  advance(t, 1000);
  buttons.held.add('hid:054c:0ce6:9');
  advance(t, 100);
  assert.strictEqual(await done, 'hid:054c:0ce6:9');
});

test('learning accepts the starting button once it was let go', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const buttons = fakeButtons();
  buttons.held.add('xinput:1000');
  const { done } = learnButton({ buttons });
  advance(t, 500);
  buttons.held.clear();
  advance(t, 100);
  buttons.held.add('xinput:1000');
  advance(t, 100);
  assert.strictEqual(await done, 'xinput:1000');
});

test('learning ends with nothing on timeout, cancel or a failing pad', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const slow = learnButton({ buttons: fakeButtons() });
  advance(t, 10100);
  assert.strictEqual(await slow.done, null);
  const cancelled = learnButton({ buttons: fakeButtons() });
  cancelled.cancel();
  assert.strictEqual(await cancelled.done, null);
  const broken = learnButton({ buttons: { pressed: () => { throw new Error('gone'); } } });
  advance(t, 100);
  assert.strictEqual(await broken.done, null);
});

test('the screenshot button is saved, shown and cleared', () => {
  const settings = { consoles: {} };
  assert.strictEqual(options.buildSettings(settings, {}, '1').screenshotButton, null);
  options.setScreenshotButton(settings, 'hid:054c:0ce6:9');
  assert.deepStrictEqual(options.buildSettings(settings, {}, '1').screenshotButton, { id: 'hid:054c:0ce6:9', label: 'Create' });
  options.setScreenshotButton(settings, null);
  assert.strictEqual('screenshotButton' in settings, false);
  assert.strictEqual(options.screenshotButton({ consoles: {}, screenshotButton: { odd: true } }), null);
});
