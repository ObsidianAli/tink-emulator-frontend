import { element, focusGlow, focusRow } from './dom.js';
import { screen } from './transition.js';

const root = document.getElementById('panel');
let active = null;

// Registered before the shelf's handler, so the press that closes the panel isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const panelOpen = () => active !== null;

export function openPanel({ title, rows, empty = '' }) {
  return new Promise((resolve) => {
    let focus = 0;
    let nodes = [];
    let current = rows;

    function render() {
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      nodes = [];
      if (current.length === 0) list.append(element('p', 'setup-note', empty));
      for (const row of current) {
        const node = element('button', 'setup-row');
        node.type = 'button';
        node.append(element('span', 'setup-name', row.label), focusGlow());
        if (row.run) node.addEventListener('click', () => row.run());
        list.append(node);
        nodes.push(node);
      }
      root.replaceChildren(element('h1', '', title), list);
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      if (nodes.length) focusRow(nodes[focus], false);
      const hints = [];
      if (current.some((row) => row.run)) hints.push({ button: 'a', label: 'Choose' });
      hints.push({ button: 'b', label: 'Back' });
      setHints(hints);
    }

    async function close() {
      active.busy = true;
      await screen(() => { root.hidden = true; });
      active = null;
      resolve();
    }

    active = {
      busy: true,
      handle(action) {
        if (action === 'up' || action === 'down') {
          const before = focus;
          focus = Math.max(0, Math.min(nodes.length - 1, focus + (action === 'down' ? 1 : -1)));
          if (nodes[focus]) focusRow(nodes[focus]);
          return focus !== before ? 'list' : null;
        }
        if (action === 'a') {
          if (!nodes.length || !current[focus].run) return null;
          // After every handler has seen this press, so a dialog it opens doesn't also get it.
          const row = current[focus];
          setTimeout(() => row.run(), 0);
          return 'confirm';
        }
        if (action === 'b') {
          close();
          return 'back';
        }
        return null;
      },
      update(next) {
        current = next;
        render();
      },
    };
    screen(() => {
      root.hidden = false;
      render();
      active.busy = false;
    });
  });
}

export function updatePanel(rows) {
  if (active) active.update(rows);
}
