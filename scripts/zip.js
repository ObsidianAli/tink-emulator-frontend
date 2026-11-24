const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dist = path.join(__dirname, '..', 'dist');
const folder = path.join(dist, 'Tink');
const zip = path.join(dist, 'Tink.zip');

fs.rmSync(folder, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.cpSync(path.join(dist, 'win-unpacked'), folder, { recursive: true });
const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-cf', zip, '-C', dist, 'Tink']);
fs.rmSync(folder, { recursive: true, force: true });
console.log(`${zip}: ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);
