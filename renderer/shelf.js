// The three.js Shelf: one Console's Cases standing in a row on a board, the selected one slid forward.
// Only the Cases near the selection exist at all, and a frame is drawn only while something is moving.
import * as THREE from '../node_modules/three/build/three.module.js';
import { SHAPES, shapeFor, createCase } from './case.js';
import { createTextures } from './textures.js';

const GAP = 0.3;
const PULL = 1;
const FOV = 30;
const VIEW_HEIGHT = 6.4;
// Unselected Cases turn a little towards the middle, so their depth and spine show.
const TURN = 0.45;
const CAMERA_LIFT = 0.45;
const BOARD = { height: 0.08, depth: 1.4, back: 0.4 };
const MAX_PIXEL_RATIO = 1;
// Extra Cases built past each edge of the screen, so moving never shows an empty slot.
const SPARE = 2;
const SETTLED = 0.0005;

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function durationMs(name) {
  return parseFloat(token(name)) || 500;
}

// onTint(colour) is called with the selected Cover's average colour.
function createShelf(canvas, { onTint }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.z = VIEW_HEIGHT / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 4, 6);
  scene.add(sun);

  const colours = { shell: token('--surface-raised'), blank: token('--surface'), disc: token('--muted') };
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1, BOARD.height, BOARD.depth),
    new THREE.MeshLambertMaterial({ color: token('--surface') }),
  );
  board.position.set(0, -BOARD.height / 2, BOARD.depth / 2 - BOARD.back);
  scene.add(board);

  const row = new THREE.Group();
  scene.add(row);

  const textures = createTextures(renderer.capabilities.getMaxAnisotropy());
  // tau for the ease-out: within 1% of the target after the Case duration.
  const tau = durationMs('--duration-case') / 4.6;

  let games = [];
  let shape = SHAPES.dvd;
  let selected = 0;
  // index -> Case on screen
  const live = new Map();
  // spare Cases per shape, reused instead of rebuilt
  const pools = new Map();
  // eased values: where the row is scrolled to and how far it is from resting height
  const motion = { x: 0, xTarget: 0, y: 0 };
  const pulls = new Map();

  const spacing = () => shape.width + GAP;

  function visibleHalfCount() {
    const halfWidth = camera.position.z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect;
    return Math.ceil(halfWidth / spacing()) + SPARE;
  }

  function takeCase() {
    const pool = pools.get(shape) || [];
    pools.set(shape, pool);
    return pool.pop() || createCase(shape, colours);
  }

  function releaseCase(index) {
    const item = live.get(index);
    live.delete(index);
    pulls.delete(index);
    item.setCover(null);
    row.remove(item.group);
    pools.get(item.shape).push(item);
  }

  function coverOf(index) {
    const inUse = new Set([...live.keys()].map((i) => games[i].id));
    return textures.get(games[index], shape.width / shape.height, inUse);
  }

  function showCover(index, item) {
    coverOf(index).then((made) => {
      if (live.get(index) !== item || !made) return;
      item.setCover(made.texture);
      if (index === selected) onTint(made.tint);
      requestRender();
    });
  }

  // Builds the Cases in view of the selection and drops the ones that left it.
  function updateWindow() {
    const reach = visibleHalfCount();
    const from = Math.max(0, selected - reach);
    const to = Math.min(games.length - 1, selected + reach);
    for (const index of [...live.keys()]) {
      if (index < from || index > to) releaseCase(index);
    }
    for (let index = from; index <= to; index++) {
      if (live.has(index)) continue;
      const item = takeCase();
      item.group.position.set(index * spacing(), 0, 0);
      live.set(index, item);
      pulls.set(index, 0);
      row.add(item.group);
      showCover(index, item);
    }
  }

  function aimCamera() {
    camera.position.x = motion.x;
    camera.position.y = shape.height / 2 + CAMERA_LIFT;
    camera.lookAt(motion.x, shape.height / 2, 0);
    board.position.x = motion.x;
    row.position.y = motion.y;
  }

  // Moves every eased value towards its target. Returns true while anything is still moving.
  function step(dt) {
    const k = 1 - Math.exp(-dt / tau);
    let moving = false;
    const ease = (value, target) => {
      const next = value + (target - value) * k;
      if (Math.abs(target - next) < SETTLED) return target;
      moving = true;
      return next;
    };
    motion.x = ease(motion.x, motion.xTarget);
    motion.y = ease(motion.y, 0);
    for (const [index, item] of live) {
      const pull = ease(pulls.get(index), index === selected ? 1 : 0);
      pulls.set(index, pull);
      item.group.position.z = pull * PULL;
      item.group.rotation.y = (1 - pull) * TURN * Math.sign(index * spacing() - motion.x);
    }
    return moving;
  }

  let frameRequested = false;
  let lastTime = null;

  function frame(now) {
    frameRequested = false;
    const dt = lastTime === null ? 16 : Math.min(now - lastTime, 50);
    const moving = step(dt);
    aimCamera();
    renderer.render(scene, camera);
    if (moving) {
      lastTime = now;
      requestRender();
    } else {
      lastTime = null;
    }
  }

  function requestRender() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    board.scale.x = (visibleHalfCount() + 1) * 2 * spacing();
    if (games.length) updateWindow();
    requestRender();
  }

  // Shows another Console's Games. from: -1 when it comes from above, 1 from below, 0 for no slide.
  function show(shelfGames, consoleId, index, from = 0) {
    for (const i of [...live.keys()]) releaseCase(i);
    games = shelfGames;
    shape = shapeFor(consoleId);
    selected = Math.max(0, Math.min(index, games.length - 1));
    motion.x = motion.xTarget = selected * spacing();
    motion.y = from * shape.height;
    resize();
  }

  function select(index) {
    const next = Math.max(0, Math.min(index, games.length - 1));
    if (next === selected) return false;
    selected = next;
    motion.xTarget = selected * spacing();
    updateWindow();
    const item = live.get(selected);
    if (item) {
      coverOf(selected).then((made) => {
        if (made && live.get(selected) === item) onTint(made.tint);
      });
    }
    requestRender();
    return true;
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', requestRender);

  return { show, select, selected: () => selected, game: () => games[selected] };
}

export { createShelf };
