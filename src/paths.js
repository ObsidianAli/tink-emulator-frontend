const fs = require('node:fs');
const path = require('node:path');

// TINK_DATA_DIR is for tests; a packaged build ignores it.
function resolveDataDir({ packaged, tinkDir, projectDir, override }) {
  if (packaged) return path.join(tinkDir, 'data');
  return override ? path.resolve(override) : path.join(projectDir, 'data');
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function migrateOldData(dataDir, oldDir) {
  if (path.resolve(dataDir) === path.resolve(oldDir)) return;
  if (fs.existsSync(path.join(dataDir, 'settings.json')) || !fs.existsSync(path.join(oldDir, 'settings.json'))) return;
  for (const name of ['settings.json', 'covers']) {
    const from = path.join(oldDir, name);
    if (fs.existsSync(from) && !fs.existsSync(path.join(dataDir, name))) move(from, path.join(dataDir, name));
  }
}

module.exports = { resolveDataDir, migrateOldData };
