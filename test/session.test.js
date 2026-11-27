const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { startSession } = require('../src/session');

const GAME_DIR = path.join('D:', 'SteamLibrary', 'steamapps', 'common', 'Downwell');
const STEAM_EXE = path.join('C:', 'Steam', 'steam.exe');
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function fakeClock() {
  let now = 0;
  let timers = [];
  return {
    now: () => now,
    sleep: (ms) => new Promise((resolve) => timers.push({ at: now + ms, resolve })),
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.resolve();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function fakeWindows({ native = true } = {}) {
  const world = { processes: [{ pid: 4, ppid: 0, exe: STEAM_EXE }], windows: [], appId: 0, fronted: [], frontOk: true };
  world.platform = native
    ? {
        processes: () => world.processes,
        windows: () => world.windows,
        bringToFront: (hwnd) => {
          world.fronted.push(hwnd);
          return world.frontOk;
        },
        runningAppId: async () => world.appId,
      }
    : { processes: null, windows: null, bringToFront: null, runningAppId: async () => world.appId, steamRunning: async () => true };
  return world;
}

function launched() {
  let finish;
  let fail;
  const exited = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const child = { pid: 100, exitCode: null, signalCode: null };
  return {
    target: { kind: 'pc', child, exited },
    exit() {
      child.exitCode = 0;
      finish();
    },
    fail,
  };
}

function start(target, world, { ack = true } = {}) {
  const clock = fakeClock();
  const states = [];
  const restored = [];
  let session;
  session = startSession(target, {
    platform: world.platform,
    clock,
    onState(state, info) {
      states.push(info ? `${state}:${JSON.stringify(info)}` : state);
      if (state === 'handoff' && ack) queueMicrotask(() => session.ready());
    },
    restore: async (outcome) => restored.push(outcome),
  });
  return { session, clock, states, restored };
}

test('a Steam game hands over at its window and ends at once when Steam says nothing runs', async () => {
  const world = fakeWindows();
  const { session, clock, states } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(3000);
  world.processes.push({ pid: 300, ppid: 4, exe: path.join(GAME_DIR, 'downwell.exe') });
  world.appId = 360740;
  await clock.advance(250);
  assert.deepStrictEqual(states, ['loading'], 'no window yet');
  world.windows = [{ hwnd: 30, pid: 300 }];
  await clock.advance(250);
  assert.strictEqual(session.state(), 'playing');
  assert.deepStrictEqual(world.fronted, [30]);
  world.processes.pop();
  world.windows = [];
  world.appId = 0;
  await clock.advance(250);
  assert.strictEqual((await session.done).status, 'ended');
});

test('after a Steam crash the stale game id only costs the short grace', async () => {
  const world = fakeWindows();
  world.processes.push({ pid: 300, ppid: 4, exe: path.join(GAME_DIR, 'downwell.exe') });
  world.windows = [{ hwnd: 30, pid: 300 }];
  world.appId = 360740;
  const { session, clock } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(250);
  assert.strictEqual(session.state(), 'playing');
  world.processes = [];
  world.windows = [];
  let over = false;
  session.done.then(() => { over = true; });
  await clock.advance(500);
  assert.strictEqual(over, false, 'a short gap is not the end');
  await clock.advance(500);
  assert.strictEqual(over, true);
});

test('a game started through another launcher is followed by the Steam game id', async () => {
  const world = fakeWindows();
  world.appId = 1238810;
  const { session, clock, states } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(19000);
  assert.deepStrictEqual(states, ['loading']);
  await clock.advance(1250);
  assert.deepStrictEqual(states, ['loading', 'handoff', 'playing:{"front":null}']);
  assert.deepStrictEqual(world.fronted, []);
  await clock.advance(5000);
  assert.strictEqual(session.state(), 'playing');
  world.appId = 0;
  await clock.advance(250);
  assert.strictEqual((await session.done).status, 'ended');
});

test('a Steam game that never starts fails after the long wait', async () => {
  const world = fakeWindows();
  const { session, clock } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(5 * 60 * 1000 + 250);
  const outcome = await session.done;
  assert.strictEqual(outcome.status, 'failed');
  assert.strictEqual(outcome.timedOut, true);
});

test('B while loading cancels, but not once the game is playing', async () => {
  const world = fakeWindows();
  const { session, clock, states } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(1000);
  assert.strictEqual(session.cancel(), true);
  assert.strictEqual((await session.done).status, 'cancelled');
  assert.deepStrictEqual(states, ['loading', 'restoring', 'idle']);

  const other = fakeWindows();
  other.processes.push({ pid: 300, ppid: 4, exe: path.join(GAME_DIR, 'downwell.exe') });
  other.windows = [{ hwnd: 30, pid: 300 }];
  const playing = start({ kind: 'steam', installDir: GAME_DIR }, other);
  await playing.clock.advance(250);
  assert.strictEqual(playing.session.cancel(), false);
});

test('the running game can be brought back to front, even with a new window', async () => {
  const world = fakeWindows();
  world.processes.push({ pid: 300, ppid: 4, exe: path.join(GAME_DIR, 'downwell.exe') });
  world.windows = [{ hwnd: 9, pid: 300 }];
  const { session, clock } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(250);
  assert.strictEqual(session.alive(), true);
  world.windows = [{ hwnd: 12, pid: 300 }];
  assert.strictEqual(session.focus(), true);
  assert.deepStrictEqual(world.fronted, [9, 12]);
  assert.strictEqual(session.window(), 12);
  world.processes = [];
  await clock.advance(1000);
  await session.done;
  assert.strictEqual(session.alive(), false);
  assert.strictEqual(session.focus(), false);
  assert.strictEqual(session.window(), null);
});

test('without the renderer answering, the handoff goes ahead after 300 ms', async () => {
  const world = fakeWindows();
  world.processes.push({ pid: 300, ppid: 4, exe: path.join(GAME_DIR, 'downwell.exe') });
  world.windows = [{ hwnd: 9, pid: 300 }];
  const { session, clock } = start({ kind: 'steam', installDir: GAME_DIR }, world, { ack: false });
  await clock.advance(200);
  assert.strictEqual(session.state(), 'handoff');
  assert.deepStrictEqual(world.fronted, []);
  await clock.advance(100);
  assert.strictEqual(session.state(), 'playing');
  assert.deepStrictEqual(world.fronted, [9]);
  world.processes = [];
  await clock.advance(1000);
  await session.done;
});

test('without native access a PC game hands over once it has run for 800 ms', async () => {
  const world = fakeWindows({ native: false });
  const game = launched();
  const { session, clock, states } = start(game.target, world);
  await clock.advance(700);
  assert.deepStrictEqual(states, ['loading']);
  await clock.advance(250);
  assert.deepStrictEqual(states, ['loading', 'handoff', 'playing:{"front":null}']);
  assert.strictEqual(session.focus(), false);
  game.exit();
  assert.strictEqual((await session.done).status, 'ended');
});

test('without native access Steam is followed by its game id every 500 ms', async () => {
  const world = fakeWindows({ native: false });
  const { session, clock } = start({ kind: 'steam', installDir: GAME_DIR }, world);
  await clock.advance(2000);
  assert.strictEqual(session.state(), 'loading');
  world.appId = 360740;
  await clock.advance(500);
  assert.strictEqual(session.state(), 'playing');
  world.appId = 0;
  let over = false;
  session.done.then(() => { over = true; });
  await clock.advance(500);
  assert.strictEqual(over, true);
});
