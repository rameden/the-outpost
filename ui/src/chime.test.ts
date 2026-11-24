// The notification chime: which notes play for what, and when it stays quiet.
import { beforeEach, expect, test, vi } from "vitest";

// jsdom has no Web Audio or Notification: small fakes that record what was played and shown.
let played: number[] = [];
let recordings = 0; // sounds played from a buffer worked out in code (the wire's pluck, noise)
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
  createBiquadFilter() { return { type: "", frequency: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, Q: { value: 0 }, connect: (d: unknown) => d }; }
  createWaveShaper() { return { curve: null, oversample: "", connect: (d: unknown) => d }; }
  createBufferSource() { return { buffer: null, connect: (d: unknown) => d, start: () => { recordings++; } }; }
  createStereoPanner() { return { pan: { value: 0 }, connect: (d: unknown) => d }; }
  createConvolver() { return { buffer: null, connect: (d: unknown) => d }; }
  createBuffer(channels: number, length: number) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c: number) => data[c] }; }
}
class FakeNotification {
  static permission = "granted";
  onclick: (() => void) | null = null;
  constructor(title: string, opts: { silent?: boolean }) { shown.push({ title, silent: opts.silent }); }
  close() {}
}
vi.stubGlobal("AudioContext", FakeAudio);
vi.stubGlobal("Notification", FakeNotification);

const { CHIME_NOTES, STRUM_NOTES, STRUM_VOICES, DEMO_LINES, playChime, setChime, chimeOn, strum, setStrum, strumOn, strumVoice, setStrumVoice, demoStrum } = await import("./chime.ts");
const { notify } = await import("./notifications.ts");

// The tab is in the background, which is the only time a notification shows.
const background = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.spyOn(document, "hasFocus").mockReturnValue(!hidden);
};
const fundamentals = () => played.filter((_, i) => i % 2 === 0); // each ping also starts the tone that gives it its metal

beforeEach(() => { localStorage.clear(); played = []; recordings = 0; shown = []; background(true); });

test("a notification is the innermost line's ping (the sonar until you pick another voice): alone for a decision, rising to it for finished, falling from it for failed", () => {
  expect(CHIME_NOTES.ask).toEqual([STRUM_NOTES[0]]);
  const [d1, d2] = CHIME_NOTES.done;
  const [f1, f2] = CHIME_NOTES.fail;
  expect(d2).toBe(STRUM_NOTES[0]);
  expect(d1).toBeLessThan(d2);
  expect(f1).toBe(STRUM_NOTES[0]);
  expect(f2).toBeLessThan(f1);
  playChime("done");
  expect(fundamentals()).toEqual(CHIME_NOTES.done);
  expect(played.filter((_, i) => i % 2 === 1)).toEqual(CHIME_NOTES.done.map((f) => f * 1.4)); // each ping's metal
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
  expect(played.filter((f) => STRUM_NOTES.includes(f))).toEqual([STRUM_NOTES[0], STRUM_NOTES[3]]);
  played = [];
  strum(99); // a line further out than there are notes takes the lowest
  expect(played[0]).toBe(STRUM_NOTES.at(-1));
  played = [];
  setChime(false); // the notification sound has its own switch
  strum(1);
  expect(played[0]).toBe(STRUM_NOTES[1]);
  played = [];
  setStrum(false);
  strum(1);
  expect(played).toEqual([]);
});

test("the strum has a few voices to pick from, the sonar until you pick, kept in this browser", () => {
  expect(STRUM_VOICES.map((v) => v.id)).toEqual(["sonar", "bell", "wire", "breath", "console", "analog"]);
  expect(strumVoice()).toBe("sonar");
  setStrumVoice("wire");
  expect(localStorage.getItem("camp-strum-voice")).toBe("wire");
  expect(strumVoice()).toBe("wire");
  localStorage.setItem("camp-strum-voice", "kazoo"); // one that's gone takes the sonar
  expect(strumVoice()).toBe("sonar");
});

test("every voice plays its line's note, and the wire is worked out in code and played back", () => {
  setStrum(true);
  for (const v of STRUM_VOICES) {
    setStrumVoice(v.id);
    played = []; recordings = 0;
    strum(2, 0.7);
    if (v.id === "wire") expect(recordings).toBe(1);
    else expect(played, v.id).toContain(STRUM_NOTES[2]);
  }
});

test("a notification is in the strum's voice, whether or not the strum sound is on", () => {
  expect(strumOn()).toBe(false);
  setStrumVoice("bell");
  playChime("done");
  expect(played.filter((f) => STRUM_NOTES.includes(f))).toEqual(CHIME_NOTES.done); // each note's bar, its overtones besides
  expect(played).not.toContain(CHIME_NOTES.done[0] * 1.4); // and no sonar metal
});

test("a voice's demo sweeps in across a few lines, even with the strum sound off", () => {
  expect(strumOn()).toBe(false);
  demoStrum("bell");
  expect(played.filter((f) => STRUM_NOTES.includes(f))).toEqual(DEMO_LINES.map((i) => STRUM_NOTES[i]));
  expect([...DEMO_LINES].sort((x, y) => y - x)).toEqual(DEMO_LINES); // outer line first, rising inwards
});
