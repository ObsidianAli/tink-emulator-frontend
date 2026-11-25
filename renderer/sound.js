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

const SOUNDS = {
  move: [[0, 1175, 0.06, 0.5, 'sine', 1100]],
  list: [[0, 740, 0.05, 0.4, 'sine']],
  confirm: [[0, 784, 0.07, 0.6, 'sine'], [0.06, 1175, 0.1, 0.6, 'sine']],
  back: [[0, 880, 0.07, 0.5, 'sine'], [0.06, 587, 0.1, 0.5, 'sine']],
  flip: [[0, 500, 0.11, 0.5, 'sine', 900], [0, 250, 0.11, 0.3, 'triangle', 450]],
  open: [[0, 523, 0.09, 0.5, 'sine'], [0.07, 659, 0.09, 0.5, 'sine'], [0.14, 784, 0.12, 0.5, 'sine']],
  discOut: [[0, 1200, 0.12, 0.35, 'sine', 1800], [0, 2400, 0.12, 0.1, 'sine', 3600]],
  toggle: [[0, 600, 0.04, 0.5, 'triangle'], [0.04, 900, 0.07, 0.5, 'triangle']],
  error: [[0, 392, 0.11, 0.5, 'sine'], [0.1, 311, 0.14, 0.5, 'sine']],
  profiles: [[0, 659, 0.09, 0.5, 'sine'], [0.08, 988, 0.16, 0.5, 'sine']],
  controllers: [...wood(0, 784), ...wood(0.08, 1047)],
  settings: [...[0, 0.055, 0.1, 0.14].flatMap((start) => [[start, 2400, 0.018, 0.9, 'noise'], [start, 3300, 0.02, 0.02, 'sine']]), [0.18, 150, 0.09, 0.6, 'sine', 110]],
  power: [...bell(0, 784, 0.25, 0.4), ...bell(0.1, 659, 0.25, 0.4), ...bell(0.2, 523, 0.5, 0.45)],
  launch: [[0, 523, 0.1, 0.5, 'sine'], [0.08, 659, 0.1, 0.5, 'sine'], [0.16, 784, 0.1, 0.5, 'sine'], [0.24, 1047, 0.2, 0.5, 'sine']],
};
const FOLLOWED_BY = { open: ['discOut', 0.26] };

const lastPlayed = new Map();
let audio = null;
let output = null;
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

function playNoise(begin, frequency, length, loudness, envelope) {
  if (!noise) {
    noise = audio.createBuffer(1, Math.round(audio.sampleRate * 0.2), audio.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = audio.createBufferSource();
  source.buffer = noise;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = frequency;
  band.Q.value = 4;
  envelope.gain.setValueAtTime(0.0001, begin);
  envelope.gain.linearRampToValueAtTime(loudness, begin + 0.002);
  envelope.gain.exponentialRampToValueAtTime(0.0001, begin + length);
  source.connect(band).connect(envelope).connect(output);
  source.start(begin);
  source.stop(begin + length + 0.02);
}

function playNotes(notes, at) {
  for (const [start, frequency, length, loudness, type, slideTo] of notes) {
    const begin = at + start;
    const envelope = audio.createGain();
    if (type === 'noise') {
      playNoise(begin, frequency, length, loudness, envelope);
      continue;
    }
    const osc = audio.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, begin);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, begin + length);
    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.linearRampToValueAtTime(loudness, begin + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, begin + length);
    osc.connect(envelope).connect(output);
    osc.start(begin);
    osc.stop(begin + length + 0.02);
  }
}

function playSound(name) {
  if (!SOUNDS[name] || document.visibilityState !== 'visible') return;
  const now = performance.now();
  if (!soundDue(name, now, lastPlayed)) return;
  lastPlayed.set(name, now);
  try {
    if (!audio) startAudio();
    if (audio.state === 'suspended') audio.resume();
    playNotes(SOUNDS[name], audio.currentTime);
    const follow = FOLLOWED_BY[name];
    if (follow) playNotes(SOUNDS[follow[0]], audio.currentTime + follow[1]);
  } catch {
  }
}

function suspendSound() {
  if (audio && audio.state === 'running') audio.suspend().catch(() => {});
}

if (typeof module !== 'undefined') module.exports = { soundDue };
