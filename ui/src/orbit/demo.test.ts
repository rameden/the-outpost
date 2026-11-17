// The demo's pretend camp: a feed of its own, played one expedition after another, each in stages.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runningCount } from "../feed/reducer.ts";
import { createFeedStore } from "../feed/store.ts";
import { DEMO_CREW, castFor, demoCamp, demoRun, runDemo } from "./demo.ts";

const [lead, ...crew] = DEMO_CREW;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

type Timed<T> = [number, T][];
const of = <T,>(events: [number, object][], type: string) => events.filter(([, e]) => (e as { type: string }).type === type) as Timed<T>;

test("an expedition goes in stages: the Scout, then two Artificer quests and the Hacker, then the Warden, then the Scribe", () => {
  const { events, lasts } = demoRun(0, lead, crew);
  expect((events[0][1] as { type: string }).type).toBe("expedition_start");
  expect((events.at(-1)![1] as { type: string }).type).toBe("expedition_end");
  expect(events.at(-1)![0]).toBe(lasts);
  expect(events.map(([at]) => at)).toEqual(events.map(([at]) => at).sort((a, b) => a - b)); // in the order they happen
  const out = of<{ who: string; step: number; questId: string }>(events, "dispatch"), back = of<{ questId: string }>(events, "return");
  expect(out.map(([, e]) => e.who)).toEqual(["Scout", "Artificer", "Artificer", "Hacker", "Warden", "Scribe"]);
  expect(out.map(([, e]) => e.step)).toEqual([1, 2, 3, 4, 5, 6]); // each a numbered step of the plan
  expect(back.length).toBe(6);
  // Nobody leaves until everyone in the stage before is home.
  const home = (...quests: number[]) => Math.max(...quests.map((q) => back.find(([, e]) => e.questId === `q${q}`)![0]));
  const leaves = (q: number) => out[q][0];
  expect(leaves(1)).toBeGreaterThan(home(0));       // the Artificer waits for the Scout
  expect(leaves(3)).toBeLessThan(home(1));          // the Artificer's two and the Hacker are out together
  expect(leaves(4)).toBeGreaterThan(home(1, 2, 3)); // the Warden waits for all three
  expect(leaves(5)).toBeGreaterThan(home(4));       // the Scribe waits for the Warden
  // The Quartermaster says a word as each stage goes; one quest stops to ask for your OK, and is given it.
  expect(of<{ who: string }>(events, "text").filter(([, e]) => e.who === "Quartermaster").length).toBe(1 + 4 + 1);
  expect(of(events, "ask").length).toBe(1);
  expect(of(events, "answered").length).toBe(1);
  // Each is out long enough to watch: a quarter of a minute or so.
  for (let q = 0; q < 6; q++) expect(home(q) - leaves(q)).toBeGreaterThan(14_000);
  // The next expedition is another task. It's the same show every time: nothing in it is left to chance.
  expect((demoRun(1, lead, crew).events[0][1] as { task: string }).task).not.toBe((events[0][1] as { task: string }).task);
  expect(demoRun(0, lead, crew)).toEqual(demoRun(0, lead, crew));
});

test("a crew without one of the parts has someone else stand in, someone with no part of their own first", () => {
  const scout = { name: "Scout" }, scribe = { name: "Scribe" }, cook = { name: "Cook" };
  expect(castFor([scout, scribe, cook])).toEqual({ scout, scribe, artificer: cook, hacker: cook, warden: cook });
  expect(Object.values(castFor([scout])).every((a) => a === scout)).toBe(true);
  const run = demoRun(0, lead, [scout, scribe, cook]);
  expect(of<{ who: string }>(run.events, "dispatch").map(([, e]) => e.who)).toEqual(["Scout", "Cook", "Cook", "Cook", "Cook", "Scribe"]);
});

test("played into a feed: first one out alone, then three at once with one waiting on you, then all home, and round again", () => {
  const store = createFeedStore();
  const stop = runDemo(store, lead, crew);
  expect(store.getState().items.length).toBe(0);
  vi.advanceTimersByTime(10_000);
  expect(store.getState().quests.map((q) => q.who)).toEqual(["Scout"]);
  let most = 0, waited = false, artificerTwice = false;
  const first = demoRun(0, lead, crew).lasts;
  for (let t = 10_000; t < first + 800; t += 200) {
    vi.advanceTimersByTime(200);
    const s = store.getState();
    most = Math.max(most, s.quests.length);
    waited ||= s.quests.some((q) => q.waiting) && s.asks.length === 1;
    artificerTwice ||= s.quests.filter((q) => q.who === "Artificer").length === 2;
  }
  expect(most).toBe(3);
  expect(waited).toBe(true);
  expect(artificerTwice).toBe(true);
  // The first is over: nobody out, nothing open, nothing waiting on you, and everyone back at camp.
  let s = store.getState();
  expect(runningCount(s)).toBe(0);
  expect(s.quests).toEqual([]);
  expect(s.asks).toEqual([]);
  expect(Object.values(s.crew).every((c) => c.status === "idle")).toBe(true);
  expect(s.items.filter((n) => n.kind === "exp").length).toBe(1);
  // A pause, and the next one starts.
  vi.advanceTimersByTime(9000);
  s = store.getState();
  expect(runningCount(s)).toBe(1);
  expect(s.items.filter((n) => n.kind === "exp").length).toBe(2);
  // Stopped, nothing more arrives.
  stop();
  const seen = store.getState().lastSeq;
  vi.advanceTimersByTime(300_000);
  expect(store.getState().lastSeq).toBe(seen);
});

test("a camp with nobody to send still has its Quartermaster planning", () => {
  const store = createFeedStore();
  const stop = runDemo(store, lead, []);
  vi.advanceTimersByTime(2500);
  expect(runningCount(store.getState())).toBe(1);
  expect(store.getState().crew.Quartermaster.status).toBe("active");
  vi.advanceTimersByTime(4000);
  expect(runningCount(store.getState())).toBe(0);
  stop();
});

test("a pretend camp has experience, a kit, a day's spend, a limit and ships for whoever is in the sky", () => {
  const camp = demoCamp(DEMO_CREW);
  expect(Object.keys(camp.xp)).toEqual(DEMO_CREW.map((c) => c.name));
  expect(Object.keys(camp.kit)).toEqual(DEMO_CREW.map((c) => c.id));
  expect(camp.kit[lead.id]).toEqual([]); // the sun carries nothing
  for (const c of crew) {
    expect(camp.kit[c.id].length).toBeGreaterThan(1);
    expect(camp.kit[c.id].at(-1)).toMatchObject({ shared: true }); // the camp's own rules, last
  }
  expect(camp.spend.today).toBeCloseTo(Object.values(camp.spend.byAgent).reduce((a, b) => a + b, 0));
  expect(Object.keys(camp.spend.byAgent)).toEqual(DEMO_CREW.map((c) => c.name));
  expect(camp.limit.used).toBeGreaterThan(0);
  expect(camp.limit.used).toBeLessThan(1);
});

test("the pretend ships include a failing pull request and are all different", () => {
  const { ships } = demoCamp(DEMO_CREW);
  expect(new Set(ships.map((s) => s.id)).size).toBe(ships.length);
  expect(new Set(ships.map((s) => s.kind))).toEqual(new Set(["queued", "pr", "job"]));
  expect(ships.filter((s) => s.bad).map((s) => s.kind)).toEqual(["pr"]);
});

test("the pretend camp is the same every time, and copes with a crew of any size", () => {
  expect(demoCamp(DEMO_CREW)).toEqual(demoCamp(DEMO_CREW));
  const many = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
  const camp = demoCamp(many);
  expect(Object.keys(camp.xp)).toHaveLength(14);
  expect(camp.kit.c0).toEqual([]);
  expect(camp.kit.c13.length).toBeGreaterThan(1);
  expect(demoCamp([])).toMatchObject({ xp: {}, kit: {}, spend: { today: 0, byAgent: {} } });
});
