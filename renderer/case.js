import * as THREE from '../node_modules/three/build/three.module.js';
import { createHeart, disposeHearts } from './heart.js';

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
const LID_OPEN = -0.8 * Math.PI;
const DISC_OUT = { z: 0.9, y: 0.3 };
const DISC_TILT = -0.12;
// The cap UVs put the label on its side; this stands it upright.
const LABEL_TURN = Math.PI / 2;
// Keeps the art planes just off the shell so they never flicker into it.
const SURFACE_GAP = 0.001;
const SPINE_FILL = 0.7;
const SHADOW_SPREAD = 0.35;
const ROUGHNESS = { plastic: 0.18, box: 0.62, shell: 0.55 };
const SELECTED_GLOSS = { strength: 0, extraRoughness: 1 };

function shapeFor(consoleId) {
  return SHAPES[SHAPE_OF_CONSOLE[consoleId] || 'dvd'];
}

function coverAspect(shape) {
  return (shape.width - shape.rim * 2) / (shape.height - shape.rim * 2);
}

function spineAspect(shape) {
  return (shape.depth * SPINE_FILL) / (shape.height - Math.max(shape.radius, BEVEL) * 2);
}

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

function createCase(shape, colours) {
  const { width, height, depth, disc } = shape;
  const geometries = geometriesFor(shape);
  const materials = sharedMaterials(colours);
  const roughness = shape.box ? ROUGHNESS.box : ROUGHNESS.plastic;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  let mats = materials;
  let fade = 1;
  let shade = 1;
  let inFront = false;
  let heart = null;
  const has = { cover: false, spine: false, back: false, label: false };

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

  const discRest = depth / 2 - LID_THICKNESS - DISC_THICKNESS;
  const discHolder = new THREE.Group();
  discHolder.position.set(0, height / 2, discRest);
  body.add(discHolder);
  const labelMaterial = new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 0.3 });
  let discMesh = null;
  if (disc) {
    // Cylinder groups are side, top, bottom.
    discMesh = new THREE.Mesh(geometries.disc, [materials.disc, materials.disc, materials.disc]);
    discMesh.rotation.x = Math.PI / 2;
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

  const setCover = (texture) => { has.cover = Boolean(texture); show(front, coverMaterial, texture, mats.blank); };
  const setSpine = (texture) => { has.spine = Boolean(texture); show(spine, spineMaterial, texture, mats.shell); };
  const setBack = (texture) => { has.back = Boolean(texture); show(back, backMaterial, texture, mats.shell); };

  function useMaterials(next) {
    mats = next;
    shadow.material = mats.shadow;
    tray.material = mats.shell;
    lid.material = mats.shell;
    show(front, coverMaterial, has.cover ? coverMaterial.map : null, mats.blank);
    show(spine, spineMaterial, has.spine ? spineMaterial.map : null, mats.shell);
    show(back, backMaterial, has.back ? backMaterial.map : null, mats.shell);
    if (discMesh) {
      const face = has.label ? labelMaterial : mats.disc;
      discMesh.material = [mats.disc, face, face];
    }
  }

  function setFade(alpha) {
    if (alpha === fade) return;
    fade = alpha;
    if (alpha >= 1 && mats !== materials) {
      const own = mats;
      useMaterials(materials);
      for (const material of Object.values(own)) material.dispose();
    } else if (alpha < 1 && mats === materials) {
      const own = {};
      for (const [name, material] of Object.entries(materials)) {
        own[name] = material.clone();
        own[name].transparent = true;
      }
      useMaterials(own);
    }
    const fading = alpha < 1;
    const owned = [coverMaterial, spineMaterial, backMaterial, labelMaterial];
    for (const material of fading ? [...owned, ...Object.values(mats)] : owned) {
      if (material.transparent !== fading) material.needsUpdate = true;
      material.transparent = fading;
      material.opacity = alpha;
    }
    group.visible = alpha > 0;
    heart?.tint(shade, fade, inFront);
  }

  function setLabel(texture) {
    if (!discMesh) return;
    labelMaterial.map = texture;
    labelMaterial.needsUpdate = true;
    has.label = Boolean(texture);
    const face = texture ? labelMaterial : mats.disc;
    discMesh.material = [mats.disc, face, face];
  }

  function setDim(amount, near = 1) {
    shade = 1 - amount;
    inFront = near < 0.5;
    heart?.tint(shade, fade, inFront);
    for (const material of [coverMaterial, spineMaterial, backMaterial]) {
      material.color.setScalar(shade);
      material.envMapIntensity = SELECTED_GLOSS.strength + (1 - SELECTED_GLOSS.strength) * near;
      material.roughness = Math.min(1, roughness + SELECTED_GLOSS.extraRoughness * (1 - near));
    }
  }

  function setHeart(look, scale) {
    if (!heart) {
      if (scale <= 0) return;
      heart = createHeart(colours.heart, shape);
      heart.tint(shade, fade, inFront);
      front.add(heart.mesh);
    }
    heart.set(look, scale);
  }

  let rim = [];
  function setRim(material) {
    for (const mesh of rim) mesh.removeFromParent();
    rim = material ? [tray, lid, spine].map((part) => {
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.renderOrder = 5;
      part.add(mesh);
      return mesh;
    }) : [];
  }

  function setPose({ flip, lid, disc: out, spin }) {
    body.rotation.y = flip * Math.PI;
    hinge.rotation.y = lid * LID_OPEN;
    if (!discMesh) return;
    discMesh.visible = out > 0 || lid > 0;
    discHolder.position.set(0, height / 2 + out * DISC_OUT.y * height, discRest + out * DISC_OUT.z);
    discHolder.rotation.x = out * DISC_TILT;
    discMesh.rotation.y = LABEL_TURN - spin;
  }

  function dispose() {
    for (const material of [coverMaterial, spineMaterial, backMaterial, labelMaterial]) material.dispose();
    if (mats !== materials) for (const material of Object.values(mats)) material.dispose();
    heart?.dispose();
  }

  return { group, shape, disc: discMesh, setCover, setSpine, setBack, setLabel, setDim, setFade, setHeart, setRim, setPose, dispose };
}

function disposeShared() {
  for (const geometries of geometryCache.values()) {
    for (const geometry of Object.values(geometries)) geometry?.dispose();
  }
  geometryCache.clear();
  disposeHearts();
  if (!shared) return;
  shared.shadow.map.dispose();
  for (const material of Object.values(shared)) material.dispose();
  shared = null;
}

export { SHAPES, shapeFor, coverAspect, spineAspect, createCase, disposeShared };
