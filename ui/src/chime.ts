// The chime that goes with a browser notification: two or three soft sine notes, made with
// Web Audio so there's no sound file. The notes' shape tells you what happened without looking:
// rising for a decision, settling for finished, falling for failed.

import { storeGet, storeSet } from "./api.ts";

export type ChimeKind = "ask" | "done" | "fail";

export const CHIME_NOTES: Record<ChimeKind, number[]> = {
  ask: [659.25, 880], // E5 → A5
  done: [523.25, 659.25, 783.99], // C5 E5 G5
  fail: [587.33, 440], // D5 → A4
};

const STEP = 0.14; // seconds between notes
const RING = 0.9; // how long each note rings
const VOLUME = 0.3;

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

export function playChime(kind: ChimeKind) {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const t0 = a.currentTime + 0.02;
  CHIME_NOTES[kind].forEach((f, i) => {
    note(a, f, t0 + i * STEP, RING, VOLUME);
    note(a, f * 2, t0 + i * STEP, RING * 0.45, VOLUME * 0.13); // a quiet octave on top, for shine
  });
}

function note(a: AudioContext, freq: number, t: number, ring: number, peak: number) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + ring + 0.05);
}

// The orbit lines in the camp at rest (MaeSystem) can be strummed, and each sounds its own note as
// the pointer crosses it: the nearest line highest, as a shorter string is, falling outwards through
// A minor's five-note scale, so any sweep across them is in tune, and a little dark. It's meant to
// sound like a working ship's sonar heard over the comms, not a chime: each ping starts with a
// relay's click and a clang of metal (a second tone, 1.4 times as high, bends the note hard and then
// lets go, as struck plate does), starts a touch sharp and slides onto its note, and goes through
// a little overdrive and a radio's narrow band, so it's gritty. Then it rings on a long while into
// a dark reverb, like a hull. Each line sits at its own place from left to right, so a sweep moves
// across. Nothing in it beats or repeats (no out-of-tune twin, no echo taps), so the tail fades
// away evenly instead of pulsing. Silent when the notification sound is off.
export const STRUM_NOTES = [440, 392, 329.63, 293.66, 261.63, 220, 196, 164.81]; // A4 G4 E4 D4 C4 A3 G3 E3
const STRUM_RING = 4.5; // seconds the note itself rings; the reverb carries it on past that
const HALL = 5; // seconds the reverb takes to die away
let strumBus: AudioNode | null = null;
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
      dark += (Math.random() * 2 - 1 - dark) * (0.05 + 0.4 * left); // smoother (darker) as it fades
      data[k] = dark * left;
    }
  }
  return buf;
}

// Where the strum goes: driven into a gentle overdrive (the grit), through a radio's band (no deep
// lows, no bright highs), then out as it is and into the reverb.
function strumOut(a: AudioContext): AudioNode {
  if (strumBus) return strumBus;
  const drive = a.createGain(), grit = a.createWaveShaper(), level = a.createGain(), lows = a.createBiquadFilter(), highs = a.createBiquadFilter();
  const dry = a.createGain(), room = a.createConvolver(), wet = a.createGain();
  drive.gain.value = 10;
  const k = 2, curve = new Float32Array(1024);
  for (let n = 0; n < curve.length; n++) { const x = (n / (curve.length - 1)) * 2 - 1; curve[n] = Math.tanh(k * x) / Math.tanh(k); }
  grit.curve = curve;
  grit.oversample = "2x";
  level.gain.value = 0.06;
  lows.type = "highpass";
  lows.frequency.value = 140;
  highs.type = "lowpass";
  highs.frequency.value = 2600;
  dry.gain.value = 0.6;
  wet.gain.value = 1.3;
  room.buffer = hall(a);
  drive.connect(grit).connect(level).connect(lows).connect(highs);
  highs.connect(dry).connect(a.destination);
  highs.connect(room).connect(wet).connect(a.destination);
  strumBus = drive;
  return drive;
}

// Line `i` (0 is nearest the sun) at `strength` from 0 (a slow pass) to 1 (a quick sweep).
export function strum(i: number, strength = 0.5) {
  if (!chimeOn()) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const f = STRUM_NOTES[Math.min(Math.max(i, 0), STRUM_NOTES.length - 1)];
  const hard = Math.min(Math.max(strength, 0), 1), peak = 0.035 + 0.03 * hard, t = a.currentTime + 0.01, end = t + STRUM_RING;
  // Where it sits: the nearest line in the middle, each further one out a little wider, by turns left and right.
  const pan = a.createStereoPanner();
  pan.pan.value = (i % 2 ? -1 : 1) * Math.min(0.7, 0.12 * i);
  pan.connect(strumOut(a));
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
