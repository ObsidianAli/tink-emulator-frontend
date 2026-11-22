// Tink's log file: plain timestamped lines, rolled over to tink.log.old so it never grows forever.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;

// Returns log(message, error). It never throws, since logging must not cause another failure.
function createLog(file, { maxBytes = MAX_BYTES, now = () => new Date() } = {}) {
  return (message, error) => {
    try {
      const detail = error ? ` | ${error && error.stack ? error.stack : String(error)}` : '';
      const line = `${now().toISOString()} ${message}${detail}`.replace(/\r?\n\s*/g, ' | ') + '\n';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      if (size > 0 && size + line.length > maxBytes) {
        fs.rmSync(`${file}.old`, { force: true });
        fs.renameSync(file, `${file}.old`);
      }
      fs.appendFileSync(file, line);
    } catch {
      // nowhere left to report it
    }
  };
}

module.exports = { createLog };
