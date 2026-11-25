import { element, focusGlow, scrollToNode } from './dom.js';

const SORT_NAMES = { recent: 'Last played', az: 'A–Z', console: 'Console', favourites: 'Favourites' };
const SORTS = Object.keys(SORT_NAMES);
const CROP_LIMIT = 0.25;
const TILE_ASPECT = 3 / 4;

const root = document.getElementById('grid');
const sortLabel = document.getElementById('grid-sort');
const list = document.getElementById('grid-list');
const title = document.getElementById('grid-title');

let games = [];
let tiles = [];
let index = 0;
const covers = new Map();

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    fillCover(entry.target, entry.target.game);
  }
}, { root: list, rootMargin: '200px 0px' });

function whole(img, aspect) {
  img.classList.toggle('whole', Math.abs(img.naturalWidth / img.naturalHeight / aspect - 1) > CROP_LIMIT);
}

async function fillCover(tile, game) {
  if (!covers.has(game.id)) covers.set(game.id, window.tink.getCover(game.id).catch(() => null));
  const cover = await covers.get(game.id);
  if (tile.game !== game) return;
  if (cover && cover.src) {
    const img = new Image();
    img.alt = '';
    img.src = cover.src;
    try {
      await img.decode();
      whole(img, TILE_ASPECT);
      tile.firstChild.replaceChildren(img);
      return;
    } catch {
    }
  }
  const plain = element('div', 'tile-plain', game.title);
  plain.style.background = (cover && cover.plain && cover.plain.colour) || '';
  tile.firstChild.replaceChildren(plain);
}

function draw() {
  observer.disconnect();
  tiles = games.map((game) => {
    const tile = element('div', 'tile');
    tile.game = game;
    tile.append(element('div', 'tile-art'), focusGlow());
    observer.observe(tile);
    return tile;
  });
  list.replaceChildren(...(tiles.length ? tiles : [element('p', 'store-empty', 'No favourites')]));
}

function columns() {
  return getComputedStyle(list).gridTemplateColumns.split(' ').length;
}

function focus(next, scroll = true) {
  tiles[index]?.classList.remove('focused');
  index = next;
  const tile = tiles[index];
  if (!tile) {
    title.textContent = '';
    return;
  }
  tile.classList.add('focused');
  title.textContent = tile.game.title;
  if (scroll) reveal(tile, true);
}

function reveal(tile, smooth) {
  scrollToNode(list, tile, smooth, parseFloat(getComputedStyle(list).paddingTop));
}

function set(next, sort, id, otherwise = index) {
  games = sort === 'favourites' ? next.filter((game) => game.fav) : next;
  sortLabel.textContent = SORT_NAMES[sort];
  draw();
  const found = games.findIndex((game) => game.id === id);
  index = 0;
  focus(found >= 0 ? found : Math.max(0, Math.min(otherwise, games.length - 1)), false);
  if (tiles[index]) reveal(tiles[index], false);
}

function move(action) {
  const across = columns();
  let next = index;
  if (action === 'left') next = index - 1;
  else if (action === 'right') next = index + 1;
  else if (action === 'up') next = index - across;
  else if (action === 'down') next = index + across < games.length ? index + across : Math.floor(index / across) < Math.floor((games.length - 1) / across) ? games.length - 1 : index;
  if (next < 0 || next >= games.length || next === index) return false;
  focus(next);
  return true;
}

function jump(action) {
  const next = action === 'first' ? 0 : games.length - 1;
  if (next < 0 || next === index) return false;
  focus(next);
  return true;
}

const nextSort = (sort) => SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];

function forgetCovers() {
  covers.clear();
}

function sleep() {
  forgetCovers();
  observer.disconnect();
  tiles = [];
  list.replaceChildren();
}

export const grid = {
  set,
  move,
  jump,
  nextSort,
  forgetCovers,
  sleep,
  game: () => games[index] || null,
  open: (open) => { root.hidden = !open; },
};
