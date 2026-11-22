// Watches for Select + Start held on an Xbox-style pad while a game runs.
// The window can't read the pad once an emulator has focus, so the main process asks XInput directly.

const HOLD_MS = 2000;
const POLL_MS = 50;
const PADS = 4;
// BACK 0x0020 + START 0x0010.
const COMBO = 0x0030;
// Older Windows only has the second one.
const DLLS = ['xinput1_4.dll', 'xinput9_1_0.dll'];

// Opens one XInput dll. Returns a function giving a pad's buttons, or null when that pad isn't connected.
function openXInput(dll) {
  const koffi = require('koffi');
  const State = koffi.struct({
    packet: 'uint32',
    buttons: 'uint16',
    leftTrigger: 'uint8',
    rightTrigger: 'uint8',
    leftX: 'int16',
    leftY: 'int16',
    rightX: 'int16',
    rightY: 'int16',
  });
  const lib = koffi.load(dll);
  const getState = lib.func('__stdcall', 'XInputGetState', 'uint32', ['uint32', koffi.out(koffi.pointer(State))]);
  return (index) => {
    const state = {};
    return getState(index, state) === 0 ? state.buttons : null;
  };
}

// True when any pad has both buttons down.
function comboDown(getButtons) {
  for (let i = 0; i < PADS; i++) {
    const buttons = getButtons(i);
    if (buttons !== null && (buttons & COMBO) === COMBO) return true;
  }
  return false;
}

// Returns { dll, read } where read() says if the combo is down, or null when no XInput dll loads.
function loadPadReader({ open = openXInput } = {}) {
  for (const dll of DLLS) {
    try {
      const getButtons = open(dll);
      return { dll, read: () => comboDown(getButtons) };
    } catch {}
  }
  return null;
}

// Calls onHold once both buttons have stayed down for holdMs. Releasing early starts the count again.
function holdTimer(holdMs, onHold) {
  let timer = null;
  return (down) => {
    if (down && !timer) {
      timer = setTimeout(onHold, holdMs);
    } else if (!down && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

// Polls read() until the returned function is called. onFail(error) hears if reading the pad breaks.
function watchCombo(onHold, { read, holdMs = HOLD_MS, pollMs = POLL_MS, onFail = () => {} }) {
  let stopped = false;
  const update = holdTimer(holdMs, () => {
    if (!stopped) onHold();
  });
  const interval = setInterval(() => {
    let down;
    try {
      down = read();
    } catch (error) {
      stop();
      onFail(error);
      return;
    }
    update(down);
  }, pollMs);
  function stop() {
    stopped = true;
    clearInterval(interval);
    update(false);
  }
  return stop;
}

module.exports = { watchCombo, holdTimer, loadPadReader, comboDown };
