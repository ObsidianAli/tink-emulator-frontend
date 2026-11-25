import * as THREE from '../node_modules/three/build/three.module.js';

// Just in front of the cover, so the outline never fights it for depth.
const LIFT = 0.003;
const MIN_RADIUS = 0.012;
const STYLES = { snake: 0, rim: 1, under: 2 };
const FLOOR_LIFT = 0.002;

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
uniform float uBreath;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform vec4 uGlowColour;
uniform float uArc;
uniform float uPhase;
uniform float uHalo;
uniform vec2 uPool;
uniform float uPoolStrength;
varying vec2 vPos;
float along(vec2 p) {
  vec2 b = uHalf;
  float s;
  if (b.x - abs(p.x) < b.y - abs(p.y)) s = p.x > 0.0 ? 2.0 * b.x + b.y + p.y : 4.0 * b.x + 3.0 * b.y - p.y;
  else s = p.y < 0.0 ? b.x + p.x : 3.0 * b.x + 2.0 * b.y - p.x;
  return s / (4.0 * (b.x + b.y));
}
float trail(float s, float head, out float behind) {
  behind = fract(head - s);
  float tail = behind < uArc ? pow(1.0 - behind / uArc, 1.2) : 0.0;
  float tip = 1.0 - smoothstep(0.0, 0.015, fract(s - head));
  return max(tail, tip);
}
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
#if STYLE == 2
  vec2 q = vPos / uPool;
  float pool = exp(-2.5 * dot(q, q)) * uPoolStrength * uBreath;
  if (pool < 0.002) discard;
  gl_FragColor = vec4(mix(uFrom, uTo, smoothstep(-1.0, 1.0, q.x)), pool);
#else
  float d = box(vPos, uHalf, uRadius);
  float aa = fwidth(d) * 0.75;
  float line = (1.0 - smoothstep(uLine * 0.5 - aa, uLine * 0.5 + aa, abs(d))) * uBreath;
  float outside = exp(-pow(max(d, 0.0) / uGlow, 2.0));
  float inside = smoothstep(-uGap, 0.0, d);
  float glow = (d > 0.0 ? outside : inside * inside) * uGlowColour.a * uBreath;
  float t = clamp((vPos.x + uHalf.x) / (2.0 * uHalf.x) + vPos.y / (8.0 * uHalf.y), 0.0, 1.0);
  vec3 stroke = mix(uFrom, uTo, smoothstep(0.0, 1.0, t));
#if STYLE == 0
  float s = along(vPos);
  float behindA;
  float behindB;
  float a = trail(s, uPhase, behindA);
  float b = trail(s, uPhase + 0.5, behindB);
  stroke = mix(uTo, uFrom, clamp((a > b ? behindA : behindB) / uArc, 0.0, 1.0));
  line *= max(a, b);
  glow *= max(a, b);
#elif STYLE == 1
  line = 0.0;
  glow *= uHalo;
#endif
  float under = glow * (1.0 - line);
  float alpha = line + under;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4((stroke * line + uGlowColour.rgb * under) / alpha, alpha);
#endif
}`;

const rimVertexShader = `
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalMatrix * normal;
  vView = -view.xyz;
  vHeight = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * view;
}`;

const rimFragmentShader = `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uPower;
uniform float uLevel;
uniform float uHeight;
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
void main() {
  float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uPower);
  gl_FragColor = vec4(mix(uFrom, uTo, clamp(vHeight / uHeight, 0.0, 1.0)), edge * uLevel);
}`;

// Colours come in as raw sRGB: the shader writes them straight to the screen, as CSS would.
function createFocusRing(theme) {
  const uniforms = () => ({
    uHalf: { value: new THREE.Vector2() },
    uRadius: { value: 0 },
    uLine: { value: 0 },
    uGlow: { value: 0 },
    uGap: { value: 0 },
    uBreath: { value: 1 },
    uFrom: { value: new THREE.Vector3(...theme.from) },
    uTo: { value: new THREE.Vector3(...theme.to) },
    uGlowColour: { value: new THREE.Vector4(...theme.glow) },
    uArc: { value: theme.arc },
    uPhase: { value: 0 },
    uHalo: { value: theme.halo },
    uPool: { value: new THREE.Vector2() },
    uPoolStrength: { value: theme.poolStrength },
  });

  let style = STYLES.rim;

  function makeRing() {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, defines: { STYLE: style }, transparent: true, depthWrite: false, uniforms: uniforms() });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, material, owner: null, shape: null };
  }

  // Sizes are themed in CSS pixels, so they turn into world units at the selected case's distance.
  let unitsPerPx = 0;
  const units = (px) => px * unitsPerPx;

  function fit() {
    const { width, height, depth, radius } = ring.shape;
    const gap = units(theme.gap);
    const line = units(theme.line);
    const glow = units(theme.glowSize);
    const pad = gap + line + glow * 2.5;
    const u = ring.material.uniforms;
    ring.mesh.geometry.dispose();
    if (style === STYLES.under) {
      const spread = units(theme.poolSpread);
      u.uPool.value.set(width / 2 + spread, width / 2 + spread);
      ring.mesh.geometry = new THREE.PlaneGeometry(u.uPool.value.x * 4, u.uPool.value.y * 4);
      ring.mesh.rotation.x = -Math.PI / 2;
      ring.mesh.position.set(0, FLOOR_LIFT, 0);
      return;
    }
    ring.mesh.geometry = new THREE.PlaneGeometry(width + pad * 2, height + pad * 2);
    ring.mesh.position.set(0, height / 2, depth / 2 + LIFT);
    u.uHalf.value.set(width / 2 + gap, height / 2 + gap);
    u.uRadius.value = Math.max(radius, MIN_RADIUS) + gap;
    u.uLine.value = line;
    u.uGlow.value = glow;
    u.uGap.value = gap;
  }

  let ring = makeRing();
  let rim = null;
  let lit = null;
  let shownAt = null;

  function attach(item) {
    light(item);
    if (ring.owner === item.group) return;
    if (ring.owner) ring.owner.remove(ring.mesh);
    ring.owner = item.group;
    ring.shape = item.shape;
    shownAt = null;
    fit();
    item.group.add(ring.mesh);
  }

  function clear() {
    light(null);
    if (ring.owner) ring.owner.remove(ring.mesh);
    ring.owner = null;
  }

  function detach(item) {
    if (ring.owner === item.group) clear();
  }

  function setStyle(name) {
    const next = STYLES[name] ?? STYLES.rim;
    if (next === style) return;
    dispose();
    style = next;
    ring = makeRing();
  }

  function makeRim() {
    return new THREE.ShaderMaterial({
      vertexShader: rimVertexShader,
      fragmentShader: rimFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFrom: { value: new THREE.Vector3(...theme.from) },
        uTo: { value: new THREE.Vector3(...theme.to) },
        uPower: { value: theme.rimPower },
        uLevel: { value: 0 },
        uHeight: { value: 1 },
      },
    });
  }

  // Cases share one material: a shader with no users left is dropped, and compiling it again stalls the next move.
  function light(item) {
    if (style !== STYLES.rim || item === lit) return;
    if (lit) lit.setRim(null);
    lit = item;
    if (!item) return;
    rim ||= makeRim();
    rim.uniforms.uHeight.value = item.shape.height;
    item.setRim(rim);
  }

  function setScale(next) {
    unitsPerPx = next;
    if (ring.owner) fit();
  }

  function update(now, shown) {
    const showing = shown && ring.owner !== null;
    if (showing) shownAt ??= now;
    else shownAt = null;
    const breath = 0.5 + 0.5 * Math.cos(((now - shownAt) / theme.period) * Math.PI * 2);
    const level = theme.low + (1 - theme.low) * breath;
    if (rim) rim.uniforms.uLevel.value = showing ? level * theme.rimStrength : 0;
    ring.material.uniforms.uBreath.value = level;
    ring.material.uniforms.uPhase.value = (now / theme.lap) % 1;
    ring.mesh.visible = showing;
    return showing;
  }

  function dispose() {
    clear();
    if (rim) rim.dispose();
    rim = null;
    ring.mesh.geometry.dispose();
    ring.material.dispose();
  }

  return { attach, detach, clear, setStyle, setScale, update, dispose, reach: () => units(theme.gap + theme.line) };
}

export { createFocusRing };
