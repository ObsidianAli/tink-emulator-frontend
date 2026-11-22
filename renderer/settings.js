// The Settings screen: one list. Up/Down move, A changes the focused row, X is the row's second action
// (Find automatically, Skip, Clear), B closes. Mouse clicks work too.
import { element, shortPath } from './dom.js';

const root = document.getElementById('settings');
let active = null;

// Registered before the shelf's handler, so the press that closes Settings isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const settingsOpen = () => active !== null;

// Resolves true when something changed that the Shelf needs to reload for.
// focusConsole puts the cursor on that Console's emulator row.
export async function openSettings({ focusConsole } = {}) {
  let state = await window.tink.getSettings();
  return new Promise((resolve) => {
    let changed = false;
    let focus = 0;
    let rows = [];
    let nodes = [];
    let typing = false;
    const done = new Set();

    async function change(request, { reload = true } = {}) {
      active.busy = true;
      try {
        const result = await request;
        if (result && result.error) await showDialog({ message: result.error });
        else if (result !== null && reload) changed = true;
      } finally {
        active.busy = false;
      }
      state = await window.tink.getSettings();
      render();
    }

    const buildRows = () => {
      const list = [
        {
          label: 'Start in fullscreen',
          status: state.fullscreen ? 'On' : 'Off',
          hint: 'Switch',
          sound: 'toggle',
          activate: () => change(window.tink.setFullscreen(!state.fullscreen), { reload: false }),
        },
        {
          label: 'Rescan games',
          hint: 'Rescan',
          status: done.has('rescan') ? 'Done' : '',
          activate: () => {
            changed = true;
            done.add('rescan');
            render();
          },
        },
        { group: 'Covers' },
        {
          label: 'Re-download covers',
          hint: 'Download',
          status: done.has('covers') ? 'Done' : '',
          activate: async () => {
            // Lets this press finish before the dialog opens, or the dialog would take it as its own.
            await null;
            const ok = await showDialog({
              message: 'Replace all covers?',
              confirm: 'Replace',
              cancel: 'Not now',
              sound: 'list',
            });
            if (!ok) return;
            done.add('covers');
            await change(window.tink.redownloadCovers().then(() => undefined));
          },
        },
        {
          label: 'SteamGridDB key',
          key: true,
          hint: 'Type',
          second: state.hasKey ? { label: 'Clear', run: () => change(window.tink.setSteamKey(''), { reload: false }) } : null,
          activate: () => startTyping(),
        },
      ];
      for (const item of state.consoles) {
        const emulator = item.emulator;
        list.push(
          { group: item.name },
          {
            console: item.id,
            label: 'Emulator',
            sub: emulator.label === 'Emulator' ? '' : emulator.label,
            status: emulator.status,
            found: emulator.found,
            hint: 'Pick',
            second: { label: 'Find automatically', run: () => change(window.tink.findAutomatically(emulator.id)) },
            activate: () => change(window.tink.pickExe(emulator.id)),
          },
          {
            label: 'Games folder',
            status: item.folder ? shortPath(item.folder) : 'None',
            found: Boolean(item.folder),
            hint: 'Pick',
            second: item.folder ? { label: 'Skip', run: () => change(window.tink.clearFolder(item.id)) } : null,
            activate: () => change(window.tink.pickFolder(item.id)),
          },
        );
      }
      return list;
    };

    function startTyping() {
      const input = nodes[focus].querySelector('input');
      typing = true;
      input.focus();
      showSettingsHints();
    }

    async function saveKey(input) {
      const value = input.value.trim();
      input.value = '';
      typing = false;
      if (value) await change(window.tink.setSteamKey(value), { reload: false });
      else render();
    }

    function stopTyping(input) {
      input.value = '';
      typing = false;
      nodes[focus].focus();
      showSettingsHints();
    }

    function render() {
      rows = buildRows();
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      nodes = [];
      const focusable = [];
      for (const row of rows) {
        if (row.group) {
          list.append(element('h2', 'settings-group', row.group));
          continue;
        }
        const node = element(row.key ? 'div' : 'button', 'setup-row');
        if (row.key) node.tabIndex = 0;
        else node.type = 'button';
        const name = element('span', 'setup-name', row.label);
        if (row.sub) name.append(element('span', 'setup-sub', row.sub));
        node.append(name);
        if (row.key) {
          const input = element('input', 'settings-key');
          input.type = 'password';
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.placeholder = state.hasKey ? 'Saved' : 'Not set';
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') saveKey(input);
            else if (event.key === 'Escape') stopTyping(input);
          });
          input.addEventListener('blur', () => {
            if (typing && !active.busy) saveKey(input);
          });
          node.append(input);
        } else if (row.status) {
          node.append(element('span', row.found ? 'setup-status found' : 'setup-status', row.status));
        }
        node.addEventListener('click', () => {
          focus = focusable.indexOf(row);
          if (!typing) row.activate();
        });
        list.append(node);
        nodes.push(node);
        focusable.push(row);
      }
      rows = focusable;
      list.append(element('p', 'setup-note', `Tink ${state.version}`));
      root.replaceChildren(element('h1', '', 'Settings'), list);
      focus = Math.min(focus, nodes.length - 1);
      nodes[focus].focus();
      showSettingsHints();
    }

    function showSettingsHints() {
      const row = rows[focus];
      if (typing) return setHints([{ button: 'a', label: 'Save' }, { button: 'b', label: 'Cancel' }]);
      const hints = [{ button: 'a', label: row.hint || 'Start' }];
      if (row.second) hints.push({ button: 'x', label: row.second.label });
      hints.push({ button: 'b', label: 'Close' });
      setHints(hints);
    }

    function close() {
      root.hidden = true;
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve(changed);
    }

    active = {
      busy: false,
      handle(action) {
        if (typing) {
          const input = nodes[focus].querySelector('input');
          if (action === 'a') {
            saveKey(input);
            return 'confirm';
          }
          if (action === 'b') {
            stopTyping(input);
            return 'back';
          }
          return null;
        }
        if (action === 'up' || action === 'down') {
          const before = focus;
          focus = Math.max(0, Math.min(nodes.length - 1, focus + (action === 'down' ? 1 : -1)));
          nodes[focus].focus();
          showSettingsHints();
          return focus !== before ? 'list' : null;
        }
        if (action === 'a') {
          rows[focus].activate();
          return rows[focus].sound || 'confirm';
        }
        if (action === 'x' && rows[focus].second) {
          rows[focus].second.run();
          return 'toggle';
        }
        if (action === 'b') {
          close();
          return 'back';
        }
        return null;
      },
    };
    root.hidden = false;
    if (focusConsole) {
      render();
      focus = Math.max(0, rows.findIndex((row) => row.console === focusConsole));
      nodes[focus].focus();
      showSettingsHints();
    } else {
      render();
    }
  });
}
