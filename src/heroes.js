const fs = require('node:fs/promises');
const { createCovers } = require('./covers');

const MIN_RATIO = 1.7;
const FULL_WIDTH = 1920;
const HUGE_WIDTH = 3840;
const MAX_TRIES = 4;

const rank = ({ width }) => (width >= HUGE_WIDTH ? 2 : width >= FULL_WIDTH ? 0 : 1);

function pickHeroes(list) {
  return list
    .filter((hero) => hero && typeof hero.url === 'string' && hero.width >= hero.height * MIN_RATIO)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_TRIES)
    .map((hero) => hero.url);
}

function createHeroes(options) {
  const store = createCovers({
    ...options,
    sources: (game, { firstImage, askGridDb }) => [
      game.art && (() => firstImage(game, [game.art.hero])),
      options.steamGridKey && (async () => firstImage(game, pickHeroes(await askGridDb(game, 'heroes', 'types=static')))),
    ].filter(Boolean),
  });

  async function getHero(game) {
    const { file, mime } = await store.getCover(game);
    if (!file) return null;
    try {
      const data = await fs.readFile(file);
      return { src: `data:${mime};base64,${data.toString('base64')}` };
    } catch {
      return null;
    }
  }

  return { getHero, redownload: store.redownload };
}

module.exports = { createHeroes, pickHeroes };
