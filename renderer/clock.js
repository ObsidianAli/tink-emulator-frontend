const clock = document.getElementById('clock');
const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const SVG = 'http://www.w3.org/2000/svg';

const time = document.createElement('span');
time.className = 'clock-time';

const wifi = document.createElementNS(SVG, 'svg');
wifi.setAttribute('viewBox', '0 0 24 24');
wifi.setAttribute('aria-hidden', 'true');
wifi.id = 'wifi';

function shape(tag, attributes, parent = wifi) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

const arc = (r) => {
  const d = +(r * Math.SQRT1_2).toFixed(3);
  return `M${+(12 - d).toFixed(3)} ${+(19 - d).toFixed(3)}a${r} ${r} 0 0 1 ${+(2 * d).toFixed(3)} 0`;
};
const SLASH = 'M3.5 3.5L20.5 20.5';

const cut = shape('mask', { id: 'wifi-cut', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 24, height: 24 });
shape('rect', { width: 24, height: 24, fill: 'white', stroke: 'none' }, cut);
shape('path', { d: SLASH, stroke: 'black', 'stroke-width': 5.4 }, cut);
const signal = shape('g', { class: 'wifi-signal' });
for (const r of [5, 9.3, 13.6]) shape('path', { d: arc(r) }, signal);
shape('circle', { class: 'wifi-dot', cx: 12, cy: 18.5, r: 1.9 }, signal);
shape('path', { class: 'wifi-off', d: SLASH });
clock.append(time, wifi);

function connection() {
  wifi.classList.toggle('offline', !navigator.onLine);
}

function tick() {
  const now = new Date();
  const nodes = [];
  for (const part of format.formatToParts(now)) {
    if (part.type === 'dayPeriod') {
      const period = document.createElement('span');
      period.className = 'clock-period';
      period.textContent = part.value;
      nodes.push(period);
    } else if (part.value.trim()) {
      nodes.push(part.value);
    }
  }
  time.replaceChildren(...nodes);
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

window.addEventListener('online', connection);
window.addEventListener('offline', connection);
connection();
tick();
