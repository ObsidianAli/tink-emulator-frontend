import { element } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';

export const ICONS = {
  controller: [
    ['path', { d: 'M18 20h28c7 0 11 6 12 14l2 10c1 6-5 9-9 5l-6-6H19l-6 6c-4 4-10 1-9-5l2-10c1-8 5-14 12-14z' }],
    ['path', { d: 'M20 29v8M16 33h8' }],
    ['circle', { cx: 43, cy: 30, r: 1.5, fill: 'currentColor' }],
    ['circle', { cx: 48, cy: 36, r: 1.5, fill: 'currentColor' }],
  ],
  planet: [
    ['circle', { cx: 32, cy: 32, r: 14 }],
    ['path', { d: 'M12 42c-6 6-4 10 6 8 8-1 20-6 30-14s14-15 10-18c-2-2-7-1-12 1' }],
  ],
  star: [
    ['path', { d: 'M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z', fill: 'currentColor', stroke: 'none' }],
  ],
};

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
    node.append(glyph(ICONS[profile.icon] || ICONS.controller));
  }
  return node;
}

export function tick() {
  const node = element('span', 'tick');
  node.append(glyph(TICK));
  return node;
}
