import { element, focusGlow, scrollToNode } from './dom.js';
import { screen } from './transition.js';

const root = document.getElementById('news');
const COLUMNS = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;
const NEWS_ICON = [
  'M4 5h13v14H6a2 2 0 0 1-2-2z',
  'M17 9h3v8a2 2 0 0 1-2 2',
  'M7.5 9h6M7.5 12.5h6M7.5 16h4',
];

let active = null;
let unread = false;
const pictures = new Map();

// Registered before the shelf's handler, so the press that closes News isn't also taken by the shelf.
listenForInput((action) => {
  if (!active || document.querySelector('.dialog-scrim')) return null;
  return active.handle(action);
});

export const newsOpen = () => active !== null;

export function hideNews() {
  root.hidden = true;
}

export async function checkNews() {
  try {
    const answer = await window.tink.getNews(false);
    unread = Boolean(answer && answer.unread);
  } catch {
  }
  return unread;
}

export function newsTrayIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const attributes = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const d of NEWS_ICON) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  const parts = document.createDocumentFragment();
  parts.append(svg);
  if (unread) parts.append(element('span', 'news-dot'));
  return parts;
}

function when(date) {
  const now = new Date();
  const then = new Date(date);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]}`;
}

const source = (item) => `${item.kind === 'tink' ? 'Tink' : item.game} · ${when(item.date)}`;

function hue(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function picture(item) {
  const node = element('span', `news-pic${item.kind === 'tink' ? ' tink' : ''}`);
  const base = hue(item.game || item.id);
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  node.style.setProperty('--news-from', `hsl(${base} ${token('--news-sat-from')} ${token('--news-light-from')})`);
  node.style.setProperty('--news-to', `hsl(${base + Number(token('--news-hue-shift'))} ${token('--news-sat-to')} ${token('--news-light-to')})`);
  const known = pictures.get(item.id);
  if (known) node.append(image(known));
  else if (item.hasImage) {
    window.tink.getNewsImage(item.id).then((src) => {
      if (!src) return;
      pictures.set(item.id, src);
      if (node.isConnected) node.append(image(src));
    }).catch(() => {});
  }
  return node;
}

function image(src) {
  const node = document.createElement('img');
  node.alt = '';
  node.src = src;
  return node;
}

export function openNews() {
  return new Promise((resolve) => {
    let items = [];
    let loaded = false;
    let focus = 0;
    let nodes = [];
    let reading = null;
    let list = null;

    function renderList() {
      nodes = [];
      list = element('div', 'news-list');
      list.setAttribute('role', 'list');
      const cards = element('div', 'news-cards');
      items.forEach((item, index) => {
        const node = element('button', index === 0 ? 'news-item news-feature' : 'news-item news-card');
        node.type = 'button';
        const text = element('span', 'news-text');
        text.append(element('span', 'news-source', source(item)), element('strong', 'news-title', item.title));
        node.append(picture(item), text, focusGlow());
        node.addEventListener('click', () => {
          if (reading) return;
          focus = index;
          read();
        });
        nodes.push(node);
        if (index === 0) list.append(node);
        else cards.append(node);
      });
      if (cards.children.length) list.append(cards);
      const body = items.length ? list : element('p', 'news-empty', loaded ? 'No news' : '');
      root.replaceChildren(element('h1', '', 'News'), body);
      focus = Math.max(0, Math.min(focus, nodes.length - 1));
      if (nodes.length) {
        nodes[focus].focus({ preventScroll: true });
        scrollToNode(list, nodes[focus], false);
      }
      setHints([{ button: 'a', label: 'Read' }, { button: 'b', label: 'Back' }].filter((hint) => nodes.length || hint.button === 'b'));
    }

    function read() {
      const item = items[focus];
      reading = element('div', 'news-read');
      reading.setAttribute('role', 'article');
      reading.append(picture(item), element('span', 'news-source', source(item)), element('strong', 'news-title', item.title), element('p', 'news-body', item.text));
      reading.tabIndex = 0;
      root.replaceChildren(element('h1', '', 'News'), reading);
      reading.focus({ preventScroll: true });
      setHints([{ button: 'b', label: 'Back' }]);
    }

    function leave() {
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve();
    }

    function show(next) {
      const same = items.length === next.length && items.every((item, i) => item.id === next[i].id);
      const current = items[focus];
      items = next;
      if (same) return;
      const at = current ? items.findIndex((item) => item.id === current.id) : -1;
      if (at >= 0) focus = at;
      if (!reading) renderList();
      else if (at < 0) {
        reading = null;
        renderList();
      }
    }

    async function load() {
      try {
        const first = await window.tink.getNews(true);
        if (active) show(first.items);
        if (first.items.length) window.tink.markNewsSeen().catch(() => {});
      } catch {
      }
      try {
        const answer = await window.tink.getNews(false);
        loaded = true;
        if (!active) return;
        show(answer.items);
        if (!items.length && !reading) renderList();
        if (answer.items.length) window.tink.markNewsSeen().catch(() => {});
      } catch {
        loaded = true;
        if (active && !items.length) renderList();
      }
    }

    active = {
      handle(action) {
        if (reading) {
          if (action === 'b') {
            reading = null;
            renderList();
            return 'back';
          }
          if (action === 'up' || action === 'down') {
            const before = reading.scrollTop;
            reading.scrollBy({ top: (action === 'down' ? 1 : -1) * reading.clientHeight * 0.5, behavior: 'smooth' });
            return before === reading.scrollTop && reading.scrollHeight <= reading.clientHeight ? null : 'list';
          }
          return null;
        }
        const move = { left: -1, right: 1, up: -COLUMNS, down: COLUMNS }[action];
        if (move !== undefined && nodes.length) {
          let next = focus + move;
          if (action === 'up' && focus > 0 && focus <= COLUMNS) next = 0;
          if (action === 'down' && focus === 0) next = 1;
          if (action === 'down' && next >= nodes.length && focus > 0 && Math.floor((focus - 1) / COLUMNS) < Math.floor((nodes.length - 2) / COLUMNS)) next = nodes.length - 1;
          if ((action === 'left' || action === 'right') && focus === 0) return null;
          if (next < 0 || next >= nodes.length || next === focus) return null;
          focus = next;
          nodes[focus].focus({ preventScroll: true });
          scrollToNode(list, nodes[focus]);
          return 'list';
        }
        if (action === 'a') {
          if (!nodes.length) return null;
          read();
          return 'confirm';
        }
        if (action === 'b') {
          leave();
          return 'back';
        }
        return null;
      },
    };
    unread = false;
    screen(() => {
      root.hidden = false;
      renderList();
    });
    load();
  });
}
