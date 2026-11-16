// Where everything is in the full-screen view (Orbit.tsx), and how the camera looks at it. All of
// it is plain arithmetic, with nothing of the page in it, so it can be checked by itself.
//
// The drawing is the camp at rest (components/MaeSystem.tsx) with more room in it: the same sun,
// the same contour lines, the same starting places and the same pace round each orbit, but the
// orbits are further apart, so a planet has room for its moons and its name. The stylesheet turns
// the small one; this one is turned from here, a frame at a time, because the camera has to know
// where a planet is to follow it.

import { LAPS, startOf } from "../components/MaeSystem.tsx";

export type Point = { x: number; y: number };

export const SUN_R = 16, PLANET_R = 9.5;
const FIRST = 96, APART = 42; // (the first is far enough out that its planet and its name clear the sun's own name)
export const orbitOf = (i: number) => FIRST + APART * i;
// A line for each of the crew (four at least, as the small one has), and how far out the drawing goes.
export const linesFor = (planets: number) => Math.max(planets, 4);
export const reachOf = (lines: number) => orbitOf(lines - 1) + 40;
// A lap, in seconds. Past the orbits the small drawing has a pace for, each is slower again by as much.
export const lapOf = (i: number) => LAPS[i] ?? LAPS[LAPS.length - 1] * 1.35 ** (i - LAPS.length + 1);
// How far round a planet is (in degrees, clockwise from due right of the sun) after so many seconds.
export const angleAt = (i: number, seconds: number) => (startOf(i) + (360 * seconds) / lapOf(i)) % 360;
export function placeAt(i: number, seconds: number): Point {
  const a = (angleAt(i, seconds) * Math.PI) / 180, r = orbitOf(i);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// How something sets off and arrives: slowly at each end (0 → 1).
export const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

// ---------- The camera ----------
// It looks at a point of the drawing (x, y) and shows it k times its size. `centre` is where on the
// screen that point lands: the middle, or to one side of it while a panel is open.
export type Camera = Point & { k: number };

export const toScreen = (cam: Camera, centre: Point, p: Point): Point => ({ x: centre.x + (p.x - cam.x) * cam.k, y: centre.y + (p.y - cam.y) * cam.k });
export const toWorld = (cam: Camera, centre: Point, s: Point): Point => ({ x: cam.x + (s.x - centre.x) / cam.k, y: cam.y + (s.y - centre.y) / cam.k });

// The zoom at which the whole system fits the screen, with room left for the bars above and below it.
export function fitZoom(width: number, height: number, lines: number): number {
  const room = Math.max(120, Math.min(width - 48, height - 190));
  return room / (2 * reachOf(lines));
}
// The zoom for looking at one planet: it and a little of what's round it.
export const closeZoom = (width: number, height: number) => Math.max(2.4, Math.min(width, height) / 150);

// Zoom is kept as a multiple of the fit (1: the whole system), so it means the same on any screen.
export const ZOOM_MIN = 0.5, ZOOM_MAX = 16;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// Zoom in or out about a point on the screen (the pointer), so what's under it stays under it.
export function zoomAbout(cam: Camera, centre: Point, at: Point, k: number): Camera {
  const under = toWorld(cam, centre, at);
  return { k, x: under.x - (at.x - centre.x) / k, y: under.y - (at.y - centre.y) / k };
}

// Keep the camera within sight of the system: no further from the sun than its edge.
export function withinReach(p: Point, reach: number): Point {
  const d = Math.hypot(p.x, p.y);
  return d <= reach ? p : { x: (p.x * reach) / d, y: (p.y * reach) / d };
}

// What a press on the screen lands on: the nearest body whose disc (or a finger's width, if the
// disc is smaller than that) is under it.
export type Spot = Point & { id: string; r: number };
export function hit(spots: Spot[], at: Point, finger = 18): string | null {
  let best: string | null = null, nearest = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - at.x, s.y - at.y);
    if (d <= Math.max(s.r, finger) && d < nearest) { nearest = d; best = s.id; }
  }
  return best;
}
