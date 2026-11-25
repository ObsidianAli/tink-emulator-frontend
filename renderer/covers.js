import { element, focusGlow, scrollToNode } from './dom.js';
import { screen } from './transition.js';
import { drawTile, stepTile } from './grid.js';

const root = document.getElementById('covers');
const list = document.getElementById('covers-list');
const pageTitle = document.getElementById('covers-title');
const homeTitle = document.getElementById('title');
// A slow lookup opens on the current cover after this long.
const OPEN_MAX_MS = 400;
const AHEAD = 2;
const KEEP = 4;
let active = null;

// Registered before the shelf's handler, so the press that closes the picker isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const coversOpen = () => active !== null;
export const leaveCovers = () => active?.close({ now: true });

const buttons = [{ button: 'a', label: 'Use' }, { button: 'b', label: 'Back' }];

function caseView(game, shelf, makeRoom) {
  const before = [...homeTitle.childNodes];
  const note = element('span', 'title-note');
  const drawn = new Map();
  let index = 0;
  let count = 1;

  const dispose = (made) => made?.textures.forEach((texture) => texture.dispose());

  async function draw(at, entry, whole) {
    const cover = await window.tink.getCoverChoice(game.id, at, whole);
    if (!cover || entry.gone || entry.whole) return;
    const made = await shelf.drawCover(game, cover);
    if (entry.gone || entry.whole) {
      dispose(made);
      return;
    }
    const old = entry.made;
    entry.made = made;
    entry.whole = cover.whole;
    if (at === index) shelf.tryCover(game.id, made);
    dispose(old);
  }

  function load(at) {
    if (at < 1 || at >= count) return;
    if (!drawn.has(at)) {
      const entry = { made: null, whole: false, small: false, gone: false };
      drawn.set(at, entry);
      draw(at, entry, true).catch(() => {});
    }
    const entry = drawn.get(at);
    if (at !== index || entry.made || entry.small) return;
    entry.small = true;
    draw(at, entry, false).catch(() => {});
  }

  function drop(at) {
    const entry = drawn.get(at);
    drawn.delete(at);
    entry.gone = true;
    dispose(entry.made);
  }

  function refill() {
    for (const at of [...drawn.keys()]) if (Math.abs(at - index) > KEEP) drop(at);
    load(index);
    for (let step = 1; step <= AHEAD; step++) {
      load(index + step);
      load(index - step);
    }
    note.textContent = count > 1 ? `${index + 1} of ${count}` : '';
  }

  return {
    index: () => index,
    grow(next) {
      count = next;
      refill();
    },
    open() {
      homeTitle.replaceChildren(element('span', 'title-name', game.title), note);
      makeRoom(true);
      setHints([{ button: ['←', '→'], label: 'Cover' }, ...buttons]);
    },
    move(action) {
      const next = index + (action === 'right' ? 1 : action === 'left' ? -1 : 0);
      if (next === index || next < 0 || next >= count) return false;
      index = next;
      refill();
      const made = drawn.get(index)?.made;
      if (made || index === 0) shelf.tryCover(game.id, made);
      return true;
    },
    wait() {},
    async close() {
      homeTitle.replaceChildren(...before);
      for (const entry of drawn.values()) entry.gone = true;
      makeRoom(false);
      await shelf.tryCover(game.id, null);
      for (const at of [...drawn.keys()]) drop(at);
    },
  };
}

function pageView(game) {
  const tiles = [];
  let index = 0;
  let closed = false;
  let ring = null;

  list.replaceChildren();
  pageTitle.textContent = game.title;

  function hide() {
    closed = true;
    root.hidden = true;
    list.replaceChildren();
  }

  return {
    index: () => index,
    grow(count) {
      while (tiles.length < count) {
        const tile = element('div', 'tile');
        tile.append(element('div', 'tile-art'), focusGlow());
        window.tink.getCoverChoice(game.id, tiles.length, false).then((cover) => drawTile(tile, cover, game.title)).catch(() => {});
        tiles.push(tile);
        list.append(tile);
      }
      tiles[index].classList.add('focused');
    },
    open() {
      screen(() => {
        if (closed) return;
        root.hidden = false;
        list.scrollTop = 0;
        setHints(buttons);
      });
    },
    move(action) {
      const next = stepTile(action, index, tiles.length, list);
      if (next === index) return false;
      tiles[index].classList.remove('focused');
      index = next;
      tiles[index].classList.add('focused');
      scrollToNode(list, tiles[index], true, parseFloat(getComputedStyle(list).paddingTop));
      return true;
    },
    wait(on) {
      ring?.remove();
      ring = on ? element('div', 'store-progress waiting') : null;
      ring?.append(element('div', 'store-ring'));
      if (ring) tiles[index].append(ring);
    },
    async close(now) {
      if (now) hide();
      else await screen(hide);
    },
  };
}

export function openCovers(game, { onCase, shelf, refresh, makeRoom }) {
  return new Promise((resolve) => {
    const view = onCase ? caseView(game, shelf, makeRoom) : pageView(game);
    let shown = false;
    let closing = false;
    let using = false;

    function show() {
      if (shown || closing) return;
      shown = true;
      view.open();
    }
    const timer = setTimeout(show, OPEN_MAX_MS);

    async function close({ problem, now = false } = {}) {
      if (closing) return;
      closing = true;
      clearTimeout(timer);
      window.tink.closeCoverChoices(game.id);
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      if (shown) await view.close(now);
      resolve(problem);
    }

    async function use() {
      if (view.index() === 0) return close();
      using = true;
      view.wait(true);
      const ok = await window.tink.useCoverChoice(game.id, view.index()).catch(() => false);
      if (ok) await refresh().catch(() => {});
      if (closing) return;
      using = false;
      view.wait(false);
      if (ok) close();
      else showDialog({ message: "This cover can't be used." });
    }

    async function follow() {
      let state = { count: 0, done: false };
      while (!state.done) {
        state = await window.tink.getCoverChoices(game.id, state.count) || { count: 1, done: true };
        if (closing) return;
        view.grow(state.count);
        if (state.count > 1) show();
      }
      if (state.count < 2) close({ problem: state.needsKey ? 'key' : 'none' });
    }

    active = {
      close,
      handle(action) {
        if (closing) return null;
        if (action === 'b') {
          close();
          return 'back';
        }
        if (!shown || using) return null;
        if (action === 'a') {
          use();
          return 'confirm';
        }
        return view.move(action) ? 'move' : null;
      },
    };
    follow().catch(() => close({ problem: 'none' }));
  });
}
