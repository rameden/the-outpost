// Orbit: the crew at work as a solar system, over the whole page. What it shows is what the crew
// is really doing; you can look closer at any of them, and go from there to where the work is.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { setCrewColors } from "../format.ts";
import type { CampEvent, CampState } from "../types.ts";
import { FLIGHT_MS, Orbit, PING_MS, RING_MS } from "./Orbit.tsx";
import { SUN_R, orbitOf } from "./scene.ts";

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
const characters = [
  { id: "quartermaster", name: "Quartermaster", emoji: "🧭", role: "Plans and dispatches", model: "claude-sonnet-5-5", effort: "high" },
  { id: "scout", name: "Scout", emoji: "🏹", role: "Finds things out", model: "claude-sonnet-5-5", effort: "medium" },
  { id: "scribe", name: "Scribe", emoji: "🪶", role: "Writes it up", model: "claude-haiku-5-5", effort: "low" },
  { id: "cook", name: "Cook", emoji: "🍳", role: "Feeds the camp", model: "claude-haiku-5-5", effort: "low", custom: true, color: "teal" },
];
const S = { xp: { Scout: 120 }, characters } as unknown as CampState;

const moving = (yes: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: !yes && q.includes("reduce") }));
beforeEach(() => { vi.useFakeTimers(); moving(true); setCrewColors(characters); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setCrewColors([]); });

// Events as they'd arrive right now (what crosses the sky is only drawn for what's happening now).
let seq = 0;
function send(store: ReturnType<typeof createFeedStore>, ...bodies: object[]) {
  act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); vi.advanceTimersByTime(20); });
}
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };
const scout = { who: "Scout", emoji: "🏹", depth: 1 };
const underWay = [
  { type: "expedition_start", id: "A", task: "Audit the login flow", source: "user", thread: "A" },
  { type: "dispatch", ...scout, questId: "q1", brief: "Read the session code", step: 1, expeditionId: "A" },
  { type: "tool", ...scout, tool: "read_file", input: "links/app/src/session.ts", questId: "q1", expeditionId: "A" },
];

function show(store = createFeedStore(), camp: CampState | null = S) {
  const on = { onClose: vi.fn(), onOpenAgent: vi.fn(), onOpenQuest: vi.fn(), onOpenConversation: vi.fn(), onDecision: vi.fn() };
  const r = render(<Orbit S={camp} store={store} {...on} />);
  const planet = (id: string) => r.container.querySelector<SVGGElement>(`.orb-planet[data-who="${id}"]`)!;
  const cell = (name: string) => within(screen.getByRole("navigation", { name: "The crew" })).getByRole("button", { name: new RegExp(`^${name}:`) });
  return { ...r, ...on, store, planet, cell, view: screen.getByRole("dialog", { name: "Orbit: the crew at work" }) };
}
const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const num = (el: Element | null, attr: string) => Number(el!.getAttribute(attr));
const flying = (el: Element) => el.querySelector(".orb-comet")!.getAttribute("data-flying");

test("the Quartermaster is the sun and everyone else has a planet on their own line, in their own colour", () => {
  const { container, planet, view } = show();
  expect(view.getAttribute("aria-modal")).toBe("true");
  expect(container.querySelectorAll(".orb-sun .orb-sun-core").length).toBe(1);
  expect([...container.querySelectorAll(".orb-planet")].map((p) => p.getAttribute("data-who"))).toEqual(["scout", "scribe", "cook"]);
  expect(planet("scout").classList.contains("c-scout")).toBe(true);
  expect(planet("cook").classList.contains("c-x-teal")).toBe(true);
  expect(planet("scout").querySelectorAll(".orb-mark").length).toBe(1); // the camp's own have their marks
  expect(planet("cook").querySelector(".orb-emoji")!.textContent).toBe("🍳"); // anyone else, their emoji
  // Each planet sits on its own contour line (the line starts exactly where the planet is), as on the blank page.
  [...container.querySelectorAll(".orb-planet")].forEach((p, i) => {
    expect(p.querySelector("path.orb-ring")!.getAttribute("d")!.startsWith(`M${orbitOf(i)}.0 0.0L`)).toBe(true);
    expect(p.querySelector(`g[transform="translate(${orbitOf(i)} 0)"]`)).toBeTruthy();
    expect(p.querySelectorAll("path.orb-tail").length).toBe(3);
  });
  // A line for each of four orbits and a fainter one beyond; the two nobody is on drift by themselves.
  expect(container.querySelectorAll("path.orb-ring").length).toBe(5);
  expect(container.querySelectorAll(".orb-drift").length).toBe(2);
  // The drawing is decoration: who is doing what is said in words, in the cells along the bottom.
  expect(container.querySelector("svg.orb-sky")!.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole("navigation", { name: "The crew" }).querySelectorAll("button").length).toBe(4);
});

test("nothing is acted out: with the camp quiet, everyone is at camp and no planet is lit", () => {
  const { container, cell } = show();
  expect(container.querySelectorAll(".orb-planet.active, .orb-planet.waiting, .orb-moon, [data-flying]").length).toBe(0);
  expect(cell("Scout").getAttribute("aria-label")).toBe("Scout: At camp");
  pass(60_000);
  expect(container.querySelectorAll(".orb-planet.active, .orb-moon, [data-flying]").length).toBe(0);
});

test("a quest sent is a comet from the sun to that planet, which then carries a moon and says what it's doing", () => {
  const { container, planet, cell, store } = show();
  send(store, ...underWay.slice(0, 2));
  expect(container.querySelector(".orb-sun")!.classList.contains("active")).toBe(true);
  expect(planet("scout").classList.contains("active")).toBe(true);
  expect(flying(planet("scout"))).toBe("out");
  expect(flying(planet("scribe"))).toBe(null);
  // Part of the way there, its head is somewhere between the sun and the planet, with three fainter dots behind it.
  pass(FLIGHT_MS / 2);
  const dots = [...planet("scout").querySelectorAll(".orb-comet circle")];
  expect(dots.length).toBe(4);
  expect(num(dots[0], "cx")).toBeGreaterThan(SUN_R + 20);
  expect(num(dots[0], "cx")).toBeLessThan(orbitOf(0) - 30);
  expect(num(dots[3], "cx")).toBeLessThan(num(dots[0], "cx"));
  expect(num(dots[0], "opacity")).toBe(1);
  expect(num(dots[3], "opacity")).toBeLessThan(num(dots[0], "opacity"));
  // It lands: the comet is gone, and the planet rings.
  pass(FLIGHT_MS / 2 + 250);
  expect(flying(planet("scout"))).toBe(null);
  expect(dots.every((d) => d.getAttribute("opacity") === "0")).toBe(true);
  expect(num(planet("scout").querySelector(".orb-land"), "opacity")).toBeGreaterThan(0);
  pass(RING_MS + 50);
  expect(planet("scout").querySelector(".orb-land")!.getAttribute("opacity")).toBe("0");
  // The moon stays for as long as the quest is out, going round the planet; nobody else has one.
  expect(planet("scout").querySelectorAll(".orb-moon").length).toBe(1);
  expect(planet("scribe").querySelectorAll(".orb-moon").length).toBe(0);
  const round = () => planet("scout").querySelector(".orb-moon")!.getAttribute("transform");
  const before = round();
  pass(500);
  expect(round()).toMatch(/^rotate\(/);
  expect(round()).not.toBe(before);
  // What it's doing is under its name and in its cell; a tool call is a small ring off the planet.
  send(store, underWay[2]);
  expect(cell("Scout").getAttribute("aria-label")).toBe("Scout: Using read_file");
  expect(container.querySelector(".orb-label.c-scout span")!.textContent).toBe("Using read_file");
  expect(num(planet("scout").querySelector(".orb-blip"), "opacity")).toBeGreaterThan(0);
  pass(RING_MS + 50);
  expect(planet("scout").querySelector(".orb-blip")!.getAttribute("opacity")).toBe("0");
  // A second quest is a second moon; one that needs you is marked.
  send(store, { type: "dispatch", ...scout, questId: "q2", brief: "Check the cookie flags", expeditionId: "A" },
    { type: "ask", id: "k2", kind: "shell", title: "Run a command", body: "curl -I localhost", questId: "q2", expeditionId: "A" });
  expect(planet("scout").querySelectorAll(".orb-moon").length).toBe(2);
  expect(planet("scout").querySelectorAll(".orb-moon.waiting").length).toBe(1);
  expect(planet("scout").classList.contains("waiting")).toBe(true);
  expect(within(screen.getByRole("dialog")).getByText("Waiting on you").nextElementSibling!.textContent).toBe("1");
});

test("a report is a comet home, and then the sun sends a ring out that lights each line as it passes", () => {
  const { container, planet, store } = show();
  const ping = () => container.querySelector(".orb-ping")!;
  send(store, ...underWay);
  pass(FLIGHT_MS + 1500);
  expect(ping().getAttribute("opacity")).toBe("0");
  send(store, { type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" });
  expect(flying(planet("scout"))).toBe("home");
  expect(planet("scout").querySelectorAll(".orb-moon").length).toBe(0);
  pass(FLIGHT_MS / 2);
  expect(ping().getAttribute("opacity")).toBe("0"); // not until the report has landed
  pass(FLIGHT_MS / 2 + 300);
  expect(flying(planet("scout"))).toBe(null);
  expect(num(ping(), "opacity")).toBeGreaterThan(0);
  expect(num(ping(), "r")).toBeGreaterThan(SUN_R);
  // Every line has its flash, and the ring reaches the nearest first: as it passes that one, the furthest is still dark.
  const lit = (i: number) => num(container.querySelectorAll(".orb-planet path.orb-lit, .orb-drift path.orb-lit")[i], "opacity");
  expect(container.querySelectorAll("path.orb-lit").length).toBe(5);
  pass(700);
  expect(num(planet("scout").querySelector("path.orb-lit"), "opacity")).toBeGreaterThan(0);
  expect(num(container.querySelector(".orb-drift path.orb-lit"), "opacity")).toBe(0);
  pass(PING_MS);
  expect(ping().getAttribute("opacity")).toBe("0");
  expect([0, 1, 2, 3, 4].every((i) => lit(i) === 0)).toBe(true);
});

test("what the feed replays on a reconnect isn't flown across the sky again", () => {
  const { container, planet, store } = show();
  act(() => {
    underWay.forEach((b, i) => store.apply({ ...b, seq: 9000 + i, time: new Date(Date.now() - 60_000).toISOString() } as CampEvent));
    vi.advanceTimersByTime(20);
  });
  expect(planet("scout").classList.contains("active")).toBe(true); // it is out, and shown so
  pass(100);
  expect(container.querySelectorAll("[data-flying]").length).toBe(0);
  expect(planet("scout").querySelector(".orb-blip")!.getAttribute("opacity")).toBe("0");
});

test("looking at one of them opens what they're doing: each quest, its last steps, and the way to it", () => {
  const { container, cell, store, onOpenQuest, onOpenAgent } = show();
  send(store, ...underWay, { type: "text_delta", ...scout, delta: "The session is kept in a cookie", questId: "q1", expeditionId: "A" });
  expect(screen.queryByRole("complementary")).toBe(null);
  fireEvent.click(cell("Scout"));
  expect(cell("Scout").getAttribute("aria-pressed")).toBe("true");
  const panel = within(screen.getByRole("complementary", { name: "What Scout is doing" }));
  expect(panel.getByRole("heading", { name: "Scout" })).toBeTruthy();
  expect(panel.getByText("Finds things out")).toBeTruthy();
  expect(panel.getByText("sonnet-5-5 · medium")).toBeTruthy();
  expect(panel.getByText("Out on a quest")).toBeTruthy();
  expect(panel.getByText("Read the session code")).toBeTruthy();
  expect(panel.getByTitle("Step 1 of the plan").textContent).toBe("1");
  expect(panel.getByText("read_file links/app/src/session.ts")).toBeTruthy();
  expect(panel.getByText("The session is kept in a cookie").querySelector(".orb-caret")).toBeTruthy(); // still arriving
  expect(container.querySelector(".orb-planet.focused")!.getAttribute("data-who")).toBe("scout");
  // More words arrive, and are there.
  send(store, { type: "text_delta", ...scout, delta: ", signed.", questId: "q1", expeditionId: "A" });
  expect(panel.getByText("The session is kept in a cookie, signed.")).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: "Go to it in the conversation" }));
  expect(onOpenQuest).toHaveBeenCalledWith(expect.objectContaining({ expId: "A", id: "q1", who: "Scout" }));
  fireEvent.click(panel.getByRole("button", { name: "Open Scout's page" }));
  expect(onOpenAgent).toHaveBeenCalledWith("scout");
});

test("the sun's panel is the Quartermaster's: the expeditions under way; and someone at camp says so", () => {
  const { cell, store, onOpenConversation } = show();
  send(store, ...underWay);
  fireEvent.click(cell("Quartermaster"));
  const sun = within(screen.getByRole("complementary", { name: "What Quartermaster is doing" }));
  expect(sun.getByText("An expedition under way")).toBeTruthy();
  expect(sun.getByText("Audit the login flow")).toBeTruthy();
  expect(sun.getByText("The sun")).toBeTruthy();
  fireEvent.click(sun.getByRole("button", { name: "Open the conversation" }));
  expect(onOpenConversation).toHaveBeenCalledWith("A");
  // Going from one to the next swaps the panel.
  fireEvent.click(cell("Scribe"));
  const scribe = within(screen.getByRole("complementary", { name: "What Scribe is doing" }));
  expect(scribe.getByText(/^At camp, with nothing out\./)).toBeTruthy();
  expect(scribe.queryByRole("button", { name: /Go to it/ })).toBe(null);
});

test("from the keyboard: a number looks at that one, Esc steps back out to the whole system, and again leaves", () => {
  const { view, cell, onClose } = show();
  expect(document.activeElement).toBe(view); // the keyboard is in it from the start
  fireEvent.keyDown(view, { key: "2" });
  expect(cell("Scout").getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(view, { key: "ArrowRight" });
  expect(cell("Scribe").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("complementary", { name: "What Scribe is doing" })).toBeTruthy();
  fireEvent.keyDown(view, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBe(null);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(view, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  // A shortcut of the page's own (the command palette, say) is left alone.
  expect(fireEvent.keyDown(view, { key: "0", ctrlKey: true })).toBe(true);
});

test("zooming: the buttons and the keys go in and out, within limits, and the whole system comes back with one press", () => {
  const { view } = show();
  const zoom = () => within(view).getByText("Zoom").nextElementSibling!.textContent;
  const settle = () => act(() => { vi.advanceTimersByTime(4000); });
  settle();
  expect(zoom()).toBe("×1.0");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  settle();
  expect(zoom()).toBe("×1.4");
  fireEvent.keyDown(view, { key: "+" });
  settle();
  expect(zoom()).toBe("×2.0");
  for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  settle();
  expect(zoom()).toBe("×0.5");
  fireEvent.click(screen.getByRole("button", { name: "Show the whole system" }));
  settle();
  expect(zoom()).toBe("×1.0");
});

test("a decision waiting on you is said along the top, and goes to it", () => {
  const { store, onDecision } = show();
  expect(screen.queryByRole("button", { name: /needs you/ })).toBe(null);
  send(store, { type: "expedition_start", id: "A", task: "Audit", source: "user" }, { type: "ask", id: "k1", kind: "plan", title: "Approve the plan", body: "1. Look", expeditionId: "A" });
  fireEvent.click(screen.getByRole("button", { name: "1 decision needs you" }));
  expect(onDecision).toHaveBeenCalledTimes(1);
});

test("before the camp has answered there is just the sun and its empty lines, and the way out", () => {
  const { container, onClose } = show(createFeedStore(), null);
  expect(container.querySelectorAll(".orb-planet").length).toBe(0);
  expect(container.querySelectorAll(".orb-drift").length).toBe(5);
  fireEvent.click(screen.getByRole("button", { name: "Leave Orbit" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("for less motion nothing is sent across the sky, and the stylesheet stops the rest; what each is doing is still said", () => {
  moving(false);
  const { container, planet, cell, store } = show();
  send(store, ...underWay);
  const still = planet("scout").querySelector("g[transform^='rotate']")!.getAttribute("transform");
  pass(30_000);
  expect(container.querySelectorAll("[data-flying]").length).toBe(0);
  expect(container.querySelector(".orb-ping")!.getAttribute("opacity")).toBe("0"); // (with the camp quiet too: no ring now and then)
  expect(planet("scout").querySelector("g[transform^='rotate']")!.getAttribute("transform")).toBe(still); // the planets rest where they start
  expect(planet("scout").classList.contains("active")).toBe(true);
  expect(cell("Scout").getAttribute("aria-label")).toBe("Scout: Using read_file");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.orbit, \.orbit \* \{ animation: none !important; \}/);
});

test("it sits over the page and under what opens over the page, and never bends a coloured edge round a corner", () => {
  const z = (rule: string) => Number(css.match(new RegExp(`${rule} \\{[^}]*z-index: (\\d+)`))![1]);
  expect(Number(css.match(/\.orbit \{[\s\S]*?z-index: (\d+)/)![1])).toBeLessThan(z("\\.drawer-backdrop"));
  expect(Number(css.match(/\.orbit \{[\s\S]*?z-index: (\d+)/)![1])).toBeGreaterThan(40); // (a narrow screen's panels)
  const own = css.slice(css.indexOf("/* ---------- Orbit:"), css.indexOf("/* ---------- Barnstorm"));
  expect(own).not.toMatch(/border-radius: (?!0\b)/);
  expect(own).not.toMatch(/box-shadow/);
  // The sign-in page's orb has parts by these names, styled wherever they appear: nothing here shares one.
  expect(own).not.toMatch(/\.orb-(glow|ripple|dial|core|light)\b/);
});

test("everything in the sky moves off the one clock: the planets go round, and the stylesheet animates nothing inside the drawing", () => {
  const { container, planet } = show();
  const turned = () => planet("scout").querySelector("g[transform^='rotate']")!.getAttribute("transform");
  const before = turned(), dial = container.querySelector(".orb-sun-dial")!.getAttribute("transform");
  pass(1000);
  expect(turned()).not.toBe(before);
  expect(container.querySelector(".orb-sun-dial")!.getAttribute("transform")).not.toBe(dial);
  // (An animation of the stylesheet's runs a frame apart from what's moved from here, and shakes against it once the camera follows a planet.)
  const own = css.slice(css.indexOf("/* ---------- Orbit:"), css.indexOf("/* ---------- Barnstorm"));
  const inSky = own.split("\n").filter((l) => /^\.orb-(sky|grid|rim|ticks|ring|drift|tone|tail|g\d|corona|sun|ping|lit|halo|disc|planet|mark|emoji|busy|moon|comet|land|blip)\b/.test(l));
  expect(inSky.length).toBeGreaterThan(15);
  for (const rule of inSky) expect(rule).not.toMatch(/animation|transition/);
});
