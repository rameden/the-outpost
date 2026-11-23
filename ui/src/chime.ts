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
// A major's five-note scale, so any sweep across them is in tune. It's meant to sound like sonar, but
// smooth: a pure sine with a faint octave over it, swelling in rather than struck, with the top taken
// off, ringing on a long while into a wash of reverb. Nothing in it beats or repeats (no out-of-tune
// twin, no echo taps), so the tail fades away evenly instead of pulsing. Silent when the
// notification sound is off.
export const STRUM_NOTES = [880, 739.99, 659.25, 554.37, 493.88, 440, 369.99, 329.63]; // A5 F#5 E5 C#5 B4 A4 F#4 E4
const STRUM_RING = 4.5; // seconds the note itself rings; the reverb carries it on past that
const HALL = 5; // seconds the reverb takes to die away
let strumBus: AudioNode | null = null;

// The reverb's echo of a single click: noise fading away smoothly over HALL seconds, darker as it
// goes, and different in each ear so it sounds wide. Made once, here, so there's no sound file.
function hall(a: AudioContext): AudioBuffer {
  const n = Math.floor(a.sampleRate * HALL), buf = a.createBuffer(2, n, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let dark = 0;
    for (let k = 0; k < n; k++) {
      const left = Math.exp((-6.9 * k) / n); // down 60 dB by the end
      dark += (Math.random() * 2 - 1 - dark) * (0.08 + 0.5 * left); // smoother (darker) as it fades
      data[k] = dark * left;
    }
  }
  return buf;
}

// Where the strum goes: through a gentle low-pass (the top off, so it's warm), then out as it is
// and into the reverb.
function strumOut(a: AudioContext): AudioNode {
  if (strumBus) return strumBus;
  const bus = a.createBiquadFilter(), dry = a.createGain(), room = a.createConvolver(), wet = a.createGain();
  bus.type = "lowpass";
  bus.frequency.value = 2000;
  dry.gain.value = 0.55;
  wet.gain.value = 1.6;
  room.buffer = hall(a);
  bus.connect(dry).connect(a.destination);
  bus.connect(room).connect(wet).connect(a.destination);
  strumBus = bus;
  return bus;
}

// Line `i` (0 is nearest the sun) at `strength` from 0 (a slow pass) to 1 (a quick sweep).
export function strum(i: number, strength = 0.5) {
  if (!chimeOn()) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const f = STRUM_NOTES[Math.min(Math.max(i, 0), STRUM_NOTES.length - 1)];
  const peak = 0.03 + 0.03 * Math.min(Math.max(strength, 0), 1), out = strumOut(a), t = a.currentTime + 0.01;
  for (const [freq, share, ring] of [[f, 1, 1], [f * 2, 0.06, 0.35]] as const) {
    const osc = a.createOscillator(), gain = a.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak * share, t + 0.07); // swells in, not struck
    gain.gain.exponentialRampToValueAtTime(0.0001, t + STRUM_RING * ring);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + STRUM_RING * ring + 0.05);
  }
}
