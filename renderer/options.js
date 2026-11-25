import { element, focusGlow, focusRow } from './dom.js';

const main = document.querySelector('main');
const root = document.getElementById('options');
const scrim = element('div', 'menu-scrim');
root.before(scrim);
const fadeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-ui'));
let active = null;
let hideTimer = 0;

// Registered before the shelf's handler, so the press that closes the options isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const optionsOpen = () => active !== null;
export const leaveOptions = () => active?.close(null);

export function openOptions(game, { beside, removable, shelf, toggle, cover, info }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const top = element('div', 'options-top');
    const art = element('div', 'options-cover');
    const list = element('div', 'setup-list');
    let fav = game.fav;
    let focus = 0;
    let closed = false;

    const rows = [
      { label: 'Favourite', status: () => (fav ? 'On' : 'Off'), hint: 'Switch', sound: 'toggle', run: switchFavourite },
      { label: 'Change cover', run: changeCover },
      { label: 'Hide', run: () => close('hide') },
      { label: 'Game info', run: () => away(info) },
      ...(removable ? [{ label: 'Remove', run: () => close('remove') }] : []),
    ];

    const nodes = rows.map((row, index) => {
      const node = element('button', 'setup-row');
      node.type = 'button';
      node.append(element('span', 'setup-name', row.label));
      if (row.status) node.append(element('span', 'setup-status', row.status()));
      node.append(focusGlow());
      node.addEventListener('click', () => {
        if (active?.busy) return;
        focusOn(index);
        playSound(press());
      });
      return node;
    });

    function focusOn(index) {
      focus = index;
      focusRow(nodes[focus]);
      setHints([{ button: 'a', label: rows[focus].hint || 'Choose' }, { button: 'b', label: 'Back' }]);
    }

    function press() {
      rows[focus].run();
      return rows[focus].sound || 'confirm';
    }

    async function switchFavourite() {
      active.busy = true;
      try {
        await toggle(!fav);
        fav = !fav;
      } finally {
        if (!closed) active.busy = false;
      }
      nodes[0].querySelector('.setup-status').textContent = rows[0].status();
    }

    async function away(run) {
      active.busy = true;
      let result;
      try {
        result = await run();
      } finally {
        if (!closed) {
          active.busy = false;
          focusOn(focus);
        }
      }
      return result;
    }

    function makeRoom(on) {
      if (closed) return;
      root.classList.toggle('open', !on);
      scrim.classList.toggle('open', !beside && !on);
      main.classList.toggle('picking', on);
    }

    async function changeCover() {
      if (await away(() => cover(makeRoom)) === 'settings') close('settings');
      else fillCover();
    }

    async function fillCover() {
      if (beside || closed) return;
      const made = await window.tink.getCover(game.id).catch(() => null);
      if (!made) return;
      if (!made.src) {
        art.style.background = made.plain.colour;
        art.replaceChildren();
        return;
      }
      const image = new Image();
      image.alt = '';
      image.src = made.src;
      await image.decode().catch(() => {});
      art.replaceChildren(image);
    }

    function close(choice) {
      if (closed) return;
      closed = true;
      root.classList.remove('open');
      scrim.classList.remove('open');
      main.classList.remove('beside', 'picking');
      if (beside) shelf.setAlone(false);
      returnFocus(previousFocus, root);
      hideTimer = setTimeout(() => { root.hidden = true; }, fadeMs);
      active.busy = true;
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve(choice);
    }

    active = {
      busy: false,
      close,
      handle(action) {
        if (action === 'up' || action === 'down') {
          const next = Math.max(0, Math.min(nodes.length - 1, focus + (action === 'down' ? 1 : -1)));
          if (next === focus) return null;
          focusOn(next);
          return 'list';
        }
        if (action === 'a') return press();
        if (action === 'b' || action === 'menu') {
          close(null);
          return 'back';
        }
        return null;
      },
    };

    clearTimeout(hideTimer);
    if (!beside) top.append(art);
    top.append(element('h1', '', game.title));
    list.append(...nodes);
    root.className = beside ? 'beside' : 'side';
    root.replaceChildren(top, list);
    root.hidden = false;
    fillCover();
    focusOn(0);
    void root.offsetWidth;
    root.classList.add('open');
    scrim.classList.toggle('open', !beside);
    main.classList.toggle('beside', beside);
    if (beside) shelf.setAlone(true);
  });
}
