const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { closeEmulator, playGame } = require('../src/launcher');
const { watchCombo, holdTimer } = require('../src/pad');

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

test('the combo only counts once held the whole time', async () => {
  let fired = 0;
  const update = holdTimer(100, () => fired++);
  update(true);
  await sleep(50);
  update(false);
  await sleep(100);
  assert.strictEqual(fired, 0);
  update(true);
  await sleep(150);
  assert.strictEqual(fired, 1);
});

test('holding the combo closes the game and Tink comes back', async () => {
  const events = [];
  const spec = { exe: process.execPath, args: [path.join(__dirname, 'stub-emulator-stubborn.js'), 'stubborn'] };
  const poller = { exe: process.execPath, args: [path.join(__dirname, 'stub-pad.js')] };
  await playGame(spec, {
    hide: () => events.push('hide'),
    show: () => events.push('show'),
    whilePlaying: (child) => {
      events.push('playing');
      const stop = watchCombo(() => closeEmulator(child, { waitMs: 300 }), { holdMs: 100, poller });
      return () => {
        events.push('stop polling');
        stop();
      };
    },
  });
  assert.deepStrictEqual(events, ['hide', 'playing', 'stop polling', 'show']);
});

test('a pad watcher that dies on its own is reported, one that is stopped is not', async () => {
  const codes = [];
  const dies = { exe: process.execPath, args: ['-e', 'process.exit(3)'] };
  watchCombo(() => {}, { poller: dies, onFail: (code) => codes.push(code) });
  await sleep(1000);
  assert.deepStrictEqual(codes, [3]);
  const stop = watchCombo(() => {}, { poller: { exe: process.execPath, args: [path.join(__dirname, 'stub-pad.js')] }, onFail: (code) => codes.push(code) });
  await sleep(300);
  stop();
  await sleep(300);
  assert.deepStrictEqual(codes, [3]);
});
