// The camp's sound, made with Web Audio so there's no sound file: Sonar Prime, the ping that goes
// with a browser notification and the strum of the orbit lines in the camp at rest (below). A clean
// sine glides down onto its note (1.5 semitones over 60 ms), with a light FM shimmer at twice the
// note that fades in about 80 ms and a tiny high click on the attack, through a compressor, a 3.4 s
// room and a stereo ping-pong echo.
//
// A notification is a phrase that starts on the root, E4, so the shape tells you what happened
// without looking: the root alone for a decision, a major chord up to the innermost line's note for
// finished, minor steps that don't resolve for failed. The root is the full ping and rings on for
// about 2 s under the rest; later notes are lighter, quicker-gliding pings, quieter as the phrase
// climbs, by turns a little left and right, the last ringing about 1.1 s; their echoes land exactly
// on every second note. A single ping takes a longer, more open echo.

import { storeGet, storeSet } from "./api.ts";

export type ChimeKind = "ask" | "done" | "fail";

// Each line's note, nearest the sun first (see the strum, below).
export const STRUM_NOTES = [659.25, 587.33, 493.88, 440, 392, 329.63, 293.66, 246.94]; // E5 D5 B4 A4 G4 E4 D4 B3
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const PHRASES: Record<ChimeKind, number[]> = {
  ask: [64], // E4
  done: [64, 68, 71, 76], // E4 G#4 B4 E5
  fail: [64, 66, 67], // E4 F#4 G4
};
export const CHIME_NOTES = Object.fromEntries(Object.entries(PHRASES).map(([k, ms]) => [k, ms.map(mtof)])) as Record<ChimeKind, number[]>;
const STEP = 0.09; // seconds between a phrase's notes

export const chimeOn = () => storeGet("camp-notify-sound") !== "off";
export const setChime = (on: boolean) => storeSet("camp-notify-sound", on ? "on" : "off");
// The strum has its own switch, off unless you turn it on (Settings → Appearance), as it sounds
// whenever the pointer crosses the orbit.
export const strumOn = () => storeGet("camp-strum-sound") === "on";
export const setStrum = (on: boolean) => storeSet("camp-strum-sound", on ? "on" : "off");

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
  const r = rig(a), notes = CHIME_NOTES[kind], n = notes.length, out = n === 1 ? r.open : r.tight, t0 = a.currentTime + 0.02;
  click(a, t0, 0.05, out);
  notes.forEach((f, i) => {
    const t = t0 + i * STEP, last = i === n - 1;
    if (i === 0) return tone(a, { f, t, peak: 0.22, decay: 2, glide: 1.5, glideTime: 0.06, pan: 0, out });
    const fade = 1 - (0.35 * i) / Math.max(1, n - 1);
    tone(a, { f, t, peak: (last ? 0.13 : 0.11) * fade, decay: last ? 1.1 : 0.3, glide: 0.5, glideTime: 0.02, pan: i % 2 ? 0.2 : -0.2, out });
  });
}

// The orbit lines in the camp at rest (MaeSystem) can be strummed, and each sounds its own note as
// the pointer crosses it: the nearest line highest, as a shorter string is, falling outwards through
// E minor's five-note scale, so any sweep across them is in tune. Each is one of the lighter pings;
// a quicker sweep plays it louder, with a sharper click and a longer glide. Each line sits at its own
// place from left to right, so a sweep moves across.
// Line `i` (0 is nearest the sun) at `strength` from 0 (a slow pass) to 1 (a quick sweep).
export function strum(i: number, strength = 0.5) {
  if (!strumOn()) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const f = STRUM_NOTES[Math.min(Math.max(i, 0), STRUM_NOTES.length - 1)];
  const hard = Math.min(Math.max(strength, 0), 1), side = (i % 2 ? -1 : 1) * Math.min(0.7, 0.12 * i);
  const t = a.currentTime + 0.01, out = rig(a).tight;
  click(a, t, 0.012 + 0.025 * hard, out);
  tone(a, { f, t, peak: 0.05 + 0.06 * hard, decay: 1.1, glide: 0.5 + hard, glideTime: 0.02 + 0.03 * hard, pan: side * 0.4, out });
}

type Fx = { reverb: number; delay: number; time: number; fb: number };
const OPEN: Fx = { reverb: 0.3, delay: 0.38, time: 0.32, fb: 0.42 };
const TIGHT: Fx = { reverb: 0.32, delay: 0.22, time: 2 * STEP, fb: 0.28 };
type Rig = { click: AudioBuffer; open: AudioNode; tight: AudioNode };
const rigs = new WeakMap<BaseAudioContext, Rig>();
function rig(a: BaseAudioContext): Rig {
  const had = rigs.get(a);
  if (had) return had;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  comp.connect(a.destination);
  // The room: 3.4 s of soft noise, fading, with a 12 ms swell so it doesn't click.
  const rate = a.sampleRate, seconds = 3.4, len = Math.floor(rate * seconds), ir = a.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let k = 0; k < len; k++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.4;
      d[k] = lp * Math.exp((-5 * (k / rate)) / seconds) * Math.min(1, k / (rate * 0.012));
    }
  }
  const verb = a.createConvolver();
  verb.buffer = ir;
  verb.connect(comp);
  // A way in at 85%, with a send to the room and a filtered echo bouncing left, right, left.
  const bus = (fx: Fx): AudioNode => {
    const into = a.createGain(), vol = a.createGain(), toRoom = a.createGain(), send = a.createGain();
    vol.gain.value = 0.85;
    toRoom.gain.value = fx.reverb;
    send.gain.value = fx.delay;
    into.connect(vol).connect(comp);
    vol.connect(toRoom).connect(verb);
    const [dL, dR] = [a.createDelay(1), a.createDelay(1)], [fL, fR] = [a.createBiquadFilter(), a.createBiquadFilter()], [gL, gR] = [a.createGain(), a.createGain()];
    const merge = a.createChannelMerger(2);
    for (const d of [dL, dR]) d.delayTime.value = fx.time;
    for (const f of [fL, fR]) { f.type = "lowpass"; f.frequency.value = 3200; }
    for (const g of [gL, gR]) g.gain.value = fx.fb;
    vol.connect(send).connect(dL);
    dL.connect(fL).connect(gL).connect(dR);
    dR.connect(fR).connect(gR).connect(dL);
    fL.connect(merge, 0, 0);
    fR.connect(merge, 0, 1);
    merge.connect(comp);
    return into;
  };
  const click = a.createBuffer(1, rate * 2, rate), cd = click.getChannelData(0);
  for (let k = 0; k < cd.length; k++) cd[k] = Math.random() * 2 - 1;
  const made: Rig = { click, open: bus(OPEN), tight: bus(TIGHT) };
  rigs.set(a, made);
  return made;
}
// One ping: down onto `f` from `glide` semitones above over `glideTime`, with the shimmer.
function tone(a: BaseAudioContext, o: { f: number; t: number; peak: number; decay: number; glide: number; glideTime: number; pan: number; out: AudioNode }) {
  const { f, t } = o, attack = 0.003, stop = t + attack + o.decay + 0.05;
  const osc = a.createOscillator(), gain = a.createGain(), shim = a.createOscillator(), depth = a.createGain();
  osc.type = "sine";
  osc.frequency.value = f;
  osc.frequency.setValueAtTime(f * 2 ** (o.glide / 12), t);
  osc.frequency.exponentialRampToValueAtTime(f, t + o.glideTime);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
  shim.frequency.value = f * 2;
  depth.gain.setValueAtTime(f * 0.6, t);
  depth.gain.exponentialRampToValueAtTime(Math.max(0.5, f * 0.02), t + 0.08);
  shim.connect(depth).connect(osc.frequency);
  osc.connect(gain);
  if (o.pan) { const pan = a.createStereoPanner(); pan.pan.value = o.pan; gain.connect(pan).connect(o.out); } else gain.connect(o.out);
  shim.start(t); shim.stop(stop);
  osc.start(t); osc.stop(stop);
}
function click(a: BaseAudioContext, t: number, level: number, out: AudioNode) {
  const src = a.createBufferSource(), high = a.createBiquadFilter(), gain = a.createGain();
  src.buffer = rig(a).click;
  high.type = "highpass";
  high.frequency.value = 3000;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(level, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  src.connect(high).connect(gain).connect(out);
  src.start(t, Math.random(), 0.07);
}
