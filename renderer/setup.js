// First-run setup, three screens: emulators found, one games folder per Console, and whether to download Covers.
// Up/Down move, A chooses, B goes back a screen and X clears a folder. Mouse clicks work too.
const root = document.getElementById('setup');
let active = null;

// Registered before the shelf's handler, so a press that closes a dialog isn't also taken as a choice here.
listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return;
  active.handle(action);
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The last two folders, since the end of a path is the part that tells folders apart.
function shortPath(folder) {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : folder;
}

export function runSetup(initial) {
  return new Promise((resolve) => {
    let state = initial;
    let screen = 0;
    let focus = 0;
    let buttons = [];
    let items = [];

    const emulatorRows = () => [
      ...state.emulators.map((item) => ({
        label: item.label,
        sub: item.consoles,
        status: item.found ? 'Found' : 'Not found',
        found: item.found,
        activate: () => pickExe(item.id),
      })),
      ...state.manual.map((item) => ({
        label: `${item.label} emulator`,
        status: item.found ? 'Chosen' : 'Not chosen',
        found: item.found,
        activate: () => pickExe(item.id),
      })),
    ];

    const folderRows = () => state.consoles.map((item) => ({
      label: item.name,
      status: item.folder ? shortPath(item.folder) : 'Skip',
      found: Boolean(item.folder),
      activate: () => pickFolder(item.id),
      clear: item.folder ? () => change(window.tink.clearFolder(item.id)) : null,
    }));

    const coverRows = () => [
      { label: 'Yes', activate: () => finish(true) },
      { label: 'Not now', activate: () => finish(false) },
    ];

    const SCREENS = [
      { title: 'Finding your emulators…', text: 'Choose any that are missing.', rows: emulatorRows, next: 'Next' },
      { title: 'Where are your games?', text: "Pick one folder for each console. Skip the ones you don't play.", rows: folderRows, next: 'Next' },
      { title: 'Download covers?', text: 'Tink can download a cover for each game from the internet.', rows: coverRows, hint: 'Choose' },
    ];

    async function change(request) {
      active.busy = true;
      const result = await request;
      active.busy = false;
      if (result && result.error) await showDialog({ message: result.error });
      else if (result && result.state) state = result.state;
      render();
    }

    const pickExe = (id) => change(window.tink.pickExe(id));
    const pickFolder = (id) => change(window.tink.pickFolder(id));

    async function finish(covers) {
      active.busy = true;
      await window.tink.finishSetup(covers);
      root.hidden = true;
      active = null;
      resolve();
    }

    function go(step) {
      screen += step;
      focus = 0;
      render();
    }

    function render() {
      const { title, text, rows, next } = SCREENS[screen];
      items = rows();
      const list = element('div', 'setup-list');
      list.setAttribute('role', 'list');
      buttons = items.map((item) => {
        const row = element('button', 'setup-row');
        row.type = 'button';
        const name = element('span', 'setup-name', item.label);
        if (item.sub) name.append(element('span', 'setup-sub', item.sub));
        row.append(name);
        if (item.status) row.append(element('span', item.found ? 'setup-status found' : 'setup-status', item.status));
        return row;
      });
      list.append(...buttons);
      if (state.steamFound && screen === 0) list.append(element('p', 'setup-note', 'Steam was found too.'));
      const children = [element('h1', '', title), element('p', 'setup-text', text), list];
      if (next) {
        const button = element('button', 'setup-next', next);
        button.type = 'button';
        buttons.push(button);
        children.push(button);
      }
      root.replaceChildren(...children);
      buttons.forEach((button, index) => button.addEventListener('click', () => {
        focus = index;
        choose();
      }));
      focus = Math.min(focus, buttons.length - 1);
      buttons[focus].focus();
      showSetupHints();
    }

    function showSetupHints() {
      const onNext = focus >= items.length;
      const hints = [{ button: 'a', label: onNext ? 'Next' : SCREENS[screen].hint || 'Pick' }];
      if (!onNext && items[focus].clear) hints.push({ button: 'x', label: 'Skip' });
      if (screen > 0) hints.push({ button: 'b', label: 'Back' });
      setHints(hints);
    }

    function choose() {
      if (focus >= items.length) go(1);
      else items[focus].activate();
    }

    active = {
      busy: false,
      handle(action) {
        if (action === 'up' || action === 'down') {
          focus = Math.max(0, Math.min(buttons.length - 1, focus + (action === 'down' ? 1 : -1)));
          buttons[focus].focus();
          showSetupHints();
        } else if (action === 'a') {
          choose();
        } else if (action === 'b' && screen > 0) {
          go(-1);
        } else if (action === 'x' && focus < items.length && items[focus].clear) {
          items[focus].clear();
        }
      },
    };
    root.hidden = false;
    render();
  });
}
