const hintsBar = document.getElementById('hints');
const SVG = 'http://www.w3.org/2000/svg';
let currentHints = [];

function shape(tag, attributes, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

const disc = () => shape('circle', { class: 'glyph-fill', cx: 12, cy: 12, r: 12 });
const letter = (text, size = 13) => shape('text', { class: 'glyph-ink', x: 12, y: 12.5, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text);
const stroke = (d) => shape('path', { class: 'glyph-stroke', d });

const GLYPHS = {
  a: () => [disc(), letter('A')],
  b: () => [disc(), letter('B')],
  x: () => [disc(), letter('X')],
  y: () => [disc(), letter('Y')],
  menu: () => [disc(), stroke('M7 8h10M7 12h10M7 16h10')],
  '+': () => [disc(), stroke('M12 6.5v11M6.5 12h11')],
  view: () => [disc(), shape('rect', { class: 'glyph-stroke', x: 6, y: 9, width: 9, height: 9, rx: 1.5 }), shape('path', { class: 'glyph-stroke', d: 'M9 6.5h7.5a1.5 1.5 0 0 1 1.5 1.5v7.5' })],
  '←': () => [disc(), stroke('M14 7l-5 5 5 5')],
  '→': () => [disc(), stroke('M10 7l5 5-5 5')],
};

const stick = (side) => () => [
  shape('circle', { class: 'glyph-ring', cx: 12, cy: 12, r: 11 }),
  shape('circle', { class: 'glyph-fill', cx: 12, cy: 12, r: 7.5 }),
  letter(`${side}3`, 8),
];

const shoulder = (side) => () => {
  const left = side === 'L';
  const body = left ? 'M1 20V11a7 7 0 0 1 7-7h27v16z' : 'M35 20V11a7 7 0 0 0-7-7H1v16z';
  return [shape('path', { class: 'glyph-fill', d: body }), shape('text', { class: 'glyph-ink', x: 18, y: 13, 'font-size': 10, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, `${side}B`)];
};

GLYPHS.l3 = GLYPHS.fav = stick('L');
GLYPHS.r3 = GLYPHS.hide = stick('R');
GLYPHS.lb = shoulder('L');
GLYPHS.rb = shoulder('R');

function glyphFor(name) {
  const key = name.toLowerCase();
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  const parts = GLYPHS[key];
  if (!parts) {
    glyph.classList.add('glyph-text');
    glyph.textContent = name.toUpperCase();
    return glyph;
  }
  const wide = key === 'lb' || key === 'rb';
  const svg = shape('svg', { viewBox: wide ? '0 0 36 24' : '0 0 24 24', 'aria-hidden': 'true' });
  svg.append(...parts());
  glyph.append(svg);
  return glyph;
}

function setHints(hints) {
  currentHints = hints;
  hintsBar.replaceChildren(...hints.map(({ button, label }) => {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.append(...[].concat(button).map(glyphFor), label);
    return hint;
  }));
}

function getHints() {
  return currentHints;
}
