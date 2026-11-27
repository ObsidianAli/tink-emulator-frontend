const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { addPcGame, removePcGame, rememberRealExe, getAddedGames, pcMatcher } = require('../src/pcadded');
const { startSession } = require('../src/session');

const here = (...parts) => path.join(path.parse(process.cwd()).root, ...parts);
const GAME = here('Games', 'Hollow Quest');
const EXE = path.join(GAME, 'Start.exe');
const exists = () => true;

test('an added game gets a clean title and a library entry as a PC game', () => {
  const settings = {};
  const { id } = addPcGame(settings, { exe: path.join(GAME, 'Hollow_Quest.exe') }, { isFile: exists });
  const [game] = getAddedGames(settings);
  assert.strictEqual(game.id, `pc:${id}`);
  assert.deepStrictEqual([game.console, game.consoleName, game.title, game.installDir], ['pc', 'PC', 'Hollow Quest', GAME]);
  assert.strictEqual(game.fileName, 'Hollow Quest');
});

test('adding the same exe twice keeps one entry, and a given title is cleaned', () => {
  const settings = {};
  const first = addPcGame(settings, { exe: EXE, title: 'Hollow_Quest [Repack]' }, { isFile: exists });
  const second = addPcGame(settings, { exe: EXE.toUpperCase(), title: 'Other' }, { isFile: exists });
  assert.strictEqual(first.id, second.id);
  assert.strictEqual(settings.pcGames.length, 1);
  assert.strictEqual(settings.pcGames[0].title, 'Hollow Quest');
});

test('bad input is refused and nothing is saved', () => {
  const settings = {};
  for (const exe of [undefined, 5, '', 'relative.exe', here('x', 'readme.txt'), `${here('x')}\0.exe`, 'a'.repeat(2000)]) {
    assert.ok(addPcGame(settings, { exe }, { isFile: exists }).error, String(exe));
  }
  assert.ok(addPcGame(settings, { exe: EXE }, { isFile: () => false }).error);
  assert.strictEqual(settings.pcGames, undefined);
});

test('removing takes the library id or the bare id and ignores anything else', () => {
  const settings = {};
  const { id } = addPcGame(settings, { exe: EXE }, { isFile: exists });
  assert.strictEqual(removePcGame(settings, '../x'), false);
  assert.strictEqual(removePcGame(settings, 'pc:ffffffffff'), false);
  assert.strictEqual(removePcGame(settings, `pc:${id}`), true);
  assert.deepStrictEqual(getAddedGames(settings), []);
});

test('the real exe is only remembered when it belongs to the game', () => {
  const settings = {};
  const { id } = addPcGame(settings, { exe: EXE }, { isFile: exists });
  assert.strictEqual(rememberRealExe(settings, id, here('Elsewhere', 'evil.exe')), false);
  assert.strictEqual(rememberRealExe(settings, id, EXE), false);
  assert.strictEqual(rememberRealExe(settings, id, path.join(GAME, 'Bin', 'Game.exe')), true);
  assert.strictEqual(getAddedGames(settings)[0].realExe, path.join(GAME, 'Bin', 'Game.exe'));
});

test('a game counts as open through its launcher child, its folder and its own exe, but a shared folder only by exe', () => {
  const loose = { path: here('Games', 'one.exe'), installDir: here('Games'), exact: true, realExe: null };
  const rows = [
    { pid: 1, ppid: 0, exe: here('Windows', 'explorer.exe') },
    { pid: 2, ppid: 1, exe: loose.path },
    { pid: 3, ppid: 1, exe: here('Games', 'two.exe') },
    { pid: 4, ppid: 2, exe: here('Windows', 'conhost.exe') },
  ];
  assert.deepStrictEqual(pcMatcher(loose, 2)(rows).sort(), [2, 4]);
  const boxed = { path: EXE, installDir: GAME, exact: false, realExe: null };
  const inside = [{ pid: 9, ppid: 1, exe: path.join(GAME, 'Bin', 'real.exe') }, { pid: 8, ppid: 1, exe: here('Games', 'Other', 'o.exe') }];
  assert.deepStrictEqual(pcMatcher(boxed, 0)(inside), [9]);
});

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

function pcSession({ game, childExit = 0 }) {
  const world = { processes: [{ pid: 4, ppid: 0, exe: here('Windows', 'explorer.exe') }], windows: [], fronted: [] };
  const clock = fakeClock();
  const states = [];
  const exes = [];
  const child = { pid: 100, exitCode: childExit, signalCode: null };
  let session;
  const target = {
    kind: 'pc',
    child,
    exited: Promise.resolve(),
    installDir: game.installDir,
    match: pcMatcher(game, 0),
    realExe: () => game.realExe,
    onExe: (exe) => exes.push(exe),
  };
  session = startSession(target, {
    platform: {
      processes: () => world.processes,
      windows: () => world.windows,
      bringToFront: (hwnd) => { world.fronted.push(hwnd); return true; },
      runningAppId: async () => { throw new Error('PC games never ask Steam'); },
    },
    clock,
    onState(state) {
      states.push(state);
      if (state === 'handoff') queueMicrotask(() => session.ready());
    },
    restore: async () => {},
  });
  return { world, clock, states, exes, session };
}

const boxed = () => ({ path: EXE, installDir: GAME, exact: false, realExe: null });

test('a launcher that quits early does not end the game while something from its folder runs', async () => {
  const { world, clock, states, session, exes } = pcSession({ game: boxed() });
  await clock.advance(1000);
  world.processes.push({ pid: 200, ppid: 4, exe: EXE });
  await clock.advance(500);
  world.processes.pop();
  world.processes.push({ pid: 201, ppid: 4, exe: path.join(GAME, 'Bin', 'real.exe') });
  world.windows = [{ hwnd: 21, pid: 201 }];
  await clock.advance(500);
  assert.strictEqual(session.state(), 'playing');
  assert.deepStrictEqual(world.fronted, [21]);
  assert.deepStrictEqual(exes, [path.join(GAME, 'Bin', 'real.exe')]);
  assert.strictEqual(session.alive(), true);
  world.processes.pop();
  world.windows = [];
  await clock.advance(2000);
  assert.strictEqual(session.state(), 'playing', 'a short gap between launcher and game is allowed');
  await clock.advance(1500);
  assert.strictEqual((await session.done).status, 'ended');
  assert.ok(states.includes('handoff'));
});

test('a known real exe gets its window brought forward, not the launcher window', async () => {
  const real = path.join(GAME, 'Bin', 'real.exe');
  const { world, clock, session } = pcSession({ game: { ...boxed(), realExe: real } });
  world.processes.push({ pid: 200, ppid: 4, exe: EXE }, { pid: 201, ppid: 4, exe: real });
  world.windows = [{ hwnd: 20, pid: 200 }, { hwnd: 21, pid: 201 }];
  await clock.advance(500);
  assert.deepStrictEqual(world.fronted, [21]);
  assert.strictEqual(session.focus(), true);
  assert.deepStrictEqual(world.fronted, [21, 21]);
});

test('a game that exited at once and never shows a process fails after ten seconds', async () => {
  const { clock, session, states } = pcSession({ game: boxed(), childExit: 1 });
  await clock.advance(9000);
  assert.strictEqual(session.state(), 'loading');
  await clock.advance(1500);
  const outcome = await session.done;
  assert.deepStrictEqual([outcome.status, outcome.timedOut], ['failed', true]);
  assert.ok(!states.includes('handoff'));
});

test('a game with no window after twenty seconds still counts as playing', async () => {
  const { world, clock, session } = pcSession({ game: boxed() });
  world.processes.push({ pid: 200, ppid: 4, exe: EXE });
  await clock.advance(21000);
  assert.strictEqual(session.state(), 'playing');
});

test('an added game looks its cover up on SteamGridDB by name', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { createCovers } = require('../src/covers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tink-pc-covers-'));
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    return { status: 404, ok: false };
  };
  const covers = createCovers({ dir, enabled: true, steamGridKey: 'k', fetch });
  const [game] = (() => {
    const settings = {};
    addPcGame(settings, { exe: EXE, title: 'Hollow Quest' }, { isFile: exists });
    return getAddedGames(settings);
  })();
  const cover = await covers.getCover(game);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(cover.plain && cover.plain.colour);
  assert.ok(asked[0].includes('/search/autocomplete/Hollow%20Quest'));
});
