// The three.js Shelf: one Console's Cases standing in a row on a board, the selected one slid forward.
// The selected Case can be flipped to its Back and opened to show its Disc.
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
// Frames in motion are drawn at a low pixel ratio so they stay smooth; the still frame after is drawn sharp.
const MOVING_PIXEL_RATIO = 1;
const STILL_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 3);
// Extra Cases built past each edge of the screen, so moving never shows an empty slot.
const SPARE = 2;
const SETTLED = 0.0005;
// How far one step of the open animation has to get before the next one starts.
const NEXT_STEP = 0.9;
const DISC_SPIN = (Math.PI * 2) / 16000;
const REST = { flip: 0, lid: 0 };

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function durationMs(name) {
  return parseFloat(token(name)) || 500;
}

// onTint(colour) is called with the selected Cover's average colour.
function createShelf(canvas, { onTint }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(STILL_PIXEL_RATIO);
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
  const discTau = durationMs('--duration-case-slow') / 4.6;

  let games = [];
  let shape = SHAPES.dvd;
  let consoleName = '';
  let selected = 0;
  // The selected Case's poses, one per Y or X press, so B can undo them in order.
  let poses = [];
  // index -> Case on screen
  const live = new Map();
  // spare Cases per shape, reused instead of rebuilt
  const pools = new Map();
  // eased values: where the row is scrolled to and how far it is from resting height
  const motion = { x: 0, xTarget: 0, y: 0 };
  const pulls = new Map();
  // index -> { flip, lid, disc, spin } of each live Case, all 0 at rest
  const poseOf = new Map();
  const restPose = () => ({ flip: 0, lid: 0, disc: 0, spin: 0 });
  // indexes of the Cases showing a Back and Disc label right now
  const detailed = new Set();

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
    poseOf.delete(index);
    clearDetails(index, item);
    item.setPose(restPose());
    item.setCover(null);
    row.remove(item.group);
    pools.get(item.shape).push(item);
  }

  function coverOf(index) {
    const inUse = new Set([...live.keys()].map((i) => games[i].id));
    return textures.get(games[index], shape.width / shape.height, inUse);
  }

  function inUseDetails() {
    return new Set([...detailed].map((i) => games[i].id));
  }

  // Puts the generated Back and Disc label on the selected Case.
  function showDetails() {
    const index = selected;
    const item = live.get(index);
    if (!item || detailed.has(index)) return;
    detailed.add(index);
    textures.getDetails(games[index], shape.width / shape.height, consoleName, inUseDetails()).then((made) => {
      if (live.get(index) !== item || !detailed.has(index) || !made) return;
      item.setBack(made.back);
      item.setLabel(made.label);
      requestRender();
    });
  }

  function clearDetails(index, item) {
    if (!detailed.delete(index)) return;
    item.setBack(null);
    item.setLabel(null);
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
      poseOf.set(index, restPose());
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

  const currentPose = () => poses[poses.length - 1] || REST;

  // Eases one Case towards its target pose one step at a time: it turns, then the lid opens, then the Disc
  // lifts out. Putting it away runs the other way round.
  function stepPose(pose, target, ease, easeSlow) {
    const flipTarget = target.flip && pose.lid > 0 ? pose.flip : target.flip;
    pose.flip = ease(pose.flip, flipTarget);
    const facingFront = pose.flip < 1 - NEXT_STEP;
    const lidTarget = target.lid ? (facingFront ? 1 : pose.lid) : pose.disc > 0 ? pose.lid : 0;
    pose.lid = ease(pose.lid, lidTarget);
    pose.disc = easeSlow(pose.disc, target.lid && pose.lid > NEXT_STEP ? 1 : 0);
  }

  // Moves every eased value towards its target. moving: anything but the Disc's slow turn is still moving.
  function step(dt) {
    let moving = false;
    const easer = (t) => {
      const k = 1 - Math.exp(-dt / t);
      return (value, target) => {
        const next = value + (target - value) * k;
        if (Math.abs(target - next) < SETTLED) return target;
        moving = true;
        return next;
      };
    };
    const ease = easer(tau);
    const easeSlow = easer(discTau);
    motion.x = ease(motion.x, motion.xTarget);
    motion.y = ease(motion.y, 0);
    let spinning = false;
    for (const [index, item] of live) {
      const isSelected = index === selected;
      const pull = ease(pulls.get(index), isSelected ? 1 : 0);
      pulls.set(index, pull);
      item.group.position.z = pull * PULL;
      item.group.rotation.y = (1 - pull) * TURN * Math.sign(index * spacing() - motion.x);
      const pose = poseOf.get(index);
      stepPose(pose, isSelected ? currentPose() : REST, ease, easeSlow);
      if (pose.disc > 0 && item.disc) {
        pose.spin = (pose.spin + dt * DISC_SPIN) % (Math.PI * 2);
        spinning = true;
      }
      item.setPose(pose);
      if (!isSelected && !pose.flip && !pose.lid && !pose.disc) clearDetails(index, item);
    }
    return { moving, spinning };
  }

  function setPixelRatio(ratio) {
    if (renderer.getPixelRatio() === ratio) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }

  let frameRequested = false;
  let lastTime = null;

  function frame(now) {
    frameRequested = false;
    const dt = lastTime === null ? 16 : Math.min(now - lastTime, 50);
    const { moving, spinning } = step(dt);
    setPixelRatio(moving ? MOVING_PIXEL_RATIO : STILL_PIXEL_RATIO);
    aimCamera();
    renderer.render(scene, camera);
    if (moving || spinning) {
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

  // Shows another Console's Shelf, { games, console, name }. from: -1 when it comes from above, 1 from below, 0 for no slide.
  function show(item, index, from = 0) {
    for (const i of [...live.keys()]) releaseCase(i);
    games = item.games;
    shape = shapeFor(item.console);
    consoleName = item.name;
    poses = [];
    selected = Math.max(0, Math.min(index, games.length - 1));
    motion.x = motion.xTarget = selected * spacing();
    motion.y = from * shape.height;
    resize();
  }

  function select(index) {
    const next = Math.max(0, Math.min(index, games.length - 1));
    if (next === selected) return false;
    selected = next;
    poses = [];
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

  function changePose(change) {
    if (!games.length) return false;
    change();
    showDetails();
    requestRender();
    return true;
  }

  // Y: turns the selected Case to its Back, or back to its front.
  function flip() {
    const pose = currentPose();
    if (pose.lid) return false;
    if (pose.flip) return back();
    return changePose(() => poses.push({ flip: 1, lid: 0 }));
  }

  // X: opens the selected Case and lifts its Disc out. From the Back it turns round first, as its own step.
  function open() {
    const pose = currentPose();
    if (pose.lid) return false;
    return changePose(() => {
      if (pose.flip) poses.push({ flip: 0, lid: 0 });
      poses.push({ flip: 0, lid: 1 });
    });
  }

  // B: undoes the last flip or open. Returns false when there's nothing to undo.
  function back() {
    if (!poses.length) return false;
    poses.pop();
    requestRender();
    return true;
  }

  // 'front', 'back' or 'open', for the button hints.
  function caseState() {
    const pose = currentPose();
    return pose.lid ? 'open' : pose.flip ? 'back' : 'front';
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', requestRender);

  return { show, select, flip, open, back, caseState, selected: () => selected, game: () => games[selected] };
}

export { createShelf };
