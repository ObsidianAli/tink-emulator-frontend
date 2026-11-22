// Tink's settings file. For now it holds, per console, the games folder and optionally the emulator exe:
// { "consoles": { "gamecube": { "folder": "D:\\Games\\GameCube" }, "ps5": { "folder": "...", "exe": "..." } } }
const fs = require('node:fs');

function loadSettings(file) {
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (settings && typeof settings.consoles === 'object' && settings.consoles) return settings;
  } catch {
    // missing or broken file: start empty
  }
  return { consoles: {} };
}

module.exports = { loadSettings };
