import { element, focusGlow, scrollToNode } from './dom.js';
import { screen } from './transition.js';

const root = document.getElementById('album');
const COLUMNS = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHOT_CACHE = 4;
const GRID_HINTS = [{ button: 'a', label: 'View' }, { button: 'x', label: 'Delete' }, { button: 'b', label: 'Back' }];

let active = null;
const thumbs = new Map();

// Registered before the shelf's handler, so the press that closes Album isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const albumOpen = () => active !== null;

export function hideAlbum() {
  root.hidden = true;
}

function when(time) {
  const date = new Date(time);
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  let day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (date.getFullYear() !== now.getFullYear()) day += ` ${date.getFullYear()}`;
  if (days === 0) day = 'Today';
  else if (days === 1) day = 'Yesterday';
  return `${day}, ${clock}`;
}

function caption(shot) {
  const node = element('span', 'album-caption-text');
  node.append(element('strong', '', shot.title || 'Screenshot'), element('em', '', when(shot.takenAt)));
  return node;
}

function image(src) {
  const node = document.createElement('img');
  node.alt = '';
  node.src = src;
  return node;
}

export function openAlbum() {
  return new Promise((resolve) => {
    let shots = [];
    let loaded = false;
    let focus = 0;
    let nodes = [];
    let list = null;
    let observer = null;
    let viewer = null;
    let viewing = 0;
    let layers = [];
    let front = 0;
    let token = 0;
    let busy = false;
    const full = new Map();

    function loadThumb(node, shot) {
      const known = thumbs.get(shot.id);
      if (known) {
        node.prepend(image(known));
        return;
      }
      window.tink.getThumb(shot.id).then((src) => {
        if (!src) return;
        thumbs.set(shot.id, src);
        if (node.isConnected) node.prepend(image(src));
      }).catch(() => {});
    }

    function renderList() {
      if (observer) observer.disconnect();
      nodes = [];
      list = element('div', 'album-grid');
      list.setAttribute('role', 'list');
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          loadThumb(entry.target, shots[nodes.indexOf(entry.target)]);
        }
      }, { root: list, rootMargin: '100% 0px' });
      shots.forEach((shot, index) => {
        const node = element('button', 'album-shot');
        node.type = 'button';
        node.append(focusGlow());
        node.addEventListener('click', () => {
          if (viewer || busy) return;
          focus = index;
          view();
        });
        nodes.push(node);
        list.append(node);
      });
      const bar = element('div', 'album-caption');
      bar.hidden = true;
      const body = shots.length ? list : element('p', 'album-empty', loaded ? 'No screenshots' : '');
      root.replaceChildren(element('h1', '', 'Album'), body, element('div', 'album-fade'), bar);
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      nodes.forEach((node) => observer.observe(node));
      if (nodes.length) select(false);
      setHints(shots.length ? GRID_HINTS : [{ button: 'b', label: 'Back' }]);
    }

    function select(smooth = true) {
      nodes[focus].focus({ preventScroll: true });
      scrollToNode(list, nodes[focus], smooth);
      const bar = root.querySelector('.album-caption');
      bar.replaceChildren(caption(shots[focus]));
      bar.hidden = false;
    }

    async function shotSource(shot) {
      if (full.has(shot.id)) return full.get(shot.id);
      let src = null;
      try {
        src = await window.tink.getShot(shot.id);
      } catch {
      }
      if (src) {
        full.set(shot.id, src);
        if (full.size > SHOT_CACHE) full.delete(full.keys().next().value);
      }
      return src;
    }

    function view() {
      viewing = focus;
      viewer = element('div', 'album-viewer');
      layers = [element('div', 'album-layer'), element('div', 'album-layer')];
      front = 0;
      viewer.append(...layers, element('div', 'album-viewer-caption'));
      root.append(viewer);
      requestAnimationFrame(() => viewer && viewer.classList.add('open'));
      show(false);
      setHints([{ button: 'x', label: 'Delete' }, { button: 'b', label: 'Back' }]);
    }

    async function show(fade = true) {
      const v = viewer;
      const shot = shots[viewing];
      const mine = ++token;
      v.querySelector('.album-viewer-caption').replaceChildren(caption(shot));
      const src = await shotSource(shot);
      if (mine !== token || viewer !== v) return;
      const next = fade ? 1 - front : front;
      layers[next].replaceChildren(...(src ? [image(src)] : []));
      layers[next].classList.add('shown');
      if (fade) layers[front].classList.remove('shown');
      front = next;
    }

    function closeViewer() {
      token++;
      focus = viewing;
      viewer.remove();
      viewer = null;
      select(false);
      setHints(GRID_HINTS);
    }

    async function remove() {
      const index = viewer ? viewing : focus;
      const shot = shots[index];
      busy = true;
      try {
        if (!await showDialog({ message: 'Delete this screenshot?', confirm: 'Delete', cancel: 'Cancel', sound: 'list' })) return;
        let ok = false;
        try {
          ok = await window.tink.deleteShot(shot.id);
        } catch {
        }
        if (!ok || !active) return;
        shots = shots.filter((item) => item !== shot);
        thumbs.delete(shot.id);
        full.delete(shot.id);
        focus = Math.min(index, shots.length - 1);
        const open = viewer;
        renderList();
        if (open && shots.length) {
          viewing = focus;
          root.append(open);
          setHints([{ button: 'x', label: 'Delete' }, { button: 'b', label: 'Back' }]);
          show(true);
        } else {
          viewer = null;
          token++;
        }
      } finally {
        busy = false;
      }
    }

    function leave() {
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      if (observer) observer.disconnect();
      resolve();
    }

    async function load() {
      try {
        shots = await window.tink.getAlbum();
      } catch {
        shots = [];
      }
      loaded = true;
      if (active) renderList();
    }

    active = {
      handle(action) {
        if (busy) return null;
        if (viewer) {
          if (action === 'left' || action === 'right') {
            const next = viewing + (action === 'right' ? 1 : -1);
            if (next < 0 || next >= shots.length) return null;
            viewing = next;
            show(true);
            return 'list';
          }
          if (action === 'x') {
            remove();
            return 'confirm';
          }
          if (action === 'b') {
            closeViewer();
            return 'back';
          }
          return null;
        }
        const move = { left: -1, right: 1, up: -COLUMNS, down: COLUMNS }[action];
        if (move !== undefined && nodes.length) {
          let next = focus + move;
          if (action === 'down' && next >= nodes.length && Math.floor(focus / COLUMNS) < Math.floor((nodes.length - 1) / COLUMNS)) next = nodes.length - 1;
          if (next < 0 || next >= nodes.length || next === focus) return null;
          focus = next;
          select();
          return 'list';
        }
        if (action === 'a' && nodes.length) {
          view();
          return 'confirm';
        }
        if (action === 'x' && nodes.length) {
          remove();
          return 'confirm';
        }
        if (action === 'b') {
          leave();
          return 'back';
        }
        return null;
      },
    };
    screen(() => {
      root.hidden = false;
      renderList();
    });
    load();
  });
}
