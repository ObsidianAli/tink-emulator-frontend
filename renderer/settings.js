import { element, focusRow, shortPath } from './dom.js';
import { screen } from './transition.js';

const root = document.getElementById('settings');
let active = null;

// Registered before the shelf's handler, so the press that closes Settings isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const settingsOpen = () => active !== null;

export function hideSettings() {
  root.hidden = true;
}

export async function openSettings({ focusConsole } = {}) {
  let state = await window.tink.getSettings();
  return new Promise((resolve) => {
    let changed = false;
    let focus = 0;
    let rows = [];
    let nodes = [];
    let typing = false;
    const done = new Set();
    let view = 'top';
    let update = '';
    let pendingFocus = null;

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

    const link = (name, label, status) => ({ id: name, label, status, hint: 'Open', activate: () => { view = name; focus = 0; render(); } });

    async function checkUpdates() {
      if (update === 'Checking…') return;
      update = 'Checking…';
      render();
      let result;
      try {
        result = await window.tink.checkForUpdates();
      } catch {
        result = { status: 'failed' };
      }
      update = result.status === 'failed' ? "Couldn't check" : 'Up to date';
      render();
      if (result.status !== 'ready') return;
      update = '';
      render();
      const ok = await showDialog({ message: `Update available (${result.version}).`, confirm: 'Update', cancel: 'Not now', sound: 'confirm' });
      if (ok) await window.tink.applyUpdate();
    }

    const buildRows = () => {
      if (view === 'emulators') {
        return state.consoles.map((item) => {
          const emulator = item.emulator;
          return {
            console: item.id,
            label: item.name,
            status: emulator.status,
            found: emulator.found,
            hint: 'Pick',
            second: { label: 'Find automatically', run: () => change(window.tink.findAutomatically(emulator.id)) },
            activate: () => change(window.tink.pickExe(emulator.id)),
          };
        });
      }
      if (view === 'folders') {
        return state.consoles.map((item) => ({
          label: item.name,
          status: item.folder ? shortPath(item.folder) : 'None',
          found: Boolean(item.folder),
          hint: 'Pick',
          second: item.folder ? { label: 'Skip', run: () => change(window.tink.clearFolder(item.id)) } : null,
          activate: () => change(window.tink.pickFolder(item.id)),
        }));
      }
      if (view === 'consoles') {
        return state.consoleList.map((item) => ({
          label: item.name,
          status: item.hidden ? 'Hidden' : 'Shown',
          hint: item.hidden ? 'Show' : 'Hide',
          sound: 'toggle',
          activate: () => change(window.tink.toggleConsole(item.id)),
        }));
      }
      const emulatorsFound = state.consoles.filter((item) => item.emulator.found).length;
      const foldersSet = state.consoles.filter((item) => item.folder).length;
      const shown = state.consoleList.filter((item) => !item.hidden).length;
      return [
        link('emulators', 'Emulators', `${emulatorsFound} of ${state.consoles.length} found`),
        link('folders', 'Games folders', `${foldersSet} of ${state.consoles.length} set`),
        link('consoles', 'Consoles', `${shown} of ${state.consoleList.length} shown`),
        {
          label: 'Re-download covers',
          group: true,
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
        {
          label: 'Start in fullscreen',
          group: true,
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
        {
          label: 'Hidden games',
          status: state.hiddenGames ? String(state.hiddenGames) : 'None',
          hint: 'Show all',
          sound: 'toggle',
          activate: () => (state.hiddenGames ? change(window.tink.showHiddenGames()) : undefined),
        },
        { label: `Version ${state.version}`, plain: true, group: true },
        { id: 'update', label: 'Check for updates', status: update, hint: 'Check', activate: checkUpdates },
      ];
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
      focusRow(nodes[focus], false);
      showSettingsHints();
    }

    function render() {
      rows = buildRows();
      if (pendingFocus) {
        focus = rows.filter((row) => !row.plain).findIndex(pendingFocus);
        pendingFocus = null;
      }
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      nodes = [];
      const focusable = [];
      for (const row of rows) {
        if (row.plain) {
          list.append(element('p', row.group ? 'setup-note group-start' : 'setup-note', row.label));
          continue;
        }
        const node = element(row.key ? 'div' : 'button', row.group ? 'setup-row group-start' : 'setup-row');
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
      const titles = { top: 'Settings', emulators: 'Emulators', folders: 'Games folders', consoles: 'Consoles' };
      root.replaceChildren(element('h1', '', titles[view]), list);
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      focusRow(nodes[focus], false);
      showSettingsHints();
    }

    function showSettingsHints() {
      const row = rows[focus];
      if (typing) return setHints([{ button: 'a', label: 'Save' }, { button: 'b', label: 'Cancel' }]);
      const hints = [{ button: 'a', label: row.hint || 'Start' }];
      if (row.second) hints.push({ button: 'x', label: row.second.label });
      hints.push({ button: 'b', label: view === 'top' ? 'Close' : 'Back' });
      setHints(hints);
    }

    function close() {
      active.busy = true;
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve(changed);
    }

    active = {
      busy: true,
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
          focusRow(nodes[focus]);
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
          if (view === 'top') close();
          else {
            const id = view;
            view = 'top';
            pendingFocus = (row) => row.id === id;
            render();
          }
          return 'back';
        }
        return null;
      },
    };
    screen(() => {
      root.hidden = false;
      if (focusConsole) {
        view = 'emulators';
        pendingFocus = (row) => row.console === focusConsole;
      }
      render();
      active.busy = false;
    });
  });
}
