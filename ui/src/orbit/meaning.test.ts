// What the picture says beyond who's working: quiet quests, time out, gauges and what's holding at the edge.
import { expect, test } from "vitest";
import type { CrewStatus } from "../feed/reducer.ts";
import { MOON_GROWN, MOON_R, NEAR_FULL, SHIPS, STALL_MS, WAYS, WAY_APART, WAY_R, arc, moonOf, quietFor, sayOf, shipAt, shipsOf, spendLine, spendOf, stalled, tightest, wayAt } from "./meaning.ts";

const q = (last: number, over: object = {}) => ({ id: "q", expId: "A", node: "n", who: "Scout", emoji: "🏹", brief: "b", started: 0, line: "", waiting: false, last, ...over });
const NOW = 10 * 60_000;
const busy: CrewStatus = { status: "active", line: "Reading files" };

test("a quest is quiet after three minutes of nothing, unless it's waiting on you", () => {
  expect(stalled(q(NOW - STALL_MS + 1), NOW)).toBe(false);
  expect(stalled(q(NOW - STALL_MS), NOW)).toBe(true);
  expect(stalled(q(0, { waiting: true }), NOW)).toBe(false);
});

test("how long it's been quiet is said in whole minutes", () => {
  expect(quietFor(q(NOW - 3 * 60_000 - 40_000), NOW)).toBe("Quiet for 3m");
  expect(quietFor(q(0), 75 * 60_000)).toBe("Quiet for 1h 15m");
});

test("under a name: what they're doing, or that what they have out has gone quiet", () => {
  expect(sayOf(busy, [q(NOW - 1000)], NOW)).toEqual({ text: "Reading files", quiet: false });
  expect(sayOf(busy, [q(NOW - 5 * 60_000)], NOW)).toEqual({ text: "Quiet for 5m", quiet: true });
  // Two out, one quiet: the planet stays lit. Both quiet: it dims.
  expect(sayOf(busy, [q(NOW - 5 * 60_000), q(NOW - 1000)], NOW)).toEqual({ text: "2 quests out · one gone quiet", quiet: false });
  expect(sayOf(busy, [q(0), q(1000), q(NOW - 1000)], NOW)).toEqual({ text: "3 quests out · 2 gone quiet", quiet: false });
  expect(sayOf(busy, [q(0), q(1000)], NOW)).toEqual({ text: "2 quests out · all quiet", quiet: true });
});

test("a moon grows with time out, quickly at first, and gains rings at ten and thirty minutes", () => {
  expect(moonOf(0)).toEqual({ r: MOON_R, rings: 0 });
  expect(moonOf(-5000).r).toBe(MOON_R);
  const [a, b, c] = [moonOf(60_000).r, moonOf(10 * 60_000).r, moonOf(20 * 60_000).r];
  expect(a).toBeGreaterThan(MOON_R);
  expect(b - a).toBeGreaterThan(c - b); // the growth slows
  expect(moonOf(60 * 60_000).r).toBeCloseTo(MOON_GROWN);
  expect(moonOf(24 * 3600_000).r).toBeCloseTo(MOON_GROWN); // and stops
  expect([9, 10, 29, 30].map((m) => moonOf(m * 60_000).rings)).toEqual([0, 1, 1, 2]);
});

test("an arc runs clockwise from twelve o'clock, and is nothing for next to nothing", () => {
  expect(arc(10, 0)).toBe("");
  expect(arc(10, 0.003)).toBe("");
  expect(arc(10, NaN)).toBe("");
  expect(arc(10, 0.25)).toMatch(/^M0 -10\.00A10 10 0 0 1 10\.00 -?0\.00$/);
  expect(arc(10, 0.75)).toMatch(/^M0 -10\.00A10 10 0 1 1 -10\.00 -?0\.00$/); // past half: the long way round
  expect(arc(10, 5)).toBe(arc(10, 0.9999)); // never quite closes
});

test("what one of the crew has cost today, and their share of the camp's day", () => {
  const spend = { today: 4, byAgent: { Scout: 1, Scribe: 0 } };
  expect(spendOf(spend, "Scout")).toEqual({ cost: 1, share: 0.25 });
  expect(spendOf(spend, "Warden")).toEqual({ cost: 0, share: 0 });
  expect(spendOf(null, "Scout")).toEqual({ cost: 0, share: 0 });
  expect(spendOf({ today: 0, byAgent: { Scout: 1 } }, "Scout").share).toBe(0);
  expect(spendOf({ today: 1 }, "Scout")).toEqual({ cost: 0, share: 0 });
  expect(spendOf({ today: 1, byAgent: { Scout: 3 } }, "Scout").share).toBe(1); // capped
  expect(spendLine({ cost: 1, share: 0.25 })).toBe("$1.00 · 25% of the camp's day");
  expect(spendLine({ cost: 0, share: 0 })).toBe("Nothing yet");
});

test("the sun's gauge is the plan limit nearest to full, and none if the plan has none", () => {
  expect(tightest(null)).toBeNull();
  expect(tightest([{ type: "five_hour" }])).toBeNull();
  expect(tightest([{ type: "five_hour", label: "5 hours", utilization: 0.3 }, { type: "week", utilization: 0.7 }, { type: "opus", label: "Opus", utilization: 0.5 }])).toEqual({ label: "week", used: 0.7 });
  expect(tightest([{ type: "week", label: "This week", utilization: 1.4 }])).toEqual({ label: "This week", used: 1 });
  expect(NEAR_FULL).toBe(0.8);
});

test("a plan's steps sit round the sun from twelve o'clock, clockwise, and a second plan's a ring further out", () => {
  const first = wayAt(0, 4, 0), second = wayAt(1, 4, 0), outer = wayAt(0, 4, 1);
  expect(first.x).toBeCloseTo(0); expect(first.y).toBeCloseTo(-WAY_R);
  expect(second.x).toBeCloseTo(WAY_R); expect(second.y).toBeCloseTo(0);
  expect(outer.y).toBeCloseTo(-(WAY_R + WAY_APART));
  expect(wayAt(0, 0, 0).y).toBeCloseTo(-WAY_R); // no steps: no division by nothing
  expect(WAYS).toBeGreaterThan(0);
});

test("what's holding at the edge: the queue, open pull requests, and jobs that are on", () => {
  const ships = shipsOf({
    queued: [{ id: "w1", task: "Tidy", label: "L1" }, { id: "w2", label: "Second", after: "w1" }, { id: "w3", task: "Third", label: "L3", held: true }] as never,
    prs: [
      { number: 1, title: "Merged", url: "u1", state: "MERGED", failing: 0 },
      { number: 2, title: "Red", url: "u2", state: "OPEN", failing: 2, pending: 0 },
      { number: 3, title: "One red", url: "u3", state: "OPEN", failing: 1 },
      { number: 4, title: "Clash", url: "u4", state: "OPEN", failing: 0, conflicts: true },
      { number: 5, title: "Running", url: "u5", state: "OPEN", failing: 0, pending: 1 },
      { number: 6, title: "Ok", url: "u6", state: "OPEN", failing: 0, pending: 0, review: "approved" },
      { number: 7, title: "Asked", url: "u7", state: "OPEN", failing: 0, pending: 0, review: "changes" },
      { number: 8, title: "Plain", url: "u8", state: "OPEN", failing: 0, pending: 0 },
    ] as never,
    jobs: [{ name: "Brief", schedule: "Daily", enabled: true }, { name: "Off", schedule: "Never", enabled: false }] as never,
  });
  expect(ships.map((s) => s.id)).toEqual(["ship:q:w1", "ship:q:w2", "ship:q:w3", ...[2, 3, 4, 5, 6, 7, 8].map((n) => `ship:pr:u${n}`), "ship:job:Brief"]);
  const by = (id: string) => ships.find((s) => s.id === id)!;
  expect(by("ship:q:w1")).toMatchObject({ kind: "queued", name: "Tidy", ref: "w1", detail: "In the queue" });
  expect(by("ship:q:w2")).toMatchObject({ name: "Second", detail: "Waiting for the run before it" });
  expect(by("ship:q:w3")).toMatchObject({ held: true, detail: "Held: what it was waiting on didn't finish" });
  expect(by("ship:pr:u2")).toMatchObject({ name: "#2 Red", bad: true, detail: "2 checks failing", url: "u2" });
  expect(by("ship:pr:u3").detail).toBe("1 check failing");
  expect(["u4", "u5", "u6", "u7", "u8"].map((u) => by(`ship:pr:${u}`).detail)).toEqual(["Conflicts with its base", "Checks running", "Approved", "Changes asked for", "Checks passing"]);
  expect(by("ship:pr:u8").bad).toBeUndefined();
  expect(by("ship:job:Brief")).toMatchObject({ kind: "job", detail: "Daily" });
  expect(shipsOf(null)).toEqual([]);
});

test("ships hold along the rim a few degrees apart, centred on the same place however many there are", () => {
  expect(shipAt(0, 1)).toBe(215);
  const four = [0, 1, 2, 3].map((j) => shipAt(j, 4));
  expect(four[1] - four[0]).toBe(7);
  expect((four[0] + four[3]) / 2).toBe(215);
  expect(shipAt(0, SHIPS + 10)).toBe(shipAt(0, SHIPS)); // no more than the ones drawn are spread
});
