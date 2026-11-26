// Spiral, in Orbit's HD view: the sun isn't still. It carries the whole system through space, so each world's
// real path is a corkscrew round the sun's. The camera rides with the sun, and the corkscrew is drawn as a wake: a
// point of light where each world was so many seconds ago, left behind as the system moves on. With it shown the
// worlds aren't all on the one table either: each orbit tips up off it towards the way the system is going, a
// little more and turned a little further round than the one inside it, so they nest like a twisting stack.
// Pure, like frame.ts, which uses it.

import { lapOf, orbitOf } from "@outpost/sdk";
import type { Vec3 } from "./math.ts";
import type { HdPoint } from "./renderer.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// The way the system is going: about 60° off straight up from its table, as our own is tipped to the way the Sun
// goes (up, so each world winds up its corkscrew from below to where it is now); and how fast (units a second).
export const DRIFT: Vec3 = [Math.sin(1.05) * Math.cos(0.6), Math.cos(1.05), Math.sin(1.05) * Math.sin(0.6)];
export const DRIFT_SPEED = 5;
// The wake: how many seconds back it goes, how many points to a lap of it (and fewest to a world), and the sun's spacing.
const WAKE_S = 90, WAKE_PER_LAP = 180, WAKE_MIN = 70, SUN_STEP = 6;
// How far each orbit tips, outwards: of the way from flat on the table to square across the drift, the first this much
// and each after it a step more (no further than the most); and how far round the drift each is turned past the last (radians).
const TIP_FIRST = 0.18, TIP_STEP = 0.045, TIP_MOST = 0.5, TWIST_STEP = 0.14;
// With the worlds off the table there's no one table to mark, so its bearings, rings and rim fade this much of the way out.
export const TABLE_FADE = 0.75;
const WARM: Vec3 = [1, 0.86, 0.62];
const UP: Vec3 = [0, 1, 0];

// A turn in three dimensions, as nine numbers, column by column (as WebGL takes them): where it takes x, y and z.
export type Turn = [number, number, number, number, number, number, number, number, number];
export const NO_TURN: Turn = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const turnBy = (m: Turn, v: Vec3): Vec3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
// v turned round the axis k (of length 1) by the angle whose cosine and sine are c and s.
function about(v: Vec3, k: Vec3, c: number, s: number): Vec3 {
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], x: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [v[0] * c + x[0] * s + k[0] * kv * (1 - c), v[1] * c + x[1] * s + k[1] * kv * (1 - c), v[2] * c + x[2] * s + k[2] * kv * (1 - c)];
}

// Which way is straight up from the i-th orbit out, with so much of the spiral shown (0: straight up, as the table).
export function orbitUp(i: number, spiral: number): Vec3 {
  const on = clamp01(spiral), w = on * Math.min(TIP_MOST, TIP_FIRST + TIP_STEP * i), twist = on * TWIST_STEP * i;
  const n: Vec3 = [DRIFT[0] * w, 1 - w + DRIFT[1] * w, DRIFT[2] * w], len = Math.hypot(...n);
  return about([n[0] / len, n[1] / len, n[2] / len], DRIFT, Math.cos(twist), Math.sin(twist));
}
// The turn that takes the table to that orbit: round the line where the two cross, by the angle between them.
export function orbitTurn(i: number, spiral: number): Turn {
  const n = orbitUp(i, spiral), ax: Vec3 = [n[2], 0, -n[0]], s = Math.hypot(...ax);
  if (s < 1e-9) return NO_TURN;
  const k: Vec3 = [ax[0] / s, 0, ax[2] / s], c = n[1];
  return [...about([1, 0, 0], k, c, s), ...about(UP, k, c, s), ...about([0, 0, 1], k, c, s)] as Turn;
}
// Where the i-th world out is on its orbit (so far round it, in radians), tipped by that orbit's turn.
export const onOrbit = (turn: Turn, i: number, angle: number): Vec3 => { const r = orbitOf(i); return turnBy(turn, [Math.cos(angle) * r, 0, Math.sin(angle) * r]); };

// The sun's own wake: the straight line it has come along, which every world's corkscrew winds round. Starts at its edge.
export function sunWake(spiral: number, from: number): HdPoint[] {
  const points: HdPoint[] = [], long = DRIFT_SPEED * WAKE_S;
  if (spiral > 0.01) for (let d = from; d < long; d += SUN_STEP) {
    const fade = 1 - d / long;
    points.push({ pos: [-DRIFT[0] * d, -DRIFT[1] * d, -DRIFT[2] * d], size: 2.2 + 3 * fade, color: WARM, a: 0.35 * spiral * fade ** 1.5 });
  }
  return points;
}
// A world's wake: where it was each moment back (so far round its orbit then), and where the sun was. Brighter while its crew member works (glow).
export function worldWake(i: number, turn: Turn, angle: number, color: Vec3, glow: number, spiral: number): HdPoint[] {
  const points: HdPoint[] = [];
  if (spiral <= 0.01) return points;
  const lap = lapOf(i), n = Math.max(WAKE_MIN, Math.ceil((WAKE_S / lap) * WAKE_PER_LAP));
  for (let j = 1; j <= n; j++) {
    const back = (j / n) * WAKE_S, behind = DRIFT_SPEED * back, fade = 1 - j / n, was = onOrbit(turn, i, angle - (2 * Math.PI * back) / lap);
    points.push({ pos: [was[0] - DRIFT[0] * behind, was[1] - DRIFT[1] * behind, was[2] - DRIFT[2] * behind], size: 2 + 2 * fade, color, a: (0.5 + 0.6 * glow) * spiral * fade ** 1.2 });
  }
  return points;
}
