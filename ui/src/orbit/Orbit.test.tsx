// Orbit: the crew at work as a solar system, over the whole page. What it shows is what the crew
// is really doing; you can look closer at any of them, and go from there to where the work is.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Opener, expectTabWraps } from "../components/modalkit.tsx";
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
  const on = { onClose: vi.fn(), onOpenAgent: vi.fn(), onOpenQuest: vi.fn(), onOpenConversation: vi.fn() };
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
  expect(container.querySelectorAll(".orb-planet.st-active, .orb-planet.st-waiting, .orb-moon, [data-flying]").length).toBe(0);
  expect(cell("Scout").getAttribute("aria-label")).toBe("Scout: At camp");
  pass(60_000);
  expect(container.querySelectorAll(".orb-planet.st-active, .orb-moon, [data-flying]").length).toBe(0);
});

test("a quest sent is a comet from the sun to that planet, which then carries a moon and says what it's doing", () => {
  const { container, planet, cell, store } = show();
  send(store, ...underWay.slice(0, 2));
  expect(container.querySelector(".orb-sun")!.classList.contains("st-active")).toBe(true);
  expect(planet("scout").classList.contains("st-active")).toBe(true);
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
  expect(planet("scout").querySelectorAll(".orb-moon.st-waiting").length).toBe(1);
  expect(planet("scout").classList.contains("st-waiting")).toBe(true);
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
  expect(planet("scout").classList.contains("st-active")).toBe(true); // it is out, and shown so
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

test("a decision waiting on you is said along the top, and is answered where you are", () => {
  const { store } = show();
  expect(screen.queryByRole("button", { name: /needs you/ })).toBe(null);
  send(store, { type: "expedition_start", id: "A", task: "Audit", source: "user" }, { type: "ask", id: "k1", kind: "plan", title: "Approve the plan", body: "1. Look", expeditionId: "A" });
  fireEvent.click(screen.getByRole("button", { name: "1 decision needs you" }));
  // It looks at whoever asked (the Quartermaster, for a plan), and the decision is there in its panel.
  const panel = within(screen.getByRole("complementary", { name: "What Quartermaster is doing" }));
  expect(panel.getByText(/Approve the plan/)).toBeTruthy();
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
  expect(planet("scout").classList.contains("st-active")).toBe(true);
  expect(cell("Scout").getAttribute("aria-label")).toBe("Scout: Using read_file");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.orbit, \.orbit \* \{ animation: none !important; \}/);
});

test("the demo is a pretend camp at work: it says so, your own crew plays it, and none of it reaches the real feed", () => {
  // A minute and more passes here, and the demo is played on timers, not frames: stand in for those only, as the
  // quiet-quest test does, or the frames drawn on the way take a slow machine past the time limit.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  const { container, planet, cell, store, onOpenQuest } = show();
  expect(screen.queryByRole("status")).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "Demo", pressed: false }));
  expect(screen.getByRole("status").textContent).toBe("Demo: a pretend camp. None of this is really happening.");
  expect(screen.getByRole("button", { name: "Demo", pressed: true })).toBeTruthy();
  // A few seconds in, the Quartermaster has planned and the Scout is out, alone: the rest wait for the report.
  pass(6000);
  expect(container.querySelector(".orb-sun")!.classList.contains("st-active")).toBe(true);
  expect(planet("scout").classList.contains("st-active")).toBe(true);
  expect(planet("scout").querySelectorAll(".orb-moon").length).toBe(1);
  expect(container.querySelectorAll(".orb-planet.st-active").length).toBe(1);
  expect(container.querySelectorAll(".orb-moon").length).toBe(1);
  // Their panel shows the pretend work, but offers no way to it: there's nowhere to go.
  fireEvent.click(cell("Scout"));
  const panel = within(screen.getByRole("complementary", { name: "What Scout is doing" }));
  expect(panel.getByText("Read the session code and say where the cookie is set")).toBeTruthy();
  expect(panel.queryByRole("button", { name: /Go to it|Open Scout's page/ })).toBe(null);
  expect(onOpenQuest).not.toHaveBeenCalled();
  // The real feed has had none of it.
  expect(store.getState().items).toEqual([]);
  expect(store.getState().crew).toEqual({});
  // Once the Scout has reported, the next stage goes: three quests at once, on the Cook you added (who stands in for those parts).
  pass(30_000);
  expect(planet("scout").querySelectorAll(".orb-moon").length).toBe(0);
  expect(planet("cook").querySelectorAll(".orb-moon").length).toBe(3);
  // Ending the demo shows the real camp again, which is quiet, and nothing is left crossing the sky.
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "d" });
  expect(screen.queryByRole("status")).toBe(null);
  expect(container.querySelectorAll(".orb-planet.st-active, .orb-moon, [data-flying]").length).toBe(0);
  expect(cell("Scout").getAttribute("aria-label")).toBe("Scout: At camp");
  pass(30_000);
  expect(container.querySelectorAll(".orb-planet.st-active, .orb-moon").length).toBe(0); // and the demo has stopped playing
});

test("opened on the demo with no crew to play it, the camp's own do", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] }); // (36 seconds pass: timers only, as above)
  const on = { onClose: vi.fn() };
  const { container } = render(<Orbit S={null} store={createFeedStore()} demo {...on} />);
  expect(screen.getByRole("status").textContent).toMatch(/^Demo:/);
  expect([...container.querySelectorAll(".orb-planet")].map((p) => p.getAttribute("data-who"))).toEqual(["scout", "artificer", "scribe", "warden", "wizard"]);
  pass(36_000); // the Scout has been and gone: the Artificer has two out, and the Test Pilot one
  expect(container.querySelector('.orb-planet[data-who="artificer"]')!.querySelectorAll(".orb-moon").length).toBe(2);
  expect(container.querySelector('.orb-planet[data-who="wizard"]')!.querySelectorAll(".orb-moon").length).toBe(1);
  expect(container.querySelectorAll(".orb-moon").length).toBe(3);
  expect(within(screen.getByRole("navigation", { name: "The crew" })).getByRole("button", { name: /^Quartermaster:/ })).toBeTruthy();
});

test("it sits over the page and under what opens over the page, and never bends a coloured edge round a corner", () => {
  const z = (rule: string) => Number(css.match(new RegExp(`${rule} \\{[^}]*z-index: (\\d+)`))![1]);
  expect(Number(css.match(/\.orbit \{[\s\S]*?z-index: (\d+)/)![1])).toBeLessThan(z("\\.drawer-backdrop"));
  expect(Number(css.match(/\.orbit \{[\s\S]*?z-index: (\d+)/)![1])).toBeGreaterThan(40); // (a narrow screen's panels)
  const own = css.slice(css.indexOf("/* ---------- Orbit:"), css.indexOf("/* ---------- Barnstorm"));
  expect(own).not.toMatch(/border-radius: (?!0\b)/);
  expect(own).not.toMatch(/box-shadow/);
  // Each of the crew's colour is their class's (--c), set earlier in the sheet: a rule here that set --c would take it from them.
  expect(own).not.toMatch(/--c:/);
  // The sign-in page's orb has parts by these names, styled wherever they appear: nothing here shares one.
  expect(own).not.toMatch(/\.orb-(glow|ripple|dial|core|light)\b/);
});

test("a name that's saying what its crew member is doing has a backing to be read against; one at camp is just the name", () => {
  const { container, store } = show();
  const label = (who: string) => container.querySelector(`.orb-label.c-${who}`)!;
  expect(label("scout").classList.contains("st-idle")).toBe(true);
  expect(label("scout").querySelector("span")).toBe(null);
  send(store, ...underWay);
  expect(label("scout").classList.contains("st-active")).toBe(true);
  expect(label("scout").querySelector("span")!.textContent).toBe("Using read_file");
  expect(label("scribe").classList.contains("st-idle")).toBe(true);
  expect(css).toMatch(/\.orb-label:is\(\.st-active, \.st-waiting\) \{ background: rgba\([^)]+, \.\d+\);/); // see-through, so the sky still shows
});

test("its class names are its own: the page's styles for other things by the same name don't land on it", () => {
  // (A step's line marked plain "ask" once picked up the approval card's rounded amber box, and "waiting" the waiting list's padding.)
  const { view, cell, store } = show();
  send(store, ...underWay, { type: "ask", id: "k9", kind: "shell", title: "Run a command", body: "npm test", questId: "q1", expeditionId: "A" });
  fireEvent.click(cell("Scout"));
  fireEvent.click(screen.getByRole("button", { name: "Demo" }));
  pass(9000);
  const used = new Set([view, ...view.querySelectorAll("*")].flatMap((el) => [...el.classList]));
  expect(used.size).toBeGreaterThan(40);
  expect([...used].some((c) => c.startsWith("orb-l-"))).toBe(true);
  const elsewhere = css.slice(0, css.indexOf("/* ---------- Orbit:")) + css.slice(css.indexOf("/* ---------- Barnstorm"));
  const taken = [...used].filter((name) => !/^c-/.test(name) && name !== "icon" // (the crew's colours and the icons are meant to be shared)
    && new RegExp(`(^|[\\s,>+~])\\.${name.replace(/[^\w-]/g, "\\$&")}(?![\\w-])`, "m").test(elsewhere));
  expect(taken).toEqual([]);
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

// ---------- Holding, satellites, replay, ambient, quiet, plans ----------
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });
const posts: { path: string; body: unknown }[] = [];
function camp(handlers: Record<string, () => { status?: number; body: object }> = {}) {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const h = handlers[path] ?? (() => ({ body: { ok: true } }));
    const { status = 200, body } = h();
    return new Response(JSON.stringify(body), { status });
  }));
}
const dialog = () => screen.getByRole("dialog");
const holding = () => screen.getByRole("complementary", { name: "Waiting at the edge of the system" });
const withKit = {
  ...S,
  installedSkills: [{ owner: "scout", name: "read-logs", description: "Where to look." }, { owner: "shared", name: "camp-rules", description: "Be kind." }],
  connectors: [{ name: "github", description: "PRs", agents: ["scout"], state: "connected", tools: [{ name: "list" }], allowWrite: false }],
} as unknown as CampState;

test("the demo holds a pretend queue, pull requests and jobs at the edge; each opens, and the failing one is red", () => {
  show();
  expect(screen.queryByRole("complementary", { name: "Waiting at the edge of the system" })).toBeNull(); // a quiet camp has nothing holding
  fireEvent.keyDown(dialog(), { key: "D" });
  const list = within(holding());
  expect(list.getByRole("heading", { name: "Holding at the edge" })).toBeTruthy();
  expect(list.getAllByRole("listitem")).toHaveLength(5);
  const red = list.getByRole("button", { name: /#208/ }).closest("li")!;
  expect(red.className).toContain("bad");
  expect(list.getByRole("button", { name: /#212/ }).closest("li")!.className).not.toContain("bad");
  expect(list.queryByText("Checks running")).toBeNull();
  fireEvent.click(list.getByRole("button", { name: /#212/ }));
  expect(list.getByText("Checks running")).toBeTruthy();
  fireEvent.click(list.getByRole("button", { name: /#208/ })); // one at a time
  expect(list.queryByText("Checks running")).toBeNull();
  expect(list.getByText("2 checks failing")).toBeTruthy();
  fireEvent.click(list.getByRole("button", { name: /#208/ }));
  expect(list.queryByText("2 checks failing")).toBeNull();
  // A pretend camp can't send anything: there's nothing to start.
  fireEvent.click(list.getByRole("button", { name: /Tidy the changelog/ }));
  expect(list.queryByRole("button", { name: "Start it without waiting" })).toBeNull();
});

test("something waiting in the real queue can be started without waiting, which posts its id", async () => {
  camp();
  show(createFeedStore(), { ...S, queued: [{ id: "w1", task: "Tidy the changelog", label: "Tidy", after: "w0" }] } as unknown as CampState);
  fireEvent.click(within(holding()).getByRole("button", { name: /Tidy the changelog/ }));
  expect(within(holding()).getByText("Waiting for the run before it")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start it without waiting" }));
  await settle();
  expect(posts).toEqual([{ path: "/api/queue/release", body: { id: "w1" } }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("if the queued one isn't waiting any more, the camp's reason is shown", async () => {
  camp({ "/api/queue/release": () => ({ status: 404, body: { error: "That one isn't waiting any more." } }) });
  show(createFeedStore(), { ...S, queued: [{ id: "w1", task: "Tidy", label: "Tidy" }] } as unknown as CampState);
  fireEvent.click(within(holding()).getByRole("button", { name: /Tidy/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start it without waiting" }));
  await settle();
  expect(screen.getByRole("alert").textContent).toBe("That one isn't waiting any more.");
});

test("an open pull request links to it; jobs that are off and merged ones aren't held", () => {
  show(createFeedStore(), { ...S, prs: [{ number: 9, title: "Fix", url: "https://example.test/9", state: "OPEN", failing: 0, pending: 0 }, { number: 8, title: "Old", url: "u", state: "MERGED", failing: 0 }], jobs: [{ name: "Off", schedule: "never", enabled: false }] } as unknown as CampState);
  expect(within(holding()).getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(within(holding()).getByRole("button", { name: /#9 Fix/ }));
  expect(screen.getByRole("link", { name: "Open the pull request" }).getAttribute("href")).toBe("https://example.test/9");
});

test("what a crew member carries is listed in their panel as their satellites", () => {
  const { cell } = show(createFeedStore(), withKit);
  fireEvent.click(cell("Scout"));
  const panel = within(screen.getByRole("complementary", { name: "What Scout is doing" }));
  expect(panel.getByRole("heading", { name: /^3 satellites/ })).toBeTruthy();
  expect(panel.getAllByRole("listitem").map((li) => li.querySelector("span")!.textContent)).toEqual(["read-logs", "github", "camp-rules"]);
  fireEvent.click(cell("Scribe"));
  expect(within(screen.getByRole("complementary", { name: "What Scribe is doing" })).getByRole("heading", { name: /^One satellite/ })).toBeTruthy(); // (the camp's shared one)
});

test("a camp that doesn't say what they carry lists no satellites", () => {
  const { cell } = show();
  fireEvent.click(cell("Scout"));
  expect(screen.queryByRole("heading", { name: /satellite/ })).toBeNull();
});

test("a quest with nothing for three minutes dims its planet and its label says it's quiet", () => {
  // Four minutes pass here. Only the clock and the timers are stood in for, not the frames: quiet is worked out
  // on the fifteen-second beat, and drawing fifteen thousand frames to get there took a slow machine past the time limit.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  const { store, planet, cell } = show();
  send(store, ...underWay);
  pass(2 * 60_000);
  expect(planet("scout").classList.contains("st-stalled")).toBe(false);
  pass(2 * 60_000); // Orbit looks again every fifteen seconds
  expect(planet("scout").classList.contains("st-stalled")).toBe(true);
  expect(cell("Scout").getAttribute("aria-label")).toMatch(/^Scout: Quiet for 4m$/);
  expect(document.querySelector('.orb-label.st-stalled')!.textContent).toContain("Quiet for 4m");
  send(store, { type: "tool", ...scout, tool: "grep", input: "x", questId: "q1", expeditionId: "A" }); // it speaks again
  pass(15_000);
  expect(planet("scout").classList.contains("st-stalled")).toBe(false);
});

test("a plan's steps are waypoints round the sun, each in the state it's in", () => {
  const { container, store } = show();
  expect(container.querySelectorAll("g.orb-ways rect").length).toBe(0);
  send(store, { type: "expedition_start", id: "A", task: "Audit", source: "user" }, { type: "plan", steps: [{ n: 1, text: "Look" }, { n: 2, text: "Write" }, { n: 3, text: "Check" }], expeditionId: "A" });
  const ways = () => [...container.querySelectorAll("g.orb-ways rect")].map((r) => [...r.classList].find((c) => c.startsWith("way-")));
  expect(ways()).toHaveLength(3);
  expect(ways().every((w) => w !== undefined)).toBe(true);
  const before = ways();
  send(store, { type: "dispatch", ...scout, questId: "q1", step: 1, expeditionId: "A" });
  expect(ways()[0]).toBe("way-out");
  expect(ways()[0]).not.toBe(before[0]);
  send(store, { type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" }, { type: "expedition_end", id: "A", status: "done", text: "Done" });
  expect(container.querySelectorAll("g.orb-ways rect").length).toBe(0); // over: nothing to show
});

test("keys typed into a box inside Orbit are typing, not shortcuts", () => {
  const { cell } = show();
  fireEvent.click(cell("Scout"));
  const box = screen.getByRole("textbox", { name: "Ask Scout for something" });
  for (const key of ["d", "a", "p", "2", "0", "+"]) fireEvent.keyDown(box, { key });
  expect(screen.queryByRole("status")).toBeNull(); // not the demo, not a replay
  expect(dialog().classList.contains("ambient")).toBe(false);
  expect(screen.getByRole("complementary", { name: "What Scout is doing" })).toBeTruthy(); // still with the Scout
  fireEvent.keyDown(box, { key: "Escape" }); // steps out of the box, and nothing more
  expect(screen.getByRole("complementary", { name: "What Scout is doing" })).toBeTruthy();
  expect(document.activeElement).toBe(dialog());
});

const dayOf = (...bodies: object[]) => bodies.map((b, i) => ({ ...b, seq: i + 1, time: new Date(Date.now() - (bodies.length - i) * 60_000).toISOString() }));
const day = dayOf(...underWay, { type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" });

test("the replay fetches the last day and plays it back, with the timeline and a note that it isn't now", async () => {
  camp({ "/api/feed/day": () => ({ body: { events: day } }) });
  const { container } = show();
  fireEvent.click(screen.getByRole("button", { name: "Replay" }));
  await settle();
  expect(posts[0]).toEqual({ path: "/api/feed/day", body: undefined });
  expect(screen.getByRole("region", { name: "Replay of the last day" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Replay: the last day, played back. None of this is happening now.");
  expect(screen.getByRole("button", { name: "Replay", pressed: true })).toBeTruthy();
  pass(2000);
  expect(container.querySelector('.orb-planet[data-who="scout"]')).toBeTruthy();
});

test("while replaying there's nothing to act with, and Esc leaves it", async () => {
  camp({ "/api/feed/day": () => ({ body: { events: day } }) });
  const { cell, store } = show();
  fireEvent.keyDown(dialog(), { key: "P" });
  await settle();
  expect(screen.getByRole("region", { name: "Replay of the last day" })).toBeTruthy();
  pass(10_000);
  fireEvent.click(cell("Scout"));
  expect(screen.queryByRole("textbox", { name: /Ask Scout|Say something/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop this expedition" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Go to it|Open Scout's page/ })).toBeNull();
  expect(store.getState().items).toEqual([]); // the real feed has none of it
  fireEvent.keyDown(dialog(), { key: "Escape" }); // (one Esc for what's looked at, then the replay)
  fireEvent.keyDown(dialog(), { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Replay of the last day" })).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

test("Back to now leaves the replay for the camp as it is", async () => {
  camp({ "/api/feed/day": () => ({ body: { events: day } }) });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Replay" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Back to now" }));
  expect(screen.queryByRole("region", { name: "Replay of the last day" })).toBeNull();
});

test("with nothing to replay it says so, and when the day can't be fetched it says that", async () => {
  camp({ "/api/feed/day": () => ({ body: { events: [] } }) });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Replay" }));
  await settle();
  expect(screen.getByRole("status").textContent).toBe("Nothing has happened in the last day to replay.");
  expect(screen.queryByRole("region", { name: "Replay of the last day" })).toBeNull();
  cleanup();
  camp({ "/api/feed/day": () => ({ status: 500, body: { error: "No feed" } }) });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Replay" }));
  await settle();
  expect(screen.getByRole("status").textContent).toBe("The replay couldn't be fetched: No feed");
});

// Ambient: hands off.
const ambient = () => fireEvent.keyDown(dialog(), { key: "A" });
const caption = (c: HTMLElement) => c.querySelector(".orb-caption")!;

test("ambient takes the panel, the strip and the hint away, and names who the camera is on", () => {
  const { container, store, cell } = show();
  fireEvent.click(cell("Scout"));
  ambient();
  expect(dialog().classList.contains("ambient")).toBe(true);
  expect(screen.queryByRole("navigation", { name: "The crew" })).toBeNull();
  expect(container.querySelector(".orb-panel")).toBeNull();
  expect(container.querySelector(".orb-hint")).toBeNull();
  expect(screen.getByRole("button", { name: "Ambient", pressed: true })).toBeTruthy();
  expect(caption(container).querySelector("b")!.textContent).toBe("Scout"); // (it was with the Scout)
  fireEvent.keyDown(dialog(), { key: "Escape" });
  expect(dialog().classList.contains("ambient")).toBe(false);
  expect(container.querySelector(".orb-caption")).toBeNull();
  expect(container.querySelector(".orb-hint")).toBeTruthy();
  expect(store).toBeTruthy();
});

test("the Ambient button turns it on, and with the camp quiet the camera is on the whole camp", () => {
  const { container } = show();
  fireEvent.click(screen.getByRole("button", { name: "Ambient" }));
  expect(dialog().classList.contains("ambient")).toBe(true);
  expect(caption(container).querySelector("b")!.textContent).toBe("The camp");
  expect(caption(container).querySelector("p")!.textContent).toBe("The campAt rest");
});

test("the camera cuts to whoever does something, waits its turn for the next, and steps back when it's quiet", () => {
  const { container, store } = show();
  ambient();
  send(store, ...underWay.slice(1));
  expect(caption(container).querySelector("b")!.textContent).toBe("Scout");
  expect(dialog().querySelector(".orb-planet.focused")!.getAttribute("data-who")).toBe("scout");
  // The Scribe does something a moment later: the camera stays on the Scout until it's had its time...
  pass(1000);
  send(store, { type: "tool", who: "Scribe", emoji: "🪶", depth: 1, tool: "write_file", input: "notes.md", questId: "q2", expeditionId: "A" });
  expect(caption(container).querySelector("b")!.textContent).toBe("Scout");
  pass(6000);
  expect(caption(container).querySelector("b")!.textContent).toBe("Scribe");
  // ...and with nothing from anyone for a while it goes back to the whole system.
  pass(25_000);
  expect(caption(container).querySelector("b")!.textContent).toBe("The camp");
  expect(container.querySelector(".orb-planet.focused")).toBeNull();
});

test("a decision for you is said quietly, goes to the front of the queue, and takes you to whoever is asking", () => {
  const { container, store } = show();
  ambient();
  send(store, ...underWay.slice(1));
  expect(screen.queryByRole("button", { name: "A decision needs you" })).toBeNull();
  expect(dialog().classList.contains("needs")).toBe(false);
  pass(1000); // (the Scout's turn isn't up)
  send(store, { type: "ask", id: "k1", kind: "plan", title: "Approve the plan", body: "1. Look", expeditionId: "A" }); // plans are the Quartermaster's to ask
  expect(caption(container).querySelector("b")!.textContent).toBe("Quartermaster"); // (it didn't wait its turn)
  expect(dialog().classList.contains("needs")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "A decision needs you" }));
  expect(dialog().classList.contains("ambient")).toBe(false);
  expect(container.querySelector(".orb-caption")).toBeNull();
  expect(screen.getByRole("complementary", { name: "What Quartermaster is doing" })).toBeTruthy();
});

test("a decision asked from a quest takes the camera to whoever is out on it", () => {
  const { container, store } = show();
  ambient();
  send(store, ...underWay, { type: "dispatch", who: "Scribe", emoji: "🪶", depth: 1, questId: "q2", brief: "Write it up", step: 2, expeditionId: "A" });
  expect(caption(container).querySelector("b")!.textContent).toBe("Quartermaster"); // (the expedition has just set out)
  pass(1000); // (its turn isn't up, and the Scout and the Scribe are waiting for theirs)
  send(store, { type: "ask", id: "k3", kind: "shell", title: "Run a command", body: "git status", questId: "q2", expeditionId: "A" }); // (the Scribe's quest)
  expect(caption(container).querySelector("b")!.textContent).toBe("Scribe"); // (who's asking, and it didn't wait its turn)
  expect(dialog().classList.contains("needs")).toBe(true);
});

test("a press on the sky takes the controls back", () => {
  class Press extends MouseEvent { pointerId = 1; }
  vi.stubGlobal("PointerEvent", Press);
  const { container } = show();
  ambient();
  fireEvent(container.querySelector(".orb-sky")!, new Press("pointerdown", { bubbles: true, button: 0 }));
  expect(dialog().classList.contains("ambient")).toBe(false);
});

test("the sun can be turned down from its own panel, and stays as you left it", () => {
  const { cell, container } = show();
  const corona = () => num(container.querySelector(".orb-corona"), "opacity"), core = () => num(container.querySelector(".orb-sun-core"), "opacity");
  const full = corona();
  expect(core()).toBe(1);
  fireEvent.click(cell("Quartermaster"));
  const dimmer = screen.getByRole("slider", { name: "Brightness" });
  expect(num(dimmer, "value")).toBe(1);
  fireEvent.change(dimmer, { target: { value: "0.4" } });
  expect(screen.getByText("40%")).toBeTruthy();
  expect(corona()).toBeLessThan(full * 0.5);
  expect(core()).toBeLessThan(1);
  expect(core()).toBeGreaterThan(0.3); // (dimmer, but never out)
  expect(localStorage.getItem("camp-orbit-sun")).toBe("0.4");
  // A planet's panel has no such setting: it is the sun's.
  fireEvent.click(cell("Scout"));
  expect(screen.queryByRole("slider", { name: "Brightness" })).toBe(null);
  // Opened again later, it comes up as dim as it was left.
  cleanup();
  const again = show();
  expect(num(again.container.querySelector(".orb-sun-core"), "opacity")).toBeLessThan(1);
  localStorage.removeItem("camp-orbit-sun");
});

test("Tab stays inside Orbit, and focus goes back to what opened it when it closes", () => {
  render(<Opener>{(close) => <Orbit S={S} store={createFeedStore()} onClose={close} onOpenAgent={vi.fn()} onOpenQuest={vi.fn()} onOpenConversation={vi.fn()} />}</Opener>);
  const opener = screen.getByRole("button", { name: "Open it" });
  opener.focus();
  fireEvent.click(opener);
  const view = screen.getByRole("dialog", { name: "Orbit: the crew at work" });
  expect(document.activeElement).toBe(view);
  expectTabWraps(view);
  fireEvent.keyDown(view, { key: "1" }); // its own keys still answer: look closer at the first of the crew
  expect(view.classList.contains("looking")).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" }); // steps back out
  expect(screen.queryByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); // and leaves
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
