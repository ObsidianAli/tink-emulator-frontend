const MIN_GAP_MS = { move: 100, list: 100 };
const DEFAULT_GAP_MS = 50;

// A held direction repeats faster than a blip is worth hearing, so a sound repeating too soon is dropped.
function soundDue(name, now, lastPlayed) {
  const last = lastPlayed.get(name);
  return last === undefined || now - last >= (MIN_GAP_MS[name] || DEFAULT_GAP_MS);
}

const bell = (start, frequency, length, loudness) => [
  [start, frequency, length, loudness, 'sine'],
  [start, frequency * 2, length * 0.5, loudness * 0.18, 'sine'],
  [start, frequency * 3, length * 0.25, loudness * 0.08, 'sine'],
];
const wood = (start, frequency) => [
  [start, frequency, 0.12, 0.55, 'sine'],
  [start, frequency * 4, 0.03, 0.1375, 'sine'],
];

const mallet = (start, frequency, length, loudness) => [
  [start, frequency, length, loudness, 'sine'],
  [start, frequency * 4, length * 0.22, loudness * 0.16, 'sine'],
  [start, frequency * 9.2, 0.03, loudness * 0.05, 'sine'],
];
const box = (start, frequency, length, loudness) => [
  [start, frequency, length, loudness, 'sine'],
  [start, frequency * 3.01, length * 0.4, loudness * 0.14, 'sine'],
  [start, frequency * 5.4, length * 0.16, loudness * 0.07, 'sine'],
];
const pop = (start, frequency, loudness) => [
  [start, frequency * 0.55, 0.075, loudness, 'sine', frequency],
  [start, frequency * 2, 0.04, loudness * 0.12, 'sine'],
];

const SOUNDS = {
  move: [[0, 1175, 0.06, 0.5, 'sine', 1100]],
  list: [[0, 740, 0.05, 0.4, 'sine']],
  confirm: [[0, 784, 0.07, 0.6, 'sine'], [0.06, 1175, 0.1, 0.6, 'sine']],
  back: [[0, 880, 0.07, 0.5, 'sine'], [0.06, 587, 0.1, 0.5, 'sine']],
  toggle: [[0, 600, 0.04, 0.5, 'triangle'], [0.04, 900, 0.07, 0.5, 'triangle']],
  error: [[0, 392, 0.11, 0.5, 'sine'], [0.1, 311, 0.14, 0.5, 'sine']],
  profiles: [[0, 659, 0.09, 0.5, 'sine'], [0.08, 988, 0.16, 0.5, 'sine']],
  news: [[0, 1500, 0.07, 0.5, 'noise'], [0.05, 2300, 0.09, 0.6, 'noise'], [0.12, 3000, 0.06, 0.35, 'noise'], [0.19, 880, 0.07, 0.35, 'triangle'], [0.26, 1109, 0.13, 0.35, 'triangle']],
  album: [[0, 2800, 0.022, 0.95, 'noise'], [0, 220, 0.04, 0.35, 'triangle', 170], [0.085, 1900, 0.035, 0.8, 'noise'], [0.1, 1319, 0.16, 0.22, 'sine']],
  controllers: [...wood(0, 784), ...wood(0.08, 1047)],
  settings: [...[0, 0.055, 0.1, 0.14].flatMap((start) => [[start, 2400, 0.018, 0.9, 'noise'], [start, 3300, 0.02, 0.02, 'sine']]), [0.18, 150, 0.09, 0.6, 'sine', 110]],
  power: [...bell(0, 784, 0.25, 0.4), ...bell(0.1, 659, 0.25, 0.4), ...bell(0.2, 523, 0.5, 0.45)],
  store: [[0, 1480, 0.13, 0.35, 'sine', 740], [0.13, 196, 0.1, 0.7, 'sine', 140], [0.13, 900, 0.03, 0.25, 'noise'], [0.21, 1047, 0.14, 0.32, 'sine']],
  startup: [[0, 659, 0.9, 0.6, 'sine'], [0.1, 988, 1.3, 0.7, 'sine'], [0.1, 1976, 0.6, 0.12, 'sine']],
  launch: [[0, 523, 0.1, 0.5, 'sine'], [0.08, 659, 0.1, 0.5, 'sine'], [0.16, 784, 0.1, 0.5, 'sine'], [0.24, 1047, 0.2, 0.5, 'sine']],
  camera: [
    [0, 3000, 0.03, 0.9, 'noise'],
    [0, 1800, 0.02, 0.12, 'triangle', 900],
    [0.09, 2000, 0.05, 0.8, 'noise'],
    [0.09, 900, 0.05, 0.16, 'triangle', 420],
    [0.15, 1568, 0.16, 0.22, 'sine'],
  ],
};
const storeAt = (by) => [[0, 1480 * by, 0.13, 0.35, 'sine', 740 * by], [0.13, 233, 0.1, 0.7, 'sine', 167], [0.13, 900 * by, 0.03, 0.25, 'noise'], ...box(0.21, 1047 * by, 0.3, 0.34)];
const now = ['now', 'Now'];
const soft = (notes) => [now, ['soft', 'Softer', notes]];

const SOUND_CHOICES = {
  store: { label: 'Store', options: [now, ['a', 'Slightly higher', storeAt(1.19)], ['b', 'Higher', storeAt(1.335)], ['c', 'Highest', storeAt(1.5)]] },
  album: {
    label: 'Album',
    options: [
      now,
      ['a', 'Music box', [...box(0, 988, 0.3, 0.34), ...box(0.09, 1175, 0.3, 0.34), ...box(0.18, 1568, 0.34, 0.36), ...box(0.31, 1319, 0.6, 0.34)]],
      ['b', 'Flicked prints', [
        ...[0, 1, 2].flatMap((i) => [[i * 0.05, 1700 + i * 500, 0.035, 0.75, 'noise'], [i * 0.05, 294 + i * 60, 0.03, 0.22, 'sine']]),
        ...mallet(0.18, 784, 0.35, 0.34), ...mallet(0.2, 988, 0.4, 0.26), ...mallet(0.22, 1175, 0.5, 0.24),
      ]],
      ['c', 'Instant photo', [
        [0, 170, 0.26, 0.2, 'triangle', 300], [0, 900, 0.26, 0.3, 'noise', 2000], [0.26, 1600, 0.02, 0.7, 'noise'],
        ...bell(0.28, 1319, 0.4, 0.32), ...bell(0.36, 1976, 0.5, 0.2),
      ]],
    ],
  },
  news: {
    label: 'News',
    options: [
      now,
      ['a', 'Bubbles', [...pop(0, 784, 0.55), ...pop(0.085, 988, 0.55), ...pop(0.17, 1568, 0.6)]],
      ['b', 'Bulletin', [...mallet(0, 1175, 0.16, 0.42), ...mallet(0.08, 1175, 0.16, 0.3), ...mallet(0.19, 1568, 0.4, 0.45), ...mallet(0.19, 784, 0.3, 0.25)]],
      ['c', 'Page and ping', [[0, 900, 0.16, 0.65, 'noise', 3200], ...bell(0.13, 1568, 0.12, 0.3), ...bell(0.2, 2349, 0.45, 0.26)]],
    ],
  },
  move: { label: 'Move', options: soft([[0, 1175, 0.05, 0.3, 'sine', 1140], [0, 2350, 0.02, 0.04, 'sine']]) },
  list: { label: 'Move in lists', options: soft([[0, 784, 0.045, 0.28, 'sine'], [0, 1568, 0.02, 0.04, 'sine']]) },
  confirm: { label: 'OK', options: soft([...mallet(0, 784, 0.11, 0.5), ...mallet(0.06, 1175, 0.22, 0.5)]) },
  back: { label: 'Back', options: soft([...mallet(0, 784, 0.09, 0.4), ...mallet(0.06, 587, 0.18, 0.42)]) },
  toggle: { label: 'Switch', options: soft([[0, 784, 0.05, 0.4, 'sine'], [0.04, 1175, 0.1, 0.42, 'sine'], [0.04, 2350, 0.03, 0.05, 'sine']]) },
  error: { label: 'Error', options: soft([[0, 392, 0.12, 0.42, 'sine'], [0.1, 330, 0.18, 0.42, 'sine']]) },
  profiles: { label: 'Profiles', options: soft([...box(0, 784, 0.14, 0.42), ...box(0.08, 1175, 0.3, 0.42)]) },
  controllers: { label: 'Controllers', options: soft([...wood(0, 784), ...wood(0.08, 1175)]) },
  settings: { label: 'Settings', options: soft(SOUNDS.settings) },
  power: { label: 'Power', options: soft([...bell(0, 1175, 0.3, 0.34), ...bell(0.1, 988, 0.3, 0.36), ...bell(0.2, 784, 0.6, 0.42)]) },
  launch: { label: 'Launch', options: soft([...mallet(0, 587, 0.14, 0.4), ...mallet(0.08, 784, 0.14, 0.42), ...mallet(0.16, 988, 0.16, 0.44), ...mallet(0.24, 1175, 0.5, 0.48)]) },
};

let chosen = {};
function setSounds(next) {
  chosen = next;
}

function chosenNotes(name) {
  const option = SOUND_CHOICES[name]?.options.find(([id]) => id === chosen[name]);
  return option && option[2];
}

const CAMERA_MS = 600;

const lastPlayed = new Map();
let audio = null;
let output = null;
let airy = null;
let noise = null;

function startAudio() {
  audio = new AudioContext();
  const soften = audio.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 3200;
  output = audio.createGain();
  output.gain.value = 0.18;
  output.connect(soften).connect(audio.destination);
}

function airyOutput() {
  if (airy) return airy;
  airy = audio.createGain();
  airy.gain.value = 0.18;
  const soften = audio.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 5200;
  const size = Math.round(audio.sampleRate * 0.45);
  const room = audio.createBuffer(2, size, audio.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = room.getChannelData(channel);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size) ** 3;
  }
  const echo = audio.createConvolver();
  echo.buffer = room;
  const wet = audio.createGain();
  wet.gain.value = 0.3;
  airy.connect(soften).connect(audio.destination);
  soften.connect(echo).connect(wet).connect(audio.destination);
  return airy;
}

function playNoise(begin, frequency, length, loudness, slideTo, envelope, out) {
  if (!noise) {
    noise = audio.createBuffer(1, Math.round(audio.sampleRate * 0.4), audio.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = audio.createBufferSource();
  source.buffer = noise;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(frequency, begin);
  if (slideTo) band.frequency.exponentialRampToValueAtTime(slideTo, begin + length);
  band.Q.value = 4;
  envelope.gain.setValueAtTime(0.0001, begin);
  envelope.gain.linearRampToValueAtTime(loudness, begin + 0.002);
  envelope.gain.exponentialRampToValueAtTime(0.0001, begin + length);
  source.connect(band).connect(envelope).connect(out);
  source.start(begin);
  source.stop(begin + length + 0.02);
}

function playNotes(notes, at, out = output) {
  for (const [start, frequency, length, loudness, type, slideTo] of notes) {
    const begin = at + start;
    const envelope = audio.createGain();
    if (type === 'noise') {
      playNoise(begin, frequency, length, loudness, slideTo, envelope, out);
      continue;
    }
    const osc = audio.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, begin);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, begin + length);
    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.linearRampToValueAtTime(loudness, begin + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, begin + length);
    osc.connect(envelope).connect(out);
    osc.start(begin);
    osc.stop(begin + length + 0.02);
  }
}

function playSound(name, { hidden = false } = {}) {
  if (!SOUNDS[name] || (!hidden && document.visibilityState !== 'visible')) return;
  const now = performance.now();
  if (!soundDue(name, now, lastPlayed)) return;
  lastPlayed.set(name, now);
  try {
    if (!audio) startAudio();
    if (audio.state === 'suspended') audio.resume();
    const picked = chosenNotes(name);
    if (picked) playNotes(picked, audio.currentTime, airyOutput());
    else playNotes(SOUNDS[name], audio.currentTime);
  } catch {
  }
}

function suspendSound() {
  if (audio && audio.state === 'running') audio.suspend().catch(() => {});
}

let cameraTimer = null;
function playCamera() {
  const resting = cameraTimer || !audio || audio.state !== 'running';
  clearTimeout(cameraTimer);
  playSound('camera', { hidden: true });
  if (!resting) return;
  cameraTimer = setTimeout(() => {
    cameraTimer = null;
    suspendSound();
  }, CAMERA_MS);
}

if (typeof window !== 'undefined') {
  window.tink?.onShot?.(playCamera);
  // Opening the sound device blocks for about 60 ms, which would otherwise land on the first move.
  startAudio();
  suspendSound();
}
if (typeof module !== 'undefined') module.exports = { soundDue, SOUND_CHOICES };
