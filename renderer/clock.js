const clock = document.getElementById('clock');
const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const SVG = 'http://www.w3.org/2000/svg';

const time = document.createElement('span');
time.className = 'clock-time';

const wifi = document.createElementNS(SVG, 'svg');
wifi.setAttribute('viewBox', '0 2 24 24');
wifi.setAttribute('aria-hidden', 'true');
wifi.id = 'wifi';
for (const [tag, attributes] of [
  ['path', { d: 'M3 9a13 13 0 0 1 18 0M6 12.5a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0' }],
  ['circle', { cx: 12, cy: 19, r: 1, fill: 'currentColor' }],
  ['path', { class: 'wifi-off', d: 'M4 4l16 16' }],
]) {
  const shape = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
  wifi.append(shape);
}
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
