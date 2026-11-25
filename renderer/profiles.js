import { element, focusGlow } from './dom.js';
import { screen as changeScreen } from './transition.js';
import { badge, tick } from './badge.js';
import { createKeyboard } from './keyboard.js';

const root = document.getElementById('profiles');
const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'];
const NAME_MAX = 10;
const TITLES = { icon: 'Choose an icon', colour: 'Choose a background', name: 'Nickname' };
export const PROFILES_MAX = 8;
let active = null;

// Registered before the shelf's handler, so the press that picks a profile isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

captureKeys((event) => active !== null && !active.busy && active.type !== null && !document.querySelector('.dialog-scrim') && active.type(event));

export function closeProfiles() {
  root.hidden = true;
  document.body.classList.remove('profile-tint');
}

function reveal(node, smooth = true) {
  node.focus({ preventScroll: true });
  const row = node.parentElement;
  if (row.classList.contains('profile-grid')) {
    node.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'instant' });
    return;
  }
  row.scrollTo({ left: node.offsetLeft + node.offsetWidth / 2 - row.clientWidth / 2, behavior: smooth ? 'smooth' : 'instant' });
}

function clickable(controller, nodes, pick) {
  nodes.forEach((node, index) => node.addEventListener('click', () => {
    if (active === controller && !controller.busy) pick(index);
  }));
}

export async function editProfile({ id = null, steps: wanted = ['icon', 'colour', 'name'], hide = () => {} } = {}) {
  const [data, settings, avatars] = await Promise.all([
    window.tink.getProfiles(),
    window.tink.getSettings(),
    wanted.includes('icon') ? window.tink.getAvatars() : [],
  ]);
  const steps = avatars.length ? wanted : wanted.filter((s) => s !== 'icon');
  const design = settings.keyboard === 'full' ? 'full' : 'grid';
  const profile = data.profiles.find((p) => p.id === id);
  const taken = data.profiles.map((p) => p.colour);
  const draft = profile
    ? { name: profile.name, colour: profile.colour, avatar: profile.avatar, file: null }
    : {
      name: '',
      colour: COLOURS.find((c) => !taken.includes(c)) || COLOURS[data.profiles.length % COLOURS.length],
      avatar: null,
      file: null,
    };
  const placeholder = profile ? profile.name : `Player ${data.profiles.length + 1}`;
  const tiles = [{ avatar: null, file: null }, ...avatars.map((a) => ({ avatar: a.src, file: a.file }))];

  return new Promise((resolve) => {
    const previous = active;
    let step = steps[0];
    let focus = 0;
    let nodes = [];
    let keyboard = null;

    const controller = { busy: true, type: null, handle: (action) => handlers[step](action) };
    active = controller;

    const title = element('span', '', '');
    const dots = element('span', 'profile-dots');
    const header = element('div', 'profile-header');
    header.append(title, dots);
    const preview = badge({ ...draft, name: draft.name || placeholder }, { className: 'profile-preview' });
    const body = element('div', 'profile-step');
    const layout = element('div', `profile-steps profile-steps-${design}`);
    layout.append(header, preview, body);

    const flow = () => steps.filter((s) => s !== 'colour' || !draft.avatar);
    const named = (look) => ({ ...look, name: draft.name || placeholder });
    const tileLook = (tile) => named({ ...draft, avatar: tile.avatar });
    const iconIndex = () => (draft.avatar ? 1 + Math.max(0, avatars.findIndex((a) => a.src === draft.avatar)) : 0);
    const colourIndex = () => Math.max(0, COLOURS.indexOf(draft.colour));
    const chosen = (index) => (step === 'icon' ? index === iconIndex() : index === colourIndex());

    function paint(look) {
      const next = badge(named(look));
      preview.style.background = next.style.background;
      preview.replaceChildren(...next.childNodes);
      document.body.style.setProperty('--profile-tint', look.avatar ? 'var(--bg)' : `var(--profile-${look.colour})`);
      document.body.classList.add('profile-tint');
    }

    function option(look) {
      const node = element('button', 'profile-option');
      node.type = 'button';
      node.append(look ? badge(look) : element('div', 'badge'), focusGlow());
      return node;
    }

    function renderOptions() {
      if (step === 'icon') nodes = tiles.map((tile) => option(tileLook(tile)));
      else {
        nodes = COLOURS.map((colour) => {
          const node = option(null);
          node.firstChild.style.background = `var(--profile-${colour})`;
          return node;
        });
      }
      nodes.forEach((node, index) => {
        if (chosen(index)) node.append(tick());
      });
      const row = element('div', step === 'icon' ? 'profile-options profile-grid' : 'profile-options');
      row.setAttribute('role', 'list');
      row.append(...nodes);
      body.replaceChildren(row);
      clickable(controller, nodes, (index) => {
        focus = index;
        controller.handle('a');
      });
    }

    function renderName() {
      keyboard = createKeyboard({
        design,
        text: draft.name,
        max: NAME_MAX,
        placeholder,
        onChange: (value) => {
          draft.name = value.trim();
          paint(draft);
        },
        onDone: () => {
          draft.name = keyboard.value().trim();
          next();
        },
        onBack: () => {
          draft.name = '';
          back();
        },
      });
      nodes = [];
      body.replaceChildren(keyboard.field, keyboard.board);
    }

    function render(swap) {
      title.textContent = TITLES[step];
      layout.classList.toggle('profile-steps-icon', step === 'icon');
      const list = flow();
      dots.replaceChildren(...list.map((s) => element('i', s === step ? 'on' : '')));
      dots.hidden = list.length < 2;
      if (step === 'name') renderName();
      else renderOptions();
      body.classList.remove('settings-swap');
      if (swap) {
        void body.offsetWidth;
        body.classList.add('settings-swap');
      }
      paint(draft);
      if (nodes[focus]) reveal(nodes[focus], false);
      controller.type = step === 'name' ? keyboard.type : null;
      showHints();
    }

    function showHints() {
      if (step !== 'name') return setHints([{ button: 'a', label: 'OK' }, { button: 'b', label: 'Back' }]);
      const hints = [{ button: 'a', label: 'Type' }, { button: 'b', label: 'Delete' }];
      if (design === 'full') hints.push({ button: 'y', label: 'Shift' });
      setHints([...hints, { button: '+', label: design === 'full' ? 'OK' : 'Done' }]);
    }

    function go(to, swap = true) {
      step = to;
      focus = step === 'icon' ? iconIndex() : step === 'colour' ? colourIndex() : 0;
      render(swap);
    }

    function finish(value) {
      active = previous;
      resolve(value);
    }

    async function save() {
      controller.busy = true;
      const edit = { name: draft.name, colour: draft.colour };
      if (steps.includes('icon')) edit.avatar = draft.file;
      let saved = id;
      if (!saved) saved = await window.tink.addProfile();
      if (saved) await window.tink.saveProfile({ id: saved, ...edit });
      finish(saved);
    }

    function next() {
      const list = flow();
      const at = list.indexOf(step);
      if (at + 1 < list.length) go(list[at + 1]);
      else save();
    }

    function back() {
      const list = flow();
      const at = list.indexOf(step);
      if (at > 0) go(list[at - 1]);
      else {
        controller.busy = true;
        finish(null);
      }
    }

    function columns() {
      return nodes.filter((node) => node.offsetTop === nodes[0].offsetTop).length;
    }

    function target(action) {
      if (action === 'first') return 0;
      if (action === 'last') return nodes.length - 1;
      const delta = { left: -1, right: 1 }[action];
      if (delta) return focus + delta;
      if (step !== 'icon' || (action !== 'up' && action !== 'down')) return -1;
      const cols = columns();
      if (action === 'up') return focus - cols;
      const below = focus + cols;
      if (below < nodes.length) return below;
      return Math.floor(focus / cols) < Math.floor((nodes.length - 1) / cols) ? nodes.length - 1 : -1;
    }

    function move(action) {
      const index = target(action);
      if (index < 0 || index >= nodes.length || index === focus) return null;
      focus = index;
      reveal(nodes[focus]);
      return 'move';
    }

    function choose(action, pick, look) {
      if (action === 'a') {
        pick();
        next();
        return 'confirm';
      }
      if (action === 'b') {
        back();
        return 'back';
      }
      const sound = move(action);
      if (sound) paint(look());
      return sound;
    }

    const handlers = {
      icon: (action) => choose(action, () => {
        const tile = tiles[focus];
        Object.assign(draft, { avatar: tile.avatar, file: tile.file });
      }, () => tileLook(tiles[focus])),
      colour: (action) => choose(action, () => {
        draft.colour = COLOURS[focus];
      }, () => ({ ...draft, colour: COLOURS[focus] })),
      name: (action) => keyboard.handle(action),
    };

    changeScreen(() => {
      hide();
      root.replaceChildren(layout);
      root.hidden = false;
      go(step, false);
      controller.busy = false;
    });
  });
}

export async function chooseProfile({ canCancel = false, stay = false } = {}) {
  let data = await window.tink.getProfiles();
  if (data.profiles.length === 1 && !canCancel) {
    await window.tink.chooseProfile(data.profiles[0].id);
    return true;
  }
  return new Promise((resolve) => {
    let focus = Math.max(0, data.profiles.findIndex((p) => p.id === data.last));
    let nodes = [];

    const picker = { busy: true, type: null, handle };
    active = picker;

    const canAdd = () => data.profiles.length < PROFILES_MAX;

    function render() {
      document.body.classList.remove('profile-tint');
      nodes = data.profiles.map((profile) => {
        const node = element('button', 'profile');
        node.type = 'button';
        const avatar = element('span', 'profile-avatar');
        avatar.append(badge(profile), focusGlow());
        node.append(avatar, element('span', '', profile.name));
        return node;
      });
      if (canAdd()) {
        const add = element('button', 'profile');
        add.type = 'button';
        const avatar = element('span', 'profile-avatar');
        avatar.append(element('div', 'badge', '+'), focusGlow());
        add.append(avatar, element('span', '', 'Add user'));
        nodes.push(add);
      }
      const row = element('div', 'profile-row');
      row.append(...nodes);
      root.replaceChildren(row);
      clickable(picker, nodes, (index) => {
        focus = index;
        handle('a');
      });
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      nodes[focus].focus({ preventScroll: true });
      showHints();
    }

    function showHints() {
      const onAdd = focus >= data.profiles.length;
      const hints = [{ button: 'a', label: onAdd ? 'Add' : 'Choose' }];
      if (!onAdd) hints.push({ button: 'x', label: 'Change icon' });
      if (canCancel) hints.push({ button: 'b', label: 'Back' });
      setHints(hints);
    }

    function finish(value) {
      picker.busy = true;
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      if (value && stay) resolve(value);
      else changeScreen(closeProfiles).then(() => resolve(value));
    }

    async function edit(options) {
      picker.busy = true;
      const id = await editProfile(options) || options.id;
      data = await window.tink.getProfiles();
      const index = data.profiles.findIndex((p) => p.id === id);
      focus = index < 0 ? data.profiles.length : index;
      await changeScreen(render);
      picker.busy = false;
    }

    function handle(action) {
      const onAdd = focus >= data.profiles.length;
      if (action === 'a') {
        if (onAdd) edit({});
        else {
          picker.busy = true;
          window.tink.chooseProfile(data.profiles[focus].id).then(() => finish(true));
        }
        return 'confirm';
      }
      if (action === 'x' && !onAdd) {
        edit({ id: data.profiles[focus].id, steps: ['icon', 'colour'] });
        return 'confirm';
      }
      if (action === 'b' && canCancel) {
        finish(false);
        return 'back';
      }
      const delta = { left: -1, right: 1, up: -1, down: 1 }[action];
      const index = focus + (delta || 0);
      if (!delta || index < 0 || index >= nodes.length) return null;
      focus = index;
      nodes[focus].focus({ preventScroll: true });
      showHints();
      return 'move';
    }

    changeScreen(() => {
      root.hidden = false;
      render();
      picker.busy = false;
    });
  });
}
