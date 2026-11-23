// The profile picker: a row of badges, A picks, X edits, "Add" makes a new one. The edit view is one short list
// (Name, Colour, Picture, Remove); a picture is chosen from a grid of the files in data/avatars.
import { element, focusRow } from './dom.js';

const root = document.getElementById('profiles');
const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'];
const GRID_COLUMNS = 6;
const PROFILES_MAX = 8;
let active = null;

// Registered before the shelf's handler, so the press that picks a profile isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const profilesOpen = () => active !== null;

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// A round badge: the picture when there is one, else the first letter on the profile's colour.
export function badge(profile, small = false) {
  const node = element('div', small ? 'badge small' : 'badge');
  node.style.background = `var(--profile-${profile.colour})`;
  if (profile.avatar) {
    const image = element('img');
    image.src = profile.avatar;
    image.alt = '';
    node.append(image);
  } else {
    node.textContent = profile.name.charAt(0).toUpperCase();
  }
  return node;
}

// Shows the picker and resolves once a profile is chosen. canCancel lets B go back to the shelf, resolving false.
export async function chooseProfile({ canCancel = false } = {}) {
  let data = await window.tink.getProfiles();
  if (data.profiles.length === 1 && !canCancel) {
    await window.tink.chooseProfile(data.profiles[0].id);
    return true;
  }
  return new Promise((resolve) => {
    let screen = 'pick';
    let focus = Math.max(0, data.profiles.findIndex((p) => p.id === data.last));
    let editing = null;
    let avatars = [];
    let nodes = [];
    let rows = [];
    let typing = false;

    const refresh = async () => { data = await window.tink.getProfiles(); };
    const current = () => data.profiles.find((p) => p.id === editing);

    async function busy(work) {
      active.busy = true;
      try {
        await work();
      } finally {
        active.busy = false;
      }
    }

    async function save(edit) {
      await busy(async () => {
        await window.tink.saveProfile({ id: editing, ...edit });
        await refresh();
      });
      render();
    }

    function finish(value) {
      root.hidden = true;
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve(value);
    }

    function show(next, index = 0) {
      screen = next;
      focus = index;
      render();
    }

    function renderPick() {
      const buttons = data.profiles.map((profile) => {
        const node = element('button', 'profile');
        node.type = 'button';
        node.append(badge(profile), element('span', '', profile.name));
        return node;
      });
      if (data.profiles.length < PROFILES_MAX) {
        const add = element('button', 'profile');
        add.type = 'button';
        add.append(element('div', 'badge', '+'), element('span', '', 'Add'));
        buttons.push(add);
      }
      nodes = buttons;
      rows = data.profiles.map((profile) => ({ profile }));
      root.replaceChildren(element('div', 'profile-row'));
      root.firstChild.append(...buttons);
      buttons.forEach((node, index) => node.addEventListener('click', () => {
        focus = index;
        if (!active.busy) active.handle('a');
      }));
    }

    function renderEdit() {
      const profile = current();
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      rows = [
        { label: 'Name', input: true, hint: 'Type' },
        { label: 'Colour', status: capital(profile.colour), hint: 'Change', run: () => save({ colour: COLOURS[(COLOURS.indexOf(profile.colour) + 1) % COLOURS.length] }) },
        { label: 'Picture', status: profile.avatar ? 'Chosen' : 'None', hint: 'Pick', run: pickPicture },
      ];
      if (data.profiles.length > 1) rows.push({ label: 'Remove', hint: 'Remove', run: remove });
      nodes = rows.map((row) => {
        const node = element(row.input ? 'div' : 'button', 'setup-row');
        if (row.input) node.tabIndex = 0;
        else node.type = 'button';
        node.append(element('span', 'setup-name', row.label));
        if (row.input) {
          const input = element('input', 'settings-key');
          input.type = 'text';
          input.maxLength = 16;
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.value = profile.name;
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') saveName(input);
            else if (event.key === 'Escape') stopTyping(input);
          });
          input.addEventListener('blur', () => {
            if (typing && !active.busy) saveName(input);
          });
          node.append(input);
        } else if (row.status) {
          node.append(element('span', 'setup-status', row.status));
        }
        node.addEventListener('click', () => {
          focus = rows.indexOf(row);
          if (!typing && !active.busy) active.handle('a');
        });
        list.append(node);
        return node;
      });
      root.replaceChildren(element('div', 'profile-edit'));
      root.firstChild.append(badge(profile), list);
    }

    function renderAvatars() {
      const profile = current();
      const list = element('div', 'setup-list');
      const grid = element('div', 'avatar-grid');
      grid.setAttribute('role', 'list');
      nodes = [{ ...profile, avatar: null }, ...avatars.map((a) => ({ ...profile, avatar: a.src }))].map((view) => {
        const node = element('button', 'avatar-tile');
        node.type = 'button';
        node.append(badge(view, true));
        return node;
      });
      nodes.forEach((node, index) => node.addEventListener('click', () => {
        focus = index;
        if (!active.busy) active.handle('a');
      }));
      grid.append(...nodes);
      list.append(grid);
      root.replaceChildren(element('div', 'profile-edit'));
      root.firstChild.append(list);
    }

    function render() {
      if (screen === 'pick') renderPick();
      else if (screen === 'edit') renderEdit();
      else renderAvatars();
      focus = Math.min(focus, nodes.length - 1);
      focusRow(nodes[focus], false);
      showHints();
    }

    function showHints() {
      if (typing) return setHints([{ button: 'a', label: 'Save' }, { button: 'b', label: 'Cancel' }]);
      if (screen === 'pick') {
        const onAdd = focus >= data.profiles.length;
        const hints = [{ button: 'a', label: onAdd ? 'Add' : 'Choose' }];
        if (!onAdd) hints.push({ button: 'x', label: 'Edit' });
        if (canCancel) hints.push({ button: 'b', label: 'Back' });
        return setHints(hints);
      }
      if (screen === 'edit') return setHints([{ button: 'a', label: rows[focus].hint }, { button: 'b', label: 'Done' }]);
      setHints([{ button: 'a', label: 'Pick' }, { button: 'b', label: 'Back' }]);
    }

    async function pickPicture() {
      await busy(async () => { avatars = await window.tink.getAvatars(); });
      if (!avatars.length) return;
      const index = avatars.findIndex((a) => a.src === current().avatar);
      show('avatars', index + 1);
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

    async function saveName(input) {
      const name = input.value.trim();
      typing = false;
      if (name) await save({ name });
      else render();
    }

    function stopTyping(input) {
      input.value = current().name;
      typing = false;
      focusRow(nodes[focus], false);
      showHints();
    }

    async function choose() {
      if (focus < data.profiles.length) {
        await busy(() => window.tink.chooseProfile(data.profiles[focus].id));
        finish(true);
        return;
      }
      await busy(async () => {
        editing = await window.tink.addProfile();
        await refresh();
      });
      if (editing) show('edit', 0);
    }

    function move(action, columns) {
      const step = { left: -1, right: 1, up: -columns, down: columns }[action];
      const next = focus + step;
      if (!step || next < 0 || next >= nodes.length || (columns > 1 && Math.abs(step) === 1 && Math.floor(next / columns) !== Math.floor(focus / columns))) return null;
      focus = next;
      focusRow(nodes[focus]);
      showHints();
      return 'move';
    }

    active = {
      busy: false,
      handle(action) {
        if (screen === 'pick') {
          if (action === 'a') {
            choose();
            return 'confirm';
          }
          if (action === 'x' && focus < data.profiles.length) {
            editing = data.profiles[focus].id;
            show('edit', 0);
            return 'confirm';
          }
          if (action === 'b' && canCancel) {
            finish(false);
            return 'back';
          }
          return move(action, 1);
        }
        if (screen === 'edit') {
          const input = nodes[focus].querySelector('input');
          if (typing) {
            if (action === 'a') saveName(input);
            else if (action === 'b') stopTyping(input);
            else return null;
            return action === 'a' ? 'confirm' : 'back';
          }
          if (action === 'up' || action === 'down') return move(action, 1) && 'list';
          if (action === 'a') {
            if (input) {
              typing = true;
              input.focus();
              input.select();
              showHints();
            } else {
              rows[focus].run();
            }
            return 'confirm';
          }
          if (action === 'b') {
            show('pick', data.profiles.findIndex((p) => p.id === editing));
            return 'back';
          }
          return null;
        }
        if (action === 'a') {
          const picked = focus === 0 ? null : avatars[focus - 1].file;
          screen = 'edit';
          focus = 2;
          save({ avatar: picked });
          return 'confirm';
        }
        if (action === 'b') {
          show('edit', 2);
          return 'back';
        }
        return move(action, GRID_COLUMNS);
      },
    };
    root.hidden = false;
    render();
  });
}
