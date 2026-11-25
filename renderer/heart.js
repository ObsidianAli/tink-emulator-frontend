import * as THREE from '../node_modules/three/build/three.module.js';
import { HEART, HEART_WIDTH } from './icons.js';

const TEXTURE_SIZE = 512;
const VIEW = 36;
const CENTRE = 12;
const LIFT = 0.006;
const MAX_WIDTH = 1.05;
const SHADOW_DROP = 0.8;
const SHADOW_BLUR = 0.8;
const FRONT_ORDER = 11;
const SIDE_ORDER = 4;
const ANISOTROPY = 8;

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = `
uniform sampler2D uMap;
uniform vec3 uFill;
uniform vec3 uEdge;
uniform vec4 uShadow;
uniform float uShade;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec3 mask = texture2D(uMap, vUv).rgb;
  float shadow = uShadow.a * mask.b * (1.0 - mask.g);
  float alpha = mask.g + shadow;
  if (alpha < 0.004) discard;
  vec3 colour = (mix(uEdge, uFill, mask.r) * mask.g + uShadow.rgb * shadow) / alpha;
  gl_FragColor = vec4(colour * uShade, alpha * uOpacity);
}`;

function drawMasks(look, edgeWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const unit = TEXTURE_SIZE / VIEW;
  const path = new Path2D(HEART);
  const sticker = look === 'sticker';
  const paint = (colour) => {
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
    ctx.fill(path);
    if (sticker) ctx.stroke(path);
  };
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.globalCompositeOperation = 'lighter';
  const origin = TEXTURE_SIZE / 2 - CENTRE * unit;
  ctx.setTransform(unit, 0, 0, unit, origin, origin);
  ctx.lineWidth = edgeWidth;
  ctx.lineJoin = 'round';
  ctx.filter = `blur(${SHADOW_BLUR * unit}px)`;
  ctx.translate(0, SHADOW_DROP);
  paint('#00f');
  ctx.translate(0, -SHADOW_DROP);
  ctx.filter = 'none';
  paint('#0f0');
  ctx.fillStyle = '#f00';
  if (sticker) ctx.fill(path);
  else ctx.fillRect(-VIEW, -VIEW, VIEW * 3, VIEW * 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = ANISOTROPY;
  return texture;
}

let geometry = null;
const textures = new Map();

function textureFor(look, edgeWidth) {
  if (!textures.has(look)) textures.set(look, drawMasks(look, edgeWidth));
  return textures.get(look);
}

function createHeart(theme, { width, height, rim }) {
  geometry = geometry || new THREE.PlaneGeometry(1, 1);
  const uniforms = {
    uMap: { value: null },
    uFill: { value: new THREE.Vector3(...theme.fill) },
    uEdge: { value: new THREE.Vector3(...theme.edge) },
    uShadow: { value: new THREE.Vector4(...theme.shadow) },
    uShade: { value: 1 },
    uOpacity: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);

  function set(look, scale) {
    const { size, inset } = theme[look];
    const base = Math.min(width, MAX_WIDTH);
    const x = width / 2 - inset * base;
    const y = height / 2 - inset * base;
    uniforms.uMap.value = textureFor(look, theme.edgeWidth);
    if (look === 'sticker') mesh.position.set(x, y, LIFT);
    else mesh.position.set(x - rim, rim - y, LIFT);
    mesh.rotation.z = look === 'sticker' ? -theme.tilt : 0;
    mesh.scale.setScalar((size * base * VIEW * scale) / HEART_WIDTH);
    mesh.visible = scale > 0;
  }

  function tint(shade, opacity, front) {
    uniforms.uShade.value = shade;
    uniforms.uOpacity.value = opacity;
    mesh.renderOrder = front ? FRONT_ORDER : SIDE_ORDER;
  }

  return { mesh, set, tint, dispose: () => material.dispose() };
}

function disposeHearts() {
  geometry?.dispose();
  geometry = null;
  for (const texture of textures.values()) texture.dispose();
  textures.clear();
}

export { createHeart, disposeHearts };
