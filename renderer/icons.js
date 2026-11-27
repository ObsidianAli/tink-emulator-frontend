const NS = 'http://www.w3.org/2000/svg';

function draw([tag, attributes, ...children]) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children.map(draw));
  return node;
}

const fill = (d) => ['path', { class: 'icon-fill', d }];
const line = (d) => ['path', { class: 'icon-line', d }];
const cut = (d) => ['path', { class: 'icon-cut', d }];
const hole = (cx, cy, r) => ['circle', { class: 'icon-hole', cx, cy, r }];
const part = (name, ...children) => ['g', { class: `icon-${name}` }, ...children];

const ICONS = {
  store: [
    part('handle', line('M8.4 9.5V7.2a3.6 3.6 0 0 1 7.2 0v2.3')),
    part('bag',
      fill('M5.6 8.6h12.8a1 1 0 0 1 1 .9l.9 9.7a2 2 0 0 1-2 2.2H5.7a2 2 0 0 1-2-2.2l.9-9.7a1 1 0 0 1 1-.9z'),
      part('arrow', cut('M12 11.6v5.8M9.3 14.9l2.7 2.7 2.7-2.7'))),
  ],
  album: [
    part('rear', ['rect', { class: 'icon-fill', x: 6.8, y: 2.6, width: 15, height: 12.4, rx: 2.6 }]),
    part('front',
      ['rect', { class: 'icon-fill icon-edge', x: 2, y: 6.4, width: 17, height: 14, rx: 2.8 }],
      ['path', { class: 'icon-hole', d: 'M4.4 17.6l4-5.2a.9.9 0 0 1 1.4 0l2.2 2.7 1.3-1.5a.9.9 0 0 1 1.4 0l2.3 3.2a.6.6 0 0 1-.5 1H4.9a.5.5 0 0 1-.5-.2z' }],
      hole(14.9, 10.3, 1.5)),
  ],
  news: [
    fill('M18.7 8.5h1.5a1.3 1.3 0 0 1 1.3 1.3v7.9a2.9 2.9 0 0 1-2.8 2.9z'),
    part('page',
      ['path', { class: 'icon-fill icon-edge', d: 'M4.8 3.4h11.5a1.8 1.8 0 0 1 1.8 1.8v13a2.9 2.9 0 0 0 1 2.3H5.9A2.9 2.9 0 0 1 3 17.6V5.2a1.8 1.8 0 0 1 1.8-1.8z' }],
      ['rect', { class: 'icon-hole', x: 5.7, y: 6.2, width: 9.7, height: 4.2, rx: 1 }],
      cut('M6.5 13.4h8.2M6.5 16.8h5.2')),
  ],
  controllers: [
    fill('M7 5.2h10a5 5 0 0 1 4.9 4.1l1 5.9a3.5 3.5 0 0 1-6.2 2.8l-1.6-2H8.9l-1.6 2a3.5 3.5 0 0 1-6.2-2.8l1-5.9A5 5 0 0 1 7 5.2z'),
    cut('M8 8.5v4M6 10.5h4'),
    hole(15.2, 11.7, 1.25),
    hole(17.5, 9.3, 1.25),
  ],
  settings: [
    ['path', { class: 'icon-fill icon-round', d: 'M10.3 1.7h3.4l.6 2.6 1.7.7 2.3-1.4 2.4 2.4-1.4 2.3.7 1.7 2.6.6v3.4l-2.6.6-.7 1.7 1.4 2.3-2.4 2.4-2.3-1.4-1.7.7-.6 2.6h-3.4l-.6-2.6-1.7-.7-2.3 1.4-2.4-2.4 1.4-2.3-.7-1.7-2.6-.6v-3.4l2.6-.6.7-1.7L3.3 6l2.4-2.4L8 5l1.7-.7z', transform: 'translate(1.080 .6) scale(.91)' }],
    hole(12, 12, 3.6),
  ],
  power: [line('M6.6 7.2a7.8 7.8 0 1 0 10.8 0'), line('M12 3.2v8')],
};

export const HEART = 'M12 21C5 15.6 2 12.2 2 8.3 2 5.3 4.3 3 7.2 3 9.1 3 10.9 4 12 5.6 13.1 4 14.9 3 16.8 3 19.7 3 22 5.3 22 8.3c0 3.9-3 7.3-10 12.7z';
export const HEART_WIDTH = 20;

export function heartDrawing() {
  return draw(['svg', { class: 'heart', viewBox: '2 2 20 20' }, ['path', { d: HEART }]]);
}

export function plusDrawing() {
  return draw(['svg', { class: 'plus-drawing', viewBox: '0 0 24 24' }, line('M12 5v14M5 12h14')]);
}

export function controllerDrawing() {
  return draw(['svg', { viewBox: '0 0 24 24' }, ['path', { class: 'icon-fill', 'fill-rule': 'evenodd', d: 'M7 5.2h10a5 5 0 0 1 4.9 4.1l1 5.9a3.5 3.5 0 0 1-6.2 2.8l-1.6-2H8.9l-1.6 2a3.5 3.5 0 0 1-6.2-2.8l1-5.9A5 5 0 0 1 7 5.2zM6.15 8.45h1.7v1.7h1.7v1.7h-1.7v1.7h-1.7v-1.7h-1.7v-1.7h1.7zM16.5 8.8a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM16.5 13.2a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM14.3 11a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM18.7 11a1 1 0 1 0 2 0a1 1 0 1 0-2 0z' }]]);
}

export function trayDrawing(name) {
  const svg = draw(['svg', { viewBox: '0 0 24 24' }, ...ICONS[name]]);
  svg.classList.add('tray-drawing');
  return svg;
}
