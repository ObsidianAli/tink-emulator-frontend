const fs = require('node:fs');
const path = require('node:path');

const BULK = 12;

function read(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
  }
  return null;
}

// Entries are never dropped, so a game on an unplugged drive is not new when it comes back.
function updateFirstSeen(file, keys, now = Date.now()) {
  const stored = read(file);
  const data = stored || {};
  const fresh = keys.filter((key) => !Number.isFinite(Object.hasOwn(data, key) ? data[key] : null));
  const stamp = stored === null || fresh.length > BULK ? 0 : now;
  for (const key of fresh) data[key] = stamp;
  if (stored === null || fresh.length) {
    const temp = `${file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(data));
      fs.renameSync(temp, file);
    } catch {
      fs.rmSync(temp, { force: true });
    }
  }
  return data;
}

module.exports = { updateFirstSeen };
