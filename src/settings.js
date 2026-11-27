const fs = require('node:fs');
const path = require('node:path');

function loadSettings(file) {
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) return settings;
  } catch {
  }
  return {};
}

// Writes a temp file first and renames it over the real one, so a crash never leaves half a file.
function saveSettings(file, settings) {
  const temp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

module.exports = { loadSettings, saveSettings };
