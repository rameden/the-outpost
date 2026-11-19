// The whole map as rings: which ring a run is, where its steps sit on it, and what is joined to what.
import { describe, expect, test } from "vitest";
import { DISC, EDGE, GAP, GATE, MOON, moonsOf, R0, ringsOf, SLOT, type Ring, type RingRun, type Rings } from "./rings.ts";

const line = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1 }));
const diamond = [{ n: 1 }, { n: 2, after: [1] }, { n: 3, after: [1] }, { n: 4, after: [2, 3] }];
const run = (expId: string, thread: string | undefined, steps: RingRun["steps"] = line(2)): RingRun => ({ expId, thread, steps });
const ring = (map: Rings, expId: string) => map.rings.find((x) => x.expId === expId)!;
const fromCentre = (map: Rings, p: { x: number; y: number }) => Math.hypot(p.x - map.c, p.y - map.c);
const lines = (x: Ring) => x.edges.map((e) => `${e.from}>${e.to}@${e.lane}`).sort();

describe("the whole map as rings", () => {
  test("the first run is the innermost ring, and each later one is the next ring out", () => {
    const map = ringsOf([run("A", "A"), run("B", "B"), run("C", "C")]);
    expect(map.rings.map((x) => `${x.expId} ${x.ring}`)).toEqual(["A 1", "B 2", "C 3"]);
    expect(map.rings.map((x) => x.r)).toEqual([R0, R0 + GAP, R0 + 2 * GAP]);
    expect(map.c).toBe(R0 + 2 * GAP + EDGE);
    expect(map.size).toBe(map.c * 2);
    // A run that arrives joins outside the rest: the rings already there keep their size and bearing.
    const more = ringsOf([run("A", "A"), run("B", "B"), run("C", "C"), run("D", "A")]);
    expect(more.rings.slice(0, 3).map((x) => [x.r, x.bearing])).toEqual(map.rings.map((x) => [x.r, x.bearing]));
    expect(ring(more, "D").r).toBe(R0 + 3 * GAP);
  });

  test("a ring is as big as its steps need, and the rings after it are outside it", () => {
    const map = ringsOf([run("A", "A", line(20)), run("B", "B")]);
    const a = ring(map, "A");
    expect(a.r).toBeGreaterThanOrEqual((20 * SLOT + GATE) / (2 * Math.PI));
    expect(ring(map, "B").r).toBe(a.r + GAP);
    // Each waypoint has its room along the ring, the last one round to the ring's number included.
    const round = a.ways.toSorted((p, q) => p.slot - q.slot).map((w) => w.a);
    const arc = (deg: number) => (deg * Math.PI * a.r) / 180;
    for (let i = 1; i < round.length; i++) expect(arc(round[i] - round[i - 1])).toBeGreaterThanOrEqual(SLOT - 0.5);
    expect(arc(a.gate.a + 360 - round.at(-1)!)).toBeGreaterThanOrEqual(SLOT - 0.5);
  });

  test("a run's steps sit on its ring, clockwise from its bearing in the trail's order, all of them on the map", () => {
    const map = ringsOf([run("A", "A", diamond), run("B", "B", line(3))]);
    for (const x of map.rings) for (const w of x.ways) {
      expect(fromCentre(map, w)).toBeCloseTo(x.r, 0);
      expect(w.x - DISC / 2 >= 0 && w.y - DISC / 2 >= 0 && w.x + DISC / 2 <= map.size && w.y + DISC / 2 <= map.size).toBe(true);
    }
    const a = ring(map, "A");
    expect(a.ways.map((w) => `${w.n}@${w.slot}`)).toEqual(["1@0", "2@1", "3@2", "4@3"]);
    expect(a.ways[0].a).toBe(a.bearing);
    expect(a.ways.map((w) => w.a)).toEqual(a.ways.map((w) => w.a).toSorted((p, q) => p - q)); // clockwise
    expect(a.ways.at(-1)!.a - a.bearing).toBeLessThan(360);
    expect(a.ways[3].after).toEqual([2, 3]); // (each still says all it waits for)
    // The first conversation starts at the top; the ring's number sits just before its first step.
    expect(a.bearing).toBe(-90);
    expect(fromCentre(map, a.gate)).toBeCloseTo(a.r, 0);
    expect(a.gate.a).toBeLessThan(a.bearing);
    // A step that can't start until a later-listed one is done still comes after it round the ring.
    const late = ringsOf([run("L", "L", [{ n: 1 }, { n: 2, after: [1] }, { n: 3 }, { n: 4, after: [1, 3] }])]).rings[0];
    expect(late.ways.map((w) => `${w.n}@${w.slot}`)).toEqual(["1@0", "2@2", "3@1", "4@3"]);
  });

  test("the runs of one conversation share a bearing and are joined, each to the one before it; nothing else is", () => {
    // Two conversations (A, then C replying in it later; B with a follow-up), and a job that's in none.
    const map = ringsOf([run("A", "A"), run("B", "B"), run("job", undefined), run("B2", "B"), run("A2", "A"), run("A3", "A"), run("job2", undefined)]);
    expect(map.links.map((l) => `${l.from}>${l.to}`)).toEqual(["B>B2", "A>A2", "A2>A3"]);
    expect(map.rings.map((x) => x.follows)).toEqual([undefined, undefined, undefined, "B", "A", "A2", undefined]);
    const bearing = (id: string) => ring(map, id).bearing;
    expect(bearing("A2")).toBe(bearing("A"));
    expect(bearing("A3")).toBe(bearing("A"));
    expect(bearing("B2")).toBe(bearing("B"));
    expect(new Set(["A", "B", "job", "job2"].map(bearing)).size).toBe(4);
    // A line between two rings runs from one ring's number to the other's.
    const link = map.links.find((l) => l.to === "A3")!, [x1, y1, x2, y2] = [...link.d.matchAll(/-?[\d.]+/g)].map(Number).filter((_, i, all) => i < 2 || i >= all.length - 2);
    expect([x1, y1]).toEqual([ring(map, "A2").gate.x, ring(map, "A2").gate.y]);
    expect([x2, y2]).toEqual([ring(map, "A3").gate.x, ring(map, "A3").gate.y]);
    // Two runs that only happen to be next to each other are not joined.
    expect(ringsOf([run("A", "A"), run("B", "B")]).links).toEqual([]);
    expect(ringsOf([run("j1", undefined), run("j2", undefined)]).links).toEqual([]);
  });

  test("a step is joined to the step it waits for: along the ring to the one next door, across it to one further back", () => {
    expect(lines(ringsOf([run("A", "A", line(3))]).rings[0])).toEqual(["1>2@0", "2>3@0"]);
    // The diamond: 1 → 2 and 3 → 4 are next door; 1 → 3 and 2 → 4 pass a step, and pass each other, so each has its own lane.
    const a = ringsOf([run("A", "A", diamond)]).rings[0];
    expect(lines(a)).toEqual(["1>2@0", "1>3@1", "2>4@2", "3>4@0"]);
    // Along: an arc of the ring itself. Across: an arc inside it, clear of the waypoints between.
    const radii = (d: string) => [...d.matchAll(/A([\d.]+) /g)].map((m) => Number(m[1]));
    expect(radii(a.edges.find((e) => e.to === 2)!.d)).toEqual([a.r]);
    const inside = radii(a.edges.find((e) => e.from === 1 && e.to === 3)!.d)[0], further = radii(a.edges.find((e) => e.from === 2 && e.to === 4)!.d)[0];
    expect(inside).toBeLessThan(a.r - DISC / 2);
    expect(further).toBeLessThan(inside);
    expect(further).toBeGreaterThan(a.r - GAP / 2); // (and nowhere near the ring inside this one)
    // Two lines across that don't pass each other share the nearest lane.
    const two = ringsOf([run("A", "A", [{ n: 1 }, { n: 2 }, { n: 3, after: [1] }, { n: 4 }, { n: 5, after: [3] }, { n: 6, after: [3, 4] }])]).rings[0];
    expect(new Set(two.edges.filter((e) => e.lane > 0).map((e) => e.lane)).size).toBeLessThanOrEqual(2);
    for (const e of [...a.edges, ...two.edges]) expect(e.d + e.tip).not.toMatch(/NaN|Infinity/);
  });

  test("a run with no steps, or one, is still a ring; and no runs is an empty map", () => {
    const map = ringsOf([run("A", "A", []), run("B", "A", line(1))]);
    expect(map.rings.map((x) => [x.ways.length, x.edges.length])).toEqual([[0, 0], [1, 0]]);
    expect(map.rings[1].ways[0].a).toBe(map.rings[1].bearing);
    expect(map.links.map((l) => `${l.from}>${l.to}`)).toEqual(["A>B"]);
    expect(JSON.stringify(map)).not.toMatch(/NaN|null/);
    expect(ringsOf([])).toEqual({ rings: [], links: [], size: 0, c: 0 });
  });

  test("the crew on a step are moons round its waypoint, on the side away from the centre", () => {
    expect(moonsOf(0, 0)).toEqual([]);
    // One: straight out. At three o'clock that is to the right; at the top it is up.
    expect(moonsOf(0, 1)).toEqual([{ dx: DISC / 2 + 5 + MOON / 2, dy: 0 }]);
    expect(moonsOf(-90, 1)[0].dy).toBe(-(DISC / 2 + 5 + MOON / 2));
    // Several fan out either side of straight out, clear of the waypoint and of each other; a fifth starts a row further out.
    const five = moonsOf(0, 5), far = (m: { dx: number; dy: number }) => Math.hypot(m.dx, m.dy);
    expect(five.slice(0, 4).every((m) => m.dx > 0 && far(m) >= DISC / 2 + MOON / 2)).toBe(true);
    expect(five[0].dy).toBeCloseTo(-five[3].dy, 5);
    for (let i = 1; i < 4; i++) expect(Math.hypot(five[i].dx - five[i - 1].dx, five[i].dy - five[i - 1].dy)).toBeGreaterThanOrEqual(MOON);
    expect(far(five[4])).toBeGreaterThanOrEqual(far(five[0]) + MOON);
  });
});
