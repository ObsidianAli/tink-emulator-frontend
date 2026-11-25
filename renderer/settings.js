import { element, focusGlow, focusRow, shortPath } from './dom.js';
import { screen } from './transition.js';
import { badge, tick } from './badge.js';
import { editProfile, closeProfiles, PROFILES_MAX } from './profiles.js';

const root = document.getElementById('settings');
let active = null;

const CATEGORIES = [
  { id: 'users', name: 'Users' },
  { id: 'library', name: 'Library' },
  { id: 'covers', name: 'Covers' },
  { id: 'display', name: 'Display' },
  { id: 'system', name: 'System' },
];

// Registered before the shelf's handler, so the press that closes Settings isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const settingsOpen = () => active !== null;

export function hideSettings() {
  root.hidden = true;
}

const HIGHLIGHTS = { rim: 'Rim', snake: 'Snake', under: 'Under' };
const EDGES = { slide: 'Slide off', peek: 'Peek', fade: 'Fade' };
const KEYBOARDS = { grid: 'Grid', full: 'Full' };
const ICON_STYLES = { grey: 'Grey', disc: 'Colour when selected', glyph: 'Coloured icon' };
const ICON_ROWS = { separate: 'Separate', bar: 'One bar' };
const BACKGROUNDS = { tint: 'Tint', art: 'Art', drift: 'Drift' };

export async function openSettings({ focusConsole } = {}) {
  let state = await window.tink.getSettings();
  let users = await window.tink.getProfiles();
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
    let category = 0;
    let column = 'categories';
    let categoryNodes = [];
    let pane = null;
    let user = null;
    let choice = null;
    let learning = false;

    async function change(request, { reload = true, swap = false } = {}) {
      active.busy = true;
      try {
        const result = await request;
        if (result && result.error) await showDialog({ message: result.error });
        else if (result !== null && reload) changed = true;
      } finally {
        active.busy = false;
      }
      state = await window.tink.getSettings();
      render({ swap });
    }

    const choose = (id, label, options, current, set) => ({
      id,
      label,
      status: options[current] || Object.values(options)[0],
      hint: 'Open',
      activate: () => {
        view = 'choice';
        choice = { id, label, options, current: options[current] ? current : Object.keys(options)[0], set };
        focus = Object.keys(options).indexOf(choice.current);
        render({ swap: true });
      },
    });

    function pick(value) {
      const { id, set } = choice;
      view = 'top';
      pendingFocus = (row) => row.id === id;
      return change(set(value), { reload: false, swap: true });
    }

    const link = (name, label, status) => ({ id: name, label, status, hint: 'Open', activate: () => { view = name; focus = 0; render({ swap: true }); } });

    async function learnButton() {
      if (learning) return;
      learning = true;
      render();
      await change(window.tink.learnScreenshotButton().finally(() => { learning = false; }), { reload: false });
    }

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

    async function runSteps(options, rowId) {
      active.busy = true;
      const id = await editProfile({ ...options, hide: () => { root.hidden = true; } });
      users = await window.tink.getProfiles();
      await screen(() => {
        closeProfiles();
        root.hidden = false;
        pendingFocus = (row) => row.id === (rowId || id || 'add');
        render();
      });
      active.busy = false;
    }

    async function removeUser(profile) {
      // Lets this press finish before the dialog opens, or the dialog would take it as its own.
      await null;
      if (!await showDialog({ message: `Remove ${profile.name}?`, confirm: 'Remove', cancel: 'Not now', sound: 'list' })) return;
      if (profile.id === users.last) changed = true;
      active.busy = true;
      try {
        await window.tink.removeProfile(profile.id);
        users = await window.tink.getProfiles();
      } finally {
        active.busy = false;
      }
      view = 'top';
      user = null;
      focus = 0;
      render({ swap: true });
    }

    const userProfile = () => users.profiles.find((p) => p.id === user);

    const buildRows = () => {
      if (view === 'user') {
        const profile = userProfile();
        const userRows = [
          { id: 'name', label: 'Nickname', status: profile.name, hint: 'Change', activate: () => runSteps({ id: user, steps: ['name'] }, 'name') },
          { id: 'icon', label: 'Icon', side: profile, hint: 'Change', activate: () => runSteps({ id: user, steps: ['icon', 'colour'] }, 'icon') },
        ];
        if (users.profiles.length > 1) userRows.push({ label: 'Remove', group: true, hint: 'Remove', activate: () => removeUser(profile) });
        return userRows;
      }
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
      if (view === 'choice') {
        return Object.entries(choice.options).map(([value, label]) => ({
          id: value,
          label,
          tick: value === choice.current,
          hint: 'Choose',
          activate: () => pick(value),
        }));
      }
      if (view === 'hidden') {
        return [
          { id: 'all', label: 'Show all', hint: 'Show', activate: () => change(window.tink.showHiddenGames()) },
          ...state.hiddenList.map((game) => ({
            id: game.key,
            label: game.title,
            status: game.consoleName,
            hint: 'Show',
            activate: () => change(window.tink.showGame(game.key)),
          })),
        ];
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
      const panes = {
        users: () => {
          const list = users.profiles.map((profile) => ({
            id: profile.id,
            label: profile.name,
            badge: profile,
            status: profile.id === users.last ? 'Current' : '',
            hint: 'Open',
            activate: () => {
              user = profile.id;
              view = 'user';
              focus = 0;
              render({ swap: true });
            },
          }));
          if (users.profiles.length < PROFILES_MAX) list.push({ id: 'add', label: 'Add user', group: true, hint: 'Add', activate: () => runSteps({}) });
          return list;
        },
        library: () => [
          link('emulators', 'Emulators', `${emulatorsFound} of ${state.consoles.length} found`),
          link('folders', 'Games folders', `${foldersSet} of ${state.consoles.length} set`),
          link('consoles', 'Consoles', `${shown} of ${state.consoleList.length} shown`),
          {
            id: 'hidden',
            label: 'Hidden games',
            group: true,
            status: state.hiddenList.length ? String(state.hiddenList.length) : 'None',
            hint: 'Open',
            activate: () => {
              if (!state.hiddenList.length) return;
              view = 'hidden';
              focus = 0;
              render({ swap: true });
            },
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
        ],
        covers: () => [
          {
            label: 'SteamGridDB key',
            key: true,
            hint: 'Type',
            second: state.hasKey ? { label: 'Clear', run: () => change(window.tink.setSteamKey(''), { reload: false }) } : null,
            activate: () => startTyping(),
          },
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
        ],
        display: () => [
          {
            label: 'Start in fullscreen',
            status: state.fullscreen ? 'On' : 'Off',
            hint: 'Switch',
            sound: 'toggle',
            activate: () => change(window.tink.setFullscreen(!state.fullscreen), { reload: false }),
          },
          choose('edge', 'Left edge', EDGES, state.leftEdge, (value) => window.tink.setLeftEdge(value)),
          choose('highlight', 'Highlight', HIGHLIGHTS, state.focusStyle, (value) => window.tink.setFocusStyle(value)),
          choose('keyboard', 'Keyboard', KEYBOARDS, state.keyboard, (value) => window.tink.setKeyboard(value)),
          {
            label: 'Profiles on Home',
            status: state.homeProfiles ? 'On' : 'Off',
            hint: 'Switch',
            sound: 'toggle',
            activate: () => change(window.tink.setHomeProfiles(!state.homeProfiles), { reload: false }),
          },
          choose('icons', 'Icons', ICON_STYLES, state.iconStyle, (value) => window.tink.setIconStyle(value)),
          choose('iconRow', 'Icon row', ICON_ROWS, state.iconRow, (value) => window.tink.setIconRow(value)),
          choose('background', 'Background', BACKGROUNDS, state.background, (value) => window.tink.setBackground(value)),
        ],
        system: () => [
          { label: 'Version', status: state.version, plain: true },
          { id: 'update', label: 'Check for updates', status: update, hint: 'Check', activate: checkUpdates },
          {
            id: 'screenshot',
            label: 'Screenshot button',
            status: learning ? 'Press a button' : state.screenshotButton ? state.screenshotButton.label : 'None',
            hint: 'Set',
            second: state.screenshotButton ? { label: 'Clear', run: () => change(window.tink.clearScreenshotButton(), { reload: false }) } : null,
            activate: learnButton,
          },
        ],
      };
      return panes[CATEGORIES[category].id]();
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

    function build() {
      const categories = element('div', 'settings-categories');
      categoryNodes = CATEGORIES.map((item, index) => {
        const node = element('button', 'settings-category', item.name);
        node.type = 'button';
        node.append(focusGlow());
        node.addEventListener('click', () => {
          if (typing) return;
          const swap = index !== category || view !== 'top';
          category = index;
          column = 'categories';
          view = 'top';
          render({ swap });
        });
        return node;
      });
      categories.append(element('h1', '', 'Settings'), ...categoryNodes);
      pane = element('div', 'settings-pane');
      root.replaceChildren(categories, pane);
    }

    function render({ swap = false } = {}) {
      if (view === 'hidden' && !state.hiddenList.length) {
        view = 'top';
        pendingFocus = (row) => row.id === 'hidden';
      }
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
        const node = element(row.key || row.plain ? 'div' : 'button', 'setup-row');
        if (row.group) node.classList.add('group-start');
        if (row.plain) node.classList.add('plain');
        else if (row.key) node.tabIndex = 0;
        else node.type = 'button';
        const name = element('span', 'setup-name', row.label);
        if (row.sub) name.append(element('span', 'setup-sub', row.sub));
        if (row.badge) name.prepend(badge(row.badge, { className: 'small' }));
        node.append(name);
        if (row.side) node.append(badge(row.side, { className: 'small' }));
        if (row.tick) node.append(tick());
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
        if (!row.plain) node.append(focusGlow());
        list.append(node);
        if (row.plain) continue;
        node.addEventListener('click', () => {
          focus = focusable.indexOf(row);
          column = 'pane';
          if (!typing) row.activate();
        });
        nodes.push(node);
        focusable.push(row);
      }
      rows = focusable;
      const titles = { emulators: 'Emulators', folders: 'Games folders', consoles: 'Consoles', hidden: 'Hidden games', choice: choice && choice.label };
      const heading = element('h1', '', view === 'top' ? CATEGORIES[category].name : view === 'user' ? userProfile().name : titles[view]);
      if (swap) {
        heading.classList.add('settings-swap');
        list.classList.add('settings-swap');
      }
      pane.replaceChildren(heading, list);
      categoryNodes.forEach((node, index) => node.classList.toggle('selected', index === category));
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      focusColumn(false);
    }

    function focusColumn(smooth = true) {
      if (column === 'categories') focusRow(categoryNodes[category], false);
      else focusRow(nodes[focus], smooth);
      showSettingsHints();
    }

    function showSettingsHints() {
      if (column === 'categories') return setHints([{ button: 'a', label: 'Open' }, { button: 'b', label: 'Close' }]);
      const row = rows[focus];
      if (typing) return setHints([{ button: 'a', label: 'Save' }, { button: 'b', label: 'Cancel' }]);
      const hints = [{ button: 'a', label: row.hint || 'Start' }];
      if (row.second) hints.push({ button: 'x', label: row.second.label });
      hints.push({ button: 'b', label: 'Back' });
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
        if (column === 'categories') {
          if (action === 'up' || action === 'down') {
            const next = Math.max(0, Math.min(CATEGORIES.length - 1, category + (action === 'down' ? 1 : -1)));
            if (next === category) return null;
            category = next;
            focus = 0;
            render();
            return 'list';
          }
          if (action === 'right' || action === 'a') {
            column = 'pane';
            focus = 0;
            focusColumn(false);
            return action === 'a' ? 'confirm' : 'list';
          }
          if (action === 'b') {
            close();
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
        if (action === 'b' || action === 'left') {
          if (view === 'top') {
            column = 'categories';
            focusColumn();
          } else {
            const id = view === 'user' ? user : view === 'choice' ? choice.id : view;
            view = 'top';
            pendingFocus = (row) => row.id === id;
            render({ swap: true });
          }
          return action === 'b' ? 'back' : 'list';
        }
        return null;
      },
    };
    screen(() => {
      root.hidden = false;
      build();
      if (focusConsole) {
        category = CATEGORIES.findIndex((item) => item.id === 'library');
        column = 'pane';
        view = 'emulators';
        pendingFocus = (row) => row.console === focusConsole;
      }
      render();
      active.busy = false;
    });
  });
}
