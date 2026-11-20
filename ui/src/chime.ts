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
