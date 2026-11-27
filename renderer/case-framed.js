import * as THREE from '../node_modules/three/build/three.module.js';
import { createHeart, disposeHearts } from './heart.js';

const SHAPES = {
  dvd: { width: 1.35, height: 1.9, depth: 0.2, radius: 0.08, rim: 0.06 },
  pc: { width: 1.35, height: 1.9, depth: 0.21, radius: 0.08, rim: 0.06 },
};

// Keeps the art planes just off the shell so they never flicker into it.
const SURFACE_GAP = 0.001;
const TUCK = 0.004;
const BED = 0.002;
const SPINE_FILL = 0.86;
const SHADOW_SPREAD = 0.35;
const ROUGHNESS = { plastic: 0.18 };
const SELECTED_GLOSS = { strength: 0, extraRoughness: 1 };

let looks = null;

function look() {
  if (looks) return looks;
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  const number = (name) => parseFloat(read(name)) || 0;
  looks = {
    shell: read('--case-shell'),
    frame: read('--case-frame'),
    blank: read('--case-blank'),
    edge: number('--case-edge'),
    lip: number('--case-lip'),
    roughness: number('--case-roughness'),
    ridge: number('--case-ridge'),
    ridges: Math.round(number('--case-ridges')),
    bulge: number('--case-spine-bulge'),
    shine: number('--case-sleeve-shine'),
    glow: number('--case-sleeve-glow'),
    gloss: number('--case-sleeve-roughness'),
  };
  return looks;
}

function shapeFor(kind) {
  return kind === 'steam' ? SHAPES.pc : SHAPES.dvd;
}

function coverAspect(shape) {
  return (shape.width - shape.rim * 2) / (shape.height - shape.rim * 2);
}

function edgeOf(shape) {
  return Math.min(look().edge, shape.depth / 6);
}

function lipOf(shape) {
  return Math.max(look().lip, edgeOf(shape) + BED);
}

function ridgeBand(shape) {
  const { ridge, ridges } = look();
  if (ridges <= 0 || ridge <= 0) return 0;
  return ridge * 4 + (ridges - 1) * ridge * 3;
}

function spineSize(shape) {
  const edge = edgeOf(shape);
  const width = (shape.depth - edge * 2) * SPINE_FILL;
  const height = shape.height - Math.max(shape.radius, edge) * 2 - ridgeBand(shape) * 2;
  return { width, height };
}

function spineAspect(shape) {
  const { width, height } = spineSize(shape);
  return width / height;
}

function outline(path, width, height, radius, y) {
  const r = Math.max(0.001, Math.min(radius, width / 2, height / 2));
  const left = -width / 2;
  const right = width / 2;
  const bottom = y - height / 2;
  const top = y + height / 2;
  path.moveTo(left + r, bottom);
  path.lineTo(right - r, bottom);
  path.absarc(right - r, bottom + r, r, -Math.PI / 2, 0);
  path.lineTo(right, top - r);
  path.absarc(right - r, top - r, r, 0, Math.PI / 2);
  path.lineTo(left + r, top);
  path.absarc(left + r, top - r, r, Math.PI / 2, Math.PI);
  path.lineTo(left, bottom + r);
  path.absarc(left + r, bottom + r, r, Math.PI, Math.PI * 1.5);
  return path;
}

function extrude(shape, from, to, edge) {
  const depth = Math.max(0.0005, to - from - edge * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 6,
    bevelEnabled: edge > 0,
    bevelThickness: edge,
    bevelSize: edge,
    bevelSegments: 4,
  });
  geometry.translate(0, 0, from + edge);
  return geometry;
}

function smooth(geometry) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const sums = new Map();
  const keys = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`;
    keys.push(key);
    const sum = sums.get(key) || [0, 0, 0];
    sums.set(key, sum);
    sum[0] += normal.getX(i);
    sum[1] += normal.getY(i);
    sum[2] += normal.getZ(i);
  }
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(normal.getZ(i)) > 0.999) continue;
    const [x, y, z] = sums.get(keys[i]);
    const length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(i, x / length, y / length, z / length);
  }
  return geometry;
}

function painted(geometry, colour) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const count = flat.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([colour.r, colour.g, colour.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return flat;
}

function merge(parts) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    const arrays = parts.map((part) => part.getAttribute(name).array);
    const joined = new Float32Array(arrays.reduce((total, array) => total + array.length, 0));
    let at = 0;
    for (const array of arrays) {
      joined.set(array, at);
      at += array.length;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(joined, size));
  }
  parts.forEach((part) => part.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}

function shellGeometry(shape) {
  const { width, height, depth, radius, rim } = shape;
  const edge = edgeOf(shape);
  const { ridge, ridges, shell, frame } = look();
  const body = new THREE.Color(shell);
  const lipColour = new THREE.Color(frame);
  const outer = () => outline(new THREE.Shape(), width - edge * 2, height - edge * 2, radius - edge, height / 2);
  const front = depth / 2 - lipOf(shape) - BED;
  const parts = [painted(smooth(extrude(outer(), -depth / 2, front, edge)), body)];
  const ring = outer();
  const holeWidth = width - rim * 2 - TUCK * 2 + edge * 2;
  const holeHeight = height - rim * 2 - TUCK * 2 + edge * 2;
  ring.holes.push(outline(new THREE.Path(), holeWidth, holeHeight, Math.max(radius - rim, edge) + edge, height / 2));
  const from = Math.max(-depth / 2 + edge, front - edge * 3);
  parts.push(painted(smooth(extrude(ring, from, depth / 2, edge)), lipColour));
  const length = depth - edge * 2 - ridge * 2;
  for (let i = 0; ridgeBand(shape) > 0 && i < ridges; i++) {
    const y = Math.max(radius, edge) + ridge * 2 + i * ridge * 3;
    for (const at of [y, height - y]) {
      const bar = new THREE.CapsuleGeometry(ridge, length, 2, 6);
      bar.rotateX(Math.PI / 2);
      bar.translate(-width / 2 + ridge * 0.4, at, 0);
      parts.push(painted(bar, lipColour));
    }
  }
  return merge(parts);
}

function spineGeometry(shape) {
  const { width, height } = spineSize(shape);
  const { bulge } = look();
  if (bulge <= 0) return new THREE.PlaneGeometry(width, height);
  const radius = (width * width / 4 + bulge * bulge) / (2 * bulge);
  const angle = 2 * Math.asin(width / (2 * radius));
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 10, 1, true, -angle / 2, angle);
  geometry.translate(0, 0, bulge - radius);
  return geometry;
}

const geometryCache = new Map();

function geometriesFor(shape) {
  if (geometryCache.has(shape)) return geometryCache.get(shape);
  const { width, height, depth, rim } = shape;
  const shadow = new THREE.PlaneGeometry(width + SHADOW_SPREAD * 2, depth + SHADOW_SPREAD * 2);
  shadow.rotateX(-Math.PI / 2);
  const geometries = {
    shell: shellGeometry(shape),
    face: new THREE.PlaneGeometry(width - rim * 2, height - rim * 2),
    spine: painted(spineGeometry(shape), new THREE.Color(look().shell)),
    shadow,
  };
  geometryCache.set(shape, geometries);
  return geometries;
}

function canvasTexture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  return new THREE.CanvasTexture(canvas);
}

function shadowTexture() {
  return canvasTexture(64, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

function sheenTexture() {
  const texture = canvasTexture(64, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size * 0.8, size);
    gradient.addColorStop(0, 'rgb(255, 255, 255)');
    gradient.addColorStop(0.45, 'rgb(70, 70, 70)');
    gradient.addColorStop(1, 'rgb(0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let shared = null;

function sharedMaterials() {
  if (!shared) {
    const { blank, roughness, gloss, shine, glow } = look();
    shared = {
      shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness }),
      blank: new THREE.MeshStandardMaterial({ color: blank, roughness: ROUGHNESS.plastic }),
      sleeve: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0, 0, 0),
        roughness: gloss,
        emissive: new THREE.Color(1, 1, 1),
        emissiveMap: sheenTexture(),
        emissiveIntensity: glow,
        envMapIntensity: shine,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    };
  }
  return shared;
}

function createCase(shape, colours) {
  const { width, height, depth } = shape;
  const geometries = geometriesFor(shape);
  const materials = sharedMaterials();
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

  const shell = new THREE.Mesh(geometries.shell, materials.shell);
  group.add(shell);

  const spineMaterial = new THREE.MeshStandardMaterial({ roughness });
  const spine = new THREE.Mesh(geometries.spine, materials.shell);
  spine.rotation.y = -Math.PI / 2;
  spine.position.set(-width / 2 - SURFACE_GAP, height / 2, 0);
  group.add(spine);

  const coverZ = depth / 2 - lipOf(shape);
  const coverMaterial = new THREE.MeshStandardMaterial({ roughness });
  const front = new THREE.Mesh(geometries.face, materials.blank);
  front.position.set(0, height / 2, coverZ);
  group.add(front);

  const sleeve = new THREE.Mesh(geometries.face, materials.sleeve);
  sleeve.position.set(0, height / 2, coverZ + BED);
  sleeve.renderOrder = 1;
  group.add(sleeve);

  const face = new THREE.Object3D();
  face.position.set(0, height / 2, depth / 2 + SURFACE_GAP);
  group.add(face);

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
    shell.material = mats.shell;
    sleeve.material = mats.sleeve;
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
      face.add(heart.mesh);
    }
    heart.set(look, scale);
  }

  let rim = [];
  function setRim(material) {
    for (const mesh of rim) mesh.removeFromParent();
    rim = material ? [shell, spine].map((part) => {
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
  shared.sleeve.emissiveMap.dispose();
  for (const material of Object.values(shared)) material.dispose();
  shared = null;
  looks = null;
}

export { SHAPES, shapeFor, coverAspect, spineAspect, createCase, disposeShared };
