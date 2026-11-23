// The Game info page: Cover, title, Console, and for a Steam game its overview and screenshots. Left/Right move along
// the screenshots, B goes back. Nothing is shown for what isn't known.
import { element } from './dom.js';

const root = document.getElementById('info');
let active = null;

// Registered before the shelf's handler, so the press that closes the page isn't also taken by the shelf.
listenForInput((action) => {
  if (!active) return null;
  return active.handle(action);
});

export const infoOpen = () => active !== null;

// Resolves when the page is closed.
export function openInfo(game) {
  return new Promise((resolve) => {
    let shots = [];
    let focus = 0;
    const cover = element('div', 'info-cover');
    const text = element('div', 'info-text');
    const consoleName = element('p', 'info-console');
    const overview = element('p', 'info-overview');
    overview.hidden = true;
    const row = element('div', 'info-shots');
    row.hidden = true;
    text.append(element('h1', '', game.title), consoleName, overview);
    root.replaceChildren(element('div', 'info-top', ''), row);
    root.firstChild.append(cover, text);

    function showHints() {
      const hints = shots.length > 1 ? [{ button: ['←', '→'], label: 'Screenshots' }] : [];
      setHints([...hints, { button: 'b', label: 'Back' }]);
    }

    function select(index) {
      focus = Math.max(0, Math.min(shots.length - 1, index));
      shots.forEach((node, i) => node.classList.toggle('current', i === focus));
      shots[focus].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }

    function close() {
      root.hidden = true;
      // Still counts as open until every handler has seen this press.
      setTimeout(() => { active = null; }, 0);
      resolve();
    }

    active = {
      handle(action) {
        if ((action === 'left' || action === 'right') && shots.length) {
          const before = focus;
          select(focus + (action === 'right' ? 1 : -1));
          return focus !== before ? 'move' : null;
        }
        if (action === 'b') {
          close();
          return 'back';
        }
        return null;
      },
    };
    root.hidden = false;
    showHints();

    const mine = active;
    const stillOpen = () => active === mine && !root.hidden;
    window.tink.getCover(game.id).then((made) => {
      if (!stillOpen() || !made) return;
      if (made.src) {
        const image = element('img');
        image.src = made.src;
        image.alt = '';
        cover.append(image);
      } else if (made.plain) {
        cover.style.background = made.plain.colour;
      }
    });
    window.tink.getGameInfo(game.id).then((info) => {
      if (!stillOpen() || !info) return;
      consoleName.textContent = info.consoleName;
      if (info.overview) {
        overview.textContent = info.overview;
        overview.hidden = false;
      }
      if (info.screenshots.length) {
        shots = info.screenshots.map((src) => {
          const image = element('img', 'info-shot');
          image.src = src;
          image.alt = '';
          return image;
        });
        row.append(...shots);
        row.hidden = false;
        select(0);
        showHints();
      }
    });
  });
}
