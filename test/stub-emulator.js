const fs = require('node:fs');

const [outFile, ...args] = process.argv.slice(2);
fs.writeFileSync(outFile, JSON.stringify(args));
setTimeout(() => process.exit(0), 300);
