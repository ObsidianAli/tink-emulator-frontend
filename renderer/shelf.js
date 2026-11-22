// The three.js Shelf: one Console's Cases in a row, the selected one forward and facing the player, the others turned
// towards it and stacked close behind on each side. The selected Case can be flipped to its Back and opened to show its
// Disc. Only the Cases near the selection exist at all, and a frame is drawn only while something is moving.
import * as THREE from '../node_modules/three/build/three.module.js';
import { SHAPES, shapeFor, coverAspect, spineAspect, createCase } from './case.js';
import { createTextures } from './textures.js';

const FOV = 30;
// How many Case heights the view spans at the row's depth.
const FRAME = 2.5;
// Where the camera sits and looks, in Case heights: a little above the middle, looking slightly down.
const EYE = 0.62;
const AIM = 0.42;
// The selected Case comes this far forward and turns a little, so its spine and thickness show.
const PULL = 0.9;
const SELECTED_TURN = 0.32;
// The others stand back, turned towards the selection, the first one clear of it and the rest overlapping.
const BACK = -0.8;
const SIDE_TURN = 1.05;
const NEAR = 1.15;
const STEP = 0.26;
const SIDE_DIM = 0.35;
// Extra Cases built past each edge of the screen, so moving never shows an empty slot.
const SPARE = 2;
const SETTLED = 0.0005;
// How far one step of the open animation has to get before the next one starts.
const NEXT_STEP = 0.9;
// The lid starts to close once the Disc is this close to resting in the tray.
const DISC_SEATED = 0.03;
const DISC_SPIN = (Math.PI * 2) / 16000;
const REST = { flip: 0, lid: 0 };
const SHARP_STEP = 64;
const SHARP_MAX = 2048;

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function durationMs(name) {
  return parseFloat(token(name)) || 500;
}

// A dark room with two soft light panels, baked into the reflections every Case's plastic picks up: a long one above
// that lines the top edges, and a tall one to the front right that lies across the selected Cover as a gloss band.
function studioLight(renderer) {
  const room = new THREE.Scene();
  const geometries = [];
  const materials = [];
  const add = (geometry, material) => {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    room.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0x0b0c0f, side: THREE.BackSide }));
  const panel = (width, height, strength, x, y, z) => {
    const mesh = add(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(strength) }));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
  };
  panel(14, 1.6, 5, 0, 9, 2);
  panel(0.9, 12, 7, 5.2, 0, 7.6);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  return texture;
}

// onTint(colour) is called with the selected Cover's average colour.
function createShelf(canvas, { onTint }) {
  // At two or more device pixels per CSS pixel the edges are already fine, and multisampling a 4K buffer is costly.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = studioLight(renderer);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 3, 6);
  scene.add(key);

  const colours = { shell: token('--surface'), blank: token('--surface-raised'), disc: token('--muted') };
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
  // eased values: which index the row is centred on, and how far it is from resting height
  const motion = { focus: 0, y: 0 };
  // index -> { flip, lid, disc, spin } of each live Case, all 0 at rest
  const poseOf = new Map();
  const restPose = () => ({ flip: 0, lid: 0, disc: 0, spin: 0 });
  // indexes of the Cases showing a Back and Disc label right now
  const detailed = new Set();
  // the index whose Case has its sharp Cover on
  let sharpIndex = -1;

  const halfTan = () => Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  function visibleHalfCount() {
    const halfWidth = (camera.position.z - BACK) * halfTan() * camera.aspect;
    return Math.max(1, Math.ceil((halfWidth - NEAR * shape.width) / (STEP * shape.width + shape.depth))) + 1 + SPARE;
  }

  // How tall the selected Cover is on screen in device pixels, so its sharp texture matches.
  function sharpHeight() {
    const view = 2 * (camera.position.z - PULL) * halfTan();
    const pixels = ((shape.height - shape.rim * 2) / view) * renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    return Math.min(SHARP_MAX, Math.ceil(pixels / SHARP_STEP) * SHARP_STEP);
  }

  function takeCase() {
    const pool = pools.get(shape) || [];
    pools.set(shape, pool);
    return pool.pop() || createCase(shape, colours);
  }

  function releaseCase(index) {
    const item = live.get(index);
    live.delete(index);
    poseOf.delete(index);
    clearDetails(index, item);
    if (sharpIndex === index) sharpIndex = -1;
    item.setPose(restPose());
    item.setCover(null);
    item.setSpine(null);
    row.remove(item.group);
    pools.get(item.shape).push(item);
  }

  function coverOf(index) {
    const inUse = new Set([...live.keys()].map((i) => games[i].id));
    return textures.get(games[index], coverAspect(shape), spineAspect(shape), inUse);
  }

  function inUseDetails() {
    return new Set([...detailed, selected].map((i) => games[i].id));
  }

  // Swaps the selected Case's small Cover for one as sharp as the screen, and puts the small one back on the last.
  function sharpen() {
    const before = sharpIndex;
    if (before !== selected && live.has(before)) {
      const item = live.get(before);
      coverOf(before).then((made) => {
        if (made && live.get(before) === item && sharpIndex !== before) item.setCover(made.texture);
      });
    }
    const index = selected;
    const item = live.get(index);
    sharpIndex = item ? index : -1;
    if (!item) return;
    textures.getSharp(games[index], coverAspect(shape), sharpHeight(), inUseDetails()).then((made) => {
      if (!made || live.get(index) !== item || sharpIndex !== index) return;
      item.setCover(made.texture);
      requestRender();
    });
  }

  // Puts the generated Back and Disc label on the selected Case.
  function showDetails() {
    const index = selected;
    const item = live.get(index);
    if (!item || detailed.has(index)) return;
    detailed.add(index);
    textures.getDetails(games[index], coverAspect(shape), sharpHeight(), consoleName, inUseDetails()).then((made) => {
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
      item.setSpine(made.spine);
      if (index === selected) {
        onTint(made.tint);
        sharpen();
      }
      requestRender();
    });
  }

  // Builds the Cases in view of the selection, and of where the row is still sliding from, and drops the rest.
  function updateWindow() {
    const reach = visibleHalfCount();
    const centre = Math.round(motion.focus);
    const from = Math.max(0, Math.min(selected, centre) - reach);
    const to = Math.min(games.length - 1, Math.max(selected, centre) + reach);
    for (const index of [...live.keys()]) {
      if (index < from || index > to) releaseCase(index);
    }
    for (let index = from; index <= to; index++) {
      if (live.has(index)) continue;
      const item = takeCase();
      live.set(index, item);
      poseOf.set(index, restPose());
      row.add(item.group);
      showCover(index, item);
    }
  }

  // Where a Case stands when it is offset Cases away from the middle of the row.
  function place(item, offset) {
    const near = Math.min(1, Math.abs(offset));
    const side = Math.sign(offset);
    const step = STEP * shape.width + shape.depth;
    const x = side * (near * NEAR * shape.width + Math.max(0, Math.abs(offset) - 1) * step);
    item.group.position.set(x, 0, PULL + near * (BACK - PULL));
    item.group.rotation.y = (1 - near) * SELECTED_TURN - side * near * SIDE_TURN;
    item.setDim(near * SIDE_DIM);
  }

  function aimCamera() {
    camera.position.set(0, shape.height * EYE, shape.height * (FRAME / 2 / halfTan()));
    camera.lookAt(0, shape.height * AIM, BACK);
    row.position.y = motion.y;
  }

  const currentPose = () => poses[poses.length - 1] || REST;

  // Eases one Case towards its target pose one step at a time: it turns, then the lid opens, then the Disc
  // lifts out. Putting it away runs the other way round.
  function stepPose(pose, target, ease, easeSlow) {
    const flipTarget = target.flip && pose.lid > 0 ? pose.flip : target.flip;
    pose.flip = ease(pose.flip, flipTarget);
    const facingFront = pose.flip < 1 - NEXT_STEP;
    const lidTarget = target.lid ? (facingFront ? 1 : pose.lid) : pose.disc > DISC_SEATED ? pose.lid : 0;
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
    motion.focus = ease(motion.focus, selected);
    motion.y = ease(motion.y, 0);
    let spinning = false;
    for (const [index, item] of live) {
      const isSelected = index === selected;
      place(item, index - motion.focus);
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

  let frameRequested = false;
  let lastTime = null;

  function frame(now) {
    frameRequested = false;
    const dt = lastTime === null ? 16 : Math.min(now - lastTime, 50);
    const { moving, spinning } = step(dt);
    aimCamera();
    renderer.render(scene, camera);
    if (moving || spinning) {
      lastTime = now;
      nextFrame();
    } else {
      lastTime = null;
      // The row has stopped, so the Cases it slid past can go.
      updateWindow();
    }
  }

  function nextFrame() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  const requestRender = nextFrame;

  function resize() {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    // Follows the window onto a screen with a different scale.
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    aimCamera();
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
    motion.focus = selected;
    motion.y = from * shape.height;
    resize();
  }

  // After the saved Covers change: drops the Cases and their textures, so the next show() builds them again.
  function forgetCovers() {
    for (const i of [...live.keys()]) releaseCase(i);
    textures.forget();
  }

  function select(index) {
    const next = Math.max(0, Math.min(index, games.length - 1));
    if (next === selected) return false;
    selected = next;
    poses = [];
    updateWindow();
    const item = live.get(selected);
    if (item) {
      coverOf(selected).then((made) => {
        if (made && live.get(selected) === item) onTint(made.tint);
      });
    }
    sharpen();
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

  return { show, forgetCovers, select, flip, open, back, caseState, selected: () => selected, game: () => games[selected] };
}

export { createShelf };
