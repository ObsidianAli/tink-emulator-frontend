const path = require('node:path');
const { gameProcesses } = require('./steam');
const { pickGameWindow, descendants } = require('./win32');

const POLL_MS = 250;
const PLAIN_POLL_MS = 500;
const STEAM_GRACE_MS = 750;
// Some Steam games start through another company's launcher installed outside their own folder.
const LAUNCHER_AFTER_MS = 20 * 1000;
const PLAIN_HANDOFF_MS = 800;
const ACK_TIMEOUT_MS = 300;
// Generous: a first launch can wait on an update or a Steam login.
const START_TIMEOUT_MS = 5 * 60 * 1000;
// Without the native process list only tasklist can tell a Steam crash apart, and it is too slow to run every poll.
const STEAM_CHECK_EVERY = 4;

const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const attempt = (fn, ...args) => {
  try {
    return fn ? fn(...args) : null;
  } catch {
    return null;
  }
};

function startSession(target, { platform, clock = realClock, onState = () => {}, restore = async () => {} }) {
  const native = Boolean(platform.processes);
  let state = 'idle';
  let cancelled = false;
  let gameWindow = null;
  let acknowledge;
  const acked = new Promise((resolve) => { acknowledge = resolve; });
  let wakeUp;
  let poked = new Promise((resolve) => { wakeUp = resolve; });

  function poke() {
    wakeUp();
    poked = new Promise((resolve) => { wakeUp = resolve; });
  }

  const nap = (ms) => (ms === null ? poked : Promise.race([clock.sleep(ms), poked]));

  function set(next, info) {
    state = next;
    onState(next, info);
  }

  async function handoff(hwnd) {
    set('handoff');
    await Promise.race([acked, clock.sleep(ACK_TIMEOUT_MS)]);
    gameWindow = hwnd;
    const front = hwnd === null ? null : Boolean(attempt(platform.bringToFront, hwnd));
    set('playing', { front });
  }

  function emulatorPids() {
    const processes = attempt(platform.processes);
    return processes ? new Set([target.child.pid, ...descendants(processes, target.child.pid)]) : null;
  }

  function steamPids() {
    const processes = attempt(platform.processes);
    return processes ? new Set(gameProcesses(processes, target.installDir)) : null;
  }

  const appId = () => Promise.resolve(attempt(platform.runningAppId)).catch(() => null);
  const findWindow = (pids) => (pids && pids.size ? pickGameWindow(attempt(platform.windows), pids) : null);

  async function watchEmulator() {
    let exit = null;
    target.exited.then(
      () => { exit = { status: 'ended' }; poke(); },
      (error) => { exit = { status: 'failed', error }; poke(); },
    );
    const start = clock.now();
    for (;;) {
      if (exit) return exit;
      if (cancelled) return { status: 'cancelled' };
      if (state !== 'loading') {
        await nap(null);
        continue;
      }
      const hwnd = native ? findWindow(emulatorPids()) : null;
      const left = (native ? LAUNCHER_AFTER_MS : PLAIN_HANDOFF_MS) - (clock.now() - start);
      if (hwnd !== null) await handoff(hwnd);
      else if (left <= 0) await handoff(null);
      else await nap(Math.min(POLL_MS, left));
    }
  }

  async function watchSteamNative() {
    const start = clock.now();
    let seen = false;
    let lastSeen = 0;
    let viaLauncher = false;
    for (;;) {
      if (cancelled) return { status: 'cancelled' };
      const now = clock.now();
      const processes = attempt(platform.processes);
      if (processes) {
        const pids = new Set(gameProcesses(processes, target.installDir));
        if (pids.size) {
          seen = true;
          lastSeen = now;
          if (state === 'loading') {
            const hwnd = findWindow(pids);
            if (hwnd !== null || now - start >= LAUNCHER_AFTER_MS) {
              await handoff(hwnd);
              continue;
            }
          }
        } else if (seen) {
          if (now - lastSeen >= STEAM_GRACE_MS || (await appId()) === 0) return { status: 'ended' };
        } else if (now - start >= LAUNCHER_AFTER_MS) {
          const running = await appId();
          const steamUp = processes.some(({ exe }) => exe && path.basename(exe).toLowerCase() === 'steam.exe');
          if (running) viaLauncher = true;
          if (viaLauncher && (running === 0 || !steamUp)) return { status: 'ended' };
          if (viaLauncher && state === 'loading') {
            await handoff(null);
            continue;
          }
        }
      }
      if (!seen && !viaLauncher && now - start >= START_TIMEOUT_MS) return { status: 'failed', timedOut: true };
      await nap(POLL_MS);
    }
  }

  async function watchSteamPlain() {
    const start = clock.now();
    let started = false;
    for (let round = 0; ; round++) {
      if (cancelled) return { status: 'cancelled' };
      const running = await appId();
      if (running) {
        started = true;
        if (state === 'loading') {
          await handoff(null);
          continue;
        }
        if (platform.steamRunning && round % STEAM_CHECK_EVERY === 0 && !(await platform.steamRunning())) return { status: 'ended' };
      } else if (running === 0 && started) {
        return { status: 'ended' };
      }
      if (!started && clock.now() - start >= START_TIMEOUT_MS) return { status: 'failed', timedOut: true };
      await nap(PLAIN_POLL_MS);
    }
  }

  async function run() {
    set('loading');
    let outcome;
    try {
      if (target.kind === 'emulator') outcome = await watchEmulator();
      else outcome = await (native ? watchSteamNative() : watchSteamPlain());
    } catch (error) {
      outcome = { status: 'failed', error };
    }
    if (outcome.status === 'ended') set('ended');
    set('restoring');
    try {
      await restore(outcome);
    } finally {
      set('idle');
    }
    return outcome;
  }

  const done = run();

  return {
    done,
    state: () => state,
    ready: () => acknowledge(),
    cancel() {
      if (state !== 'loading') return false;
      cancelled = true;
      poke();
      return true;
    },
    alive() {
      if (state !== 'playing') return false;
      if (!native) return true;
      if (target.kind === 'emulator') return target.child.exitCode === null && target.child.signalCode === null;
      const pids = steamPids();
      return pids === null || pids.size > 0 || gameWindow === null;
    },
    focus() {
      if (state !== 'playing') return false;
      const hwnd = native ? findWindow(target.kind === 'emulator' ? emulatorPids() : steamPids()) ?? gameWindow : gameWindow;
      return hwnd !== null && Boolean(attempt(platform.bringToFront, hwnd));
    },
  };
}

module.exports = { startSession };
