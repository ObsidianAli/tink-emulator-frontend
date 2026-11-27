const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { CONSOLES, coverColour } = require('./presets');
const { download, griddbJson, libretroUrl, nameVariants, limiter, Rejected, PARALLEL, TIMEOUT_MS } = require('./covers');

const MAX_CHOICES = 24;
const MAX_MATCHES = 3;
const REGIONS = ['USA', 'Europe', 'Japan'];
const GRIDS = '?dimensions=600x900&types=static';

const hash = (data) => crypto.createHash('sha1').update(data).digest('hex');
const dataUrl = ({ data, type }) => `data:${type.mime};base64,${data.toString('base64')}`;

function openChoices({ game, covers, steamGridKey, fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const queue = limiter(PARALLEL);
  const seen = new Set();
  let waiting = [];
  let finished = false;
  let failed = false;
  let closed = false;
  let defaultHash = null;

  async function still(found) {
    const cover = await found;
    if (cover.plain) return cover;
    try {
      return { data: await fs.readFile(cover.file), type: { mime: cover.mime } };
    } catch {
      return { plain: { colour: coverColour(game.console) } };
    }
  }

  const choices = [{ still: still(covers.getCover(game)) }];

  function wake() {
    const woken = waiting;
    waiting = [];
    for (const resolve of woken) resolve();
  }

  function add(choice) {
    choices.push(choice);
    wake();
  }

  async function ask(task) {
    try {
      return await queue(async () => (closed ? null : task()));
    } catch (error) {
      if (!(error instanceof Rejected)) failed = true;
      return null;
    }
  }

  const fetchImage = (url) => ask(() => download(fetchFn, url, timeoutMs));
  const gridDb = (route) => ask(() => griddbJson(fetchFn, steamGridKey, route, timeoutMs));

  function directUrls() {
    if (game.art) return [game.art.cover, game.art.fallback];
    const system = CONSOLES[game.console] && CONSOLES[game.console].libretro;
    if (!system) return [];
    const names = nameVariants(game.fileName);
    const bare = names[names.length - 1];
    return [...names, ...REGIONS.map((region) => `${bare} (${region})`)].map((name) => libretroUrl(system, name));
  }

  async function gridRoutes() {
    if (game.art) return [`/grids/steam/${encodeURIComponent(game.fileName)}`];
    const matches = await gridDb(`/search/autocomplete/${encodeURIComponent(game.title || game.fileName)}`);
    return (matches || []).slice(0, MAX_MATCHES).map((match) => `/grids/game/${encodeURIComponent(match.id)}`);
  }

  async function grids() {
    if (!steamGridKey) return [];
    const found = await Promise.all((await gridRoutes()).map((route) => gridDb(route + GRIDS)));
    const lists = found.filter((list) => list && list.length);
    const share = Math.ceil(MAX_CHOICES / lists.length);
    const list = [...lists.flatMap((grid) => grid.slice(0, share)), ...lists.flatMap((grid) => grid.slice(share))]
      .filter((grid) => grid && typeof grid.url === 'string');
    // The first grid is usually the default cover, and only its full image can show that.
    return list.map(({ url, thumb }, index) => ({ url, thumb: index && typeof thumb === 'string' ? thumb : null }));
  }

  async function preview({ url, thumb }) {
    const small = thumb && await fetchImage(thumb);
    if (small) return { url, small, thumb: true };
    const whole = await fetchImage(url);
    return whole && { url, small: whole };
  }

  async function addAll(candidates) {
    const wanted = [];
    for (const candidate of candidates) {
      if (wanted.length >= MAX_CHOICES || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      wanted.push(candidate);
    }
    for (const loading of wanted.map(preview)) {
      const choice = await loading;
      if (closed || choices.length >= MAX_CHOICES) return;
      if (!choice) continue;
      const key = hash(choice.small.data);
      if (seen.has(key)) continue;
      seen.add(key);
      add(choice);
    }
  }

  async function addDefault() {
    const pickedUrl = await covers.pickedFrom(game);
    const current = await choices[0].still;
    const currentHash = current.data ? hash(current.data) : null;
    if (currentHash) seen.add(currentHash);
    if (pickedUrl === null) {
      defaultHash = currentHash;
      return;
    }
    if (pickedUrl) seen.add(pickedUrl);
    const choice = { still: still(covers.getDefault(game)) };
    const own = await choice.still;
    defaultHash = own.data ? hash(own.data) : null;
    if (defaultHash && seen.has(defaultHash)) return;
    if (defaultHash) seen.add(defaultHash);
    add(choice);
  }

  async function run() {
    await addDefault();
    const later = grids().catch(() => {
      failed = true;
      return [];
    });
    await addAll(directUrls().map((url) => ({ url })));
    await addAll(await later);
  }

  run().catch(() => { failed = true; }).finally(() => {
    finished = true;
    wake();
  });

  async function more(known) {
    while (!finished && !closed && choices.length <= known) await new Promise((resolve) => waiting.push(resolve));
    const only = choices.length < 2;
    return { count: choices.length, done: finished || closed, needsKey: finished && only && !failed && !steamGridKey };
  }

  async function whole(choice) {
    if (!choice.loading) choice.loading = choice.thumb ? download(fetchFn, choice.url, timeoutMs).catch(() => null) : Promise.resolve(choice.small);
    const image = await choice.loading;
    if (!image) choice.loading = null;
    return image;
  }

  async function image(index, full) {
    const choice = choices[index];
    if (!choice) return null;
    if (choice.still) {
      const shown = await choice.still;
      return shown.plain ? { plain: shown.plain, whole: true } : { src: dataUrl(shown), whole: true };
    }
    const shown = full ? await whole(choice) : choice.small;
    return shown && { src: dataUrl(shown), whole: full || !choice.thumb };
  }

  async function use(index) {
    const choice = choices[index];
    if (!choice) return false;
    if (index === 0) return true;
    const picked = choice.still ? null : await whole(choice);
    if (closed || !(picked || choice.still)) return false;
    if (!picked || hash(picked.data) === defaultHash) await covers.unpick(game);
    else await covers.pick(game, picked, choice.url);
    return true;
  }

  function close() {
    closed = true;
    wake();
  }

  return { game, more, image, use, close };
}

module.exports = { openChoices };
