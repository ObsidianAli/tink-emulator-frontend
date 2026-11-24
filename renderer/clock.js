const clock = document.getElementById('clock');
const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function tick() {
  const now = new Date();
  clock.textContent = format.format(now);
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

tick();
