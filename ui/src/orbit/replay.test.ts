// The last day, laid along a line that plays in about half a minute.
import { expect, test } from "vitest";
import type { CampEvent } from "../types.ts";
import { GAP_MS, REEL_S, TAIL_MS, countAt, paceOf, realAt, reelOf } from "./replay.ts";

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
const ev = (seq: number, ms: number, over: object = {}) => ({ type: "text", who: "Scout", emoji: "🏹", depth: 1, text: "x", seq, time: new Date(T0 + ms).toISOString(), ...over }) as CampEvent;

test("events are put in order of when they happened and renumbered from one", () => {
  const r = reelOf([ev(9, 2000), ev(7, 0), ev(8, 1000)]);
  expect(r.events.map((e) => e.seq)).toEqual([1, 2, 3]);
  expect(r.real).toEqual([T0, T0 + 1000, T0 + 2000]);
  expect(r.at).toEqual([0, 1000, 2000]);
});

test("events with no readable time are left out, and ties keep their order", () => {
  const r = reelOf([ev(2, 0, { text: "b" }), ev(1, 0, { text: "a" }), ev(3, 0, { time: "nonsense" })]);
  expect(r.events.map((e) => (e as { text: string }).text)).toEqual(["a", "b"]);
});

test("a long stretch of nothing is cut down, and the line runs a little past the last event", () => {
  const r = reelOf([ev(1, 0), ev(2, 3 * 3600_000), ev(3, 3 * 3600_000 + 500)]);
  expect(r.at).toEqual([0, GAP_MS, GAP_MS + 500]);
  expect(r.span).toBe(GAP_MS + 500 + TAIL_MS);
  expect(reelOf([ev(1, 0), ev(2, 10_000)], 2000).at).toEqual([0, 2000]); // a gap of your own
});

test("expeditions setting out and decisions waiting are marked where they fall", () => {
  const r = reelOf([ev(1, 0, { type: "expedition_start", id: "A", task: "Dig", source: "user" }), ev(2, 500), ev(3, 800, { type: "ask", id: "k", kind: "plan", title: "Approve", body: "" })]);
  expect(r.marks).toEqual([{ at: 0, kind: "start", label: "Dig" }, { at: 800, kind: "ask", label: "Approve" }]);
});

test("no events is an empty line", () => {
  expect(reelOf([])).toMatchObject({ events: [], at: [], span: 0, marks: [] });
});

test("how many events have happened by a point on the line", () => {
  const r = reelOf([ev(1, 0), ev(2, 1000), ev(3, 1000), ev(4, 5000)]);
  expect([-1, 0, 999, 1000, 4999, 5000, 99999].map((o) => countAt(r, o))).toEqual([0, 1, 1, 3, 3, 4, 4]);
});

test("the real time at a point runs on from the event before it, across a stretch that was cut short", () => {
  const r = reelOf([ev(1, 0), ev(2, 3 * 3600_000)]);
  expect(realAt(r, 0)).toBe(T0);
  expect(realAt(r, 30_000)).toBe(T0 + 30_000);
  expect(realAt(r, GAP_MS)).toBe(T0 + 3 * 3600_000);
  expect(realAt(r, r.span + 99_999)).toBe(T0 + 3 * 3600_000 + TAIL_MS); // not past the end
  expect(realAt(reelOf([]), 5)).toBe(0);
  expect(realAt(reelOf([ev(1, 100)]), -50)).toBe(T0 + 100); // before the first: when it began
});

test("a day plays in half a minute at its usual speed, and faster or slower as asked", () => {
  const r = reelOf([ev(1, 0), ev(2, GAP_MS), ev(3, GAP_MS * 2), ev(4, GAP_MS * 3)]);
  expect(paceOf(r)).toBeCloseTo(r.span / (REEL_S * 1000));
  expect(paceOf(r, 4)).toBeCloseTo(4 * paceOf(r));
  expect(paceOf(reelOf([ev(1, 0)]))).toBe(1); // a short one is never slowed below real time
  expect(paceOf(reelOf([]), 2)).toBe(2);
});
