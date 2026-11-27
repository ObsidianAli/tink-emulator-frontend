import * as THREE from '../node_modules/three/build/three.module.js';
import { createHeart, disposeHearts } from './heart.js';

const SHAPES = {
  dvd: { width: 1.35, height: 1.9, depth: 0.14, radius: 0.07, rim: 0.03 },
  pc: { width: 1.35, height: 1.9, depth: 0.16, radius: 0.07, rim: 0.03 },
};

const LID_THICKNESS = 0.02;
const BEVEL = 0.012;
// Keeps the art planes just off the shell so they never flicker into it.
const SURFACE_GAP = 0.001;
const SPINE_FILL = 0.7;
const SHADOW_SPREAD = 0.35;
const ROUGHNESS = { plastic: 0.18, shell: 0.55 };
const SELECTED_GLOSS = { strength: 0, extraRoughness: 1 };

function shapeFor(kind) {
  return kind === 'steam' ? SHAPES.pc : SHAPES.dvd;
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
  const { width, height, depth, radius, rim } = shape;
  const shadow = new THREE.PlaneGeometry(width + SHADOW_SPREAD * 2, depth + SHADOW_SPREAD * 2);
  shadow.rotateX(-Math.PI / 2);
  const geometries = {
    tray: roundedSlab(width, height, depth - LID_THICKNESS, radius),
    lid: roundedSlab(width, height, LID_THICKNESS, radius),
    face: new THREE.PlaneGeometry(width - rim * 2, height - rim * 2),
    spine: new THREE.PlaneGeometry(depth * SPINE_FILL, height - Math.max(radius, BEVEL) * 2),
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
      shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    };
  }
  return shared;
}

function createCase(shape, colours) {
  const { width, height, depth } = shape;
  const geometries = geometriesFor(shape);
  const materials = sharedMaterials(colours);
  const roughness = ROUGHNESS.plastic;
  const group = new THREE.Group();

  let mats = materials;
  let fade = 1;
  let shade = 1;
  let inFront = false;
  let heart = null;
  const has = { cover: false, spine: false };

  const shadow = new THREE.Mesh(geometries.shadow, materials.shadow);
  shadow.position.y = SURFACE_GAP;
  shadow.renderOrder = -1;
  group.add(shadow);

  const tray = new THREE.Mesh(geometries.tray, materials.shell);
  tray.position.z = -LID_THICKNESS / 2;
  group.add(tray);

  const spineMaterial = new THREE.MeshStandardMaterial({ roughness });
  const spine = new THREE.Mesh(geometries.spine, materials.shell);
  spine.rotation.y = -Math.PI / 2;
  spine.position.set(-width / 2 - SURFACE_GAP, height / 2, 0);
  group.add(spine);

  const lid = new THREE.Mesh(geometries.lid, materials.shell);
  lid.position.z = depth / 2 - LID_THICKNESS / 2;
  group.add(lid);

  const coverMaterial = new THREE.MeshStandardMaterial({ roughness });
  const front = new THREE.Mesh(geometries.face, materials.blank);
  front.position.set(0, height / 2, depth / 2 + SURFACE_GAP);
  group.add(front);

  function show(mesh, material, texture, fallback) {
    if (material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true;
    }
    mesh.material = texture ? material : fallback;
  }

  const setCover = (texture) => { has.cover = Boolean(texture); show(front, coverMaterial, texture, mats.blank); };
  const setSpine = (texture) => { has.spine = Boolean(texture); show(spine, spineMaterial, texture, mats.shell); };

  function useMaterials(next) {
    mats = next;
    shadow.material = mats.shadow;
    tray.material = mats.shell;
    lid.material = mats.shell;
    show(front, coverMaterial, has.cover ? coverMaterial.map : null, mats.blank);
    show(spine, spineMaterial, has.spine ? spineMaterial.map : null, mats.shell);
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
    const owned = [coverMaterial, spineMaterial];
    for (const material of fading ? [...owned, ...Object.values(mats)] : owned) {
      if (material.transparent !== fading) material.needsUpdate = true;
      material.transparent = fading;
      material.opacity = alpha;
    }
    group.visible = alpha > 0;
    heart?.tint(shade, fade, inFront);
  }

  function setDim(amount, near = 1) {
    shade = 1 - amount;
    inFront = near < 0.5;
    heart?.tint(shade, fade, inFront);
    for (const material of [coverMaterial, spineMaterial]) {
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

  function dispose() {
    for (const material of [coverMaterial, spineMaterial]) material.dispose();
    if (mats !== materials) for (const material of Object.values(mats)) material.dispose();
    heart?.dispose();
  }

  return { group, shape, setCover, setSpine, setDim, setFade, setHeart, setRim, dispose };
}

function disposeShared() {
  for (const geometries of geometryCache.values()) {
    for (const geometry of Object.values(geometries)) geometry.dispose();
  }
  geometryCache.clear();
  disposeHearts();
  if (!shared) return;
  shared.shadow.map.dispose();
  for (const material of Object.values(shared)) material.dispose();
  shared = null;
}

export { SHAPES, shapeFor, coverAspect, spineAspect, createCase, disposeShared };
