// Small helpers shared by the setup and Settings screens.
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The last two folders, since the end of a path is the part that tells folders apart.
export function shortPath(folder) {
  const parts = folder.split(/[\/]/).filter(Boolean);
  return parts.length > 2 ? `…\${parts.slice(-2).join('\')}` : folder;
}
