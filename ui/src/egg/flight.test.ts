// Barnstorm's arithmetic: the code that starts it, how the plane flies, and where words are.
import { expect, test } from "vitest";
import { EDGE, GUN_AHEAD, KONAMI, THRUST, DRAG, TURN, UP, konami, muzzle, newPlane, scoreText, stepPlane, wordAt, wordsIn, type Plane } from "./flight.ts";

const sky = { width: 1000, height: 800 };
const fly = (p: Plane, stick: { x: number; y: number }, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) p = stepPlane(p, stick, 1 / 60, sky);
  return p;
};

test("the Konami code starts it: only the whole code, in order", () => {
  const next = konami();
  expect(KONAMI.slice(0, -1).map(next)).toEqual(Array(9).fill(false));
  expect(next("a")).toBe(true);
  // A wrong key anywhere starts the count again.
  expect([...KONAMI.slice(0, 5), "x", ...KONAMI.slice(5)].map(next).includes(true)).toBe(false);
  // Capitals count (caps lock), and an extra ↑ at the start doesn't spoil it.
  expect(["ArrowUp", ...KONAMI.slice(0, 8), "B", "A"].map(next).at(-1)).toBe(true);
});

const speed = (p: Plane) => Math.hypot(p.vx, p.vy);
const GO = { x: 0, y: -1 }, COAST = { x: 0, y: 0 }, BRAKING = { x: 0, y: 1 }, LEFT = { x: -1, y: 0 }, RIGHT = { x: 1, y: 0 };

test("↑ is the throttle: it drives the plane the way its nose points, and it glides on when you let go", () => {
  const start = newPlane(sky);
  expect([start.x, start.y, start.heading, speed(start)]).toEqual([500, 400, UP, 0]); // the middle of the screen, nose up, standing still
  const going = fly(start, GO, 0.4);
  expect(going.y).toBeLessThan(start.y - 20); // up the screen, where the nose is
  expect(going.x).toBeCloseTo(start.x);
  expect(going.vy).toBeLessThan(-200);
  expect(speed(fly(start, GO, 10))).toBeLessThanOrEqual(THRUST / DRAG); // it never passes its top speed
  // Pointing right, the same key goes right.
  const east = fly({ ...start, heading: 0 }, GO, 0.4);
  expect(east.x).toBeGreaterThan(start.x + 20);
  expect(east.y).toBeCloseTo(start.y);

  const gliding = fly(going, COAST, 0.3);
  expect(gliding.y).toBeLessThan(going.y); // still moving with the throttle shut
  expect(speed(gliding)).toBeLessThan(speed(going));
  expect(speed(gliding)).toBeGreaterThan(speed(going) / 2);
  expect(speed(fly(gliding, COAST, 6))).toBeLessThan(1);
});

test("↓ is the brake: it slows the plane much faster than letting go, and never backs it up", () => {
  const going = fly(newPlane(sky), GO, 0.6);
  const coasted = fly(going, COAST, 0.3), braked = fly(going, BRAKING, 0.3);
  expect(speed(braked)).toBeLessThan(speed(coasted) / 2);
  expect(braked.vy).toBeLessThanOrEqual(0); // slower, but still the way it was going
  const stopped = fly(going, BRAKING, 3);
  expect(speed(stopped)).toBeLessThan(1);
  expect(stopped.y).toBeLessThan(going.y); // it stopped further on, not back where it came from
  // From a standstill the brake does nothing at all.
  expect(fly(newPlane(sky), BRAKING, 1)).toMatchObject({ x: 500, y: 400, vx: 0, vy: 0 });
});

test("← and → turn the plane, standing still or moving, and it holds its course when you let go", () => {
  const start = newPlane(sky);
  // On the spot: the nose comes round, and the plane goes nowhere.
  const frames = (p: Plane, stick: { x: number; y: number }, n: number) => { for (let i = 0; i < n; i++) p = stepPlane(p, stick, 1 / 60, sky); return p; };
  const right = frames(start, RIGHT, 15), left = frames(start, LEFT, 15); // a quarter of a second each
  expect(right.heading).toBeCloseTo(UP + TURN * 0.25); // → is clockwise on the screen
  expect(left.heading).toBeCloseTo(UP - TURN * 0.25);
  expect([right.x, right.y, speed(right)]).toEqual([500, 400, 0]);
  expect(right.bank).toBeGreaterThan(0); // and it rolls into the turn
  expect(left.bank).toBeLessThan(0);
  expect(fly(right, COAST, 1).heading).toBe(right.heading);
  expect(Math.abs(fly(right, COAST, 1).bank)).toBeLessThan(0.01); // wings level again

  // Under way: a quarter turn to the right takes its momentum round with it.
  const north = fly(start, GO, 0.6);
  const turned = fly(north, { x: 1, y: -1 }, Math.PI / 2 / TURN);
  expect(turned.heading).toBeCloseTo(0, 1); // nose right
  expect(turned.vx).toBeGreaterThan(200); // and now that's the way it's going…
  expect(Math.abs(turned.vy)).toBeLessThan(turned.vx / 2); // …with only a little of the old way left, sliding wide
  expect(turned.x).toBeGreaterThan(north.x);
  // Let everything go and it carries on along the nose, not back the way it was.
  const on = fly(turned, COAST, 0.5);
  expect(on.x).toBeGreaterThan(turned.x);
  const slide = (p: Plane) => Math.abs(p.vy * Math.cos(p.heading) - p.vx * Math.sin(p.heading)); // speed across the way it points
  expect(slide(turned)).toBeGreaterThan(20); // it was swinging wide coming out of the turn…
  expect(slide(on)).toBeLessThan(1); // …and that's gone: all its speed is along the nose
});

test("the plane stays inside the window", () => {
  const top = fly(newPlane(sky), GO, 5); // straight up, into the top edge
  expect(top.y).toBeCloseTo(EDGE, 0);
  expect(top.x).toBeCloseTo(500);
  const corner = fly({ ...newPlane(sky), heading: Math.PI * 0.75 }, GO, 6); // down and to the left
  expect(corner.x).toBeCloseTo(EDGE, 0);
  expect(corner.y).toBeCloseTo(800 - EDGE, 0);
  // Round and round at full throttle never gets out either.
  let p = newPlane({ width: 300, height: 200 });
  for (let i = 0; i < 600; i++) {
    p = stepPlane(p, { x: 1, y: -1 }, 1 / 60, { width: 300, height: 200 });
    expect(p.x >= EDGE && p.x <= 300 - EDGE && p.y >= EDGE && p.y <= 200 - EDGE).toBe(true);
  }
});

test("the gun is in the nose: shots leave dead ahead of the plane's middle", () => {
  const up = muzzle({ ...newPlane(sky), heading: UP });
  expect(up.x).toBeCloseTo(500); // on the plane's own line, so what the nose points at is what's hit
  expect(up.y).toBeCloseTo(400 - GUN_AHEAD);
  const right = muzzle({ ...newPlane(sky), heading: 0 });
  expect(right.x).toBeCloseTo(500 + GUN_AHEAD);
  expect(right.y).toBeCloseTo(400);
});

test("a word is whatever's between the spaces around the caret", () => {
  const text = "Reply in  this…";
  expect(wordAt(text, 0)).toEqual([0, 5]);
  expect(wordAt(text, 5)).toEqual([0, 5]); // just after its last letter still touches it
  expect(wordAt(text, 6)).toEqual([6, 8]);
  expect(wordAt(text, 9)).toBeNull(); // between two spaces
  expect(wordAt(text, text.length)).toEqual([10, 15]);
  expect(wordAt("   ", 1)).toBeNull();
  expect(wordsIn(text)).toEqual([[0, 5], [6, 8], [10, 15]]);
});

test("the score is six figures", () => {
  expect(scoreText(0)).toBe("000000");
  expect(scoreText(1250)).toBe("001250");
});
