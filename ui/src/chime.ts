// The camp's sounds, made with Web Audio so there's no sound file: the chime that goes with a browser
// notification, and the strum of the orbit lines in the camp at rest (below). They're one voice: a
// notification sounds like the innermost line being plucked, so you know it's the camp. The shape
// tells you what happened without looking: that line's ping alone for a decision, a lower ping rising
// to it for finished, and it falling away to the lower one for failed.

import { storeGet, storeSet } from "./api.ts";

export type ChimeKind = "ask" | "done" | "fail";

// Each line's note, nearest the sun first (see the strum, below).
export const STRUM_NOTES = [659.25, 587.33, 493.88, 440, 392, 329.63, 293.66, 246.94]; // E5 D5 B4 A4 G4 E4 D4 B3
const INNER = STRUM_NOTES[0], BELOW = STRUM_NOTES[2];
export const CHIME_NOTES: Record<ChimeKind, number[]> = {
  ask: [INNER], // E5
  done: [BELOW, INNER], // B4 → E5
  fail: [INNER, BELOW], // E5 → B4
};
const STEP = 0.2; // seconds between pings

export const chimeOn = () => storeGet("camp-notify-sound") !== "off";
export const setChime = (on: boolean) => storeSet("camp-notify-sound", on ? "on" : "off");

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

// Browsers won't start sound until the page has had a click or a key. The chime plays when the
// tab is in the background, so the sound is set up on the first click instead, ready for later.
export function readyChimeOnFirstGesture() {
  if (typeof window === "undefined") return;
  const wake = () => {
    const a = audio();
    if (a?.state === "suspended") void a.resume().catch(() => {});
    window.removeEventListener("pointerdown", wake);
    window.removeEventListener("keydown", wake);
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
}

// Louder than a strum, as it's for when you're looking elsewhere.
export function playChime(kind: ChimeKind) {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const t0 = a.currentTime + 0.02;
  CHIME_NOTES[kind].forEach((f, i) => ping(a, f, 1, 0, t0 + i * STEP, "alert"));
}

// The orbit lines in the camp at rest (MaeSystem) can be strummed, and each sounds its own note as
// the pointer crosses it: the nearest line highest, as a shorter string is, falling outwards through
// E minor's five-note scale, so any sweep across them is in tune, and a little dark. It's meant to
// sound like a working ship's sonar heard over the comms, not a chime: each ping starts with a
// relay's click and a clang of metal (a second tone, 1.4 times as high, bends the note hard and then
// lets go, as struck plate does), starts a touch sharp and slides onto its note, and goes through
// a little overdrive and a radio's narrow band, so it's gritty. Then it rings on a long while into
// a dark reverb, like a hull. Each line sits at its own place from left to right, so a sweep moves
// across. A notification is the same ping (playChime, above). Nothing in it beats or repeats (no out-of-tune twin, no echo taps), so the tail fades
// away evenly instead of pulsing. Silent when the notification sound is off.
const STRUM_RING = 4.5; // seconds the note itself rings; the reverb carries it on past that
const HALL = 5; // seconds the reverb takes to die away
type Out = "strum" | "alert";
const buses: Partial<Record<Out, AudioNode>> = {};
let clickNoise: AudioBuffer | null = null;

// The reverb's echo of a single click: noise fading away smoothly over HALL seconds, darker as it
// goes, and different in each ear so it sounds wide. Made once, here, so there's no sound file.
function hall(a: AudioContext): AudioBuffer {
  const n = Math.floor(a.sampleRate * HALL), buf = a.createBuffer(2, n, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let dark = 0;
    for (let k = 0; k < n; k++) {
      const left = Math.exp((-6.9 * k) / n); // down 60 dB by the end
      dark += (Math.random() * 2 - 1 - dark) * (0.12 + 0.5 * left); // smoother (darker) as it fades
      data[k] = dark * left;
    }
  }
  return buf;
}

// Where a ping goes: driven into a gentle overdrive (the grit), through a radio's band (no deep
// lows, no bright highs), then out as it is and into the reverb. A notification's comes out louder.
function strumOut(a: AudioContext, out: Out): AudioNode {
  const made = buses[out];
  if (made) return made;
  const drive = a.createGain(), grit = a.createWaveShaper(), level = a.createGain(), lows = a.createBiquadFilter(), highs = a.createBiquadFilter();
  const dry = a.createGain(), room = a.createConvolver(), wet = a.createGain();
  drive.gain.value = 10;
  const k = 2, curve = new Float32Array(1024);
  for (let n = 0; n < curve.length; n++) { const x = (n / (curve.length - 1)) * 2 - 1; curve[n] = Math.tanh(k * x) / Math.tanh(k); }
  grit.curve = curve;
  grit.oversample = "2x";
  level.gain.value = out === "alert" ? 0.16 : 0.06;
  lows.type = "highpass";
  lows.frequency.value = 180;
  highs.type = "lowpass";
  highs.frequency.value = 4200;
  dry.gain.value = 0.6;
  wet.gain.value = 1.3;
  room.buffer = hall(a);
  drive.connect(grit).connect(level).connect(lows).connect(highs);
  highs.connect(dry).connect(a.destination);
  highs.connect(room).connect(wet).connect(a.destination);
  buses[out] = drive;
  return drive;
}

// Line `i` (0 is nearest the sun) at `strength` from 0 (a slow pass) to 1 (a quick sweep).
export function strum(i: number, strength = 0.5) {
  if (!chimeOn()) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const f = STRUM_NOTES[Math.min(Math.max(i, 0), STRUM_NOTES.length - 1)];
  // Where it sits: the nearest line in the middle, each further one out a little wider, by turns left and right.
  ping(a, f, Math.min(Math.max(strength, 0), 1), (i % 2 ? -1 : 1) * Math.min(0.7, 0.12 * i), a.currentTime + 0.01, "strum");
}

// One ping of note `f` at time `t`: `hard` from 0 to 1, `side` from -1 (left) to 1 (right).
function ping(a: AudioContext, f: number, hard: number, side: number, t: number, out: Out) {
  const peak = 0.035 + 0.03 * hard, end = t + STRUM_RING;
  const pan = a.createStereoPanner();
  pan.pan.value = side;
  pan.connect(strumOut(a, out));
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = "sine";
  osc.frequency.value = f;
  osc.frequency.setValueAtTime(f * 1.03, t); // a touch sharp, sliding onto the note
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.15);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(pan);
  // The clang: a tone 1.4 times as high (not a harmonic, so it sounds like metal, not a bell) bends
  // the note's pitch, hard at first and then not at all.
  const metal = a.createOscillator(), depth = a.createGain();
  metal.type = "sine";
  metal.frequency.value = f * 1.4;
  depth.gain.setValueAtTime(f * (0.8 + 0.9 * hard), t);
  depth.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
  metal.connect(depth).connect(osc.frequency);
  for (const o of [osc, metal]) { o.start(t); o.stop(end + 0.05); }
  // The relay's click: a few milliseconds of noise, narrowed to around the note.
  if (!clickNoise) {
    clickNoise = a.createBuffer(1, Math.floor(a.sampleRate * 0.03), a.sampleRate);
    const d = clickNoise.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  }
  const click = a.createBufferSource(), band = a.createBiquadFilter(), tap = a.createGain();
  click.buffer = clickNoise;
  band.type = "bandpass";
  band.frequency.value = f * 4;
  band.Q.value = 2;
  tap.gain.setValueAtTime(peak * 0.5, t);
  tap.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  click.connect(band).connect(tap).connect(pan);
  click.start(t);
}
