const KEY_ACTIONS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'a',
  Escape: 'b',
  ' ': 'x',
  f: 'y',
  F: 'y',
  s: 'menu',
  S: 'menu',
  Tab: 'view',
  l: 'fav',
  L: 'fav',
  h: 'hide',
  H: 'hide',
  ',': 'settings',
};

const PAD_ACTIONS = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 8: 'view', 9: 'menu', 10: 'fav', 11: 'hide', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const STICK_DEADZONE = 0.5;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

const inputHandlers = [];
let keyCapture = null;

function captureKeys(handler) {
  keyCapture = handler;
}

function listenForInput(handler) {
  inputHandlers.push(handler);
}

function emitAction(action) {
  let sound = null;
  for (const handler of inputHandlers) sound = handler(action) || sound;
  if (sound) playSound(sound);
}

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (keyCapture && keyCapture(event)) {
    event.preventDefault();
    return;
  }
  const action = KEY_ACTIONS[event.key];
  if (!action) return;
  // Stops Enter or Space from also clicking whatever has focus, so each press counts once.
  event.preventDefault();
  if (event.repeat && !DIRECTIONS.has(action)) return;
  emitAction(action);
});

function heldPadActions() {
  const held = new Set();
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue;
    pad.buttons.forEach((button, index) => {
      if (button.pressed && PAD_ACTIONS[index]) held.add(PAD_ACTIONS[index]);
    });
    const [x = 0, y = 0] = pad.axes;
    if (x < -STICK_DEADZONE) held.add('left');
    if (x > STICK_DEADZONE) held.add('right');
    if (y < -STICK_DEADZONE) held.add('up');
    if (y > STICK_DEADZONE) held.add('down');
  }
  return held;
}

const nextFire = new Map();

function pollPads(now) {
  const held = heldPadActions();
  for (const action of nextFire.keys()) {
    if (!held.has(action)) nextFire.delete(action);
  }
  for (const action of held) {
    if (!nextFire.has(action)) {
      emitAction(action);
      nextFire.set(action, DIRECTIONS.has(action) ? now + REPEAT_DELAY_MS : Infinity);
    } else if (now >= nextFire.get(action)) {
      emitAction(action);
      nextFire.set(action, now + REPEAT_EVERY_MS);
    }
  }
  requestAnimationFrame(pollPads);
}

requestAnimationFrame(pollPads);
