import * as THREE from '../node_modules/three/build/three.module.js';
import { SHAPES, shapeFor, coverAspect, spineAspect, createCase, disposeShared } from './case.js';
import { createTextures } from './textures.js';
import { createFocusRing } from './ring.js';

const FOV = 30;
const FRAME = 2.5;
const EYE = 0.62;
const AIM = 0.42;
const PULL = 0.9;
const SELECTED_TURN = 0.32;
const BACK = -0.8;
const SIDE_TURN = 1.05;
const NEAR = 1.02;
const STEP = 0.26;
const SIDE_DIM = 0.35;
const SPARE = 2;
const LEFT_CLEAR = 0.7;
const SETTLED = 0.0005;
const NEXT_STEP = 0.9;
const DISC_SEATED = 0.03;
const DISC_SPIN = (Math.PI * 2) / 16000;
const REST = { flip: 0, lid: 0 };
const LAYOUT = SHAPES.dvd;
const shapeOf = (game) => shapeFor(game.console);
const SHARP_STEP = 64;
const SHARP_MAX = 2048;
// A slow Cover load can't keep the screen black for longer than this.
const READY_MAX_MS = 500;
const COMPILE_MAX_MS = 1000;
const BREATH_FRAME_MS = 1000 / 30;

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function durationMs(name) {
  const value = token(name);
  const number = parseFloat(value);
  if (!number) return 500;
  return value.endsWith('ms') || !value.endsWith('s') ? number : number * 1000;
}

const pixels = (name) => parseFloat(token(name)) || 0;

function colour(name) {
  const paint = new OffscreenCanvas(1, 1).getContext('2d');
  paint.fillStyle = token(name);
  paint.fillRect(0, 0, 1, 1);
  return [...paint.getImageData(0, 0, 1, 1).data].map((value) => value / 255);
}

function focusTheme() {
  return {
    from: colour('--focus-from').slice(0, 3),
    to: colour('--focus-to').slice(0, 3),
    glow: colour('--focus-glow'),
    line: pixels('--focus-line'),
    gap: pixels('--focus-gap'),
    glowSize: pixels('--focus-glow-size'),
    low: parseFloat(token('--focus-breath-low')) || 1,
    period: durationMs('--focus-period'),
    fade: durationMs('--focus-fade'),
  };
}

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

function makeRenderer(canvas) {
  // At two or more device pixels per CSS pixel the edges are already fine, and multisampling a 4K buffer is costly.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function createShelf(canvas, { onTint, button, title }) {
  let renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = studioLight(renderer);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 3, 6);
  scene.add(key);

  const colours = { shell: token('--surface'), blank: token('--surface-raised'), disc: token('--muted') };
  const row = new THREE.Group();
  scene.add(row);

  const theme = focusTheme();
  const ring = createFocusRing(theme);
  let ringShown = true;
  let textures = createTextures(renderer.capabilities.getMaxAnisotropy());
  const tau = durationMs('--duration-case') / 4.6;
  const discTau = durationMs('--duration-case-slow') / 4.6;

  let games = [];
  let selected = 0;
  let poses = [];
  const live = new Map();
  const pools = new Map();
  const motion = { focus: 0 };
  const poseOf = new Map();
  const restPose = () => ({ flip: 0, lid: 0, disc: 0, spin: 0 });
  const detailed = new Set();
  let sharpIndex = -1;

  const halfTan = () => Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  function visibleCount(share) {
    const width = 2 * (camera.position.z - BACK) * halfTan() * camera.aspect * share;
    return Math.max(1, Math.ceil((width - NEAR * LAYOUT.width) / (STEP * LAYOUT.width + LAYOUT.depth))) + 1 + SPARE;
  }

  function sharpHeight() {
    const { height, rim } = shapeOf(games[selected]);
    const view = 2 * (camera.position.z - PULL) * halfTan();
    const pixels = ((height - rim * 2) / view) * renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    return Math.min(SHARP_MAX, Math.ceil(pixels / SHARP_STEP) * SHARP_STEP);
  }

  function takeCase(shape) {
    const pool = pools.get(shape) || [];
    pools.set(shape, pool);
    return pool.pop() || createCase(shape, colours);
  }

  function releaseCase(index) {
    const item = live.get(index);
    live.delete(index);
    poseOf.delete(index);
    clearDetails(index, item);
    ring.detach(item.group);
    if (sharpIndex === index) sharpIndex = -1;
    item.setPose(restPose());
    item.setCover(null);
    item.setSpine(null);
    row.remove(item.group);
    pools.get(item.shape).push(item);
  }

  function coverOf(index) {
    const inUse = new Set([...live.keys()].map((i) => games[i].id));
    const shape = shapeOf(games[index]);
    return textures.get(games[index], coverAspect(shape), spineAspect(shape), inUse);
  }

  function inUseDetails() {
    return new Set([...detailed, selected].filter((i) => games[i]).map((i) => games[i].id));
  }

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
    textures.getSharp(games[index], coverAspect(shapeOf(games[index])), sharpHeight(), inUseDetails()).then((made) => {
      if (!made || live.get(index) !== item || sharpIndex !== index) return;
      item.setCover(made.texture);
      requestRender();
    });
  }

  function showDetails() {
    const index = selected;
    const item = live.get(index);
    if (!item || detailed.has(index)) return;
    detailed.add(index);
    textures.getDetails(games[index], coverAspect(shapeOf(games[index])), sharpHeight(), games[index].consoleName, inUseDetails()).then((made) => {
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

  function updateWindow() {
    const width = canvas.clientWidth || 1;
    const centre = Math.round(motion.focus);
    const from = Math.max(0, Math.min(selected, centre) - visibleCount(rowStart / width));
    const to = Math.min(games.length - 1, Math.max(selected, centre) + visibleCount(1 - rowStart / width));
    for (const index of [...live.keys()]) {
      if (index < from || index > to) releaseCase(index);
    }
    for (let index = from; index <= to; index++) {
      if (live.has(index)) continue;
      const item = takeCase(shapeOf(games[index]));
      live.set(index, item);
      poseOf.set(index, restPose());
      row.add(item.group);
      showCover(index, item);
    }
  }

  function place(item, offset) {
    const near = Math.min(1, Math.abs(offset));
    const side = Math.sign(offset);
    const clear = offset < 0 && leftEdge === 'slide' ? near * LEFT_CLEAR * LAYOUT.width : 0;
    item.group.position.set(slotX(offset) - clear, 0, PULL + near * (BACK - PULL));
    item.group.rotation.y = (1 - near) * SELECTED_TURN - side * near * SIDE_TURN;
    item.setDim(near * SIDE_DIM, near);
    item.setFade(offset < 0 && leftEdge === 'fade' ? Math.max(0, 1 + offset) : 1);
  }

  let leftEdge = 'slide';
  function setLeftEdge(mode) {
    leftEdge = mode === 'peek' || mode === 'fade' ? mode : 'slide';
    requestRender();
  }
  window.tink.getSettings().then((state) => setLeftEdge(state.leftEdge));

  function slotX(offset) {
    const near = Math.min(1, Math.abs(offset));
    const step = STEP * LAYOUT.width + LAYOUT.depth;
    return Math.sign(offset) * (near * NEAR * LAYOUT.width + Math.max(0, Math.abs(offset) - 1) * step);
  }

  const corner = new THREE.Vector3();
  function toScreen(x, z) {
    corner.set(x, LAYOUT.height / 2, z).project(camera);
    return { left: ((corner.x + 1) / 2) * canvas.clientWidth, top: ((1 - corner.y) / 2) * canvas.clientHeight };
  }

  function rightEdge(offset, { width, depth }) {
    const near = Math.min(1, Math.abs(offset));
    const turn = (1 - near) * SELECTED_TURN - Math.sign(offset) * near * SIDE_TURN;
    const x = slotX(offset);
    const z = PULL + near * (BACK - PULL);
    return Math.max(...[-depth / 2, depth / 2].map((along) =>
      toScreen(x + (width / 2) * Math.cos(turn) + along * Math.sin(turn), z - (width / 2) * Math.sin(turn) + along * Math.cos(turn)).left));
  }

  // The button is flat HTML, so the overlapping Case step would put it on top of the last Case.
  function placeButton() {
    const offset = games.length - motion.focus;
    const near = Math.min(1, Math.abs(offset));
    const at = toScreen(slotX(Math.min(offset, 1)), PULL + near * (BACK - PULL));
    if (offset > 1) {
      const last = shapeOf(games[games.length - 1]);
      at.left += rightEdge(offset - 1, last) - rightEdge(0, last);
    }
    button.style.left = `${at.left}px`;
    button.style.top = `${at.top}px`;
    return at;
  }

  let rowStart = 0;
  const screenX = (x, z) => toScreen(x, z).left;

  function measureRow() {
    camera.clearViewOffset();
    aimCamera();
    camera.updateMatrixWorld();
    const half = LAYOUT.width / 2;
    rowStart = pixels('--home-margin') + (screenX(half, PULL) - screenX(-half, PULL)) / 2;
  }

  // A lens shift rather than moving the camera, so the perspective stays centred on the selected Case.
  function layoutRow() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.setViewOffset(width, height, width / 2 - rowStart, 0, width, height);
  }

  const point = new THREE.Vector3();
  let titleAt = '';
  function placeTitle(buttonAt) {
    let x;
    let top;
    const item = live.get(selected);
    if (selected >= games.length) {
      x = buttonAt.left;
      top = buttonAt.top - buttonHalf - theme.gap - theme.line;
    } else if (item) {
      const { width, height, depth } = item.shape;
      const edge = width / 2 + ring.reach();
      const topAt = (side) => {
        point.set(side, height + ring.reach(), depth / 2);
        return item.group.localToWorld(point).project(camera).y;
      };
      top = ((1 - Math.max(topAt(-edge), topAt(edge))) / 2) * canvas.clientHeight;
      point.set(0, height, depth / 2);
      x = ((item.group.localToWorld(point).project(camera).x + 1) / 2) * canvas.clientWidth;
    } else return;
    const at = `translate(${x.toFixed(1)}px, ${top.toFixed(1)}px)`;
    if (at === titleAt) return;
    titleAt = at;
    title.style.transform = at;
  }

  function onScreen() {
    return !document.hidden && canvas.checkVisibility({ visibilityProperty: true })
      && !canvas.parentElement.querySelector(':scope > section:not([hidden])');
  }

  function aimCamera() {
    camera.position.set(0, LAYOUT.height * EYE, LAYOUT.height * (FRAME / 2 / halfTan()));
    camera.lookAt(0, LAYOUT.height * AIM, BACK);
  }

  const currentPose = () => poses[poses.length - 1] || REST;

  function stepPose(pose, target, ease, easeSlow) {
    const flipTarget = target.flip && pose.lid > 0 ? pose.flip : target.flip;
    pose.flip = ease(pose.flip, flipTarget);
    const facingFront = pose.flip < 1 - NEXT_STEP;
    const lidTarget = target.lid ? (facingFront ? 1 : pose.lid) : pose.disc > DISC_SEATED ? pose.lid : 0;
    pose.lid = ease(pose.lid, lidTarget);
    pose.disc = easeSlow(pose.disc, target.lid && pose.lid > NEXT_STEP ? 1 : 0);
  }

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
  let frameId = 0;
  let asleep = false;
  let lastTime = null;
  let breathTimer = 0;
  let settled = false;
  let buttonHalf = 0;

  function frame(now) {
    frameRequested = false;
    const dt = lastTime === null ? 16 : Math.min(now - lastTime, 50);
    const { moving, spinning } = step(dt);
    aimCamera();
    layoutRow();
    const buttonAt = placeButton();
    const item = live.get(selected);
    if (item && selected < games.length) ring.attach(item.group, item.shape);
    else ring.clear();
    const { fading, showing } = ring.update(now, dt, ringShown && caseState() === 'front');
    renderer.render(scene, camera);
    placeTitle(buttonAt);
    if (moving || spinning) settled = false;
    else if (!settled) {
      settled = true;
      updateWindow();
    }
    if (moving || spinning || fading) {
      lastTime = now;
      nextFrame();
    } else if (showing && onScreen()) {
      // Only the breathing outline is changing, which doesn't need every display refresh.
      lastTime = now;
      breathTimer = setTimeout(nextFrame, BREATH_FRAME_MS);
    } else {
      lastTime = null;
    }
  }

  function nextFrame() {
    clearTimeout(breathTimer);
    if (frameRequested || asleep) return;
    frameRequested = true;
    frameId = requestAnimationFrame(frame);
  }

  const requestRender = nextFrame;

  function resize() {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight || asleep) return;
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    measureRow();
    ring.setScale((2 * (camera.position.z - PULL) * halfTan()) / clientHeight);
    buttonHalf = button.offsetHeight / 2;
    if (games.length) updateWindow();
    requestRender();
  }

  function show(list, index) {
    for (const i of [...live.keys()]) releaseCase(i);
    games = list;
    button.hidden = !games.length;
    poses = [];
    selected = Math.max(0, Math.min(index, games.length));
    motion.focus = selected;
    resize();
  }

  function forgetCovers() {
    for (const i of [...live.keys()]) releaseCase(i);
    textures.forget();
  }

  function select(index) {
    const next = Math.max(0, Math.min(index, games.length));
    if (next === selected) return false;
    selected = next;
    poses = [];
    if (asleep) return true;
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

  function ready() {
    const waits = [...live.keys()].map(coverOf);
    const game = games[selected];
    if (live.has(selected)) waits.push(textures.getSharp(game, coverAspect(shapeOf(game)), sharpHeight(), inUseDetails()));
    const capped = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
    // A fresh WebGL context after sleep has to compile every shader again, which stalls the first frame if left to draw time.
    return capped(Promise.all(waits), READY_MAX_MS).then(() => capped(renderer.compileAsync(scene, camera), COMPILE_MAX_MS));
  }

  async function art(game, height) {
    const shape = shapeOf(game);
    const inUse = new Set([...live.keys()].map((i) => games[i].id).concat(game.id));
    const [cover, sharp] = await Promise.all([
      textures.get(game, coverAspect(shape), spineAspect(shape), inUse),
      textures.getSharp(game, coverAspect(shape), height, inUse),
    ]);
    if (cover) onTint(cover.tint);
    return sharp && { image: sharp.texture.image, aspect: coverAspect(shape) };
  }

  function sleep() {
    if (asleep) return;
    asleep = true;
    cancelAnimationFrame(frameId);
    clearTimeout(breathTimer);
    frameRequested = false;
    lastTime = null;
    for (const i of [...live.keys()]) releaseCase(i);
    for (const pool of pools.values()) pool.forEach((item) => item.dispose());
    pools.clear();
    disposeShared();
    ring.dispose();
    textures.forget();
    scene.environment.dispose();
    scene.environment = null;
    renderer.dispose();
    renderer.forceContextLoss();
    // A canvas keeps its lost context for good, so the next renderer needs a new canvas.
    const fresh = canvas.cloneNode();
    canvas.replaceWith(fresh);
    canvas = fresh;
  }

  function wake() {
    if (!asleep) return;
    asleep = false;
    renderer = makeRenderer(canvas);
    scene.environment = studioLight(renderer);
    textures = createTextures(renderer.capabilities.getMaxAnisotropy());
    show(games, selected);
  }

  function changePose(change) {
    if (selected >= games.length) return false;
    change();
    showDetails();
    requestRender();
    return true;
  }

  function flip() {
    const pose = currentPose();
    if (pose.lid) return false;
    if (pose.flip) return back();
    return changePose(() => poses.push({ flip: 1, lid: 0 }));
  }

  function open() {
    const pose = currentPose();
    if (pose.lid) return false;
    return changePose(() => {
      if (pose.flip) poses.push({ flip: 0, lid: 0 });
      poses.push({ flip: 0, lid: 1 });
    });
  }

  function back() {
    if (!poses.length) return false;
    poses.pop();
    requestRender();
    return true;
  }

  function caseState() {
    const pose = currentPose();
    return pose.lid ? 'open' : pose.flip ? 'back' : 'front';
  }

  function showRing(shown) {
    ringShown = shown;
    requestRender();
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', requestRender);
  const screens = new MutationObserver(requestRender);
  screens.observe(canvas.parentElement, { attributes: true, attributeFilter: ['class'] });
  for (const section of canvas.parentElement.querySelectorAll(':scope > section')) screens.observe(section, { attributes: true, attributeFilter: ['hidden'] });

  return { show, showRing, setLeftEdge, ready, forgetCovers, art, sleep, wake, select, flip, open, back, caseState, selected: () => selected, onButton: () => games.length > 0 && selected === games.length, game: () => games[selected] || null };
}

export { createShelf };
