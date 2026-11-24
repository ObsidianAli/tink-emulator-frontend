const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { closeEmulator, playGame } = require('../src/launcher');
const { watchCombo, holdTimer, loadPadReader, comboDown } = require('../src/pad');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stub = (mode) => spawn(process.execPath, [path.join(__dirname, 'stub-emulator-stubborn.js'), mode], { stdio: ['pipe', 'ignore', 'ignore'] });
const started = (child) => new Promise((resolve) => child.once('spawn', resolve));

test('an emulator that closes when asked is never forced', async () => {
  const child = stub('polite');
  await started(child);
  let forced = false;
  await closeEmulator(child, { waitMs: 2000, ask: (c) => c.stdin.end(), force: () => { forced = true; } });
  assert.strictEqual(forced, false);
});

test('an emulator that ignores the polite close is forced after the wait', async () => {
  const child = stub('stubborn');
  await started(child);
  const begun = Date.now();
  await closeEmulator(child, { waitMs: 500 });
  assert.ok(Date.now() - begun >= 500, 'waited before forcing');
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'it exited');
});

test('closing an emulator that already exited does nothing', async () => {
  const child = stub('polite');
  await started(child);
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
  await closeEmulator(child, { ask: () => assert.fail('asked'), force: () => assert.fail('forced') });
});

// Mocked timers only fire timeouts set inside a tick correctly when time moves in small steps.
function advance(t, ms) {
  for (let i = 0; i < ms; i += 10) t.mock.timers.tick(10);
}

function fakePad() {
  const pad = { held: false, reads: 0 };
  pad.read = () => {
    pad.reads++;
    return pad.held;
  };
  return pad;
}

test('holding Select + Start for 2 seconds triggers the close', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const pad = fakePad();
  let fired = 0;
  const stop = watchCombo(() => fired++, { read: pad.read });
  pad.held = true;
  advance(t, 1950);
  assert.strictEqual(fired, 0);
  advance(t, 150);
  assert.strictEqual(fired, 1);
  advance(t, 5000);
  assert.strictEqual(fired, 1, 'only once per hold');
  stop();
});

test('letting go before 2 seconds starts the count again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const pad = fakePad();
  let fired = 0;
  const stop = watchCombo(() => fired++, { read: pad.read });
  pad.held = true;
  advance(t, 1500);
  pad.held = false;
  advance(t, 100);
  pad.held = true;
  advance(t, 1500);
  assert.strictEqual(fired, 0);
  stop();
});

test('stopping the watcher stops polling and cancels a hold in progress', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const pad = fakePad();
  let fired = 0;
  const stop = watchCombo(() => fired++, { read: pad.read });
  pad.held = true;
  advance(t, 1000);
  stop();
  const reads = pad.reads;
  advance(t, 5000);
  assert.strictEqual(fired, 0);
  assert.strictEqual(pad.reads, reads);
});

test('a pad that fails to read is reported once and polling stops', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const errors = [];
  let reads = 0;
  const read = () => {
    reads++;
    throw new Error('gone');
  };
  watchCombo(() => {}, { read, onFail: (error) => errors.push(error.message) });
  advance(t, 1000);
  assert.deepStrictEqual(errors, ['gone']);
  assert.strictEqual(reads, 1);
});

test('the combo counts on any of the four pads, and needs both buttons', () => {
  const pads = (buttons) => (index) => (index in buttons ? buttons[index] : null);
  assert.strictEqual(comboDown(pads({ 0: 0x0030 })), true);
  assert.strictEqual(comboDown(pads({ 3: 0x0030 | 0x1000 })), true);
  assert.strictEqual(comboDown(pads({ 1: 0x0020, 2: 0x0010 })), false);
  assert.strictEqual(comboDown(pads({ 0: 0x0010 })), false);
  assert.strictEqual(comboDown(pads({})), false);
});

test('XInput falls back to the older dll, and gives up when neither loads', () => {
  const tried = [];
  const reader = loadPadReader({
    open: (dll) => {
      tried.push(dll);
      if (dll === 'xinput1_4.dll') throw new Error('missing');
      return () => 0x0030;
    },
  });
  assert.strictEqual(reader.dll, 'xinput9_1_0.dll');
  assert.strictEqual(reader.read(), true);
  assert.deepStrictEqual(tried, ['xinput1_4.dll', 'xinput9_1_0.dll']);
  const none = loadPadReader({
    open: () => {
      throw new Error('missing');
    },
  });
  assert.strictEqual(none, null);
});

test('the real XInput loads through koffi', { skip: process.platform !== 'win32' }, () => {
  const reader = loadPadReader();
  assert.ok(reader, 'an XInput dll loaded');
  assert.strictEqual(typeof reader.read(), 'boolean');
});

test('holding the combo closes the game and Tink comes back', async () => {
  const events = [];
  const spec = { exe: process.execPath, args: [path.join(__dirname, 'stub-emulator-stubborn.js'), 'stubborn'] };
  const pad = fakePad();
  pad.held = true;
  await playGame(spec, {
    hide: () => events.push('hide'),
    show: () => events.push('show'),
    whilePlaying: (child) => {
      events.push('playing');
      const stop = watchCombo(() => closeEmulator(child, { waitMs: 300 }), { read: pad.read, holdMs: 100 });
      return () => {
        events.push('stop polling');
        stop();
      };
    },
  });
  assert.deepStrictEqual(events, ['hide', 'playing', 'stop polling', 'show']);
  const reads = pad.reads;
  await sleep(200);
  assert.strictEqual(pad.reads, reads, 'no polling once the game is gone');
});

test('no polling happens before a game starts or after it ends on its own', async () => {
  const pad = fakePad();
  const spec = { exe: process.execPath, args: [path.join(__dirname, 'stub-emulator-stubborn.js'), 'stubborn'] };
  let child;
  const playing = playGame(spec, {
    hide: () => assert.strictEqual(pad.reads, 0),
    show: () => {},
    whilePlaying: (c) => {
      child = c;
      return watchCombo(() => assert.fail('fired'), { read: pad.read });
    },
  });
  await sleep(300);
  assert.ok(pad.reads > 0, 'polled while playing');
  child.kill();
  await playing;
  const reads = pad.reads;
  await sleep(200);
  assert.strictEqual(pad.reads, reads);
});
