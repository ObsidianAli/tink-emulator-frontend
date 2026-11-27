import { element, focusGlow } from './dom.js';

const root = document.getElementById('case-menu');
const scrim = element('div', 'menu-scrim');
root.before(scrim);
let active = null;
let hideTimer = 0;

// Registered before the shelf's handler, so the press that closes the panel isn't also taken by the shelf.
listenForInput((action) => {
  if (!active) return null;
  return active.handle(action);
});

export const caseMenuOpen = () => active !== null;

export function openMenu({ choices, anchor = null }) {
  return new Promise((resolve) => {
    let focus = 0;
    const nodes = choices.map((choice, index) => {
      const node = element('button', 'setup-row', choice.label);
      node.type = 'button';
      node.append(focusGlow());
      node.addEventListener('click', () => {
        focus = index;
        active.handle('a');
      });
      return node;
    });

    const previousFocus = document.activeElement;

    function close(choice) {
      root.classList.remove('open');
      scrim.classList.remove('open');
      returnFocus(previousFocus, root);
      hideTimer = setTimeout(() => { root.hidden = true; }, overlayMs());
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve(choice);
    }

    active = {
      handle(action) {
        if (action === 'up' || action === 'down') {
          const before = focus;
          focus = Math.max(0, Math.min(nodes.length - 1, focus + (action === 'down' ? 1 : -1)));
          nodes[focus].focus();
          return focus !== before ? 'list' : null;
        }
        if (action === 'a') {
          close(choices[focus].id);
          return 'confirm';
        }
        if (action === 'b' || action === 'menu') {
          close(null);
          return 'back';
        }
        return null;
      },
    };
    clearTimeout(hideTimer);
    root.replaceChildren(...nodes);
    root.classList.toggle('anchored', anchor !== null);
    root.hidden = false;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const margin = rect.height / 4;
      const left = rect.left + rect.width / 2 - root.offsetWidth / 2;
      root.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - root.offsetWidth - margin))}px`;
      root.style.bottom = `${window.innerHeight - rect.top}px`;
    } else {
      root.style.left = '';
      root.style.bottom = '';
    }
    nodes[0].focus();
    void root.offsetWidth;
    root.classList.add('open');
    scrim.classList.add('open');
    setHints([{ button: 'a', label: 'Choose' }, { button: 'b', label: 'Close' }]);
  });
}
