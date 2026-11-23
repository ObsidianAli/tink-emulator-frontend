// The small panel beside the selected Case, opened with Menu: Favourite, Hide and Game info. Up/Down move, A picks, B closes.
import { element } from './dom.js';

const root = document.getElementById('case-menu');
let active = null;

// Registered before the shelf's handler, so the press that closes the panel isn't also taken by the shelf.
listenForInput((action) => {
  if (!active) return null;
  return active.handle(action);
});

export const caseMenuOpen = () => active !== null;

// Resolves 'fav', 'hide' or 'info', or null when it is closed with B.
export function openCaseMenu({ fav }) {
  return new Promise((resolve) => {
    const choices = [
      { id: 'fav', label: fav ? 'Unfavourite' : 'Favourite' },
      { id: 'hide', label: 'Hide' },
      { id: 'info', label: 'Game info' },
    ];
    let focus = 0;
    const nodes = choices.map((choice, index) => {
      const node = element('button', 'setup-row', choice.label);
      node.type = 'button';
      node.addEventListener('click', () => {
        focus = index;
        active.handle('a');
      });
      return node;
    });

    function close(choice) {
      root.hidden = true;
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
    root.replaceChildren(...nodes);
    root.hidden = false;
    nodes[0].focus();
    setHints([{ button: 'a', label: 'Choose' }, { button: 'b', label: 'Close' }]);
  });
}
