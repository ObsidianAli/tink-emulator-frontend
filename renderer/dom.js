// Small helpers shared by the setup and Settings screens.
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The last two folders, since the end of a path is the part that tells folders apart.
export function shortPath(folder) {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : folder;
}

const scrolling = new WeakMap();

// Focuses a row without the browser's own jump, then scrolls its list just enough to show the whole row plus a margin.
// smooth is false when a screen is drawn fresh, so it opens already in place.
export function focusRow(node, smooth = true) {
  node.focus({ preventScroll: true });
  const list = node.closest('.setup-list');
  if (!list) return;
  const style = getComputedStyle(list);
  const margin = parseFloat(style.getPropertyValue('--space')) * 2;
  const top = node.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  const bottom = top + node.offsetHeight;
  let target = list.scrollTop;
  if (top - margin < target) target = top - margin;
  else if (bottom + margin > target + list.clientHeight) target = bottom + margin - list.clientHeight;
  target = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight));
  cancelAnimationFrame(scrolling.get(list));
  const from = list.scrollTop;
  if (!smooth || target === from) {
    list.scrollTop = target;
    return;
  }
  const duration = parseFloat(style.getPropertyValue('--duration-ui'));
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    list.scrollTop = from + (target - from) * (1 - (1 - t) ** 3);
    if (t < 1) scrolling.set(list, requestAnimationFrame(step));
  };
  scrolling.set(list, requestAnimationFrame(step));
}
