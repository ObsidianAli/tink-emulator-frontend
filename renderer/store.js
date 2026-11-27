import { element, focusRow, focusGlow, scrollToNode } from './dom.js';
import { screen } from './transition.js';
import { openMenu } from './casemenu.js';

const root = document.getElementById('store');
const CATEGORIES = [
  { id: 'steam', name: 'Steam' },
  { id: 'pc', name: 'Add games' },
];
const COLUMNS = 5;
const GENERAL_FAILURE = "Steam couldn't start this download.";
const POLL_MS = 2000;
// Steam can sit on a drive question for a while; after this the request counts as given up.
const WAIT_FOR_STEAM_MS = 3 * 60 * 1000;
const SOURCES = { epic: 'Epic', gog: 'GOG', shortcut: 'Start menu', folder: 'Folder' };

let active = null;
// Installs keep going after the screen closes, so they live here rather than in one visit.
const pending = new Map();
let pollTimer = 0;

listenForInput((action) => {
  if (!active || active.busy || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const storeOpen = () => active !== null;
export const hideStore = () => { root.hidden = true; };

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!active && pending.size === 0) return;
  pollTimer = setTimeout(poll, POLL_MS);
}

async function poll() {
  const finished = [];
  for (const [appId, entry] of [...pending]) {
    let result = { state: 'none', percent: 0 };
    try {
      result = await window.tink.getInstallProgress(appId);
    } catch {
    }
    if (result.state === 'done') {
      pending.delete(appId);
      finished.push(appId);
    } else if (result.state === 'none') {
      entry.state = 'none';
      if (Date.now() - entry.since > WAIT_FOR_STEAM_MS) pending.delete(appId);
    } else {
      entry.state = result.state;
      entry.percent = result.percent;
      entry.since = Date.now();
    }
    if (active) active.paint(appId);
  }
  if (finished.length) {
    if (active) active.finished(finished);
    else window.dispatchEvent(new Event('store-installed'));
  }
  schedulePoll();
}

async function startInstall(appId, library) {
  pending.set(appId, { state: 'none', percent: 0, since: Date.now() });
  active.paint(appId);
  schedulePoll();
  let started = GENERAL_FAILURE;
  try {
    started = await window.tink.installGame(appId, library);
  } catch {
  }
  if (started === true) return;
  pending.delete(appId);
  if (!active) return;
  active.paint(appId);
  if (!active.busy) await showDialog({ message: typeof started === 'string' ? started : GENERAL_FAILURE });
}

async function pickDrive(appId) {
  let drives = GENERAL_FAILURE;
  try {
    drives = await window.tink.getInstallDrives(appId);
  } catch {
  }
  if (!Array.isArray(drives) || !drives.length) {
    await showDialog({ message: typeof drives === 'string' ? drives : GENERAL_FAILURE });
    return null;
  }
  const choices = drives.filter((drive) => drive.fits);
  if (!choices.length) {
    await showDialog({ message: 'Not enough space.' });
    return null;
  }
  if (drives.length === 1) return drives[0];
  const id = await openMenu({ choices });
  return id === null ? null : { id };
}

export function openStore() {
  return new Promise((resolve) => {
    let changed = false;
    let category = 0;
    let column = 'categories';
    let owned = [];
    let found = null;
    let added = new Map();
    let view = 'list';
    let browse = { path: '', parent: null, entries: [] };
    let focus = 0;
    let categoryNodes = [];
    let pane = null;
    let rows = [];
    let nodes = [];
    let nameNode = null;
    let loadToken = 0;

    let observer = null;

    async function fillCover(tile) {
      const game = tile.game;
      let cover = null;
      try {
        cover = await window.tink.getCover(game.id);
      } catch {
      }
      if (!tile.isConnected) return;
      const art = tile.querySelector('.store-art');
      if (cover && cover.src) {
        const img = new Image();
        img.alt = '';
        img.src = cover.src;
        try {
          await img.decode();
          art.replaceChildren(img);
          return;
        } catch {
        }
      }
      const plain = element('div', 'tile-plain', game.title);
      plain.style.background = (cover && cover.plain && cover.plain.colour) || '';
      art.replaceChildren(plain);
    }

    function paint(appId) {
      const tile = nodes.find((node) => node.game && node.game.appId === appId);
      if (!tile) return;
      const entry = pending.get(appId);
      tile.classList.toggle('installing', Boolean(entry));
      tile.querySelector('.store-progress')?.remove();
      if (!entry) return;
      const waiting = entry.state === 'none' || entry.state === 'queued';
      const box = element('span', waiting ? 'store-progress waiting' : 'store-progress');
      const ring = element('span', 'store-ring');
      ring.style.setProperty('--p', entry.percent);
      box.append(ring);
      if (!waiting) box.append(element('span', 'store-percent', `${entry.percent}%`));
      tile.append(box);
      if (nodes[focus] === tile) hints();
    }

    function finished(ids) {
      changed = true;
      const name = nodes[focus] && nodes[focus].game ? nodes[focus].game.appId : null;
      owned = owned.filter((game) => !ids.includes(game.appId));
      if (category === 0 && view === 'list') {
        const keep = owned.findIndex((game) => game.appId === name);
        focus = keep >= 0 ? keep : Math.min(focus, owned.length - 1);
        render();
      }
    }

    async function install(game) {
      if (pending.has(game.appId)) return;
      // Lets this press finish before the dialog opens, or the dialog would take it as its own.
      await null;
      active.busy = true;
      try {
        if (!await showDialog({ message: `Install ${game.title}?`, confirm: 'Install', cancel: 'Cancel', sound: 'list' })) return;
        const drive = await pickDrive(game.appId);
        if (drive) startInstall(game.appId, drive.id);
      } finally {
        active.busy = false;
        hints();
      }
    }

    async function hideGame(game) {
      active.busy = true;
      try {
        await window.tink.hideGame(`own:${game.appId}`);
        owned = owned.filter((item) => item.appId !== game.appId);
        render();
      } catch {
      } finally {
        active.busy = false;
      }
    }

    async function toggleFound(item) {
      active.busy = true;
      try {
        const id = added.get(item.exe);
        if (id) {
          await window.tink.removePcGame(id);
          added.delete(item.exe);
        } else {
          const result = await window.tink.addPcGame({ exe: item.exe, title: item.title });
          if (result && result.error) {
            await showDialog({ message: result.error });
            return;
          }
          added.set(item.exe, result.id);
        }
        changed = true;
        render();
      } finally {
        active.busy = false;
      }
    }

    async function addFromBrowser(entry) {
      await null;
      active.busy = true;
      try {
        const name = entry.name.replace(/\.exe$/i, '');
        if (!await showDialog({ message: `Add ${name}?`, confirm: 'Add', cancel: 'Cancel', sound: 'list' })) return;
        const result = await window.tink.addPcGame({ exe: entry.path });
        if (result && result.error) {
          await showDialog({ message: result.error });
          return;
        }
        changed = true;
        view = 'list';
        focus = Infinity;
        render({ swap: true });
      } finally {
        active.busy = false;
      }
    }

    async function openFolder(path, { from = null } = {}) {
      active.busy = true;
      try {
        browse = await window.tink.listFolder(path);
      } catch {
        browse = { path, parent: null, entries: [] };
      } finally {
        active.busy = false;
      }
      view = 'browse';
      focus = Math.max(0, browse.entries.findIndex((entry) => entry.path === from));
      render({ swap: true });
    }

    function loadIcon(node, exe) {
      window.tink.getFileIcon(exe).then((src) => {
        if (!src || !node.isConnected) return;
        const img = new Image();
        img.alt = '';
        img.src = src;
        node.replaceChildren(img);
      }).catch(() => {});
    }

    function empty() {
      return element('p', 'store-empty', 'No games');
    }

    function renderSteam(list) {
      nodes = [];
      rows = owned;
      if (!owned.length) {
        list.append(empty());
        return;
      }
      const covers = element('div', 'store-covers');
      covers.setAttribute('role', 'list');
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          fillCover(entry.target);
        }
      }, { root: covers, rootMargin: '400px 0px' });
      for (const game of owned) {
        const tile = element('div', 'store-tile');
        tile.game = game;
        tile.tabIndex = -1;
        tile.append(element('span', 'store-art'), focusGlow());
        covers.append(tile);
        nodes.push(tile);
        observer.observe(tile);
        tile.addEventListener('click', () => {
          focus = nodes.indexOf(tile);
          column = 'pane';
          focusColumn(false);
          active.handle('a');
        });
      }
      nameNode = element('p', 'store-name');
      list.append(covers, nameNode);
      for (const game of owned) paint(game.appId);
    }

    function row(label, { status, icon, exe, kind, entry, item, ok }) {
      const node = element('button', 'setup-row');
      node.type = 'button';
      const name = element('span', 'setup-name');
      if (icon !== undefined) {
        const holder = element('span', kind === 'folder' ? 'store-icon folder' : 'store-icon');
        if (exe) loadIcon(holder, exe);
        name.append(holder);
      }
      name.append(label);
      node.append(name);
      if (status) node.append(element('span', ok ? 'setup-status found' : 'setup-status', status));
      node.entry = entry;
      node.item = item;
      return node;
    }

    function renderFound(list) {
      nodes = [];
      rows = [];
      const wrap = element('div', 'setup-list');
      wrap.setAttribute('role', 'list');
      if (found === null) {
        list.append(element('div', 'store-spinner'));
        return;
      }
      for (const item of found) {
        const on = added.has(item.exe);
        const node = row(item.title, { icon: '', exe: item.exe, status: on ? '✓ Added' : SOURCES[item.source] || '', ok: on, item });
        wrap.append(node);
        nodes.push(node);
        rows.push({ type: 'found', item });
      }
      const browseRow = row('Browse', { icon: '', kind: 'folder', status: '›' });
      browseRow.classList.add('group-start');
      wrap.append(browseRow);
      nodes.push(browseRow);
      rows.push({ type: 'browse' });
      nodes.forEach((node, index) => node.addEventListener('click', () => {
        focus = index;
        column = 'pane';
        focusColumn(false);
        active.handle('a');
      }));
      list.append(wrap);
    }

    function renderBrowse(list) {
      nodes = [];
      rows = [];
      const wrap = element('div', 'setup-list');
      wrap.setAttribute('role', 'list');
      if (!browse.entries.length) wrap.append(empty());
      for (const entry of browse.entries) {
        const isExe = entry.kind === 'exe';
        const node = row(entry.name, { icon: '', exe: isExe ? entry.path : null, kind: isExe ? 'exe' : 'folder', status: isExe ? '' : '›', entry });
        wrap.append(node);
        nodes.push(node);
        rows.push({ type: 'entry', entry });
        node.addEventListener('click', () => {
          focus = nodes.indexOf(node);
          column = 'pane';
          focusColumn(false);
          active.handle('a');
        });
      }
      list.append(element('p', 'store-path', browse.path ? browse.path : 'This PC'), wrap);
    }

    function render({ swap = false } = {}) {
      if (observer) observer.disconnect();
      nameNode = null;
      const list = element('div', 'store-content');
      const id = CATEGORIES[category].id;
      const heading = element('h1', '', view === 'browse' ? 'Browse' : CATEGORIES[category].name);
      if (id === 'steam') renderSteam(list);
      else if (view === 'browse') renderBrowse(list);
      else renderFound(list);
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
      nodes.forEach((node) => node.classList.remove('focused'));
      if (column === 'categories' || !nodes.length) {
        focusRow(categoryNodes[category], false);
        if (nameNode) nameNode.textContent = '';
      } else {
        const node = nodes[focus];
        if (node.classList.contains('store-tile')) {
          node.classList.add('focused');
          node.focus({ preventScroll: true });
          nameNode.textContent = node.game.title;
          scrollToNode(node.parentElement, node, smooth, parseFloat(getComputedStyle(root).getPropertyValue('--space')) * 2);
        } else {
          focusRow(node, smooth);
        }
      }
      hints();
    }

    function hints() {
      if (column === 'categories') return setHints([{ button: 'a', label: 'Open' }, { button: 'b', label: 'Back' }]);
      const current = rows[focus];
      const list = [];
      if (current && category === 0 && !pending.has(current.appId)) list.push({ button: 'a', label: 'Install' }, { button: 'hide', label: 'Hide' });
      else if (current && current.type === 'found') list.push({ button: 'a', label: added.has(current.item.exe) ? 'Remove' : 'Add' });
      else if (current && current.type === 'browse') list.push({ button: 'a', label: 'Open' });
      else if (current && current.type === 'entry') list.push({ button: 'a', label: current.entry.kind === 'exe' ? 'Add' : 'Open' });
      list.push({ button: 'b', label: 'Back' });
      return setHints(list);
    }

    async function showCategory() {
      const token = ++loadToken;
      view = 'list';
      focus = 0;
      if (category === 1 && found === null) {
        render();
        const list = await window.tink.findPcGames().catch(() => []);
        if (token !== loadToken) return;
        found = list;
        render();
        return;
      }
      render();
    }

    function close() {
      active.busy = true;
      if (observer) observer.disconnect();
      // Still counts as open until every handler has seen this press.
      setTimeout(() => {
        active = null;
        schedulePoll();
      }, 0);
      resolve(changed);
    }

    const moveGrid = (action) => {
      let next = focus;
      if (action === 'left') next = focus - 1;
      else if (action === 'right') next = focus + 1;
      else if (action === 'up') next = focus - COLUMNS;
      else if (action === 'down') next = focus + COLUMNS < nodes.length ? focus + COLUMNS : Math.floor(focus / COLUMNS) < Math.floor((nodes.length - 1) / COLUMNS) ? nodes.length - 1 : focus;
      if (next < 0 || next >= nodes.length || next === focus) return false;
      focus = next;
      focusColumn();
      return true;
    };

    active = {
      busy: true,
      paint,
      finished,
      handle(action) {
        if (column === 'categories') {
          if (action === 'first' || action === 'last') {
            const next = action === 'first' ? 0 : CATEGORIES.length - 1;
            if (next === category) return null;
            category = next;
            showCategory();
            return 'list';
          }
          if (action === 'up' || action === 'down') {
            const next = Math.max(0, Math.min(CATEGORIES.length - 1, category + (action === 'down' ? 1 : -1)));
            if (next === category) return null;
            category = next;
            showCategory();
            return 'list';
          }
          if ((action === 'right' || action === 'a') && nodes.length) {
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
        const current = rows[focus];
        const isGrid = category === 0;
        if (action === 'first' || action === 'last') {
          const next = action === 'first' ? 0 : nodes.length - 1;
          if (next < 0 || next === focus) return null;
          focus = next;
          focusColumn();
          return isGrid ? 'move' : 'list';
        }
        if (isGrid && ['left', 'right', 'up', 'down'].includes(action)) {
          if (action === 'left' && focus % COLUMNS === 0) {
            column = 'categories';
            focusColumn();
            return 'list';
          }
          return moveGrid(action) ? 'move' : null;
        }
        if (!isGrid && (action === 'up' || action === 'down')) {
          const before = focus;
          focus = Math.max(0, Math.min(nodes.length - 1, focus + (action === 'down' ? 1 : -1)));
          focusColumn();
          return focus !== before ? 'list' : null;
        }
        if (action === 'hide' && isGrid && current && !pending.has(current.appId)) {
          hideGame(current);
          return 'toggle';
        }
        if (action === 'a' && current) {
          if (isGrid) {
            if (pending.has(current.appId)) return null;
            install(current);
            return 'confirm';
          }
          if (current.type === 'found') {
            toggleFound(current.item);
            return 'toggle';
          }
          if (current.type === 'browse') {
            openFolder('');
            return 'confirm';
          }
          if (current.entry.kind === 'exe') {
            addFromBrowser(current.entry);
            return 'confirm';
          }
          openFolder(current.entry.path);
          return 'confirm';
        }
        if (action === 'b' || (action === 'left' && !isGrid)) {
          if (view === 'browse') {
            if (browse.path === '') {
              view = 'list';
              focus = Infinity;
              render({ swap: true });
            } else {
              openFolder(browse.parent || '', { from: browse.path });
            }
            return 'back';
          }
          column = 'categories';
          focusColumn();
          return 'back';
        }
        return null;
      },
    };

    screen(async () => {
      root.hidden = false;
      const categories = element('div', 'settings-categories');
      categoryNodes = CATEGORIES.map((item, index) => {
        const node = element('button', 'settings-category', item.name);
        node.type = 'button';
        node.append(element('span', 'settings-bar'));
        node.addEventListener('click', () => {
          if (index === category && column === 'categories') return;
          category = index;
          column = 'categories';
          showCategory();
        });
        return node;
      });
      categories.append(element('h1', '', 'Store'), ...categoryNodes);
      pane = element('div', 'settings-pane');
      root.replaceChildren(categories, pane);
      try {
        owned = (await window.tink.getOwnedGames()) || [];
      } catch {
        owned = [];
      }
      render();
      active.busy = false;
      schedulePoll();
    });
  });
}
