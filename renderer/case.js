// The 3D Case for one Game: a tray with the Back and spine, a lid on a hinge carrying the Cover, and a Disc inside.
// The case's origin is the middle of its bottom edge; the Cover faces +z and the spine is on the left.
import * as THREE from '../node_modules/three/build/three.module.js';

// Sizes are roughly the real cases, in decimetres. disc is the Disc's radius, or 0 for cartridges and cards.
const SHAPES = {
  dvd: { width: 1.35, height: 1.9, depth: 0.14, disc: 0.6 },
  bluray: { width: 1.35, height: 1.7, depth: 0.13, disc: 0.6 },
  minidisc: { width: 1.32, height: 1.5, depth: 0.15, disc: 0.4 },
  card: { width: 1.05, height: 1.7, depth: 0.11, disc: 0 },
  handheld: { width: 1.25, height: 1.4, depth: 0.14, disc: 0 },
  jewel: { width: 1.42, height: 1.25, depth: 0.1, disc: 0.6 },
  cartridge: { width: 1.3, height: 1.85, depth: 0.26, disc: 0 },
  wideCartridge: { width: 1.8, height: 1.28, depth: 0.36, disc: 0 },
  smallCartridge: { width: 1.15, height: 1.3, depth: 0.28, disc: 0 },
  pc: { width: 1.35, height: 1.9, depth: 0.16, disc: 0.6 },
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
const DISC_THICKNESS = 0.012;
// Keeps the art planes just off the shell so they never flicker into it.
const SURFACE_GAP = 0.001;

function shapeFor(consoleId) {
  return SHAPES[SHAPE_OF_CONSOLE[consoleId] || 'dvd'];
}

// Every Case of one shape shares these geometries.
const geometryCache = new Map();

function geometriesFor(shape) {
  if (geometryCache.has(shape)) return geometryCache.get(shape);
  const { width, height, depth, disc } = shape;
  const geometries = {
    tray: new THREE.BoxGeometry(width, height, depth - LID_THICKNESS),
    lid: new THREE.BoxGeometry(width, height, LID_THICKNESS),
    face: new THREE.PlaneGeometry(width, height),
    spine: new THREE.PlaneGeometry(depth, height),
    disc: disc ? new THREE.CylinderGeometry(disc, disc, DISC_THICKNESS, 48) : null,
  };
  geometryCache.set(shape, geometries);
  return geometries;
}

// Shared by every Case. Colours come from tokens.css so the 3D scene matches the rest of the UI.
let shared = null;

function sharedMaterials(colours) {
  if (!shared) {
    shared = {
      shell: new THREE.MeshLambertMaterial({ color: colours.shell }),
      blank: new THREE.MeshBasicMaterial({ color: colours.blank }),
      disc: new THREE.MeshLambertMaterial({ color: colours.disc }),
    };
  }
  return shared;
}

// Builds one Case. colours: { shell, blank, disc } as CSS colours.
function createCase(shape, colours) {
  const { width, height, depth, disc } = shape;
  const geometries = geometriesFor(shape);
  const materials = sharedMaterials(colours);
  const group = new THREE.Group();

  const tray = new THREE.Mesh(geometries.tray, materials.shell);
  tray.position.set(0, height / 2, -LID_THICKNESS / 2);
  group.add(tray);

  const back = new THREE.Mesh(geometries.face, materials.shell);
  back.rotation.y = Math.PI;
  back.position.set(0, height / 2, -depth / 2 - SURFACE_GAP);
  group.add(back);

  const spine = new THREE.Mesh(geometries.spine, materials.shell);
  spine.rotation.y = -Math.PI / 2;
  spine.position.set(-width / 2 - SURFACE_GAP, height / 2, 0);
  group.add(spine);

  // The lid turns around the spine edge: rotate hinge.rotation.y to open it.
  const hinge = new THREE.Group();
  hinge.position.set(-width / 2, 0, depth / 2 - LID_THICKNESS / 2);
  group.add(hinge);

  const lid = new THREE.Mesh(geometries.lid, materials.shell);
  lid.position.set(width / 2, height / 2, 0);
  hinge.add(lid);

  const coverMaterial = new THREE.MeshBasicMaterial();
  const front = new THREE.Mesh(geometries.face, materials.blank);
  front.position.set(width / 2, height / 2, LID_THICKNESS / 2 + SURFACE_GAP);
  hinge.add(front);

  let discMesh = null;
  if (disc) {
    discMesh = new THREE.Mesh(geometries.disc, materials.disc);
    discMesh.rotation.x = Math.PI / 2;
    discMesh.position.set(0, height / 2, depth / 2 - LID_THICKNESS - DISC_THICKNESS);
    // Hidden inside the closed Case, so there's no point drawing it yet.
    discMesh.visible = false;
    group.add(discMesh);
  }

  // Shows a Cover texture on the front, or the blank front while it loads.
  function setCover(texture) {
    if (!texture) {
      front.material = materials.blank;
      return;
    }
    coverMaterial.map = texture;
    coverMaterial.needsUpdate = true;
    front.material = coverMaterial;
  }

  return { group, shape, hinge, lid, front, back, spine, disc: discMesh, setCover };
}

export { SHAPES, shapeFor, createCase };
