// The camp's sounds, made with Web Audio so there's no sound file: the chime that goes with a browser
// notification, and the strum of the orbit lines in the camp at rest (below). They're one voice,
// whichever the strum has (picked in Settings → Appearance), so you know it's the camp. Sonar Prime,
// the camp's own, plays a short phrase that always starts on its root: the ping alone for a decision,
// rising through a major chord to the innermost line's note for finished, and a few minor steps that
// don't resolve for failed. The other voices pluck the innermost line: alone for a decision, a lower
// ping rising to it for finished, and it falling away to the lower one for failed.

import { storeGet, storeRemove, storeSet } from "./api.ts";

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

// Louder than a strum, as it's for when you're looking elsewhere.
export function playChime(kind: ChimeKind) {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const t0 = a.currentTime + 0.02;
  if (strumVoice() === "prime") return primePhrase(a, PRIME_PHRASES[kind], t0);
  CHIME_NOTES[kind].forEach((f, i) => ping(a, f, 1, 0, t0 + i * STEP, "alert"));
}

// The orbit lines in the camp at rest (MaeSystem) can be strummed, and each sounds its own note as
// the pointer crosses it: the nearest line highest, as a shorter string is, falling outwards through
// E minor's five-note scale, so any sweep across them is in tune. Each line sits at its own place
// from left to right, so a sweep moves across. The note comes in one of a few voices, picked in
// Settings → Appearance (below), Sonar Prime unless you pick another. The others are soft, ring on
// into the same long reverb, and have nothing in them that beats or repeats (no out-of-tune twin, no
// echo taps), so their tails fade evenly; Sonar Prime brings its own room and echo. A notification
// is the same voice (playChime, above), louder.

export type StrumVoice = "prime" | "sonar" | "bell" | "wire" | "breath" | "console" | "analog" | "choir";
export const STRUM_VOICES: { id: StrumVoice; name: string; about: string }[] = [
  { id: "prime", name: "Sonar Prime", about: "The house sound: a clean sine ping that glides down onto its note with a brief shimmer and a tiny click, into a room and a ping-pong echo. Made whole, as designed, so it has no tone to shape." },
  { id: "sonar", name: "Sonar", about: "A working ship's sonar heard over the comms: a relay's click, a clang of metal, a little overdrive, then a long ring into the hull." },
  { id: "bell", name: "Glass bell", about: "A struck glass bar, like a vibraphone in a cold room: clear, a little shimmer at the start, then a long pure ring." },
  { id: "wire", name: "Wire", about: "A plucked steel wire, the way a guitar string is made in code: a soft pick, warm body, fading out like a held string." },
  { id: "breath", name: "Breath", about: "Air through a vent, tuned to the note: it swells in rather than starting, and drifts off. The softest of them." },
  { id: "console", name: "Console", about: "A bridge console's blip: a short bright chirp with a sweep of static under it, then only the room ringing." },
  { id: "analog", name: "Analog", about: "A warm old synth pluck: a buzzy wave with a sub an octave down, its filter closing as it fades. Rounder and lower." },
  { id: "choir", name: "Choir", about: "The wildcard: a ghost choir on a far channel. Each line is sung, not struck, an \"ooh\" on the outer lines opening to an \"aah\" near the sun." },
];
const VOICE_IDS = new Set<string>(STRUM_VOICES.map((v) => v.id));
export const strumVoice = (): StrumVoice => { const v = storeGet("camp-strum-voice"); return v && VOICE_IDS.has(v) ? (v as StrumVoice) : "prime"; };
export const setStrumVoice = (v: StrumVoice) => storeSet("camp-strum-voice", v);

const STRUM_RING = 4.5; // seconds the sonar's note itself rings; the reverb carries it on past that
const HALL = 5; // seconds the reverb takes to die away
type Out = "strum" | "alert";
type Voice = (a: BaseAudioContext, f: number, hard: number, side: number, t: number, out: Out) => void;
// Each sound's nodes are made once per audio context and kept (an offline one, for a test, gets its own).
const made = new WeakMap<BaseAudioContext, Map<string, AudioNode | AudioBuffer>>();
function once<T extends AudioNode | AudioBuffer>(a: BaseAudioContext, key: string, make: () => T): T {
  let m = made.get(a);
  if (!m) made.set(a, (m = new Map()));
  let v = m.get(key) as T | undefined;
  if (!v) m.set(key, (v = make()));
  return v;
}

// The reverb's echo of a single click: noise fading away smoothly over `seconds`, darker as it
// goes, and different in each ear so it sounds wide. Made once, here, so there's no sound file.
function hall(a: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(a.sampleRate * seconds), buf = a.createBuffer(2, n, a.sampleRate);
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

// The tone: the same for every voice, set in Settings → Appearance (Strum tone) to find the sound
// that fits. How loud; how much reverb (none at all to a lot) and how big the space; how long a note
// rings and how slowly it comes in; how bright, how much bass is cut, how much grit; an echo and its
// time; how wide across the ears; and the pitch, in octaves and semitones. The defaults are the
// voices as they were made.
export type RoomSize = "small" | "cabin" | "hull";
export type Tone = {
  volume: number; reverb: number; size: RoomSize; length: number; attack: number; bright: number; lowcut: number;
  grit: number; echo: number; echoTime: number; width: number; tune: number; octave: -1 | 0 | 1;
};
export const TONE_DEFAULT: Tone = {
  volume: 1, reverb: 1, size: "hull", length: 1, attack: 0, bright: 1, lowcut: 0,
  grit: 0, echo: 0, echoTime: 0.28, width: 1, tune: 0, octave: 0,
};
// Each number's bounds: what Settings' sliders go between, and what a kept tone is held to.
export const TONE_RANGE: Record<Exclude<keyof Tone, "size" | "octave">, [number, number]> = {
  volume: [0, 2], reverb: [0, 1], length: [0.05, 2], attack: [0, 0.4], bright: [0, 1], lowcut: [0, 1],
  grit: [0, 1], echo: [0, 1], echoTime: [0.06, 0.6], width: [0, 1.4], tune: [-12, 12],
};
export const ROOM_SIZES: { id: RoomSize; name: string; seconds: number }[] = [
  { id: "small", name: "Small room", seconds: 0.35 }, { id: "cabin", name: "Cabin", seconds: 1.4 }, { id: "hull", name: "Hull", seconds: HALL },
];
const clamp = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : d);
export function toneNow(): Tone {
  let kept: Partial<Tone> = {};
  try { kept = JSON.parse(storeGet("camp-strum-tone") ?? "{}") ?? {}; } catch { /* a broken one is the default */ }
  const tone = { ...TONE_DEFAULT };
  for (const [k, [lo, hi]] of Object.entries(TONE_RANGE) as [keyof typeof TONE_RANGE, [number, number]][]) tone[k] = clamp(kept[k], lo, hi, TONE_DEFAULT[k]);
  tone.tune = Math.round(tone.tune);
  if (ROOM_SIZES.some((r) => r.id === kept.size)) tone.size = kept.size as RoomSize;
  if (kept.octave === -1 || kept.octave === 1) tone.octave = kept.octave;
  return tone;
}
export function setTone(change: Partial<Tone>): Tone {
  storeSet("camp-strum-tone", JSON.stringify({ ...toneNow(), ...change }));
  return toneNow();
}
export const resetTone = (): Tone => { storeRemove("camp-strum-tone"); return toneNow(); };

// What the voices read as they play: how long (1 as made), the pitch (1 as made, 2 an octave up),
// how many seconds longer a note takes to come in (0 as made), and how wide (1 as made, 0 is mono).
let LONG = 1, OCT = 1, SLOW = 0, WIDE = 1;

// The room every voice rings into, after the tone's grit, brightness and low cut: heard as it is,
// through an echo, and through the reverb of the chosen size, all at the tone's volume. Made once;
// the tone is set on it each time a note plays.
type Room = {
  into: GainNode; pre: GainNode; post: GainNode; shade: BiquadFilterNode; cut: BiquadFilterNode; dry: GainNode;
  wet: Record<RoomSize, GainNode>; delay: DelayNode; again: GainNode; echo: GainNode; level: GainNode;
};
const rooms = new WeakMap<BaseAudioContext, Room>();
function theRoom(a: BaseAudioContext): Room {
  const had = rooms.get(a);
  if (had) return had;
  const into = a.createGain(), pre = a.createGain(), clip = a.createWaveShaper(), post = a.createGain(), shade = a.createBiquadFilter(), dry = a.createGain();
  const cut = a.createBiquadFilter(), delay = a.createDelay(1), again = a.createGain(), echo = a.createGain(), level = a.createGain();
  // The grit: a tanh drive that's straight for quiet sound at 1, so with no grit nothing changes.
  const curve = new Float32Array(2048);
  for (let n = 0; n < curve.length; n++) curve[n] = Math.tanh(4 * ((n / (curve.length - 1)) * 2 - 1));
  clip.curve = curve;
  clip.oversample = "2x";
  shade.type = "lowpass";
  shade.Q.value = 0.7;
  cut.type = "highpass";
  cut.Q.value = 0.7;
  into.connect(pre).connect(clip).connect(post).connect(shade).connect(cut);
  level.connect(a.destination);
  cut.connect(dry).connect(level);
  // The echo: the note again after a moment, each repeat quieter and a little darker, into the reverb too.
  const dull = a.createBiquadFilter();
  dull.type = "lowpass";
  dull.frequency.value = 3500;
  cut.connect(delay).connect(dull).connect(again).connect(delay);
  dull.connect(echo).connect(level);
  const wet = {} as Record<RoomSize, GainNode>;
  for (const r of ROOM_SIZES) {
    const verb = a.createConvolver(), amount = a.createGain();
    verb.buffer = hall(a, r.seconds);
    amount.gain.value = 0;
    cut.connect(verb);
    echo.connect(verb);
    verb.connect(amount).connect(level);
    wet[r.id] = amount;
  }
  const built: Room = { into, pre, post, shade, cut, dry, wet, delay, again, echo, level };
  rooms.set(a, built);
  return built;
}
const room = (a: BaseAudioContext): AudioNode => theRoom(a).into;

// The tone onto the room, and into LONG and OCT for the voices.
function wear(a: BaseAudioContext, tone = toneNow()) {
  const r = theRoom(a), drive = 1 + 40 * tone.grit;
  r.pre.gain.value = drive / 4;
  r.post.gain.value = (1 + 0.6 * tone.grit) / drive; // a little louder with grit, as it reads quieter once squashed
  r.shade.frequency.value = 600 * 2 ** (5 * tone.bright); // 600 Hz, dull, to 19 kHz, open
  r.cut.frequency.value = 20 * 30 ** tone.lowcut; // 20 Hz, nothing cut, to 600 Hz, thin
  r.dry.gain.value = 1 - 0.4 * tone.reverb;
  for (const s of ROOM_SIZES) r.wet[s.id].gain.value = s.id === tone.size ? 1.3 * tone.reverb : 0;
  r.delay.delayTime.value = tone.echoTime;
  r.again.gain.value = 0.2 + 0.4 * tone.echo; // more echo, more repeats
  r.echo.gain.value = 0.7 * tone.echo;
  r.level.gain.value = tone.volume;
  LONG = tone.length;
  OCT = 2 ** (tone.octave + tone.tune / 12);
  SLOW = tone.attack;
  WIDE = tone.width;
}

// A note's place from left to right, into the room.
function placed(a: BaseAudioContext, side: number, to: AudioNode = room(a)): AudioNode {
  const pan = a.createStereoPanner();
  pan.pan.value = Math.min(Math.max(side * WIDE, -1), 1);
  pan.connect(to);
  return pan;
}

// A tanh curve for a WaveShaper: `k` is how hard it squashes (1 is barely, 3 is crunchy).
function softClip(k: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let n = 0; n < curve.length; n++) { const x = (n / (curve.length - 1)) * 2 - 1; curve[n] = Math.tanh(k * x) / Math.tanh(k); }
  return curve;
}

// Plain noise, made once: a few seconds is enough for any note to swell and fade.
const noise = (a: BaseAudioContext) => once(a, "noise", () => {
  const b = a.createBuffer(1, Math.floor(a.sampleRate * 3.5), a.sampleRate), d = b.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  return b;
});

// An envelope on `p`: up from silence to `peak` over `rise` seconds, then down to silence by `end`.
// The tone's attack makes every rise longer, but a rise never takes more than most of the note.
function swell(p: AudioParam, t: number, peak: number, rise: number, end: number) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(peak, t + Math.min(rise + SLOW, 0.7 * (end - t)));
  p.exponentialRampToValueAtTime(0.0001, end);
}

// ---- Sonar: the ping as it was. An FM clang (a tone 1.4 times as high, not a harmonic, so it
// sounds like metal, bends the note hard and then lets go), starting a touch sharp and sliding onto
// its note, with a relay's click, through a gentle overdrive and a radio's narrow band.
function sonarOut(a: BaseAudioContext, out: Out): AudioNode {
  return once(a, `sonar-${out}`, () => {
    const drive = a.createGain(), grit = a.createWaveShaper(), level = a.createGain(), lows = a.createBiquadFilter(), highs = a.createBiquadFilter();
    drive.gain.value = 10;
    grit.curve = softClip(2);
    grit.oversample = "2x";
    level.gain.value = out === "alert" ? 0.16 : 0.06;
    lows.type = "highpass";
    lows.frequency.value = 180;
    highs.type = "lowpass";
    highs.frequency.value = 4200;
    drive.connect(grit).connect(level).connect(lows).connect(highs).connect(room(a));
    return drive;
  });
}
const sonar: Voice = (a, f, hard, side, t, out) => {
  const peak = 0.035 + 0.03 * hard, end = t + STRUM_RING * LONG;
  const pan = placed(a, side, sonarOut(a, out));
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = "sine";
  osc.frequency.value = f;
  osc.frequency.setValueAtTime(f * 1.03, t); // a touch sharp, sliding onto the note
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.15);
  swell(gain.gain, t, peak, 0.02, end);
  osc.connect(gain).connect(pan);
  const metal = a.createOscillator(), depth = a.createGain();
  metal.type = "sine";
  metal.frequency.value = f * 1.4;
  depth.gain.setValueAtTime(f * (0.8 + 0.9 * hard), t);
  depth.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
  metal.connect(depth).connect(osc.frequency);
  for (const o of [osc, metal]) { o.start(t); o.stop(end + 0.05); }
  // The relay's click: a few milliseconds of noise, narrowed to around the note.
  const click = a.createBufferSource(), band = a.createBiquadFilter(), tap = a.createGain();
  click.buffer = noise(a);
  band.type = "bandpass";
  band.frequency.value = f * 4;
  band.Q.value = 2;
  tap.gain.setValueAtTime(peak * 0.5, t);
  tap.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  click.connect(band).connect(tap).connect(pan);
  click.start(t, 0, 0.03);
};

// ---- Glass bell: a struck bar's own overtones (2.76, 5.4 and 8.9 times the note, as a free bar
// rings, so it's glassy, not a church bell), the higher ones dying first. Clean: no grit at all.
const BAR = [[1, 1, 4.2], [2.76, 0.32, 1.3], [5.4, 0.12, 0.5], [8.93, 0.05, 0.22]] as const; // ratio, loudness, seconds to ring
const bell: Voice = (a, f, hard, side, t, out) => {
  const pan = placed(a, side), loud = out === "alert" ? 2.5 : 1;
  for (const [ratio, amp, ring] of BAR) {
    if (f * ratio > 9000) continue;
    const osc = a.createOscillator(), gain = a.createGain();
    osc.type = "sine";
    osc.frequency.value = f * ratio;
    // A harder strike brings out the upper overtones more than the note.
    swell(gain.gain, t, loud * 0.04 * amp * (ratio === 1 ? 0.7 + 0.5 * hard : 0.4 + 1.2 * hard), 0.004, t + ring * LONG);
    osc.connect(gain).connect(pan);
    osc.start(t);
    osc.stop(t + ring * LONG + 0.05);
  }
};

// ---- Wire: a plucked string worked out sample by sample (Karplus-Strong): a burst of soft noise
// goes round a loop one note's length long, losing its highs a little each time round, so it rings
// at the note and mellows as it fades. Worked out once per note, then played like a recording.
const WIRE_RING = 5; // seconds to die away
function wireNote(a: BaseAudioContext, f: number): AudioBuffer {
  const ring = WIRE_RING * LONG;
  return once(a, `wire-${f}-${ring}`, () => {
    // Notes made at another length go, so changing the tone doesn't pile them up.
    for (const k of made.get(a)?.keys() ?? []) if (k.startsWith("wire-") && !k.endsWith(`-${ring}`)) made.get(a)!.delete(k);
    const sr = a.sampleRate, len = Math.floor(sr * (ring + 0.2)), buf = a.createBuffer(1, len, sr), y = buf.getChannelData(0);
    // The loop is P samples long; the averaging adds half a sample, and an all-pass makes up the fraction left over, so it's in tune.
    const P = sr / f;
    let N = Math.floor(P - 0.5), d = P - 0.5 - N;
    if (d < 0.1) { N -= 1; d += 1; }
    const C = (1 - d) / (1 + d), loss = Math.pow(10, -3 / (f * ring));
    // The pluck: noise, smoothed (a soft pick, not a sharp one), and picked a fifth of the way along.
    const pick = new Float32Array(N);
    let s = 0;
    for (let k = 0; k < N; k++) { s += (Math.random() * 2 - 1 - s) * 0.45; pick[k] = s; }
    const at = Math.max(1, Math.floor(N / 5));
    let lp1 = 0, ap1 = 0, peak = 0;
    for (let n = 0; n < len; n++) {
      const back = n >= N ? y[n - N] : 0, back1 = n > N ? y[n - N - 1] : 0;
      const lp = 0.5 * (back + back1) * loss;
      const ap = C * lp + lp1 - C * ap1;
      lp1 = lp; ap1 = ap;
      y[n] = (n < N ? pick[n] - (n >= at ? pick[n - at] : 0) : 0) + ap;
      peak = Math.max(peak, Math.abs(y[n]));
    }
    if (peak > 0) for (let n = 0; n < len; n++) y[n] /= peak;
    return buf;
  });
}
const wire: Voice = (a, f, hard, side, t, out) => {
  const src = a.createBufferSource(), tone = a.createBiquadFilter(), gain = a.createGain();
  src.buffer = wireNote(a, f);
  tone.type = "lowpass"; // a harder pluck is brighter
  tone.frequency.value = Math.min(9000, f * (3 + 7 * hard));
  tone.Q.value = 0.5;
  const level = (out === "alert" ? 2.5 : 1) * (0.1 + 0.08 * hard);
  gain.gain.value = level;
  if (SLOW > 0) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(level, t + Math.min(SLOW, 0.7 * WIRE_RING * LONG)); } // the tone's attack: a slower fade in
  src.connect(tone).connect(gain).connect(placed(a, side));
  src.start(t);
};

// ---- Breath: noise narrowed to the note (and, quieter, the octave above), with a faint pure tone
// under it, so it's air with a pitch. It swells in over a fifth of a second and drifts away.
const breath: Voice = (a, f, hard, side, t, out) => {
  const pan = placed(a, side), loud = out === "alert" ? 2.5 : 1, end = t + 3.2 * LONG, rise = 0.28 - 0.12 * hard;
  const air = a.createBufferSource();
  air.buffer = noise(a);
  for (const [mult, amp] of [[1, 1], [2, 0.35]] as const) {
    const band = a.createBiquadFilter(), gain = a.createGain();
    band.type = "bandpass";
    band.frequency.value = f * mult;
    band.Q.value = 30;
    swell(gain.gain, t, loud * amp * (1.3 + 0.8 * hard), rise, end);
    air.connect(band).connect(gain).connect(pan);
  }
  const hum = a.createOscillator(), gain = a.createGain();
  hum.type = "sine";
  hum.frequency.value = f;
  swell(gain.gain, t, loud * 0.016, rise * 1.4, end);
  hum.connect(gain).connect(pan);
  air.start(t, Math.random() * 0.2, Math.min(3.3, 3.2 * LONG + 0.1));
  hum.start(t);
  hum.stop(end + 0.05);
};

// ---- Console: a short triangle-wave chirp that drops onto its note in a few milliseconds, with a
// sweep of static falling under it, through the radio band. The blip is short; the room rings on.
function radio(a: BaseAudioContext, out: Out): AudioNode {
  return once(a, `radio-${out}`, () => {
    const lows = a.createBiquadFilter(), highs = a.createBiquadFilter(), level = a.createGain();
    lows.type = "highpass";
    lows.frequency.value = 300;
    highs.type = "lowpass";
    highs.frequency.value = 3800;
    level.gain.value = out === "alert" ? 2.5 : 1;
    lows.connect(highs).connect(level).connect(room(a));
    return lows;
  });
}
const consoleBlip: Voice = (a, f, hard, side, t, out) => {
  const pan = placed(a, side, radio(a, out)), end = t + 0.45;
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = "triangle";
  osc.frequency.value = f;
  osc.frequency.setValueAtTime(f * 1.5, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.03);
  swell(gain.gain, t, 0.05 + 0.03 * hard, 0.004, end);
  osc.connect(gain).connect(pan);
  osc.start(t);
  osc.stop(end + 0.05);
  const hiss = a.createBufferSource(), band = a.createBiquadFilter(), level = a.createGain();
  hiss.buffer = noise(a);
  band.type = "bandpass";
  band.Q.value = 6;
  band.frequency.setValueAtTime(f * 5, t);
  band.frequency.exponentialRampToValueAtTime(f, t + 0.32);
  swell(level.gain, t, 0.05 + 0.04 * hard, 0.03, t + 0.4);
  hiss.connect(band).connect(level).connect(pan);
  hiss.start(t, Math.random(), 0.45);
};

// ---- Analog: a sawtooth with a square an octave under it (exactly, so they never beat), through a
// resonant low-pass that closes as the note fades, and a little warm saturation.
function warm(a: BaseAudioContext, out: Out): AudioNode {
  return once(a, `warm-${out}`, () => {
    const sat = a.createWaveShaper(), level = a.createGain();
    sat.curve = softClip(1.5);
    sat.oversample = "2x";
    level.gain.value = out === "alert" ? 2.5 : 1;
    sat.connect(level).connect(room(a));
    return sat;
  });
}
const analog: Voice = (a, f, hard, side, t, out) => {
  const pan = placed(a, side, warm(a, out)), end = t + 2.6 * LONG;
  const filter = a.createBiquadFilter(), gain = a.createGain();
  filter.type = "lowpass";
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(Math.min(8000, f * (3 + 6 * hard)), t);
  filter.frequency.exponentialRampToValueAtTime(f * 1.1, t + 0.9 * LONG);
  swell(gain.gain, t, 0.025 + 0.015 * hard, 0.006, end);
  filter.connect(gain).connect(pan);
  for (const [type, mult, amp] of [["sawtooth", 1, 1], ["square", 0.5, 0.45]] as const) {
    const osc = a.createOscillator(), level = a.createGain();
    osc.type = type;
    osc.frequency.value = f * mult;
    level.gain.value = amp;
    osc.connect(level).connect(filter);
    osc.start(t);
    osc.stop(end + 0.05);
  }
};

// ---- Choir (the wildcard): one buzzy tone, like a voice's, through three narrow filters set where
// a sung vowel's resonances are, so it sings. The outer (lower) lines sing "ooh", opening to "aah"
// near the sun. It scoops up onto its note as a singer does, with a breath of air at the start; no
// vibrato, so the tail stays still.
const VOWELS = { oo: [[300, 1], [870, 0.35], [2240, 0.12]], aah: [[730, 1], [1090, 0.5], [2440, 0.2]] } as const;
const choir: Voice = (a, f, hard, side, t, out) => {
  const pan = placed(a, side), loud = out === "alert" ? 2.5 : 1, end = t + 3 * LONG, low = STRUM_NOTES.at(-1)!, high = STRUM_NOTES[0];
  const open = Math.min(Math.max((f / OCT - low) / (high - low), 0), 1); // 0 is "ooh", 1 is "aah"
  const voice = a.createGain(), gain = a.createGain();
  swell(gain.gain, t, loud * (0.16 + 0.09 * hard) * (2.4 - 1.4 * open), 0.14, end); // "ooh" is quieter than "aah": made up
  voice.connect(gain).connect(pan);
  const throat = a.createOscillator();
  throat.type = "sawtooth";
  throat.frequency.value = f;
  throat.frequency.setValueAtTime(f * 0.97, t); // a scoop up onto the note
  throat.frequency.exponentialRampToValueAtTime(f, t + 0.14);
  const air = a.createBufferSource(), airLevel = a.createGain();
  air.buffer = noise(a);
  swell(airLevel.gain, t, 0.25 + 0.2 * hard, 0.05, t + 0.5);
  air.connect(airLevel);
  VOWELS.oo.forEach(([fOo, ampOo], k) => {
    const [fAah, ampAah] = VOWELS.aah[k], band = a.createBiquadFilter(), level = a.createGain();
    band.type = "bandpass";
    band.frequency.value = fOo + (fAah - fOo) * open;
    band.Q.value = 9;
    level.gain.value = ampOo + (ampAah - ampOo) * open;
    throat.connect(band);
    airLevel.connect(band);
    band.connect(level).connect(voice);
  });
  throat.start(t);
  throat.stop(end + 0.05);
  air.start(t, Math.random(), 0.55);
};

// ---- Sonar Prime: the camp's own ping, made whole (the tone doesn't touch it). A clean sine that
// glides down onto its note (1.5 semitones over 60 ms), a light FM shimmer at twice the note that
// fades in about 80 ms, and a tiny high click on the attack, through a compressor, a 3.4 s room and
// a stereo ping-pong echo. A notification is a phrase that starts on the root (E4): the root is the
// full ping and rings on for about 2 s under the rest; later notes are lighter, quicker-gliding
// pings, quieter as the phrase climbs, by turns a little left and right, the last ringing about
// 1.1 s; their echoes land exactly on every second note. A single ping takes a longer, more open
// echo. A strum's line is one of the lighter pings, at its line's note.
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
export const PRIME_PHRASES: Record<ChimeKind, number[]> = {
  ask: [64], // E4
  done: [64, 68, 71, 76], // E4 G#4 B4 E5: a major chord up to the innermost line's note
  fail: [64, 66, 67], // E4 F#4 G: minor, and it doesn't resolve
};
const PRIME_STEP = 0.09; // seconds between a phrase's notes
type PrimeFx = { reverb: number; delay: number; time: number; fb: number };
const PRIME_OPEN: PrimeFx = { reverb: 0.3, delay: 0.38, time: 0.32, fb: 0.42 };
const PRIME_TIGHT: PrimeFx = { reverb: 0.32, delay: 0.22, time: 2 * PRIME_STEP, fb: 0.28 };
type Prime = { click: AudioBuffer; open: AudioNode; tight: AudioNode };
const primes = new WeakMap<BaseAudioContext, Prime>();
function primeRig(a: BaseAudioContext): Prime {
  const had = primes.get(a);
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
  const bus = (fx: PrimeFx): AudioNode => {
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
  const made: Prime = { click, open: bus(PRIME_OPEN), tight: bus(PRIME_TIGHT) };
  primes.set(a, made);
  return made;
}
// One ping: down onto `f` from `glide` semitones above over `glideTime`, with the shimmer.
function primeTone(a: BaseAudioContext, o: { f: number; t: number; peak: number; decay: number; glide: number; glideTime: number; pan: number; out: AudioNode }) {
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
function primeClick(a: BaseAudioContext, t: number, level: number, out: AudioNode) {
  const src = a.createBufferSource(), high = a.createBiquadFilter(), gain = a.createGain();
  src.buffer = primeRig(a).click;
  high.type = "highpass";
  high.frequency.value = 3000;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(level, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  src.connect(high).connect(gain).connect(out);
  src.start(t, Math.random(), 0.07);
}
// A notification's phrase of MIDI notes, from `t0`.
function primePhrase(a: BaseAudioContext, phrase: number[], t0: number) {
  const rig = primeRig(a), n = phrase.length, out = n === 1 ? rig.open : rig.tight;
  primeClick(a, t0, 0.05, out);
  phrase.forEach((m, i) => {
    const f = mtof(m), t = t0 + i * PRIME_STEP, last = i === n - 1;
    if (i === 0) return primeTone(a, { f, t, peak: 0.22, decay: 2, glide: 1.5, glideTime: 0.06, pan: 0, out });
    const fade = 1 - (0.35 * i) / Math.max(1, n - 1);
    primeTone(a, { f, t, peak: (last ? 0.13 : 0.11) * fade, decay: last ? 1.1 : 0.3, glide: 0.5, glideTime: 0.02, pan: i % 2 ? 0.2 : -0.2, out });
  });
}
const prime: Voice = (a, f, hard, side, t) => {
  const out = primeRig(a).tight;
  primeClick(a, t, 0.012 + 0.025 * hard, out);
  primeTone(a, { f, t, peak: 0.05 + 0.06 * hard, decay: 1.1, glide: 0.5 + hard, glideTime: 0.02 + 0.03 * hard, pan: side * 0.4, out });
};

const VOICES: Record<StrumVoice, Voice> = { prime, sonar, bell, wire, breath, console: consoleBlip, analog, choir };

// A notification's ping: the innermost line's note in the strum's voice, louder.
function ping(a: BaseAudioContext, f: number, hard: number, side: number, t: number, out: Out) {
  wear(a);
  (VOICES[strumVoice()] ?? prime)(a, f * OCT, hard, side, t, out);
}

const noteOf = (i: number) => STRUM_NOTES[Math.min(Math.max(i, 0), STRUM_NOTES.length - 1)];
// Where it sits: the nearest line in the middle, each further one out a little wider, by turns left and right.
const sideOf = (i: number) => (i % 2 ? -1 : 1) * Math.min(0.7, 0.12 * Math.max(i, 0));

// One line's note in `voice` and `tone` on audio context `a` at time `t`. Exported so a voice can be rendered offline.
export function sound(a: BaseAudioContext, voice: StrumVoice, i: number, strength: number, t: number, tone = toneNow()) {
  wear(a, voice === "prime" ? TONE_DEFAULT : tone); // Sonar Prime is made whole: the tone doesn't touch it
  (VOICES[voice] ?? prime)(a, noteOf(i) * OCT, Math.min(Math.max(strength, 0), 1), sideOf(i), t, "strum");
}

// Line `i` (0 is nearest the sun) at `strength` from 0 (a slow pass) to 1 (a quick sweep).
export function strum(i: number, strength = 0.5) {
  if (!strumOn()) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  sound(a, strumVoice(), i, strength, a.currentTime + 0.01);
}

// A sweep inwards across five lines in `voice`, to hear it in Settings. It plays even with the strum sound off.
export const DEMO_LINES = [4, 3, 2, 1, 0];
export function demoStrum(voice: StrumVoice) {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const t0 = a.currentTime + 0.02;
  DEMO_LINES.forEach((line, k) => sound(a, voice, line, 0.55, t0 + k * 0.13));
}
