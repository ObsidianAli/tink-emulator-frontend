import { element, focusRow, focusGlow } from './dom.js';
import { screen as changeScreen } from './transition.js';
import { badge, ICONS } from './badge.js';

const root = document.getElementById('profiles');
const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'];
const BUILT_IN = Object.keys(ICONS);
const NAME_MAX = 10;
const PROFILES_MAX = 8;
let active = null;

// Registered before the shelf's handler, so the press that picks a profile isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const profilesOpen = () => active !== null;

const columns = (name) => parseInt(getComputedStyle(root).getPropertyValue(name), 10) || 1;

export function closeProfiles() {
  root.hidden = true;
}

export async function chooseProfile({ canCancel = false, stay = false } = {}) {
  let data = await window.tink.getProfiles();
  if (data.profiles.length === 1 && !canCancel) {
    await window.tink.chooseProfile(data.profiles[0].id);
    return true;
  }
  return new Promise((resolve) => {
    let screen = 'pick';
    let focus = Math.max(0, data.profiles.findIndex((p) => p.id === data.last));
    let editing = null;
    let draft = null;
    let avatars = [];
    let tiles = [];
    let nodes = [];
    let rows = [];
    let preview = null;

    const refresh = async () => { data = await window.tink.getProfiles(); };
    const current = () => data.profiles.find((p) => p.id === editing);
    const indexOf = (id) => Math.max(0, data.profiles.findIndex((p) => p.id === id));

    async function busy(work) {
      active.busy = true;
      try {
        return await work();
      } finally {
        active.busy = false;
      }
    }

    function show(next, index = 0) {
      return busy(() => changeScreen(() => {
        screen = next;
        focus = index;
        render();
      }));
    }

    function finish(value) {
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      if (value && stay) resolve(value);
      else changeScreen(closeProfiles).then(() => resolve(value));
    }

    function clickable(list) {
      list.forEach((node, index) => node.addEventListener('click', () => {
        focus = index;
        if (!active.busy) active.handle('a');
      }));
    }

    function split(view, content, ...below) {
      const node = element('div', 'profile-split');
      const side = element('div', 'profile-side');
      side.append(view);
      node.append(side, content, ...below);
      return node;
    }

    function avatar(view) {
      const node = element('span', 'profile-avatar');
      node.append(view, focusGlow());
      return node;
    }

    const large = (view) => badge(view, { className: 'large' });

    function renderPick() {
      const buttons = data.profiles.map((profile) => {
        const node = element('button', 'profile');
        node.type = 'button';
        node.append(avatar(badge(profile)), element('span', '', profile.name));
        return node;
      });
      if (data.profiles.length < PROFILES_MAX) {
        const add = element('button', 'profile');
        add.type = 'button';
        add.append(avatar(element('div', 'badge', '+')), element('span', '', 'Add'));
        buttons.push(add);
      }
      nodes = buttons;
      const row = element('div', 'profile-row');
      row.append(...buttons);
      root.replaceChildren(row);
      clickable(nodes);
    }

    function renderIcons() {
      tiles = [...BUILT_IN.map((icon) => ({ icon })), ...avatars.map((a) => ({ avatar: a.src, file: a.file }))];
      const list = element('div', 'setup-list profile-icons');
      const grid = element('div', 'icon-grid');
      grid.setAttribute('role', 'list');
      nodes = tiles.map((tile) => {
        const node = element('button', 'icon-tile');
        node.type = 'button';
        node.append(badge(tile, { neutral: true }), focusGlow());
        return node;
      });
      grid.append(...nodes);
      list.append(grid);
      root.replaceChildren(element('h1', '', 'Choose an icon'), list);
      clickable(nodes);
    }

    function renderColours() {
      preview = large(draft);
      const swatches = element('div', 'swatches');
      swatches.setAttribute('role', 'list');
      nodes = COLOURS.map((colour) => {
        const node = element('button', 'swatch');
        node.type = 'button';
        node.style.background = `var(--profile-${colour})`;
        node.append(focusGlow());
        return node;
      });
      swatches.append(...nodes);
      root.replaceChildren(element('h1', '', 'Choose a background'), split(preview, swatches));
      clickable(nodes);
    }

    function renderName() {
      const input = element('input', 'settings-key profile-name');
      input.type = 'text';
      input.maxLength = NAME_MAX;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = draft.name;
      const count = element('p', 'profile-count');
      const recount = () => { count.textContent = `${input.value.length} / ${NAME_MAX}`; };
      recount();
      input.addEventListener('input', recount);
      input.addEventListener('keydown', (event) => {
        if (active.busy || (event.key !== 'Enter' && event.key !== 'Escape')) return;
        const action = event.key === 'Enter' ? 'a' : 'b';
        playSound(active.handle(action));
      });
      const field = element('div', 'profile-field');
      field.append(input, count);
      nodes = [input];
      root.replaceChildren(element('h1', '', 'Nickname'), split(large(draft), field));
    }

    function renderProfile() {
      const profile = current();
      rows = [
        { label: 'Nickname', status: profile.name, run: editName },
        { label: 'Icon', run: editIcon },
      ];
      if (data.profiles.length > 1) rows.push({ label: 'Remove', run: remove, gap: true });
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      nodes = rows.map((row) => {
        const node = element('button', row.gap ? 'setup-row group-start' : 'setup-row');
        node.type = 'button';
        node.append(element('span', 'setup-name', row.label));
        if (row.status) node.append(element('span', 'setup-status', row.status));
        return node;
      });
      list.append(...nodes);
      root.replaceChildren(element('h1', '', 'Profile'), split(large(profile), list, element('p', 'profile-nickname', profile.name)));
      clickable(nodes);
    }

    function render() {
      ({ pick: renderPick, icon: renderIcons, colour: renderColours, name: renderName, profile: renderProfile })[screen]();
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      focusRow(nodes[focus], false);
      if (screen === 'name') nodes[0].select();
      showHints();
    }

    function showHints() {
      const back = { button: 'b', label: 'Back' };
      if (screen === 'pick') {
        const onAdd = focus >= data.profiles.length;
        const hints = [{ button: 'a', label: onAdd ? 'Add' : 'Choose' }];
        if (!onAdd) hints.push({ button: 'x', label: 'Edit' });
        if (canCancel) hints.push(back);
        return setHints(hints);
      }
      if (screen === 'profile') return setHints([{ button: 'a', label: rows[focus].gap ? 'Remove' : 'Change' }, { button: 'b', label: 'Done' }]);
      setHints([{ button: 'a', label: 'OK' }, back]);
    }

    const iconIndex = () => {
      if (!draft.avatar) return Math.max(0, BUILT_IN.indexOf(draft.icon));
      return BUILT_IN.length + Math.max(0, avatars.findIndex((a) => a.src === draft.avatar));
    };
    const colourIndex = () => Math.max(0, COLOURS.indexOf(draft.colour));
    const fromProfile = ({ name, colour, icon, avatar }) => ({ name, colour, icon, avatar, file: null });

    async function openIcons() {
      await busy(async () => { avatars = await window.tink.getAvatars(); });
      show('icon', iconIndex());
    }

    async function save(edit) {
      await busy(async () => {
        await window.tink.saveProfile({ id: editing, ...edit });
        await refresh();
      });
    }

    function startNew() {
      editing = null;
      const taken = data.profiles.map((p) => p.colour);
      draft = {
        name: '',
        colour: COLOURS.find((c) => !taken.includes(c)) || COLOURS[data.profiles.length % COLOURS.length],
        icon: BUILT_IN[0],
        avatar: null,
        file: null,
      };
      openIcons();
    }

    function editName() {
      draft = fromProfile(current());
      show('name');
    }

    function editIcon() {
      draft = fromProfile(current());
      openIcons();
    }

    async function remove() {
      // Lets this press finish before the dialog opens, or the dialog would take it as its own.
      await null;
      const profile = current();
      if (!await showDialog({ message: `Remove ${profile.name}?`, confirm: 'Remove', cancel: 'Not now', sound: 'list' })) return;
      await busy(async () => {
        await window.tink.removeProfile(profile.id);
        await refresh();
      });
      editing = null;
      show('pick', 0);
    }

    async function pickIcon() {
      const tile = tiles[focus];
      draft = { ...draft, icon: tile.icon || null, avatar: tile.avatar || null, file: tile.file || null };
      if (tile.icon) return show('colour', colourIndex());
      if (!editing) return show('name');
      await save({ avatar: tile.file });
      show('profile', 1);
    }

    async function pickColour() {
      draft.colour = COLOURS[focus];
      if (!editing) return show('name');
      await save({ icon: draft.icon, colour: draft.colour });
      show('profile', 1);
    }

    async function saveName() {
      const name = nodes[0].value.trim();
      if (editing) {
        if (name) await save({ name });
        return show('profile', 0);
      }
      const id = await busy(async () => {
        const added = await window.tink.addProfile();
        if (added) await window.tink.saveProfile({ id: added, name, colour: draft.colour, icon: draft.icon, avatar: draft.file });
        await refresh();
        return added;
      });
      show('pick', id ? indexOf(id) : data.profiles.length);
    }

    function backFromName() {
      if (editing) return show('profile', 0);
      draft.name = nodes[0].value;
      if (draft.avatar) return show('icon', iconIndex());
      return show('colour', colourIndex());
    }

    function move(action, across) {
      const step = { left: -1, right: 1, up: -across, down: across }[action];
      const next = focus + step;
      if (!step || next < 0 || next >= nodes.length || (across > 1 && Math.abs(step) === 1 && Math.floor(next / across) !== Math.floor(focus / across))) return null;
      focus = next;
      focusRow(nodes[focus]);
      if (screen === 'colour') preview.style.background = `var(--profile-${COLOURS[focus]})`;
      showHints();
      return 'move';
    }

    const screens = {
      pick(action) {
        if (action === 'a') {
          if (focus >= data.profiles.length) {
            startNew();
            return 'confirm';
          }
          busy(() => window.tink.chooseProfile(data.profiles[focus].id)).then(() => finish(true));
          return 'confirm';
        }
        if (action === 'x' && focus < data.profiles.length) {
          editing = data.profiles[focus].id;
          show('profile', 0);
          return 'confirm';
        }
        if (action === 'b' && canCancel) {
          finish(false);
          return 'back';
        }
        return move(action, 1);
      },
      icon(action) {
        if (action === 'a') {
          pickIcon();
          return 'confirm';
        }
        if (action === 'b') {
          if (editing) show('profile', 1);
          else show('pick', data.profiles.length);
          return 'back';
        }
        return move(action, columns('--profile-icon-columns'));
      },
      colour(action) {
        if (action === 'a') {
          pickColour();
          return 'confirm';
        }
        if (action === 'b') {
          show('icon', iconIndex());
          return 'back';
        }
        return move(action, columns('--profile-swatch-columns'));
      },
      name(action) {
        if (action === 'a') {
          saveName();
          return 'confirm';
        }
        if (action === 'b') {
          backFromName();
          return 'back';
        }
        return null;
      },
      profile(action) {
        if (action === 'up' || action === 'down') return move(action, 1) && 'list';
        if (action === 'a') {
          rows[focus].run();
          return 'confirm';
        }
        if (action === 'b') {
          const id = editing;
          editing = null;
          show('pick', indexOf(id));
          return 'back';
        }
        return null;
      },
    };

    active = {
      busy: true,
      handle: (action) => screens[screen](action),
    };
    changeScreen(() => {
      root.hidden = false;
      render();
      active.busy = false;
    });
  });
}
