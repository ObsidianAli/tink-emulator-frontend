// Keyboard and controller input in the app, turned into a few named actions:
// up, down, left, right, a, b, x, y, lb, rb, menu.

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
};

// Standard gamepad layout button numbers.
const PAD_ACTIONS = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 9: 'menu', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const STICK_DEADZONE = 0.5;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

const inputHandlers = [];

// Calls handler(action) for every press, and plays the sound name it returns, if any. Directions repeat while held; buttons don't.
function listenForInput(handler) {
  inputHandlers.push(handler);
}

// A handler can return the name of the sound its action made; the first one returned plays.
function emitAction(action) {
  let sound = null;
  for (const handler of inputHandlers) sound = handler(action) || sound;
  if (sound) playSound(sound);
}

document.addEventListener('keydown', (event) => {
  // Typing in a text field belongs to the field.
  if (event.target instanceof HTMLInputElement) return;
  const action = KEY_ACTIONS[event.key];
  if (!action) return;
  // Stops Enter or Space from also clicking whatever has focus, so each press counts once.
  event.preventDefault();
  if (event.repeat && !DIRECTIONS.has(action)) return;
  emitAction(action);
});

// Which actions every pad is holding right now, buttons and left stick together.
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

// When each held action fires next, so a held direction repeats.
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
