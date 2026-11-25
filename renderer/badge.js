import { element } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';

const TICK = [['path', { d: 'M17 33l10 10 20-22' }]];

function glyph(shapes) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

export function badge(profile, { className = '', neutral = false } = {}) {
  const node = element('div', `badge ${className}`.trim());
  if (!neutral) node.style.background = `var(--profile-${profile.colour})`;
  if (profile.avatar) {
    const image = element('img');
    image.src = profile.avatar;
    image.alt = '';
    node.append(image);
  } else {
    const letter = [...String(profile.name || '').trim()][0] || 'P';
    node.append(element('span', 'badge-initial', letter.toUpperCase()));
  }
  return node;
}

export function tick() {
  const node = element('span', 'tick');
  node.append(glyph(TICK));
  return node;
}
