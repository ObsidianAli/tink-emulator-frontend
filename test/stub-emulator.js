// Stands in for an emulator in tests: writes the arguments it got, waits a moment, then exits.
const fs = require('node:fs');

const [outFile, ...args] = process.argv.slice(2);
fs.writeFileSync(outFile, JSON.stringify(args));
setTimeout(() => process.exit(0), 300);
