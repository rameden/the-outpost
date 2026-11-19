// Where the stars go: the same memory always makes the same map.
import { expect, test } from "vitest";
import { layout, seeded, starSize, type LayEdge, type LayNode } from "./layout.ts";

const nodes: LayNode[] = [
  ...Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, where: "agent:scribe", recalls: i % 5 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, where: "agent:scout", recalls: 0 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, where: "project:atlas", recalls: i * 9 })),
  { id: "a0", where: "about", recalls: 2 },
];
const edges: LayEdge[] = [{ a: "s0", b: "s1" }, { a: "s2", b: "s9" }, { a: "s3", b: "q1" }, { a: "p0", b: "p2" }];
const flat = (l: ReturnType<typeof layout>) => [...l.stars].sort(([a], [b]) => a.localeCompare(b));

test("the same lines make the same map, whatever order they arrive in", () => {
  const one = layout(nodes, edges), two = layout(nodes, edges);
  expect(flat(two)).toEqual(flat(one));
  expect(two.clusters).toEqual(one.clusters);
  // Shuffled within their places (the places keep their order), and the joins the other way round.
  const mixed = [...nodes].reverse().sort((a, b) => nodes.findIndex((n) => n.where === a.where) - nodes.findIndex((n) => n.where === b.where));
  const three = layout(mixed, [...edges].reverse().map((e) => ({ a: e.a, b: e.b })));
  expect(flat(three)).toEqual(flat(one));
  expect(seeded("s0")).toBe(seeded("s0"));
  expect(seeded("s0")).not.toBe(seeded("s1"));
});

test("every star stays inside its own place, the places don't overlap, and stars don't sit on each other", () => {
  const l = layout(nodes, edges);
  expect(l.stars.size).toBe(nodes.length);
  expect(l.clusters.map((c) => [c.where, c.count])).toEqual([["agent:scribe", 14], ["agent:scout", 6], ["project:atlas", 3], ["about", 1]]);
  for (const n of nodes) {
    const s = l.stars.get(n.id)!, c = l.clusters.find((c) => c.where === n.where)!;
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    expect(Math.hypot(s.x - c.x, s.y - c.y) + s.r).toBeLessThanOrEqual(c.r + 0.01);
    expect(Math.hypot(c.x, c.y) + c.r).toBeLessThanOrEqual(l.extent + 0.01);
  }
  for (const p of l.clusters) for (const q of l.clusters) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
  for (const a of nodes) for (const b of nodes) {
    if (a.id >= b.id || a.where !== b.where) continue;
    const p = l.stars.get(a.id)!, q = l.stars.get(b.id)!;
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
  }
});

test("a star grows with how often its line was used, but never without end", () => {
  expect(starSize(0)).toBe(4);
  expect(starSize(1)).toBeGreaterThan(starSize(0));
  expect(starSize(9)).toBeGreaterThan(starSize(4));
  expect(starSize(500)).toBe(starSize(36));
  expect(starSize(-3)).toBe(4);
  const l = layout(nodes, []);
  expect(l.stars.get("p2")!.r).toBeGreaterThan(l.stars.get("p0")!.r);
});

test("one place sits in the middle, and nothing at all is an empty map", () => {
  const one = layout([{ id: "x", where: "about", recalls: 0 }], []);
  expect(one.clusters).toHaveLength(1);
  expect([one.clusters[0].x, one.clusters[0].y]).toEqual([0, 0]);
  const none = layout([], []);
  expect(none.stars.size).toBe(0);
  expect(none.clusters).toEqual([]);
  expect(none.extent).toBe(0);
});
