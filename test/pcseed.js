const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const idFor = (title) => crypto.createHash('sha1').update(title).digest('hex').slice(0, 10);

function pcGames(root, titles) {
  return titles.map((title) => {
    const folder = path.join(root, 'games', title);
    const exe = path.join(folder, `${title}.exe`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(exe, '');
    return { id: idFor(title), title, exe, folder, exact: false };
  });
}

module.exports = { pcGames, idFor };
