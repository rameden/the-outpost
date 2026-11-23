import { describe, expect, it } from "vitest";
import { chart, lineAt, toneOf } from "./chart.ts";

describe("the star chart's layout", () => {
  it("puts every outpost on a line of its own, the first nearest the sun", () => {
    const c = chart(["_here", "work", "lab"]);
    expect(c.bodies.map((b) => b.line)).toEqual([0, 1, 2]);
    for (const b of c.bodies) expect(Math.hypot(b.x, b.y)).toBeCloseTo(lineAt(b.line));
  });

  it("leaves everyone where they were when another outpost is made", () => {
    expect(chart(["_here", "work", "lab"]).bodies.slice(0, 2)).toEqual(chart(["_here", "work"]).bodies);
  });

  it("always has a map, and room for everyone on it", () => {
    expect(chart(["_here"]).lines).toBe(3);
    const many = chart(["_here", "a", "b", "c", "d", "e"]);
    expect(many.lines).toBe(6);
    for (const b of many.bodies) expect(Math.hypot(b.x, b.y)).toBeLessThan(many.half);
  });

  it("gives neighbours different colours", () => {
    expect(toneOf(0)).not.toBe(toneOf(1));
    expect(toneOf(6)).toBe(toneOf(0));
  });
});
