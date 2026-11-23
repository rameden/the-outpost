// Decorations on the page: nothing when off, nothing that moves for anyone who asked for less
// motion, and when it does run, one canvas that takes no clicks, few shapes, and a rest while the
// tab is hidden.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RUN_DONE } from "../bus.ts";
import { Decor, MAX_PARTICLES, startFall } from "./Decor.tsx";

// A canvas that counts what's drawn on it (jsdom has none of its own).
const drawn = { arc: 0, fill: 0, fillRect: 0 };
const ctx = {
  setTransform() {}, clearRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {}, rotate() {},
  arc() { drawn.arc++; }, fill() { drawn.fill++; }, fillRect() { drawn.fillRect++; },
  globalAlpha: 1, fillStyle: "",
};
let frames: FrameRequestCallback[] = [];
let raf: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let hidden = false;
const motion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce") }));
// Run the frame that's waiting, as if `ms` had passed since the page opened.
const frame = (ms: number) => { const next = frames; frames = []; next.forEach((f) => f(ms)); };

beforeEach(() => {
  drawn.arc = drawn.fill = drawn.fillRect = 0;
  frames = []; hidden = false;
  raf = vi.fn((f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  cancel = vi.fn(() => { frames = []; });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.body.innerHTML = '<header class="top"><button>Mae</button></header>';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

test("off, or a decoration nobody knows: nothing is on the page and nothing runs", () => {
  motion(false);
  const off = render(<Decor season={null} />);
  const unknown = render(<Decor season="easter" />);
  expect(off.container.innerHTML + unknown.container.innerHTML).toBe("");
  expect(document.querySelector("canvas, .decor-lights")).toBeNull();
  expect(raf).not.toHaveBeenCalled();
});

test("with less motion asked for, nothing falls and no animation starts; the lights hang still", () => {
  motion(true);
  render(<Decor season="winter" />);
  expect(document.querySelector("canvas")).toBeNull();
  expect(raf).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  expect(document.querySelector("header.top > .decor-lights")).not.toBeNull(); // (their twinkle is CSS, off under the same setting)
});

test("a page that can't say whether motion is wanted counts as less motion", () => {
  render(<Decor season="halloween" />); // no matchMedia here at all
  expect(document.querySelector("canvas")).toBeNull();
  expect(raf).not.toHaveBeenCalled();
});

test("Winter: one canvas over the window that screen readers and clicks skip, and lights hung from the top bar", () => {
  motion(false);
  const { unmount } = render(<Decor season="winter" />);
  const all = document.querySelectorAll("canvas");
  expect(all).toHaveLength(1);
  expect([all[0].className, all[0].getAttribute("aria-hidden"), all[0].dataset.effect]).toEqual(["decor-fall", "true", "snow"]);
  expect(raf).toHaveBeenCalledTimes(1);
  // The lights are inside the top bar, hidden from screen readers, in the crew's six colours.
  const lights = document.querySelector("header.top > .decor-lights")!;
  expect(lights.getAttribute("aria-hidden")).toBe("true");
  expect(lights.querySelectorAll(".decor-wire")).toHaveLength(1);
  expect(new Set(Array.from(lights.querySelectorAll(".decor-bulb")).map((b) => b.getAttribute("class"))).size).toBe(6);
  expect(document.querySelector("header.top button")?.textContent).toBe("Mae"); // the bar's own things are untouched
  // Turned off: it stops and leaves nothing behind.
  unmount();
  expect(cancel).toHaveBeenCalled();
  expect(document.querySelector("canvas, .decor-lights")).toBeNull();
});

test("snow is plain circles, never more than the cap, drawn at most about thirty times a second", () => {
  motion(false);
  vi.stubGlobal("innerWidth", 6000); // a very wide window still gets no more than the cap
  const stop = startFall(document.createElement("canvas"), "snow");
  frame(10); // too soon after the start: nothing is drawn
  expect(drawn.arc).toBe(0);
  frame(40);
  expect(drawn.arc).toBe(MAX_PARTICLES);
  frame(50); // a 100 Hz screen's next frame: skipped
  expect(drawn.arc).toBe(MAX_PARTICLES);
  frame(80);
  expect(drawn.arc).toBe(MAX_PARTICLES * 2);
  expect(MAX_PARTICLES).toBeLessThanOrEqual(60);
  stop();
  frame(120);
  expect(drawn.arc).toBe(MAX_PARTICLES * 2);
  expect(frames).toHaveLength(0);
});

test("it rests while the tab is hidden and picks up again when you come back", () => {
  motion(false);
  hidden = true;
  const stop = startFall(document.createElement("canvas"), "bats");
  expect(raf).not.toHaveBeenCalled();
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(raf).toHaveBeenCalledTimes(1);
  frame(40);
  expect(drawn.fill).toBeGreaterThan(0); // a few flat bats
  expect(drawn.fill).toBeLessThanOrEqual(8);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(cancel).toHaveBeenCalled();
  expect(frames).toHaveLength(0);
  stop();
});

test("New Year's confetti waits for an expedition to finish, bursts once, and stops when it has fallen", () => {
  motion(false);
  render(<Decor season="newyear" />);
  expect(raf).not.toHaveBeenCalled(); // nothing falls until then
  act(() => { window.dispatchEvent(new Event(RUN_DONE)); });
  expect(raf).toHaveBeenCalledTimes(1);
  frame(40);
  expect(drawn.fillRect).toBeGreaterThan(0);
  expect(drawn.fillRect).toBeLessThanOrEqual(MAX_PARTICLES);
  // Long enough for every piece to fall past the bottom: then no frame is left waiting.
  for (let t = 80; t < 60_000 && frames.length; t += 40) frame(t);
  expect(frames).toHaveLength(0);
});
