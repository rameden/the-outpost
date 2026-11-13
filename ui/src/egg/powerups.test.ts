// Barnstorm's power-ups: which crate turns up and where, taking one, and what each changes.
import { expect, test } from "vitest";
import {
  BLAST, BOOM, CRATE_BLINK, CRATE_LIFE, PICKUP, POWERS, SPREAD, activeText, blastPoints, newCrate, pickKind, shotAngles, showing, tick, touching,
  type Crate, type PowerKind,
} from "./powerups.ts";

const sky = { width: 1000, height: 800 };

test("every kind of crate turns up, the commoner ones more often", () => {
  const seen: Record<string, number> = {};
  for (let i = 0; i < 1500; i++) { const k = pickKind(() => (i + 0.5) / 1500); seen[k] = (seen[k] ?? 0) + 1; }
  expect(seen).toEqual({ spread: 300, rapid: 300, big: 300, boom: 200, tea: 200, bomb: 200 });
  expect(pickKind(() => 0.999999)).toBe("bomb");
});

test("a crate lands over the page, clear of the edges and of the score card", () => {
  for (let i = 0; i < 200; i++) {
    const rolls = [0.1, (i % 20) / 20, Math.floor(i / 20) / 10];
    const c = newCrate(sky, () => rolls.shift() ?? 0.5);
    expect(c.x).toBeGreaterThanOrEqual(60);
    expect(c.x).toBeLessThanOrEqual(sky.width - 60);
    expect(c.y).toBeGreaterThanOrEqual(80);
    expect(c.y).toBeLessThanOrEqual(sky.height - 60);
    expect(c.x < 300 && c.y > sky.height - 280).toBe(false); // not under the card
    expect([c.kind, c.age]).toEqual(["spread", 0]);
  }
});

test("flying through a crate takes it; passing by doesn't", () => {
  const crate: Crate = { kind: "rapid", x: 400, y: 300, age: 0 };
  expect(touching({ x: 400 + PICKUP - 1, y: 300 }, crate)).toBe(true);
  expect(touching({ x: 400, y: 300 + PICKUP + 1 }, crate)).toBe(false);
});

test("a crate waits, then blinks before it's gone", () => {
  const at = (age: number): Crate => ({ kind: "tea", x: 0, y: 0, age });
  expect(showing(at(1))).toBe(true);
  expect(showing(at(CRATE_LIFE - CRATE_BLINK - 0.01))).toBe(true);
  const last = Array.from({ length: 20 }, (_, i) => showing(at(CRATE_LIFE - CRATE_BLINK + i * (CRATE_BLINK / 20))));
  expect(last.includes(true) && last.includes(false)).toBe(true);
});

test("the spread fires a fan of three; otherwise it's one shot dead ahead", () => {
  expect(shotAngles(1, false)).toEqual([1]);
  expect(shotAngles(1, true)).toEqual([1 - SPREAD, 1, 1 + SPREAD]);
});

test("the timed power-ups count down and run out, and the score card says what's running", () => {
  let active = { spread: POWERS.spread.lasts, tea: 0.5 };
  expect(activeText(active)).toBe("Spread 8s · Tea break 1s");
  active = tick(active, 0.4) as typeof active;
  expect(activeText(active)).toBe("Spread 8s · Tea break 1s"); // 7.6s and 0.1s left: whole seconds, rounded up
  active = tick(active, 0.2) as typeof active;
  expect(active).toEqual({ spread: expect.closeTo(7.4, 5) });
  expect(activeText(active)).toBe("Spread 8s");
  expect(activeText(tick(active, 60))).toBe("");
  expect(activeText({ boom: 3, big: 2.5, rapid: 1 })).toBe("Rapid 1s · Big shots 3s · Exploding 3s"); // always in the same order
  expect(POWERS.bomb.lasts).toBe(0); // the bomb is over at once: nothing to count down
});

test("a bomb reaches everything within its blast, and nothing outside the window", () => {
  const pts = blastPoints(500, 400, sky);
  expect(pts.length).toBeGreaterThan(800);
  // An exploding shot's is the same thing, smaller.
  const small = blastPoints(500, 400, sky, BOOM);
  expect(small.length).toBeGreaterThan(80);
  expect(small.every((p) => Math.hypot(p.x - 500, p.y - 400) <= BOOM)).toBe(true);
  expect(pts.every((p) => Math.hypot(p.x - 500, p.y - 400) <= BLAST)).toBe(true);
  expect(pts.some((p) => Math.hypot(p.x - 500, p.y - 400) < 5)).toBe(true); // the middle too (the grid is 6px)
  expect(pts.some((p) => Math.hypot(p.x - 500, p.y - 400) > BLAST - 8)).toBe(true); // right out to the rim
  const corner = blastPoints(10, 10, sky);
  expect(corner.length).toBeGreaterThan(0);
  expect(corner.every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
});

test("each power-up has a name, a colour and a five-by-five picture for its crate", () => {
  for (const k of Object.keys(POWERS) as PowerKind[]) {
    const p = POWERS[k];
    expect(p.name).toBeTruthy();
    expect(p.glyph.length).toBe(5);
    expect(p.glyph.every((row) => row.length === 5)).toBe(true);
    expect(p.color).not.toBe(p.ink);
  }
});
