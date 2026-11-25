import { element } from './dom.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const GRID_COLUMNS = 9;
const FULL_ROWS = [
  [...'1234567890'].map((id) => ({ id })),
  [...'qwertyuiop'].map((id) => ({ id })),
  [...'asdfghjkl-'].map((id) => ({ id })),
  [{ id: 'shift', label: 'Shift', w: 2 }, ...[...'zxcvbnm'].map((id) => ({ id })), { id: 'delete', label: 'Delete', w: 2 }],
  [{ id: 'space', label: 'Space', w: 8 }, { id: 'ok', label: 'OK', w: 2 }],
];
const PRINTABLE = /^[\p{L}\p{N} '.-]$/u;

function gridKeys() {
  const keys = LETTERS.map((id, i) => ({ id, x: i % GRID_COLUMNS, y: Math.floor(i / GRID_COLUMNS) }));
  ['space', 'delete', 'done'].forEach((id, i) => keys.push({ id, label: id[0].toUpperCase() + id.slice(1), word: true, x: i * 3 + 1, y: 3, span: 3 }));
  return keys;
}

function fullKeys() {
  const keys = [];
  FULL_ROWS.forEach((row, y) => {
    const total = row.reduce((sum, key) => sum + (key.w || 1), 0);
    let at = 0;
    row.forEach((key) => {
      const w = key.w || 1;
      keys.push({ ...key, word: Boolean(key.label), w, x: (at + w / 2) / total, y });
      at += w;
    });
  });
  return keys;
}

export function createKeyboard({ design, text = '', max, placeholder, onDone, onBack }) {
  const full = design === 'full';
  const keys = full ? fullKeys() : gridKeys();
  const doneIndex = keys.findIndex((key) => key.id === (full ? 'ok' : 'done'));
  let value = text.slice(0, max);
  let at = 0;
  let shift = full && value === '';
  let physical = false;

  const caps = () => value === '' || value.endsWith(' ');
  const upper = () => (full ? shift : caps());

  const nameText = element('span', 'profile-name-text');
  const field = element('div', 'profile-name');
  field.append(nameText, element('span', 'profile-caret'));
  const board = element('div', full ? 'keyboard keyboard-full' : 'keyboard keyboard-grid');
  const nodes = keys.map((key) => {
    const node = element('button', key.word ? 'key key-word' : 'key');
    node.type = 'button';
    node.tabIndex = -1;
    if (key.id === 'ok') node.classList.add('key-ok');
    if (full) node.style.flexGrow = key.w;
    else if (key.span) node.style.gridColumn = `span ${key.span}`;
    node.addEventListener('click', () => {
      at = keys.indexOf(key);
      handle('a');
    });
    return node;
  });
  if (full) {
    FULL_ROWS.forEach((row, y) => {
      const line = element('div', 'keyboard-row');
      line.append(...nodes.filter((_, i) => keys[i].y === y));
      board.append(line);
    });
  } else {
    board.append(...nodes);
  }

  function update() {
    nameText.textContent = value || placeholder;
    nameText.classList.toggle('placeholder', value === '');
    keys.forEach((key, i) => {
      const node = nodes[i];
      const label = key.label || (upper() ? key.id.toUpperCase() : key.id);
      if (node.textContent !== label) node.textContent = label;
      node.classList.toggle('focused', i === at);
      node.classList.toggle('on', key.id === 'shift' && shift);
    });
  }

  function insert(char, typed = false) {
    if (value.length >= max) return false;
    if (char === ' ') {
      if (value === '' || value.endsWith(' ')) return false;
      value += ' ';
    } else {
      value += full ? (shift && !typed ? char.toUpperCase() : char) : caps() ? char.toUpperCase() : char;
      if (shift && /\p{L}/u.test(char)) shift = false;
    }
    return true;
  }

  function erase() {
    if (!value) return false;
    value = value.slice(0, -1);
    if (full && value === '') shift = true;
    return true;
  }

  function move(action) {
    const key = keys[at];
    const dx = { left: -1, right: 1 }[action] || 0;
    const dy = { up: -1, down: 1 }[action] || 0;
    if (!dx && !dy) return null;
    let best = at;
    let nearest = Infinity;
    keys.forEach((other, i) => {
      if (dy ? other.y !== key.y + dy : other.y !== key.y || Math.sign(other.x - key.x) !== dx) return;
      const distance = Math.abs(other.x - key.x);
      if (distance < nearest) {
        nearest = distance;
        best = i;
      }
    });
    if (best === at) return null;
    at = best;
    return 'move';
  }

  function press() {
    const { id } = keys[at];
    if (id === (full ? 'ok' : 'done')) {
      onDone();
      return 'confirm';
    }
    if (id === 'delete') return erase() ? 'back' : null;
    if (id === 'shift') {
      shift = !shift;
      return 'toggle';
    }
    return insert(id === 'space' ? ' ' : id) ? 'list' : null;
  }

  function handle(action) {
    physical = false;
    let sound = null;
    if (action === 'a') sound = press();
    else if (action === 'b') {
      if (value === '') {
        onBack();
        return 'back';
      }
      sound = erase() ? 'back' : null;
    } else if (action === 'y' && full) {
      shift = !shift;
      sound = 'toggle';
    } else if (action === 'menu') {
      if (at !== doneIndex) sound = 'move';
      at = doneIndex;
    } else sound = move(action);
    update();
    return sound;
  }

  function type(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'Enter' && physical) {
      if (!event.repeat) {
        onDone();
        playSound('confirm');
      }
      return true;
    }
    let sound = null;
    if (event.key === 'Backspace') sound = erase() ? 'back' : null;
    else if (PRINTABLE.test(event.key)) sound = insert(event.key, true) ? 'list' : null;
    else return false;
    physical = true;
    update();
    if (sound) playSound(sound);
    return true;
  }

  update();
  return { field, board, handle, type, value: () => value };
}
