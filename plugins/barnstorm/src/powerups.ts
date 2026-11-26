// Barnstorm's power-ups: crates that turn up over the page once the shooting has started (and
// now and then fall out of a builder that's been shot). Fly through one to take it:
//   spread   three shots in a fan instead of one, for a while;
//   rapid    the gun fires twice as fast, for a while;
//   big      big shots: each one is wide enough to take out everything across its path at once;
//   boom     exploding shots: each one goes off where it lands, taking what's around it too;
//   tea      tea break: the builders down tools, and no more turn out, for a while;
//   bomb     goes off where it's picked up, taking out everything within its blast.
// A crate left alone blinks and is gone. The timed ones stack, and taking one you already
// have starts its time again.
//
// Only arithmetic here, as in flight.ts: the game (Barnstorm.tsx) does what each one says.

import type { Plane, Sky } from "./flight.ts";

export type PowerKind = "spread" | "rapid" | "big" | "boom" | "tea" | "bomb";
export type Timed = Exclude<PowerKind, "bomb">;

// What each is called, how long it lasts (seconds; the bomb is over at once), its crate's
// colour and picture (5 by 5), and how often it's the one that turns up.
export const POWERS: Record<PowerKind, { name: string; lasts: number; color: string; ink: string; glyph: string[]; weight: number }> = {
  spread: { name: "Spread", lasts: 8, color: "#d8402f", ink: "#ffffff", weight: 3, glyph: ["X.X.X", "X.X.X", ".XXX.", "..X..", "..X.."] },
  rapid: { name: "Rapid", lasts: 8, color: "#f0c040", ink: "#16233f", weight: 3, glyph: ["..X..", ".X.X.", "X.X.X", ".X.X.", "X...X"] },
  big: { name: "Big shots", lasts: 8, color: "#7a4bd6", ink: "#ffffff", weight: 3, glyph: [".XXX.", "XXXXX", "XXXXX", "XXXXX", ".XXX."] },
  boom: { name: "Exploding", lasts: 8, color: "#e8792a", ink: "#ffffff", weight: 2, glyph: ["X.X.X", ".XXX.", "XXXXX", ".XXX.", "X.X.X"] },
  tea: { name: "Tea break", lasts: 6, color: "#2f9c95", ink: "#ffffff", weight: 2, glyph: [".X.X.", ".....", "XXXX.", "XXXXX", "XXXX."] },
  bomb: { name: "Bomb", lasts: 0, color: "#3a3f4b", ink: "#ffd84a", weight: 2, glyph: ["...X.", "..X..", ".XXX.", "XXXXX", ".XXX."] },
};
const KINDS = Object.keys(POWERS) as PowerKind[];

export const CRATE = 9; // a crate's side, in the plane's pixels (flight.ts PIXEL)
export const CRATE_LIFE = 10; // seconds a crate waits to be taken
export const CRATE_BLINK = 2.5; // …the last of which it spends blinking
export const CRATE_MAX = 2; // how many wait at once (ones dropped by builders come on top)
export const FIRST_CRATE = 5; // seconds after the first hit
export const CRATE_EVERY = 9; // seconds between crates after that, give or take
export const DROP_CHANCE = 0.25; // that a shot builder leaves one behind
export const PICKUP = 26; // how near the plane's middle has to come to a crate's
export const SPREAD = 0.2; // radians between the fan's shots
export const RAPID_RATE = 0.5; // of the usual gap between shots
export const BLAST = 110; // the bomb's reach, px
export const BOOM = 38; // an exploding shot's
export const BIG_ACROSS = [-12, -6, 6, 12]; // where else a big shot hits, either side of its middle, px

export type Crate = { kind: PowerKind; x: number; y: number; age: number };
export type Active = Partial<Record<Timed, number>>; // seconds left of each

// Which power-up the next crate holds: the weights above, on one roll.
export function pickKind(rand: () => number = Math.random): PowerKind {
  const total = KINDS.reduce((n, k) => n + POWERS[k].weight, 0);
  let roll = rand() * total;
  for (const k of KINDS) { roll -= POWERS[k].weight; if (roll < 0) return k; }
  return KINDS[KINDS.length - 1];
}

// A crate somewhere over the page: clear of the window's edges, and of the bar along the bottom.
export function newCrate(sky: Sky, rand: () => number = Math.random): Crate {
  const kind = pickKind(rand);
  const x = 60 + rand() * Math.max(0, sky.width - 120);
  const y = 80 + rand() * Math.max(0, sky.height - 140);
  return { kind, x, y, age: 0 };
}

export const touching = (plane: Pick<Plane, "x" | "y">, crate: Crate) => Math.hypot(plane.x - crate.x, plane.y - crate.y) <= PICKUP;
// Whether a crate is showing this instant: steadily, then blinking as its time runs out.
export const showing = (crate: Crate) => crate.age < CRATE_LIFE - CRATE_BLINK || Math.floor(crate.age * 8) % 2 === 0;

// The directions the gun fires in: straight ahead, or a fan of three with the spread.
export const shotAngles = (heading: number, spread: boolean) => (spread ? [heading - SPREAD, heading, heading + SPREAD] : [heading]);

// The timed power-ups, a moment later: each counts down, and is dropped when it runs out.
export function tick(active: Active, dt: number): Active {
  const next: Active = {};
  for (const k of Object.keys(active) as Timed[]) { const left = active[k]! - dt; if (left > 0) next[k] = left; }
  return next;
}

// What's running, for the bar: "SPREAD 7s · RAPID 3s".
export const activeText = (active: Active) =>
  (Object.keys(POWERS) as PowerKind[]).filter((k): k is Timed => k !== "bomb" && !!active[k]).map((k) => `${POWERS[k].name} ${Math.ceil(active[k]!)}s`).join(" · ");

// The points a bomb at (x, y) reaches: a grid across its blast, inside the window.
export function blastPoints(x: number, y: number, sky: Sky, reach = BLAST, every = 6): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = -reach; dy <= reach; dy += every) for (let dx = -reach; dx <= reach; dx += every) {
    const px = x + dx, py = y + dy;
    if (dx * dx + dy * dy <= reach * reach && px >= 0 && py >= 0 && px < sky.width && py < sky.height) out.push({ x: px, y: py });
  }
  return out;
}
