import * as THREE from '../node_modules/three/build/three.module.js';

// Just in front of the cover, so the outline never fights it for depth.
const LIFT = 0.003;
const MIN_RADIUS = 0.012;

const vertexShader = `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// A signed-distance rounded rectangle keeps the stroke crisp at any tilt and for every case shape.
const fragmentShader = `
uniform vec2 uHalf;
uniform float uRadius;
uniform float uLine;
uniform float uGlow;
uniform float uGap;
uniform float uOpacity;
uniform float uBreath;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform vec4 uGlowColour;
varying vec2 vPos;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = box(vPos, uHalf, uRadius);
  float aa = fwidth(d) * 0.75;
  float line = (1.0 - smoothstep(uLine * 0.5 - aa, uLine * 0.5 + aa, abs(d))) * uBreath;
  float outside = exp(-pow(max(d, 0.0) / uGlow, 2.0));
  float inside = smoothstep(-uGap, 0.0, d);
  float glow = (d > 0.0 ? outside : inside * inside) * uGlowColour.a * uBreath;
  float t = clamp((vPos.x + uHalf.x) / (2.0 * uHalf.x) + vPos.y / (8.0 * uHalf.y), 0.0, 1.0);
  vec3 stroke = mix(uFrom, uTo, smoothstep(0.0, 1.0, t));
  float under = glow * (1.0 - line);
  float alpha = line + under;
  if (alpha * uOpacity < 0.002) discard;
  gl_FragColor = vec4((stroke * line + uGlowColour.rgb * under) / alpha, alpha * uOpacity);
}`;

// Colours come in as raw sRGB: the shader writes them straight to the screen, as CSS would.
function createFocusRing(theme) {
  const uniforms = () => ({
    uHalf: { value: new THREE.Vector2() },
    uRadius: { value: 0 },
    uLine: { value: 0 },
    uGlow: { value: 0 },
    uGap: { value: 0 },
    uOpacity: { value: 0 },
    uBreath: { value: 1 },
    uFrom: { value: new THREE.Vector3(...theme.from) },
    uTo: { value: new THREE.Vector3(...theme.to) },
    uGlowColour: { value: new THREE.Vector4(...theme.glow) },
  });

  function makeRing() {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, transparent: true, depthWrite: false, uniforms: uniforms() });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, material, owner: null, shape: null, opacity: 0 };
  }

  // Sizes are themed in CSS pixels, so they turn into world units at the selected case's distance.
  let unitsPerPx = 0;
  const units = (px) => px * unitsPerPx;

  function fit(ring) {
    const { width, height, depth, radius } = ring.shape;
    const gap = units(theme.gap);
    const line = units(theme.line);
    const glow = units(theme.glowSize);
    const pad = gap + line + glow * 2.5;
    ring.mesh.geometry.dispose();
    ring.mesh.geometry = new THREE.PlaneGeometry(width + pad * 2, height + pad * 2);
    ring.mesh.position.set(0, height / 2, depth / 2 + LIFT);
    const u = ring.material.uniforms;
    u.uHalf.value.set(width / 2 + gap, height / 2 + gap);
    u.uRadius.value = Math.max(radius, MIN_RADIUS) + gap;
    u.uLine.value = line;
    u.uGlow.value = glow;
    u.uGap.value = gap;
  }

  // Two rings, so the case being left fades out while the new one fades in.
  const rings = [makeRing(), makeRing()];
  let active = 0;
  let cleared = false;

  function attach(group, shape) {
    cleared = false;
    if (rings[active].owner === group) return;
    active = 1 - active;
    const ring = rings[active];
    if (ring.owner) ring.owner.remove(ring.mesh);
    ring.owner = group;
    ring.shape = shape;
    ring.opacity = 0;
    fit(ring);
    group.add(ring.mesh);
  }

  function detach(group) {
    for (const ring of rings) {
      if (ring.owner !== group) continue;
      group.remove(ring.mesh);
      ring.owner = null;
      ring.opacity = 0;
      ring.mesh.visible = false;
    }
  }

  function clear() {
    cleared = true;
  }

  function setScale(next) {
    unitsPerPx = next;
    for (const ring of rings) if (ring.owner) fit(ring);
  }

  function update(now, dt, shown) {
    const breath = 0.5 - 0.5 * Math.cos((now / theme.period) * Math.PI * 2);
    const level = theme.low + (1 - theme.low) * breath;
    let fading = false;
    let showing = false;
    rings.forEach((ring, i) => {
      const want = i === active && shown && !cleared && ring.owner ? 1 : 0;
      const step = Math.min(1, dt / theme.fade);
      ring.opacity += Math.sign(want - ring.opacity) * Math.min(Math.abs(want - ring.opacity), step);
      ring.material.uniforms.uOpacity.value = ring.opacity;
      ring.material.uniforms.uBreath.value = level;
      ring.mesh.visible = ring.opacity > 0;
      if (ring.opacity !== want) fading = true;
      if (ring.mesh.visible) showing = true;
    });
    return { fading, showing };
  }

  function dispose() {
    for (const ring of rings) {
      ring.mesh.geometry.dispose();
      ring.material.dispose();
    }
  }

  return { attach, detach, clear, setScale, update, dispose, reach: () => units(theme.gap + theme.line) };
}

export { createFocusRing };
