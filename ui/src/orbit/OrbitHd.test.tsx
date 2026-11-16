// Orbit's HD view, as far as the page goes: turning it on and off, what it hands the drawing each
// frame, and staying flat where the browser can't draw it. (The drawing itself needs a graphics
// card; here it's stood in for by something that keeps what it was handed.)
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent, CampState } from "../types.ts";
import type { HdFrame } from "./hd/renderer.ts";

const drawn: HdFrame[] = [];
const fake = { resize: vi.fn(), setLines: vi.fn(), dispose: vi.fn(), draw: vi.fn((f: HdFrame) => { drawn.push(f); }) };
const createHd = vi.fn<() => typeof fake | null>(() => fake);
vi.mock("./hd/renderer.ts", () => ({ createHd: () => createHd() }));
const { Orbit } = await import("./Orbit.tsx");

const characters = [
  { id: "quartermaster", name: "Quartermaster", emoji: "🧭", role: "Plans and dispatches", model: "claude-sonnet-5-5", effort: "high" },
  { id: "scout", name: "Scout", emoji: "🏹", role: "Finds things out", model: "claude-sonnet-5-5", effort: "medium" },
  { id: "scribe", name: "Scribe", emoji: "🪶", role: "Writes it up", model: "claude-haiku-5-5", effort: "low" },
];
const S = { xp: {}, characters } as unknown as CampState;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); drawn.length = 0; vi.clearAllMocks(); createHd.mockImplementation(() => fake);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
let seq = 0;
function show(store = createFeedStore()) {
  const r = render(<Orbit S={S} store={store} onClose={() => {}} />);
  const send = (...bodies: object[]) => act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); vi.advanceTimersByTime(40); });
  return { ...r, send, view: screen.getByRole("dialog") };
}
const scout = { who: "Scout", emoji: "🏹", depth: 1 };

test("HD is off until you turn it on; on, the sky is drawn on a canvas, and your choice is remembered", () => {
  const { container, view } = show();
  expect(container.querySelector("canvas")).toBe(null);
  expect(createHd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "HD", pressed: false }));
  expect(container.querySelector("canvas.orb-hd")!.getAttribute("aria-hidden")).toBe("true");
  expect(view.classList.contains("hd")).toBe(true);
  expect(localStorage.getItem("camp-orbit-hd")).toBe("1");
  expect(fake.setLines).toHaveBeenCalledTimes(1);
  expect(fake.setLines.mock.calls[0][0].length).toBe(5); // the four lines and the fainter one beyond, as points
  pass(100);
  expect(drawn.length).toBeGreaterThan(2); // a frame at a time
  // H turns it off again: the drawing is put away, and the flat one is back.
  fireEvent.keyDown(view, { key: "h" });
  expect(container.querySelector("canvas")).toBe(null);
  expect(fake.dispose).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("camp-orbit-hd")).toBe("0");
  // Opened again later, it comes up as you left it.
  localStorage.setItem("camp-orbit-hd", "1");
  cleanup();
  expect(show().container.querySelector("canvas.orb-hd")).toBeTruthy();
});

test("it opens looking straight down, which is the flat view, and tips over into depth", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "HD" }));
  pass(20);
  const up = (f: HdFrame) => -f.cam.fwd[1]; // how nearly straight down it's looking (1: straight down)
  expect(up(drawn[0])).toBeGreaterThan(0.98);
  pass(6000);
  expect(up(drawn.at(-1)!)).toBeLessThan(0.7);
  expect(up(drawn.at(-1)!)).toBeGreaterThan(0.4); // settled, looking down from a little above
});

test("each frame is the camp as it is: who's at work, their moons, and what's crossing the sky", () => {
  const { send } = show();
  fireEvent.click(screen.getByRole("button", { name: "HD" }));
  pass(100);
  let f = drawn.at(-1)!;
  expect(f.planets.length).toBe(2);
  expect(f.lines.length).toBe(5);
  const questMoons = (p: HdFrame["planets"][number]) => p.moons.filter((m) => !m.own).length; // (a world's own moons are always there)
  expect(f.planets.every((p) => p.active === 0 && questMoons(p) === 0)).toBe(true);
  expect(f.planets.every((p) => p.kind === 0)).toBe(true); // each a world you could live on
  expect(f.points).toEqual([]);
  send({ type: "expedition_start", id: "A", task: "Audit", source: "user" }, { type: "dispatch", ...scout, questId: "q1", brief: "Look", expeditionId: "A" });
  pass(400);
  f = drawn.at(-1)!;
  expect(f.points.length).toBeGreaterThan(5);       // the comet, on its way
  expect(questMoons(f.planets[0])).toBe(1);
  expect(questMoons(f.planets[1])).toBe(0);
  pass(3000);
  f = drawn.at(-1)!;
  expect(f.planets[0].active).toBeGreaterThan(0.9);  // lit up by now (it comes up over a moment, not at once)
  expect(f.planets[1].active).toBe(0);
  expect(f.sun.active).toBeGreaterThan(0.9);
  send({ type: "tool", ...scout, tool: "read_file", input: "a.ts", questId: "q1", expeditionId: "A" });
  expect(drawn.at(-1)!.planets[0].blip).toBeGreaterThanOrEqual(0); // a tool call flashes across it
});

test("the names, the panel and the keys work as they do flat: a planet is found where the drawing puts it", () => {
  const { container, view } = show();
  fireEvent.click(screen.getByRole("button", { name: "HD" }));
  pass(3000);
  // Its name on the page is somewhere on the screen (jsdom has no size, so the screen is the window's).
  expect(container.querySelector<HTMLElement>(".orb-label.c-scout")!.style.transform).toMatch(/^translate\(-?\d/);
  fireEvent.keyDown(view, { key: "2" });
  expect(within(view).getByRole("complementary", { name: "What Scout is doing" })).toBeTruthy();
  pass(4000);
  // The camera is with the Scout now: low down, close in, looking at where the planet is.
  const f = drawn.at(-1)!, p = f.planets[0];
  const toPlanet = [p.pos[0] - f.cam.eye[0], p.pos[1] - f.cam.eye[1], p.pos[2] - f.cam.eye[2]], far = Math.hypot(...toPlanet);
  expect(far).toBeLessThan(400);
  expect((toPlanet[0] * f.cam.fwd[0] + toPlanet[1] * f.cam.fwd[1] + toPlanet[2] * f.cam.fwd[2]) / far).toBeGreaterThan(0.995);
  expect(-f.cam.fwd[1]).toBeLessThan(0.4);
  expect(container.querySelector("p.orb-hint")!.textContent).toContain("drag to turn");
});

test("a browser that can't draw it stays flat, and the button says why", () => {
  createHd.mockImplementation(() => null);
  const { container, view } = show();
  fireEvent.click(screen.getByRole("button", { name: "HD" }));
  expect(container.querySelector("canvas")).toBe(null);
  expect(view.classList.contains("hd")).toBe(false);
  const button = screen.getByRole("button", { name: "HD" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.title).toContain("WebGL 2");
  expect(container.querySelectorAll(".orb-planet").length).toBe(2); // the flat drawing is all still there
  fireEvent.keyDown(view, { key: "h" }); // and H doesn't keep trying
  expect(createHd).toHaveBeenCalledTimes(1);
});

test("Reroll makes up other worlds for the crew, remembers them, and Shift+R goes back to the camp's own", () => {
  const { view } = show();
  expect(screen.queryByRole("button", { name: "Reroll" })).toBe(null); // there's nothing to reroll in the flat view
  fireEvent.click(screen.getByRole("button", { name: "HD" }));
  pass(100);
  const looks = () => drawn.at(-1)!.planets.map((p) => [p.kind, p.seed, p.radius, p.tilt, p.scale, ...p.p].join());
  const own = looks();
  expect(drawn.at(-1)!.planets.every((p) => p.scale === 1 && p.air === 1)).toBe(true); // the camp's own, to begin with
  expect(localStorage.getItem("camp-orbit-worlds")).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "Reroll" }));
  pass(100);
  const rolled = looks();
  expect(rolled).not.toEqual(own);
  expect(Number(localStorage.getItem("camp-orbit-worlds"))).toBeGreaterThan(0);
  // R rolls again; nothing about who's who changes (their colours are theirs).
  const colours = drawn.at(-1)!.planets.map((p) => p.color.join());
  fireEvent.keyDown(view, { key: "r" });
  pass(100);
  expect(looks()).not.toEqual(rolled);
  expect(drawn.at(-1)!.planets.map((p) => p.color.join())).toEqual(colours);
  // Opened again, the worlds are the ones you left.
  const kept = looks();
  cleanup();
  show();
  pass(100);
  expect(looks()).toEqual(kept);
  // Shift+R: the camp's own again.
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "R", shiftKey: true });
  pass(100);
  expect(looks()).toEqual(own);
  expect(localStorage.getItem("camp-orbit-worlds")).toBe("0");
});
