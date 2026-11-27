export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function focusGlow() {
  const glow = element('span', 'focus-glow');
  glow.append(document.createElement('span'));
  return glow;
}

export function shortPath(folder) {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : folder;
}

const scrolling = new WeakMap();

export function focusRow(node, smooth = true) {
  node.focus({ preventScroll: true });
  const list = node.closest('.setup-list');
  if (list) scrollToNode(list, node, smooth);
}

export function scrollToNode(list, node, smooth = true, margin = parseFloat(getComputedStyle(list).getPropertyValue('--space')) * 2) {
  const style = getComputedStyle(list);
  if (!list.clientHeight) return;
  // Layout position, so a focused tile that is scaled up doesn't skew the target.
  const top = node.offsetParent === list
    ? node.offsetTop
    : node.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
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

// A screen that appears with its row already focused would otherwise zoom it in.
const root = document.documentElement;
function settle() {
  root.classList.add('settling');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('settling')));
}
new MutationObserver((changes) => {
  if (changes.some(({ target }) => !target.hidden && target.matches('section'))) settle();
}).observe(document.querySelector('main'), { attributes: true, attributeFilter: ['hidden'], subtree: true });
