// The notification chime: which notes play for what, and when it stays quiet.
import { beforeEach, expect, test, vi } from "vitest";

// jsdom has no Web Audio or Notification: small fakes that record what was played and shown.
let played: number[] = [];
let shown: { title: string; silent?: boolean }[] = [];
class FakeAudio {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  createOscillator() {
    const osc = { type: "", frequency: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (g: unknown) => g, start: () => played.push(osc.frequency.value), stop: () => {} };
    return osc;
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (d: unknown) => d };
  }
  sampleRate = 8000;
  createBiquadFilter() { return { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect: (d: unknown) => d }; }
  createWaveShaper() { return { curve: null, oversample: "", connect: (d: unknown) => d }; }
  createBufferSource() { return { buffer: null, connect: (d: unknown) => d, start: () => {} }; }
  createStereoPanner() { return { pan: { value: 0 }, connect: (d: unknown) => d }; }
  createConvolver() { return { buffer: null, connect: (d: unknown) => d }; }
  createBuffer(channels: number, length: number) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c: number) => data[c] }; }
  createDynamicsCompressor() { return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: (d: unknown) => d }; }
  createDelay() { return { delayTime: { value: 0 }, connect: (d: unknown) => d }; }
  createChannelMerger() { return { connect: (d: unknown) => d }; }
}
class FakeNotification {
  static permission = "granted";
  onclick: (() => void) | null = null;
  constructor(title: string, opts: { silent?: boolean }) { shown.push({ title, silent: opts.silent }); }
  close() {}
}
vi.stubGlobal("AudioContext", FakeAudio);
vi.stubGlobal("Notification", FakeNotification);

const { CHIME_NOTES, STRUM_NOTES, playChime, setChime, chimeOn, strum, setStrum, strumOn } = await import("./chime.ts");
const { notify } = await import("./notifications.ts");

// The tab is in the background, which is the only time a notification shows.
const background = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.spyOn(document, "hasFocus").mockReturnValue(!hidden);
};
const fundamentals = () => played.filter((_, i) => i % 2 === 1); // each ping first starts its shimmer, at twice the note

beforeEach(() => { localStorage.clear(); played = []; shown = []; background(true); });

test("a notification is a sonar phrase from E4: the ping alone for a decision, a major chord up to the innermost line's note for finished, minor steps for failed", () => {
  const near = (hz: number[]) => hz.map((f) => +f.toFixed(2));
  expect(near(CHIME_NOTES.ask)).toEqual([329.63]); // E4
  expect(near(CHIME_NOTES.done)).toEqual([329.63, 415.3, 493.88, 659.26]); // E4 G#4 B4 E5
  expect(CHIME_NOTES.done.at(-1)).toBeCloseTo(STRUM_NOTES[0], 1); // ending on the innermost line's note
  expect(near(CHIME_NOTES.fail)).toEqual([329.63, 369.99, 392]); // E4 F#4 G4
  for (const kind of ["ask", "done", "fail"] as const) {
    played = [];
    playChime(kind);
    expect(fundamentals(), kind).toEqual(CHIME_NOTES[kind]);
    expect(played.filter((_, i) => i % 2 === 0), kind).toEqual(CHIME_NOTES[kind].map((f) => f * 2)); // each ping's shimmer
  }
});

test("a notification plays its chime and asks the browser to keep its own sound quiet", () => {
  notify("Mae: expedition finished", "All done", "done");
  expect(shown).toEqual([{ title: "Mae: expedition finished", silent: true }]);
  expect(fundamentals()).toEqual(CHIME_NOTES.done);
});

test("a decision is the default chime", () => {
  notify("Mae: Decision needed", "Which way?");
  expect(fundamentals()).toEqual(CHIME_NOTES.ask);
});

test("with the sound off, the notification shows with the browser's own sound and no chime", () => {
  setChime(false);
  expect(chimeOn()).toBe(false);
  notify("Mae: expedition error", "It broke", "fail");
  expect(shown).toEqual([{ title: "Mae: expedition error", silent: false }]);
  expect(played).toEqual([]);
});

test("no chime when the tab is in front, or when notifications are switched off", () => {
  background(false);
  notify("Mae: Decision needed", "Which way?");
  background(true);
  localStorage.setItem("camp-notify", "off");
  notify("Mae: Decision needed", "Which way?");
  expect(shown).toEqual([]);
  expect(played).toEqual([]);
});

test("each orbit line strums its own note, the nearest highest, only once the strum sound is turned on", () => {
  expect(new Set(STRUM_NOTES).size).toBe(STRUM_NOTES.length);
  expect([...STRUM_NOTES].sort((x, y) => y - x)).toEqual(STRUM_NOTES);
  expect(strumOn()).toBe(false); // off unless you turn it on
  strum(0);
  expect(played).toEqual([]);
  setStrum(true);
  strum(0);
  strum(3, 1);
  expect(fundamentals()).toEqual([STRUM_NOTES[0], STRUM_NOTES[3]]);
  played = [];
  strum(99); // a line further out than there are notes takes the lowest
  expect(fundamentals()).toEqual([STRUM_NOTES.at(-1)]);
  played = [];
  setChime(false); // the notification sound has its own switch
  strum(1);
  expect(fundamentals()).toEqual([STRUM_NOTES[1]]);
  played = [];
  setStrum(false);
  strum(1);
  expect(played).toEqual([]);
});
