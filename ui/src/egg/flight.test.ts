// Barnstorm's arithmetic: the code that starts it, how the plane flies, and where words are.
import { expect, test } from "vitest";
import { EDGE, GUN_AHEAD, KONAMI, THRUST, DRAG, UP, konami, muzzle, newPlane, scoreText, stepPlane, turnBetween, wordAt, wordsIn, type Plane } from "./flight.ts";

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

test("the plane picks up speed under the stick, then glides to a stop", () => {
  const start = newPlane(sky);
  expect([start.x, start.y, start.heading]).toEqual([500, 400, UP]); // the middle of the screen, nose up
  const pushed = fly(start, { x: 1, y: 0 }, 0.3);
  expect(pushed.vx).toBeGreaterThan(200);
  expect(pushed.vx).toBeLessThan(THRUST / DRAG); // it never passes its top speed
  expect(pushed.x).toBeGreaterThan(start.x);
  const gliding = fly(pushed, { x: 0, y: 0 }, 0.2);
  expect(gliding.x).toBeGreaterThan(pushed.x); // still moving with the stick let go
  expect(gliding.vx).toBeLessThan(pushed.vx);
  expect(Math.abs(fly(gliding, { x: 0, y: 0 }, 3).vx)).toBeLessThan(1);
});

test("the nose swings round to the stick the short way, and stays put when you let go", () => {
  const right = fly(newPlane(sky), { x: 1, y: 0 }, 0.5);
  expect(right.heading).toBeCloseTo(0);
  expect(fly(right, { x: 0, y: 0 }, 1).heading).toBeCloseTo(0);
  // From pointing left, down-left is a quarter turn back, not most of the way round.
  const left = { ...newPlane(sky), heading: Math.PI };
  const one = stepPlane(left, { x: -1, y: 1 }, 1 / 60, sky);
  expect(Math.abs(turnBetween(left.heading, one.heading))).toBeLessThan(0.2);
  expect(one.bank).not.toBe(0); // and it rolls into the turn
  expect(turnBetween(fly(left, { x: -1, y: 1 }, 0.5).heading, (3 * Math.PI) / 4)).toBeCloseTo(0);
});

test("the plane stays inside the window", () => {
  const p = fly(newPlane(sky), { x: -1, y: -1 }, 5);
  expect(p.x).toBeCloseTo(EDGE, 0);
  expect(p.y).toBeCloseTo(EDGE, 0);
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
