import { element, focusGlow, focusRow } from './dom.js';

const root = document.getElementById('setup');
let active = null;

// Registered before the shelf's handler, so a press that closes a dialog isn't also taken as a choice here.
listenForInput((action) => {
  if (!active || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export function runSetup() {
  return new Promise((resolve) => {
    let focus = 0;
    let buttons = [];

    const rows = [
      { label: 'Download', covers: true },
      { label: 'Skip', covers: false },
    ];

    async function finish(covers) {
      active.busy = true;
      await window.tink.finishSetup(covers);
      root.hidden = true;
      active = null;
      resolve();
    }

    function render() {
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      buttons = rows.map((item, index) => {
        const row = element('button', 'setup-row');
        row.type = 'button';
        row.append(element('span', 'setup-name', item.label), focusGlow());
        row.addEventListener('click', () => {
          focus = index;
          finish(item.covers);
        });
        return row;
      });
      list.append(...buttons);
      root.replaceChildren(element('h1', '', 'Covers'), list);
      focusRow(buttons[focus], false);
      setHints([{ button: 'a', label: 'Choose' }]);
    }

    active = {
      busy: false,
      handle(action) {
        if (active.busy) return null;
        if (action === 'up' || action === 'down') {
          const before = focus;
          focus = Math.max(0, Math.min(buttons.length - 1, focus + (action === 'down' ? 1 : -1)));
          focusRow(buttons[focus]);
          return focus !== before ? 'list' : null;
        }
        if (action === 'a') {
          finish(rows[focus].covers);
          return 'confirm';
        }
        return null;
      },
    };
    root.hidden = false;
    render();
  });
}
