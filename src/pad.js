const { openHidPads, hidLabel } = require('./hid');

const HOLD_MS = 2000;
const POLL_MS = 50;
const PADS = 4;
// BACK 0x0020 + START 0x0010.
const COMBO = 0x0030;
const LEARN_MS = 10 * 1000;
// A press that opened the screen may still be held, or not reported yet.
const LEARN_SETTLE_MS = 300;
const XINPUT_LABELS = {
  0x0001: 'D-pad up',
  0x0002: 'D-pad down',
  0x0004: 'D-pad left',
  0x0008: 'D-pad right',
  0x0010: 'Menu',
  0x0020: 'View',
  0x0040: 'Left stick',
  0x0080: 'Right stick',
  0x0100: 'LB',
  0x0200: 'RB',
  0x1000: 'A',
  0x2000: 'B',
  0x4000: 'X',
  0x8000: 'Y',
};
const XINPUT_ID = /^xinput:([0-9a-f]{4})$/;
// Older Windows only has the second one.
const DLLS = ['xinput1_4.dll', 'xinput9_1_0.dll'];

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

function comboDown(getButtons) {
  for (let i = 0; i < PADS; i++) {
    const buttons = getButtons(i);
    if (buttons !== null && (buttons & COMBO) === COMBO) return true;
  }
  return false;
}

function xinputPressed(getButtons) {
  const ids = new Set();
  for (let i = 0; i < PADS; i++) {
    const buttons = getButtons(i);
    for (const bit of Object.keys(XINPUT_LABELS).map(Number)) {
      if (buttons & bit) ids.add(`xinput:${bit.toString(16).padStart(4, '0')}`);
    }
  }
  return ids;
}

function buttonLabel(id) {
  const match = XINPUT_ID.exec(id);
  return (match ? XINPUT_LABELS[parseInt(match[1], 16)] : hidLabel(id)) || null;
}

function loadPadReader({ open = openXInput } = {}) {
  for (const dll of DLLS) {
    try {
      const getButtons = open(dll);
      return { dll, read: () => comboDown(getButtons), pressed: () => xinputPressed(getButtons) };
    } catch {}
  }
  return null;
}

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

function pollPad(update, { read, pollMs = POLL_MS, onFail = () => {} }) {
  const interval = setInterval(() => {
    let value;
    try {
      value = read();
    } catch (error) {
      clearInterval(interval);
      update(null);
      onFail(error);
      return;
    }
    update(value);
  }, pollMs);
  return () => clearInterval(interval);
}

function watchCombo(onHold, { holdMs = HOLD_MS, ...poll }) {
  let stopped = false;
  const update = holdTimer(holdMs, () => {
    if (!stopped) onHold();
  });
  const stopPolling = pollPad(update, poll);
  return () => {
    stopped = true;
    stopPolling();
    update(false);
  };
}

function watchPress(onPress, poll) {
  let wasDown = true;
  return pollPad((down) => {
    if (down && !wasDown) onPress();
    wasDown = Boolean(down);
  }, poll);
}

// Some PlayStation and Switch buttons exist only on the pad's own HID device, so that is read beside XInput.
function openButtons({ xinput = loadPadReader(), hid = openHidPads() } = {}) {
  if (!xinput && !hid) return null;
  return {
    pressed: () => new Set([...(hid ? hid.pressed() : []), ...(xinput ? xinput.pressed() : [])]),
    close: () => {
      if (hid) hid.close();
    },
  };
}

function learnButton({ buttons, timeoutMs = LEARN_MS, settleMs = LEARN_SETTLE_MS, pollMs = POLL_MS, now = Date.now }) {
  const start = now();
  const ignored = new Set();
  let cancel;
  const done = new Promise((resolve) => {
    const finish = (id) => {
      stop();
      resolve(id);
    };
    const stop = pollPad((pressed) => {
      if (!pressed) return finish(null);
      for (const id of ignored) if (!pressed.has(id)) ignored.delete(id);
      if (now() - start < settleMs) {
        for (const id of pressed) ignored.add(id);
        return undefined;
      }
      const id = [...pressed].find((held) => !ignored.has(held));
      if (id) return finish(id);
      if (now() - start >= timeoutMs) return finish(null);
      return undefined;
    }, { read: buttons.pressed, pollMs });
    cancel = () => finish(null);
  });
  return { done, cancel };
}

module.exports = { watchCombo, watchPress, learnButton, openButtons, holdTimer, loadPadReader, comboDown, buttonLabel };
