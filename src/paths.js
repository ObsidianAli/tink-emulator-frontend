// Where Tink keeps its own files: settings, the Cover cache and the log, all in one data folder.
const fs = require('node:fs');
const path = require('node:path');

// Packaged: a data folder beside the exe. Run from source: a data folder in the project.
// TINK_DATA_DIR lets tests use a throwaway folder; a packaged build ignores it.
function resolveDataDir({ packaged, tinkDir, projectDir, override }) {
  if (packaged) return path.join(tinkDir, 'data');
  return override ? path.resolve(override) : path.join(projectDir, 'data');
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    // another drive: copy, then remove
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Brings settings and the Cover cache over from the old per-user folder, once, so existing setups keep working.
function migrateOldData(dataDir, oldDir) {
  if (path.resolve(dataDir) === path.resolve(oldDir)) return;
  if (fs.existsSync(path.join(dataDir, 'settings.json')) || !fs.existsSync(path.join(oldDir, 'settings.json'))) return;
  for (const name of ['settings.json', 'covers']) {
    const from = path.join(oldDir, name);
    if (fs.existsSync(from) && !fs.existsSync(path.join(dataDir, name))) move(from, path.join(dataDir, name));
  }
}

module.exports = { resolveDataDir, migrateOldData };
