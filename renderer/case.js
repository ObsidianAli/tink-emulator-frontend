// The 3D Case for one Game: a rounded plastic tray with the Back and spine, a lid on a hinge carrying the Cover under
// clear plastic, and a Disc inside. The case's origin is the middle of its bottom edge; the Cover faces +z and the
// spine is on the left.
import * as THREE from '../node_modules/three/build/three.module.js';

// Sizes are roughly the real cases, in decimetres. disc is the Disc's radius, or 0 for cartridges and cards.
// radius rounds the corners, rim is the plastic showing around the Cover, and boxes are matte card, not plastic.
const SHAPES = {
  dvd: { width: 1.35, height: 1.9, depth: 0.14, disc: 0.6, radius: 0.07, rim: 0.03 },
  bluray: { width: 1.35, height: 1.7, depth: 0.13, disc: 0.6, radius: 0.11, rim: 0.03 },
  minidisc: { width: 1.32, height: 1.5, depth: 0.15, disc: 0.4, radius: 0.05, rim: 0.035 },
  card: { width: 1.05, height: 1.7, depth: 0.11, disc: 0, radius: 0.09, rim: 0.03 },
  handheld: { width: 1.25, height: 1.4, depth: 0.14, disc: 0, radius: 0.07, rim: 0.03 },
  jewel: { width: 1.42, height: 1.25, depth: 0.1, disc: 0.6, radius: 0.012, rim: 0.02 },
  cartridge: { width: 1.3, height: 1.85, depth: 0.26, disc: 0, radius: 0.012, rim: 0, box: true },
  wideCartridge: { width: 1.8, height: 1.28, depth: 0.36, disc: 0, radius: 0.012, rim: 0, box: true },
  smallCartridge: { width: 1.15, height: 1.3, depth: 0.28, disc: 0, radius: 0.012, rim: 0, box: true },
  pc: { width: 1.35, height: 1.9, depth: 0.16, disc: 0.6, radius: 0.07, rim: 0.03 },
};

const SHAPE_OF_CONSOLE = {
  gamecube: 'minidisc',
  wii: 'dvd',
  wiiu: 'dvd',
  ps2: 'dvd',
  ps4: 'bluray',
  ps5: 'bluray',
  switch: 'card',
  switch2: 'card',
  '3ds': 'handheld',
  ds: 'handheld',
  ps1: 'jewel',
  dreamcast: 'jewel',
  nes: 'cartridge',
  megadrive: 'cartridge',
  mastersystem: 'cartridge',
  snes: 'wideCartridge',
  n64: 'wideCartridge',
  gb: 'smallCartridge',
  gbc: 'smallCartridge',
  gba: 'smallCartridge',
  gamegear: 'smallCartridge',
  steam: 'pc',
};

const LID_THICKNESS = 0.02;
const BEVEL = 0.012;
const DISC_THICKNESS = 0.012;
// How far the lid swings open, and where the Disc floats once it's out, relative to the Case.
const LID_OPEN = -0.8 * Math.PI;
const DISC_OUT = { z: 0.9, y: 0.3 };
const DISC_TILT = -0.12;
// The cap UVs put the label on its side; this stands it upright.
const LABEL_TURN = Math.PI / 2;
// Keeps the art planes just off the shell so they never flicker into it.
const SURFACE_GAP = 0.001;
// How much of the spine the printed strip covers, the rest being the rounded shell edges.
const SPINE_FILL = 0.7;
// The soft shadow on the floor reaches this far past the Case on each side.
const SHADOW_SPREAD = 0.35;
// Clear plastic is glossy, card boxes are not.
const ROUGHNESS = { plastic: 0.18, box: 0.62, shell: 0.55 };
// The selected Cover's reflections are turned down and spread out so the art stays clean and sharp.
const SELECTED_GLOSS = { strength: 0.3, extraRoughness: 0.12 };

function shapeFor(consoleId) {
  return SHAPES[SHAPE_OF_CONSOLE[consoleId] || 'dvd'];
}

// Width over height of the Cover as it shows inside the rim.
function coverAspect(shape) {
  return (shape.width - shape.rim * 2) / (shape.height - shape.rim * 2);
}

// Width over height of the printed strip on the spine.
function spineAspect(shape) {
  return (shape.depth * SPINE_FILL) / (shape.height - Math.max(shape.radius, BEVEL) * 2);
}

// A rounded slab of the given size, its bottom edge on y = 0, centred on z = 0, with softly bevelled edges.
function roundedSlab(width, height, thickness, radius) {
  const bevel = Math.min(BEVEL, thickness / 3, radius || BEVEL);
  const w = width - bevel * 2;
  const h = height - bevel * 2;
  const r = Math.max(0.001, Math.min(radius - bevel, w / 2, h / 2));
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, bevel);
  shape.lineTo(w / 2 - r, bevel);
  shape.absarc(w / 2 - r, bevel + r, r, -Math.PI / 2, 0);
  shape.lineTo(w / 2, bevel + h - r);
  shape.absarc(w / 2 - r, bevel + h - r, r, 0, Math.PI / 2);
  shape.lineTo(-w / 2 + r, bevel + h);
  shape.absarc(-w / 2 + r, bevel + h - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-w / 2, bevel + r);
  shape.absarc(-w / 2 + r, bevel + r, r, Math.PI, Math.PI * 1.5);
  const depth = thickness - bevel * 2;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 4,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// Every Case of one shape shares these geometries.
const geometryCache = new Map();

function geometriesFor(shape) {
  if (geometryCache.has(shape)) return geometryCache.get(shape);
  const { width, height, depth, disc, radius, rim } = shape;
  const shadow = new THREE.PlaneGeometry(width + SHADOW_SPREAD * 2, depth + SHADOW_SPREAD * 2);
  shadow.rotateX(-Math.PI / 2);
  const geometries = {
    tray: roundedSlab(width, height, depth - LID_THICKNESS, radius),
    lid: roundedSlab(width, height, LID_THICKNESS, radius),
    face: new THREE.PlaneGeometry(width - rim * 2, height - rim * 2),
    spine: new THREE.PlaneGeometry(depth * SPINE_FILL, height - Math.max(radius, BEVEL) * 2),
    disc: disc ? new THREE.CylinderGeometry(disc, disc, DISC_THICKNESS, 48) : null,
    shadow,
  };
  geometryCache.set(shape, geometries);
  return geometries;
}

// A soft dark blob, drawn once and shared by every Case's shadow.
function shadowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Shared by every Case. Colours come from tokens.css so the 3D scene matches the rest of the UI.
let shared = null;

function sharedMaterials(colours) {
  if (!shared) {
    shared = {
      shell: new THREE.MeshStandardMaterial({ color: colours.shell, roughness: ROUGHNESS.shell }),
      blank: new THREE.MeshStandardMaterial({ color: colours.blank, roughness: ROUGHNESS.plastic }),
      disc: new THREE.MeshStandardMaterial({ color: colours.disc, roughness: 0.25, metalness: 0.7 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    };
  }
  return shared;
}

// Builds one Case. colours: { shell, blank, disc } as CSS colours.
function createCase(shape, colours) {
  const { width, height, depth, disc } = shape;
  const geometries = geometriesFor(shape);
  const materials = sharedMaterials(colours);
  const roughness = shape.box ? ROUGHNESS.box : ROUGHNESS.plastic;
  const group = new THREE.Group();
  // The shelf turns and slides group; body is what flips, so the two never fight.
  const body = new THREE.Group();
  group.add(body);

  const shadow = new THREE.Mesh(geometries.shadow, materials.shadow);
  shadow.position.y = SURFACE_GAP;
  shadow.renderOrder = -1;
  group.add(shadow);

  const tray = new THREE.Mesh(geometries.tray, materials.shell);
  tray.position.z = -LID_THICKNESS / 2;
  body.add(tray);

  const backMaterial = new THREE.MeshStandardMaterial({ roughness });
  const back = new THREE.Mesh(geometries.face, materials.shell);
  back.rotation.y = Math.PI;
  back.position.set(0, height / 2, -depth / 2 - SURFACE_GAP);
  body.add(back);

  const spineMaterial = new THREE.MeshStandardMaterial({ roughness });
  const spine = new THREE.Mesh(geometries.spine, materials.shell);
  spine.rotation.y = -Math.PI / 2;
  spine.position.set(-width / 2 - SURFACE_GAP, height / 2, 0);
  body.add(spine);

  // The lid turns around the spine edge.
  const hinge = new THREE.Group();
  hinge.position.set(-width / 2, 0, depth / 2 - LID_THICKNESS / 2);
  body.add(hinge);

  const lid = new THREE.Mesh(geometries.lid, materials.shell);
  lid.position.x = width / 2;
  hinge.add(lid);

  const coverMaterial = new THREE.MeshStandardMaterial({ roughness });
  const front = new THREE.Mesh(geometries.face, materials.blank);
  front.position.set(width / 2, height / 2, LID_THICKNESS / 2 + SURFACE_GAP);
  hinge.add(front);

  // The Disc sits in a holder that lifts it out; the Disc itself only spins.
  const discRest = depth / 2 - LID_THICKNESS - DISC_THICKNESS;
  const discHolder = new THREE.Group();
  discHolder.position.set(0, height / 2, discRest);
  body.add(discHolder);
  // The label's centre hole is transparent in its texture.
  const labelMaterial = new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 0.3 });
  let discMesh = null;
  if (disc) {
    // Cylinder groups are side, top, bottom.
    discMesh = new THREE.Mesh(geometries.disc, [materials.disc, materials.disc, materials.disc]);
    discMesh.rotation.x = Math.PI / 2;
    // Hidden inside the closed Case, so there's no point drawing it yet.
    discMesh.visible = false;
    discHolder.add(discMesh);
  }

  function show(mesh, material, texture, fallback) {
    if (material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true;
    }
    mesh.material = texture ? material : fallback;
  }

  // Shows a Cover texture on the front, or the blank front while it loads.
  const setCover = (texture) => show(front, coverMaterial, texture, materials.blank);
  // Shows the printed spine, or plain shell while there is none.
  const setSpine = (texture) => show(spine, spineMaterial, texture, materials.shell);
  // Shows the generated Back, or plain shell while there is none.
  const setBack = (texture) => show(back, backMaterial, texture, materials.shell);

  // Shows the Disc label, or a plain Disc while there is none.
  function setLabel(texture) {
    if (!discMesh) return;
    labelMaterial.map = texture;
    labelMaterial.needsUpdate = true;
    const face = texture ? labelMaterial : materials.disc;
    discMesh.material = [materials.disc, face, face];
  }

  // Darkens the printed art by amount (0 to 1), so Cases away from the selection sit back.
  // near is 0 for the selected Case and 1 for the rest, which keep their full reflections.
  function setDim(amount, near = 1) {
    const shade = 1 - amount;
    for (const material of [coverMaterial, spineMaterial, backMaterial]) {
      material.color.setScalar(shade);
      material.envMapIntensity = SELECTED_GLOSS.strength + (1 - SELECTED_GLOSS.strength) * near;
      material.roughness = roughness + SELECTED_GLOSS.extraRoughness * (1 - near);
    }
  }

  // flip, lid and disc run from 0 (at rest) to 1 (flipped, open, out). spin is the Disc's turn in radians.
  function setPose({ flip, lid, disc: out, spin }) {
    body.rotation.y = flip * Math.PI;
    hinge.rotation.y = lid * LID_OPEN;
    if (!discMesh) return;
    // Stays in view until the lid is fully shut over it.
    discMesh.visible = out > 0 || lid > 0;
    discHolder.position.set(0, height / 2 + out * DISC_OUT.y * height, discRest + out * DISC_OUT.z);
    discHolder.rotation.x = out * DISC_TILT;
    discMesh.rotation.y = LABEL_TURN - spin;
  }

  return { group, shape, disc: discMesh, setCover, setSpine, setBack, setLabel, setDim, setPose };
}

export { SHAPES, shapeFor, coverAspect, spineAspect, createCase };
