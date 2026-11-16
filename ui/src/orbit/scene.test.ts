// Where everything is in the full-screen view, and how the camera looks at it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LAPS, startOf } from "../components/MaeSystem.tsx";
import { PLANET_R, ZOOM_MAX, ZOOM_MIN, angleAt, clampZoom, closeZoom, fitZoom, hit, lapOf, linesFor, orbitOf, placeAt, reachOf, toScreen, toWorld, withinReach, zoomAbout } from "./scene.ts";

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");

test("it is the small drawing with more room: the same starting places and the same pace round each orbit", () => {
  for (let i = 0; i < LAPS.length; i++) {
    expect(angleAt(i, 0)).toBe(startOf(i));
    expect(lapOf(i)).toBe(LAPS[i]);
    // …which is the pace the stylesheet turns the small one at.
    expect(css).toContain(`.sys-o${i + 1} { animation-duration: ${LAPS[i]}s;`);
    // A lap later it is back where it began, and half a lap later it is across the sun from there.
    expect(angleAt(i, lapOf(i))).toBeCloseTo(startOf(i));
    expect(angleAt(i, lapOf(i) / 2)).toBeCloseTo((startOf(i) + 180) % 360);
  }
  // The orbits are further apart than a planet and its moons are wide.
  expect(orbitOf(1) - orbitOf(0)).toBeGreaterThan(2 * (PLANET_R + 7));
});

test("a planet is always on its own orbit, and someone beyond the seventh still has one, slower again", () => {
  for (const i of [0, 3, 6, 9]) for (const t of [0, 7.5, 300]) {
    const p = placeAt(i, t);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(orbitOf(i));
  }
  expect(lapOf(7)).toBeGreaterThan(lapOf(6));
  expect(lapOf(8)).toBeGreaterThan(lapOf(7));
  expect(linesFor(0)).toBe(4); // an empty system still has its map
  expect(linesFor(6)).toBe(6);
  expect(reachOf(4)).toBeGreaterThan(orbitOf(3));
});

test("the whole system fits the screen, and a planet looked at closely is several times that", () => {
  for (const [w, h, lines] of [[1440, 900, 4], [1440, 900, 7], [390, 780, 4]] as const) {
    const k = fitZoom(w, h, lines);
    expect(2 * reachOf(lines) * k).toBeLessThanOrEqual(Math.min(w, h));
    expect(closeZoom(w, h)).toBeGreaterThan(k * 1.5);
  }
  expect(clampZoom(0.01)).toBe(ZOOM_MIN);
  expect(clampZoom(400)).toBe(ZOOM_MAX);
  expect(clampZoom(2)).toBe(2);
});

test("the camera: the screen and the drawing map onto each other, and zooming keeps what's under the pointer under it", () => {
  const cam = { x: 40, y: -25, k: 2 }, centre = { x: 500, y: 300 };
  expect(toScreen(cam, centre, { x: 40, y: -25 })).toEqual(centre); // what it looks at is in the middle
  const there = { x: 90, y: 10 };
  const back = toWorld(cam, centre, toScreen(cam, centre, there));
  expect(back.x).toBeCloseTo(there.x); expect(back.y).toBeCloseTo(there.y);
  const pointer = { x: 720, y: 140 }, under = toWorld(cam, centre, pointer);
  const closer = zoomAbout(cam, centre, pointer, 7);
  expect(closer.k).toBe(7);
  const still = toScreen(closer, centre, under);
  expect(still.x).toBeCloseTo(pointer.x); expect(still.y).toBeCloseTo(pointer.y);
  // It can't be dragged out of sight of the system.
  expect(withinReach({ x: 10, y: 10 }, 200)).toEqual({ x: 10, y: 10 });
  const edge = withinReach({ x: 3000, y: 4000 }, 200);
  expect(Math.hypot(edge.x, edge.y)).toBeCloseTo(200);
});

test("a press lands on the nearest body under it: a small one still has a finger's width", () => {
  const spots = [{ id: "quartermaster", x: 500, y: 300, r: 40 }, { id: "scout", x: 560, y: 300, r: 4 }, { id: "scribe", x: 900, y: 300, r: 30 }];
  expect(hit(spots, { x: 505, y: 310 })).toBe("quartermaster");
  expect(hit(spots, { x: 552, y: 300 })).toBe("scout"); // inside the sun's disc too, but nearer the planet
  expect(hit(spots, { x: 574, y: 300 })).toBe("scout"); // off its 4px disc, within a finger of it
  expect(hit(spots, { x: 925, y: 310 })).toBe("scribe");
  expect(hit(spots, { x: 740, y: 80 })).toBe(null);
});
