// The Sortie: Barnstorm's other game. A top-down shooter flown over the page itself. Your plane
// keeps its nose to the top of the screen: the arrows slide it about (eight ways), and the
// guns only ever fire straight ahead, so aiming is flying. Enemy aircraft come in formations,
// each along a flight path you can learn: in from one side, banking across your line of fire,
// and away. They shoot slow, bright rounds aimed at where you are, so the game is to slide in
// under a formation's turn, fire a burst, and be gone before the answer arrives.
//
// One hit (a round, or a collision) costs a life, unless you have wingmen: then it costs one of
// them, so with both it's the third hit that takes the plane. The way out of a bad spot is the
// loop: the plane pulls up and over whatever was about to hit it, and comes back down level.
// You get a few a stage, so when to spend one matters.
//
// What flies against you (ENEMY, below):
//   scout      the formations: one hit each, a round or two as they bank past.
//   heavy      a bomber that prowls the top of the screen, firing threes; it takes a lot of hits.
//   ferry      slow, yellow, unarmed: shoot it for a crate of two wingmen (or another loop).
//   dart       lines up on you from the top (you can see it doing it), then dives straight at where you were.
//   ace        comes down, follows you from side to side firing pairs, and leaves when it's had enough.
//   mine       drifts down in your way. Shot, it goes off in a ring of rounds: better from a distance.
//   hauler     lumbers across firing; shot down, it spills three drones that scatter.
//   carrier    an aircraft carrier, steaming down the screen under everything else. It launches
//              scouts off its deck at you and has a gun at each end; you fly over it, and it takes
//              a lot of sinking. Sunk, it leaves a crate.
//   leader     at the head of some scout flights, gold-striped. While it flies, its flight holds
//              its line and fires in volleys on its word; shoot it first and the rest scatter in a
//              panic, worth half and firing nothing.
//   chaser     comes up from the bottom of the screen, behind you (a warning shows where), climbing
//              up your column; past you, it fires back down on its way out. Sidestep it or loop.
//   gunship    armoured across the nose, which it keeps turned towards you: rounds from straight
//              below glance off. Dash under it from the side and hit it before it turns back.
//   boat       a missile boat on the water, like the carrier: it fires slow missiles that home in
//              on you. Shoot the missiles down for points (and the chain).
//   flagship   ends every stage: back and forth along the top with two guns' worth of patterns,
//              faster once it's half done for.
//
// And what's in the sky besides (a stage's hazards, rolled along with its formations):
//   clouds     drift down through it. Inside one, they can't see you: they fire at where you went
//              in, not where you are. (You can't see what's inside one either.)
//   flak       a patch of sky is marked where you are, and goes off a moment later; a few in a row.
//              Loop through one as it goes off for a bonus.
//   balloons   barrage balloons, on cables: they stop your rounds and hurt to touch. Cut the
//              cable (dead centre under it) and it floats off, and leaves a crate.
//
// Each stage but the first rolls a twist, too (TWISTS, below): night, a headwind, an ace squadron…
// And after each flagship you pick one of three upgrades (PERKS) for the rest of the run.
//
// And the rules that make a score:
//   chain      kills in quick succession multiply what each is worth, up to five times.
//   flights    shoot down every aircraft of a formation and there's a bonus, and a crate: better
//              guns (wider, then faster), or a medal once the guns are as good as they get.
//   planes     an extra one every so many points; and a bonus for a stage flown without losing one.
//
// They aren't stupid about it (the "smarter" bits are marked below): they shoot ahead of the
// way you're moving, more so in later stages; a formation that has lost one breaks its line so
// it can't be raked; a scout whose path you're sitting under takes a snap shot at you; the ace
// keeps to one side of your guns and jinks out of the way of a burst; mines drift across to
// where you are; and the flagship, once it's hurt, lays a wall of rounds with one gap in it.
//
// A stage ends when its flagship is down, with the score and how much of what flew in you
// shot down.
//
// Only arithmetic here, as in flight.ts: Sortie.tsx draws it and reads the keys.

import type { Sky } from "./flight.ts";

export type Field = Sky; // the play area (the window, above the bar), in pixels: x across, y down
export type Pt = { x: number; y: number };

// ---------- Flight paths ----------
// Each is a curve through a few points, in shares of the field (0,0 top-left; 1,1 bottom-right;
// a little outside is off-screen), flown in `lasts` seconds. `fires`: how far along (0 to 1) a
// plane on it shoots. Any of them can be flown mirrored, left for right.
export type PathName = "sweep" | "dive" | "hook" | "cross" | "weave" | "prowl" | "ferry" | "haul";
export const PATHS: Record<PathName, { points: [number, number][]; lasts: number; fires: number[] }> = {
  // In from the upper left, banking down across the middle (your firing lane), and peeling away to the upper right.
  sweep: { points: [[-0.14, 0.06], [0.16, 0.2], [0.5, 0.44], [0.84, 0.26], [1.14, 0.04]], lasts: 4.4, fires: [0.5] },
  // Straight down the left side, then a hard turn out low to the right.
  dive: { points: [[0.22, -0.12], [0.22, 0.3], [0.3, 0.6], [0.58, 0.76], [1.14, 0.66]], lasts: 4.6, fires: [0.3] },
  // Down the right, round in a hook, and back up the way it came.
  hook: { points: [[0.82, -0.12], [0.8, 0.42], [0.62, 0.66], [0.42, 0.46], [0.36, -0.14]], lasts: 5, fires: [0.28, 0.62] },
  // A long climb across from the left edge, low to high.
  cross: { points: [[-0.14, 0.52], [0.3, 0.4], [0.7, 0.3], [1.14, 0.1]], lasts: 3.8, fires: [0.45] },
  // Side to side all the way down the screen and off the bottom.
  weave: { points: [[0.5, -0.12], [0.24, 0.2], [0.76, 0.44], [0.24, 0.68], [0.5, 1.14]], lasts: 6, fires: [0.25, 0.55] },
  // The heavy's: down to the top of the screen, back and forth along it, and away.
  prowl: { points: [[0.5, -0.18], [0.5, 0.18], [0.2, 0.22], [0.8, 0.22], [0.3, 0.2], [0.5, -0.22]], lasts: 12, fires: [0.15, 0.3, 0.45, 0.6, 0.75] },
  // The ferry's: slowly across the top. It doesn't shoot.
  ferry: { points: [[-0.14, 0.14], [0.5, 0.2], [1.14, 0.14]], lasts: 6.5, fires: [] },
  // The hauler's: slower still, and lower, where it's in the way.
  haul: { points: [[-0.16, 0.3], [0.5, 0.36], [1.16, 0.3]], lasts: 8.5, fires: [0.3, 0.6] },
};

// The point a share `u` (0 to 1) of the way along a curve through `points` (a Catmull-Rom spline: it
// passes through every point, and bends smoothly between them, which is what makes a bank look like one).
export function along(points: [number, number][], u: number): Pt {
  const n = points.length - 1;
  const s = Math.max(0, Math.min(1, u)) * n;
  const i = Math.min(n - 1, Math.floor(s)), t = s - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n, i + 2)];
  const at = (k: 0 | 1) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t * t * t);
  return { x: at(0), y: at(1) };
}

// Where a plane on a path is, in the field's pixels, and which way it's pointing.
export function onPath(name: PathName, u: number, mirror: boolean, field: Field): Pt & { heading: number } {
  const at = (v: number) => { const p = along(PATHS[name].points, v); return { x: (mirror ? 1 - p.x : p.x) * field.width, y: p.y * field.height }; };
  const here = at(u), ahead = at(Math.min(1, u + 0.01)), behind = at(Math.max(0, u - 0.01));
  return { ...here, heading: Math.atan2(ahead.y - behind.y, ahead.x - behind.x) };
}

// ---------- The aircraft ----------
export type EnemyKind = "scout" | "heavy" | "ferry" | "dart" | "ace" | "mine" | "hauler" | "carrier" | "flagship"
  | "leader" | "chaser" | "gunship" | "boat" | "balloon";
// hp: hits it takes. points: what it's worth. size: how near its middle counts as a hit, px.
export const ENEMY: Record<EnemyKind, { hp: number; points: number; size: number }> = {
  scout: { hp: 1, points: 100, size: 15 },
  heavy: { hp: 8, points: 500, size: 30 },
  ferry: { hp: 3, points: 300, size: 20 },
  dart: { hp: 1, points: 150, size: 13 },
  ace: { hp: 3, points: 400, size: 16 },
  mine: { hp: 4, points: 200, size: 18 },
  hauler: { hp: 6, points: 350, size: 26 },
  carrier: { hp: 30, points: 2000, size: 24 }, // (a ship: it's hit anywhere along its hull, HULL below)
  flagship: { hp: 45, points: 3000, size: 44 },
  leader: { hp: 2, points: 300, size: 16 },
  chaser: { hp: 2, points: 250, size: 14 },
  gunship: { hp: 6, points: 600, size: 24 },
  boat: { hp: 12, points: 900, size: 14 }, // (a ship, like the carrier: BOAT_HULL)
  balloon: { hp: 1, points: 250, size: 22 }, // (hp: its cable. Its body only stops rounds.)
};
// The ones a collision brings down along with you. (Anything bigger flies on.)
const LIGHT: ReadonlySet<EnemyKind> = new Set(["scout", "ferry", "dart", "mine", "leader", "chaser"]);
// Down on the water: you fly over them, and they're hit anywhere along the hull.
export const SHIPS: ReadonlySet<EnemyKind> = new Set(["carrier", "boat"]);
// In the sky but not flying against you: not counted in what flew, and not waited for.
const scenery = (e: Enemy) => e.kind === "balloon";
export const flagshipHp = (stage: number) => Math.min(120, ENEMY.flagship.hp + 15 * (stage - 1));

export type Enemy = Pt & {
  kind: EnemyKind;
  path: PathName | null; // the curve it follows; null for the ones that fly themselves (a dart, an ace, a mine, a drone, the flagship)
  mirror: boolean;
  age: number; // seconds since it came in (below zero: still waiting its turn in the formation)
  heading: number;
  hp: number; hpMax: number;
  fired: number; // on a path: how many of its firing points it has passed
  hurt: number; // seconds left of the flash when it's hit and not brought down
  gone: boolean;
  squad: number; // which formation of the stage it's one of (-1: none)
  home: number; // for the ones that fly themselves: where across the field they come in (a share)
  vx: number; vy: number; // …and their speed, once they have one (a dart that's dived, a drone)
  cool: number; cool2: number; burst: number; // …and their guns' timers
  jink: number; off: number; // on a path: how far to one side of it it means to fly (once its formation's been shot at), and is flying
  snappy: boolean; // on a path: it has a snap shot left for a plane sitting under it
  panic: boolean; // its leader's been shot down: it's running, and worth half
};
export type Shot = Pt & { vx: number; vy: number; spent?: boolean }; // (spent: a piercing round that's been through one already)
export type Missile = Pt & { heading: number; age: number; gone: boolean };
export type Cloud = Pt & { w: number; h: number };
export type Flak = Pt & { wait: number; fuse: number }; // wait: until it's marked (where you are then); fuse: until it goes off
export type CrateKind = "wingmen" | "loop" | "gun" | "medal";
export type SortieCrate = Pt & { what: CrateKind; age: number };

// How far ahead of you they aim: 0 at where you are, 1 at exactly where you'll be if you keep
// going as you are. The scouts get better at it every stage.
export const leadOf = (kind: EnemyKind, stage: number) =>
  kind === "ace" || kind === "flagship" ? 1 : kind === "scout" || kind === "leader" ? Math.min(0.75, 0.25 * (stage - 1)) : kind === "dart" ? 0.6 : 0.5;
// The way to shoot from `from` to hit something at `at` moving at (vx, vy), with a round of that speed. (`share`: as above.)
export function leadAim(from: Pt, at: Pt & { vx: number; vy: number }, speed: number, share: number): number {
  const t = Math.hypot(at.x - from.x, at.y - from.y) / speed;
  return Math.atan2(at.y + at.vy * t * share - from.y, at.x + at.vx * t * share - from.x);
}
export const BREAK = 44; // how far out of line a formation's aircraft go once one of them has been shot down, px
export const ACE_OFF = 90; // how far to one side of your guns the ace sits
export const ACE_SWAPS = 1.5; // seconds before it crosses to the other side (which is when you can hit it)
export const ACE_DODGE = 0.32, ACE_NERVE = 1.3; // seconds it jinks for when a burst is coming, and before it can again
export const MINE_DRIFT = 30; // px/s a mine closes on your column
// The flagship's wall: eleven rounds across the bottom half of the sky with two next to each
// other left out, a different two each time. `k`: which wall this is.
export function wall(k: number): number[] {
  const gap = (k * 3) % 8 + 1; // (never at either end: that would be no gap to find)
  return Array.from({ length: 11 }, (_, i) => i).filter((i) => i !== gap && i !== gap + 1).map((i) => Math.PI / 2 + (i - 5) * 0.17);
}

export const DART_LINES_UP = 0.9; // seconds a dart spends at the top, pointing at you, before it goes
export const DART_SPEED = 620;
export const ACE_STAYS = 5.5; // seconds an ace hunts before it leaves
export const MINE_RING = 8; // rounds a mine goes off in
export const DRONES = 3; // scouts a hauler spills when it's shot down
// The aircraft carrier: how fast it comes down the screen, how many scouts it has on deck and
// how often one takes off, how often its guns fire, and half its hull's width and length.
export const CARRIER_SPEED = 50, CARRIER_PLANES = 6, CARRIER_LAUNCHES = 1.5, CARRIER_GUNS = 1.4;
export const HULL = { wide: 24, long: 58 };
export const WING_SAVES = 0.9; // seconds you can't be hit again after a wingman has taken one for you
export const CHASE_WARN = 1.1, CHASER_SPEED = 300, CHASER_STEER = 110; // seconds of warning; how fast it climbs, and slides across to your column, px/s
// The gunship: how far off straight down its nose has to be before rounds from below get past the
// armour (radians), how fast it turns its nose (rad/s), how far to one side you have to be for it to
// turn all the way (px), how often it fires, and how long it stays.
export const GUNSHIP_ARC = 0.55, GUNSHIP_TURN = 1.3, GUNSHIP_REACH = 170, GUNSHIP_FIRES = 1.5, GUNSHIP_STAYS = 10;
export const BOAT_SPEED = 45, BOAT_MISSILES = 4, BOAT_FIRES = 2.6;
export const BOAT_HULL = { wide: 13, long: 30 };
export const MISSILE_SPEED = 165, MISSILE_TURN = 1.5, MISSILE_LIFE = 5.5, MISSILE_SIZE = 7, MISSILE_POINTS = 50;
export const CLOUD_SPEED = 80; // px/s down the screen
export const FLAK_FUSE = 1.0, FLAK_APART = 0.45, FLAK_RADIUS = 52, FLAK_DODGE = 250; // seconds marked; between marks; px; points for looping through one
export const BALLOON_SPEED = 42, CABLE = 70, CABLE_WIDE = 3; // px/s; the cable's length below the balloon, and half its width (px)
export const HEADWIND = 45; // px/s the plane's pushed back down the screen, in a headwind

// ---------- The stages ----------
// A stage is its formations, in the order they come: `at` seconds in, `count` aircraft a `gap`
// apart. On a path they follow one another along it; the ones that fly themselves come in
// spread across the top (`xs`: where, as shares of the width).
// (`leader`: a flight of scouts with a squadron leader at its head.)
export type Wave = { at: number; kind: EnemyKind; path: PathName | null; count: number; gap: number; mirror: boolean; xs?: number[]; leader?: boolean };

// Every stage is rolled fresh as it starts: how many formations, which aircraft, along which
// paths, how many in each, where and when. Within limits, so it's always one you can fly: it opens
// with scouts, a ferry always comes (wingmen), and the heavier aircraft are capped. The first stage
// is the gentlest; aces, heavies and haulers join from the second; and each stage after brings more
// formations, bigger, closer together.
export type Roll = () => number;
const FLIGHT_PATHS: PathName[] = ["sweep", "dive", "hook", "cross", "weave"];
export const formationsIn = (stage: number) => Math.min(26, 12 + 5 * (stage - 1));
// The pause after one formation before the next, in seconds: shortest and longest, by stage.
export const pauseIn = (stage: number): [number, number] => [Math.max(1.2, 2.2 - 0.3 * (stage - 1)), Math.max(2.4, 4.2 - 0.6 * (stage - 1))];
export const ECHO = 0.3; // the chance a flight of scouts is chased in by its mirror image
export const LEADER_CHANCE = 0.35; // …and, from the second stage, that it has a squadron leader at its head

// A stage's twist: something about the whole of it, rolled along with it (never the first).
export type Twist = "none" | "night" | "headwind" | "aces" | "fog" | "flak" | "convoy";
export const TWISTS: Record<Twist, { name: string; says: string }> = {
  none: { name: "", says: "" },
  night: { name: "Night", says: "Dark skies. Watch for the tracer." },
  headwind: { name: "Headwind", says: "It pushes you back down the screen." },
  aces: { name: "Ace squadron", says: "More aces, and each is worth double." },
  fog: { name: "Fog bank", says: "Cloud everywhere: for you, and for them." },
  flak: { name: "Flak alley", says: "The guns below are busy today." },
  convoy: { name: "Convoy", says: "More ships on the water." },
};
const TWIST_ROLL: Twist[] = ["night", "headwind", "aces", "fog", "flak", "convoy"];

// What can come, how likely each is (against the others), and at most how many of it a stage.
// Chasers join from the second stage, gunships and missile boats from the third (boats from the
// second, in a convoy). The twist leans on it, too.
const MIX = (stage: number, twist: Twist): { kind: EnemyKind; weight: number; most: number }[] => {
  const aces = twist === "aces", convoy = twist === "convoy";
  return [
    { kind: "scout", weight: 10, most: 99 },
    { kind: "dart", weight: 2, most: 2 + stage },
    { kind: "mine", weight: 1.5, most: 1 + stage },
    { kind: "carrier", weight: convoy ? 2.5 : 1, most: (stage > 1 ? 2 : 1) + (convoy ? 1 : 0) },
    { kind: "ferry", weight: stage > 1 ? 0.5 : 0, most: 2 },
    ...(stage > 1 ? [
      { kind: "ace" as const, weight: aces ? 4.5 : 1.5, most: stage * (aces ? 2 : 1) },
      { kind: "heavy" as const, weight: 1, most: stage },
      { kind: "hauler" as const, weight: 1, most: 2 },
      { kind: "chaser" as const, weight: 1.2, most: 1 + stage },
    ] : []),
    ...(stage > 2 ? [{ kind: "gunship" as const, weight: 1, most: stage - 1 }] : []),
    ...(stage > 2 || (stage > 1 && convoy) ? [{ kind: "boat" as const, weight: convoy ? 2.5 : 0.8, most: convoy ? 4 : 2 }] : []),
  ];
};

const between = (rand: Roll, lo: number, hi: number) => lo + rand() * (hi - lo);
const upTo = (rand: Roll, n: number) => Math.floor(rand() * (n + 1)); // 0 to n
const spread = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
// `n` places across the top, in order, each nudged off the even spread but never into its neighbour's.
const scatter = (rand: Roll, n: number) => spread(n).map((x) => x + (rand() - 0.5) * (0.6 / (n + 1)));
const flight = (path: PathName, count: number, mirror: boolean): Omit<Wave, "at"> =>
  ({ path, count, mirror, gap: 0.38, kind: path === "prowl" ? "heavy" : path === "ferry" ? "ferry" : path === "haul" ? "hauler" : "scout" });

// One formation of a kind, rolled.
function formation(kind: EnemyKind, stage: number, rand: Roll): Omit<Wave, "at"> {
  const mirror = rand() < 0.5;
  switch (kind) {
    case "dart": { const count = 3 + upTo(rand, Math.min(2, stage)); return { kind, path: null, count, gap: 0.45, mirror: false, xs: scatter(rand, count) }; }
    case "mine": { const count = 2 + upTo(rand, Math.min(2, stage)); return { kind, path: null, count, gap: 0.6, mirror: false, xs: scatter(rand, count) }; }
    case "ace": return { kind, path: null, count: 1, gap: 0, mirror, xs: [mirror ? 0.75 : 0.25] };
    case "carrier": return { kind, path: null, count: 1, gap: 0, mirror: false, xs: [between(rand, 0.25, 0.75)] };
    case "ferry": return flight("ferry", 1, mirror);
    case "heavy": return flight("prowl", 1, mirror);
    case "hauler": return flight("haul", 1, mirror);
    case "chaser": { const count = 1 + upTo(rand, stage > 2 ? 1 : 0); return { kind, path: null, count, gap: 1.6, mirror: false, xs: scatter(rand, count) }; }
    case "gunship": return { kind, path: null, count: 1, gap: 0, mirror: false, xs: [between(rand, 0.3, 0.7)] };
    case "boat": return { kind, path: null, count: 1, gap: 0, mirror: false, xs: [between(rand, 0.2, 0.8)] };
    default: {
      const w = flight(FLIGHT_PATHS[Math.floor(rand() * FLIGHT_PATHS.length)], 4 + upTo(rand, Math.min(3, stage)), mirror);
      return stage > 1 && rand() < LEADER_CHANCE ? { ...w, leader: true } : w;
    }
  }
}

export function randomStage(stage: number, rand: Roll = Math.random, twist: Twist = "none"): Wave[] {
  const n = formationsIn(stage), mix = MIX(stage, twist), had = new Map<EnemyKind, number>();
  const pickKind = (): EnemyKind => {
    const open = mix.filter((m) => m.weight > 0 && (had.get(m.kind) ?? 0) < m.most);
    let r = rand() * open.reduce((sum, m) => sum + m.weight, 0);
    const m = open.find((it) => (r -= it.weight) < 0) ?? open[0];
    had.set(m.kind, (had.get(m.kind) ?? 0) + 1);
    return m.kind;
  };
  // The ferry's place: somewhere in the first two-thirds, so its wingmen are worth having.
  const ferryAt = 1 + Math.floor(rand() * Math.max(1, Math.floor((n * 2) / 3) - 1));
  had.set("ferry", 1);
  const [lo, hi] = pauseIn(stage), waves: Wave[] = [];
  let at = 1.5;
  while (waves.length < n) {
    const last = waves.at(-1);
    if (last) at += last.kind === "carrier" || last.kind === "heavy" ? between(rand, hi, hi + 1.5) : between(rand, lo, hi);
    const w = formation(waves.length === 0 ? "scout" : waves.length === ferryAt ? "ferry" : pickKind(), stage, rand);
    waves.push({ ...w, at: Math.round(at * 10) / 10 });
    // Now and then the same flight again straight after, from the other side.
    if (w.kind === "scout" && waves.length < n && waves.length !== ferryAt && rand() < ECHO) {
      at += between(rand, 1.5, 2.2);
      waves.push({ ...w, mirror: !w.mirror, at: Math.round(at * 10) / 10 });
    }
  }
  return waves;
}

// What else is in the sky this stage, and when it comes, through the time the formations take.
export type Hazard = { at: number } & ({ kind: "cloud"; x: number; w: number } | { kind: "balloon"; x: number } | { kind: "flak"; bursts: number });
export const cloudsIn = (stage: number, twist: Twist) => Math.round((2 + stage) * (twist === "fog" ? 2.5 : 1));
export const barragesIn = (stage: number, twist: Twist) => Math.min(3, stage - 1) + (twist === "flak" ? 3 : 0);
export function randomHazards(stage: number, until: number, rand: Roll = Math.random, twist: Twist = "none"): Hazard[] {
  const out: Hazard[] = [];
  for (let i = 0; i < cloudsIn(stage, twist); i++) out.push({ at: between(rand, 0.5, until), kind: "cloud", x: between(rand, 0.1, 0.9), w: between(rand, 150, 260) });
  const balloons = stage === 1 ? 1 + upTo(rand, 1) : 2 + upTo(rand, Math.min(2, stage - 1));
  for (let i = 0; i < balloons; i++) out.push({ at: between(rand, 4, until), kind: "balloon", x: between(rand, 0.15, 0.85) });
  for (let i = 0; i < barragesIn(stage, twist); i++) out.push({ at: between(rand, 5, until), kind: "flak", bursts: 3 + upTo(rand, 1) });
  return out.map((h) => ({ ...h, at: Math.round(h.at * 10) / 10 })).sort((a, b) => a.at - b.at);
}

// A whole stage, from a run's seed: the same run and stage always roll the same one. (Which is
// what makes the daily run the same for everyone: its seed is the date.)
export type Plan = { twist: Twist; waves: Wave[]; hazards: Hazard[] };
export function seeded(seed: number): Roll { // (mulberry32)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rollFor = (run: number, stage: number, salt = 0x9e3779b1) => seeded((run ^ Math.imul(stage, salt)) >>> 0);
export function planStage(stage: number, run: number): Plan {
  const rand = rollFor(run, stage);
  const twist: Twist = stage === 1 ? "none" : TWIST_ROLL[Math.floor(rand() * TWIST_ROLL.length)];
  const waves = randomStage(stage, rand, twist);
  return { twist, waves, hazards: randomHazards(stage, waves.at(-1)?.at ?? 30, rand, twist) };
}
export const dailySeed = (day: Date) => day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();

// ---------- Upgrades ----------
// After each flagship, three of these to pick one from. `most`: how many times you can have it.
export type Perk = "loop" | "wing" | "pierce" | "plate" | "magnet" | "chain" | "steady" | "plane";
export const PERKS: Record<Perk, { name: string; says: string; most: number }> = {
  loop: { name: "Extra loop", says: "One more loop every stage.", most: 2 },
  wing: { name: "Third wingman", says: "Wingmen come in threes: one more, behind you.", most: 1 },
  pierce: { name: "Piercing rounds", says: "A round that brings one down flies on into the next.", most: 1 },
  plate: { name: "Armour plate", says: "The first hit of every stage glances off.", most: 1 },
  magnet: { name: "Crate magnet", says: "Crates drift across to you.", most: 1 },
  chain: { name: "Long chain", says: "A little longer to keep a chain going.", most: 2 },
  steady: { name: "Steady hands", says: "Losing a plane doesn't cost you a gun.", most: 1 },
  plane: { name: "Spare plane", says: "Another plane, now.", most: 99 },
};
export const CHAIN_PERK = 1.2; // seconds a Long chain adds to the chain window
export const MAGNET = 220; // px/s a crate drifts across to you, with the magnet
export const has = (g: Pick<Game, "perks">, perk: Perk) => g.perks.filter((it) => it === perk).length;
// The three on offer after a stage: rolled from the run's seed, and only ones you can still take.
export function offerFor(g: Pick<Game, "perks" | "run" | "stage" | "lives">): Perk[] {
  const rand = rollFor(g.run, g.stage, 0x85ebca6b);
  const open = (Object.keys(PERKS) as Perk[]).filter((k) => has(g, k) < PERKS[k].most && (k !== "plane" || g.lives < LIVES_MAX));
  const out: Perk[] = [];
  while (out.length < 3 && open.length) out.push(open.splice(Math.floor(rand() * open.length), 1)[0]);
  return out;
}

// ---------- The numbers ----------
export const LIVES = 3, LIVES_MAX = 5;
export const EXTRA_EVERY = 25_000; // points for another plane
export const LOOPS = 3; // a stage
export const LOOPS_MAX = 5;
export const GUNS_MAX = 3; // 1: two guns. 2: four. 3: four, firing faster.
export const SPEED = 340; // the player's, px/s, any of the eight ways, on a field 760px wide…
// …and faster on a wider one (up to a point), since the formations' paths are stretched across
// it too: sliding in under one takes the same time whatever the window.
export const speedOn = (field: Field) => SPEED * Math.max(1, Math.min(1.9, field.width / 760));
export const FIRE_EVERY = 0.22; // seconds between bursts while fire is held: slow enough that a burst has to be placed
export const SHOT_SPEED = 760; // your rounds, straight up
export const LOOP_LASTS = 1.1; // seconds up and over
export const LOOP_REACH = 64; // how far ahead and behind the loop carries the plane, px
export const SAFE = 2.2; // seconds a new plane can't be hit
export const RESPAWN = 1; // seconds before the next plane comes on
export const WING_OUT = 46, WING_BACK = 14, WING_BEHIND = 44; // where a wingman flies, from your middle
export const PLAYER_SIZE = 9, WING_SIZE = 9, SHOT_SIZE = 4, ROUND_SIZE = 5, CRATE_SIZE = 20; // how near counts as a hit, px
export const INTRO = 1.8; // seconds of "Stage 2" before the first formation
export const roundSpeed = (stage: number) => Math.min(300, 190 + 22 * (stage - 1)); // the enemy's rounds, px/s
export const SCROLL = 70; // how fast the air goes by, px/s (the wisps drifting down the screen)
export const CHAIN_WINDOW = 2.2; // seconds after a kill that the next one still counts as part of the chain
// What a kill is worth, that far into a chain: the first two as they are, then double, up to five times.
export const chainTimes = (chain: number) => Math.max(1, Math.min(5, 1 + Math.floor((chain - 1) / 2)));
export const FLIGHT_BONUS = 200; // for each aircraft of a formation you shot down all of
export const MEDAL = 1000;
export const CLEAN_BONUS = 2000; // times the stage, for flying it without losing a plane
// Where the guns are, across the plane, at each level.
export const gunsAt = (level: number) => (level >= 2 ? [-16, -6, 6, 16] : [-6, 6]);

// The plane's loop, a share `u` (0 to 1) of the way through: how far ahead of where it started
// (then behind, then back), how high (0 to 1), and its pitch as you'd see it from above (1 level,
// 0 standing on its tail, -1 on its back at the top).
export function loopPose(u: number): { ahead: number; height: number; pitch: number } {
  const a = Math.max(0, Math.min(1, u)) * Math.PI * 2;
  return { ahead: Math.sin(a) * LOOP_REACH, height: (1 - Math.cos(a)) / 2, pitch: Math.cos(a) };
}

// ---------- How hard ----------
// The level sets the pace of everything of theirs (see `td` in step): on Normal it all moves at
// 85% of full speed, on Easy at 70%, and only Hard is the whole thing flat out. Easy gives you a
// fourth plane to start with as well. (The daily run keeps a best for each level.)
export type Level = "easy" | "normal" | "hard";
export const LEVELS: Record<Level, { name: string; pace: number; lives: number; says: string }> = {
  easy: { name: "Easy", pace: 0.7, lives: LIVES + 1, says: "Slower skies, and a spare plane." },
  normal: { name: "Normal", pace: 0.85, lives: LIVES, says: "A fair fight." },
  hard: { name: "Hard", pace: 1, lives: LIVES, says: "Everything flat out." },
};
export const LEVEL_ORDER: Level[] = ["easy", "normal", "hard"];

// ---------- The game ----------
// intro: the stage's name is up. play: formations are coming. tally: the stage is over, and its
// score is up until you fire. pick: choosing an upgrade. over: no planes left.
export type Phase = "intro" | "play" | "tally" | "pick" | "over";
export type Tally = { downed: number; flew: number; percent: number; clean: boolean; bonus: number };
export type Player = Pt & {
  alive: boolean;
  down: number; // seconds until the next plane comes on
  safe: number; // seconds it can't be hit (it's just come on)
  loop: number; // seconds left of a loop (0: flying level)
  cool: number; // seconds until the guns can fire again
  lean: number; // -1 sliding left, 1 right: for the wings
  vx: number; vy: number; // how it's moving right now (what the enemy aims ahead by)
};
export type Game = {
  phase: Phase; since: number; // seconds in this phase
  stage: number; clock: number; nextWave: number;
  waves: Wave[]; // this stage's formations, in the order they're coming this time
  boss: "none" | "out" | "done"; // the stage's flagship: not yet, up, shot down
  twist: Twist; hazards: Hazard[]; nextHazard: number; // …and what else is coming
  run: number; daily: boolean; // the seed every stage is rolled from (the date's, on the daily run)
  level: Level;
  score: number; lives: number; nextLife: number; loops: number; guns: number;
  wingmen: boolean[]; // left, right (and behind, with the Third wingman): which are flying
  perks: Perk[]; offer: Perk[]; plate: boolean; // upgrades taken; the three on offer (pick); the plate's still on, this stage
  clouds: Cloud[]; flak: Flak[]; missiles: Missile[];
  hidden: boolean; seen: Pt & { vx: number; vy: number }; // in a cloud; and where they last saw you, and going which way
  chain: number; chainFor: number; // kills in the chain so far, and the seconds left to add to it
  player: Player;
  enemies: Enemy[]; shots: Shot[]; rounds: Shot[]; crates: SortieCrate[];
  squads: { size: number; downed: number }[]; // this stage's formations: how many flew, and how many of them you got
  flew: number; downed: number; lost: number; // this stage: aircraft that came in, how many you shot down, planes of yours lost
  tally: Tally | null;
  scroll: number;
};
// What the keys say this moment. loop and go are true only on the frame the key goes down.
// pick: an upgrade chosen, 1 to 3 (on the frame it's chosen).
export type Input = { x: number; y: number; fire: boolean; loop: boolean; go: boolean; pick?: number };
// What just happened, for the drawing to make something of (an explosion, a number floating up).
export type SortieEvent =
  | { type: "boom"; x: number; y: number; big: boolean }
  | { type: "spark"; x: number; y: number }
  | { type: "points"; x: number; y: number; n: number; times: number }
  | { type: "flight"; x: number; y: number; n: number } // a whole formation shot down
  | { type: "pickup"; x: number; y: number; what: CrateKind }
  | { type: "extra"; x: number; y: number } // another plane earned
  | { type: "warning" } // the flagship is coming
  | { type: "lost"; x: number; y: number }
  | { type: "block"; x: number; y: number } // a round glanced off armour, or a balloon
  | { type: "plate"; x: number; y: number } // the armour plate took a hit
  | { type: "flak"; x: number; y: number }
  | { type: "dodge"; x: number; y: number; n: number }; // looped through flak as it went off

const startAt = (field: Field): Pt => ({ x: field.width / 2, y: field.height - 80 });
const newPlayer = (field: Field): Player => ({ ...startAt(field), alive: true, down: 0, safe: SAFE, loop: 0, cool: 0, lean: 0, vx: 0, vy: 0 });
const DOWN = Math.PI / 2;

// What a stage starts with: its plan, and a clean slate.
type Fresh = Pick<Game, "stage" | "twist" | "waves" | "hazards" | "nextHazard" | "clock" | "nextWave" | "boss" | "squads" | "flew" | "downed" | "lost"
  | "tally" | "loops" | "plate" | "rounds" | "enemies" | "missiles" | "flak">;
function stageStart(g: Pick<Game, "run" | "perks">, stage: number): Fresh {
  const plan = planStage(stage, g.run);
  return {
    stage, twist: plan.twist, waves: plan.waves, hazards: plan.hazards, nextHazard: 0, clock: 0, nextWave: 0, boss: "none",
    squads: [], flew: 0, downed: 0, lost: 0, tally: null, loops: LOOPS + has(g, "loop"), plate: has(g, "plate") > 0,
    rounds: [], enemies: [], missiles: [], flak: [],
  };
}

// `run`: the seed its stages are rolled from (any, by default); `daily`: it's today's.
export function newGame(field: Field, run = Math.floor(Math.random() * 2 ** 31), daily = false, level: Level = "normal"): Game {
  const start = { run, daily, level, perks: [] as Perk[] };
  return {
    phase: "intro", since: 0, ...start, ...stageStart(start, 1),
    score: 0, lives: LEVELS[level].lives, nextLife: EXTRA_EVERY, guns: 1, wingmen: [false, false], offer: [],
    chain: 0, chainFor: 0,
    player: newPlayer(field), shots: [], crates: [], clouds: [],
    hidden: false, seen: { ...startAt(field), vx: 0, vy: 0 }, scroll: 0,
  };
}

// An aircraft, coming in. (Its place is set as it flies; this is only what it starts with.)
export function newEnemy(kind: EnemyKind, over: Partial<Enemy> = {}): Enemy {
  return {
    kind, path: null, mirror: false, age: 0, x: 0, y: -60, heading: DOWN, hp: ENEMY[kind].hp, hpMax: ENEMY[kind].hp,
    fired: 0, hurt: 0, gone: false, squad: -1, home: 0.5, vx: 0, vy: 0, cool: 1, cool2: 2, burst: 0, jink: 0, off: 0, snappy: false, panic: false, ...over,
  };
}

export const looping = (g: Game) => g.player.loop > 0;
// Where wingman 0 (on the left), 1 (on the right) or 2 (behind: the Third wingman) is flying.
export const wingAt = (g: Game, i: number): Pt =>
  i === 2 ? { x: g.player.x, y: g.player.y + WING_BEHIND } : { x: g.player.x + (i ? WING_OUT : -WING_OUT), y: g.player.y + WING_BACK };
// The gunship's armour is across its nose: it's covered from straight below while its nose is near enough down.
export const shielded = (e: Enemy) => e.kind === "gunship" && Math.abs(e.heading - DOWN) < GUNSHIP_ARC;
// A dart that hasn't gone yet: still at the top, lining up.
export const liningUp = (e: Enemy) => e.kind === "dart" && e.age >= 0 && e.vx === 0 && e.vy === 0;
const near = (a: Pt, b: Pt, d: number) => Math.hypot(a.x - b.x, a.y - b.y) <= d;
const towards = (from: number, to: number, most: number) => from + Math.max(-most, Math.min(most, to - from));

// One moment of the game. Changes `g`, and answers what happened in it.
export function step(g: Game, input: Input, dt: number, field: Field): SortieEvent[] {
  const events: SortieEvent[] = [];
  const p = g.player;
  g.since += dt;
  g.scroll += SCROLL * dt;
  if (g.chainFor > 0 && (g.chainFor -= dt) <= 0) g.chain = 0;

  // ---------- Between stages, and after the last plane ----------
  // (Over: what's still in the air flies on and away, with nobody to shoot at, until you start again.)
  // (Again on the daily run is today's run again, from the top.)
  if (g.phase === "over" && g.since > 1 && input.go) Object.assign(g, newGame(field, g.daily ? g.run : undefined, g.daily, g.level));
  const nextStage = () => Object.assign(g, stageStart(g, g.stage + 1), { phase: "intro", since: 0 });
  // After the tally, an upgrade to pick (unless there's none left to have).
  if (g.phase === "tally" && g.since > 1 && input.go) {
    g.offer = offerFor(g);
    if (g.offer.length) { g.phase = "pick"; g.since = 0; } else nextStage();
  }
  const perk = g.phase === "pick" && g.since > 0.3 && input.pick ? g.offer[input.pick - 1] : undefined;
  if (perk) {
    g.perks.push(perk);
    if (perk === "wing") g.wingmen.push(true); // (and here he is)
    if (perk === "plane") g.lives = Math.min(LIVES_MAX, g.lives + 1);
    g.offer = [];
    nextStage();
  }
  if (g.phase === "intro" && g.since >= INTRO) { g.phase = "play"; g.since = 0; }

  // ---------- You ----------
  if (!p.alive) {
    if (g.phase !== "over") p.down -= dt;
    if (g.phase !== "over" && p.down <= 0) Object.assign(p, newPlayer(field));
  } else {
    // Eight ways, and a diagonal is no faster than straight.
    const len = Math.hypot(input.x, input.y) || 1, v = speedOn(field), was = { x: p.x, y: p.y };
    p.x = Math.max(24, Math.min(field.width - 24, p.x + (input.x / len) * v * dt));
    const wind = g.twist === "headwind" && g.phase === "play" ? HEADWIND : 0;
    p.y = Math.max(40, Math.min(field.height - 30, p.y + ((input.y / len) * v + wind) * dt));
    p.vx = dt > 0 ? (p.x - was.x) / dt : 0; p.vy = dt > 0 ? (p.y - was.y) / dt : 0;
    p.lean += (Math.sign(input.x) - p.lean) * Math.min(1, dt * 12);
    if (p.safe > 0) p.safe -= dt;
    if (p.loop > 0) p.loop = Math.max(0, p.loop - dt);
    else if (input.loop && g.loops > 0) { g.loops--; p.loop = LOOP_LASTS; }
    // The guns: straight up the screen, whatever the plane is doing. (Not from up in a loop.)
    p.cool -= dt;
    if (input.fire && p.cool <= 0 && p.loop <= 0) {
      p.cool = FIRE_EVERY * (g.guns >= 3 ? 0.7 : 1);
      for (const dx of gunsAt(g.guns)) g.shots.push({ x: p.x + dx, y: p.y - 22 + Math.abs(dx) * 0.4, vx: 0, vy: -SHOT_SPEED });
      g.wingmen.forEach((there, i) => { if (there) { const w = wingAt(g, i); g.shots.push({ x: w.x, y: w.y - 14, vx: 0, vy: -SHOT_SPEED }); } });
    }
  }

  // ---------- The clouds ----------
  // Inside one, they can't see you: everything that aims or homes goes at where you were, and
  // which way you were going, as you went in. (smarter, the other way round)
  g.clouds = g.clouds.filter((c) => (c.y += CLOUD_SPEED * dt) - c.h / 2 < field.height);
  g.hidden = p.alive && g.clouds.some((c) => ((p.x - c.x) / (c.w * 0.45)) ** 2 + ((p.y - c.y) / (c.h * 0.45)) ** 2 <= 1);
  if (p.alive && !g.hidden) g.seen = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
  const them: Pt & { vx: number; vy: number } = g.hidden ? { ...g.seen, vx: 0, vy: 0 } : p; // where they think you are
  // Up in a loop, or just come on: nothing can touch it.
  const exposed = () => p.alive && p.loop <= 0 && p.safe <= 0;
  const lose = () => {
    events.push({ type: "lost", x: p.x, y: p.y });
    p.alive = false; p.down = RESPAWN; p.loop = 0; p.vx = p.vy = 0;
    g.wingmen = g.wingmen.map(() => false);
    if (!has(g, "steady")) g.guns = Math.max(1, g.guns - 1); // the next plane's guns are a step back
    g.chain = 0; g.chainFor = 0;
    g.lives--; g.lost++;
    if (g.lives <= 0) { g.phase = "over"; g.since = 0; }
  };
  const loseWing = (i: number) => { const w = wingAt(g, i); g.wingmen[i] = false; events.push({ type: "boom", x: w.x, y: w.y, big: false }); };
  // You've been hit. A wingman takes it for you if you have one (and you're clear for a moment
  // after, so the same round doesn't take the next); with none left, it's the plane.
  // (Before either, the armour plate, if it's still on.)
  const struck = () => {
    if (g.plate) { g.plate = false; p.safe = Math.max(p.safe, WING_SAVES); events.push({ type: "plate", x: p.x, y: p.y }); return; }
    const i = g.wingmen.indexOf(true);
    if (i < 0) return lose();
    loseWing(i);
    p.safe = Math.max(p.safe, WING_SAVES);
  };
  // A round from an enemy, at an angle.
  const fire = (e: Pt, speed: number, angle: number) => { g.rounds.push({ x: e.x, y: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }); };
  // The angle one of them shoots at to hit you: ahead of the way you're going, as far as its kind can judge it. (smarter)
  const aimOf = (e: Enemy, speed: number, from: Pt = e) => leadAim(from, them, speed, leadOf(e.kind, g.stage));

  // Their seconds: everything of theirs (the formations coming in, how they fly and fire, their
  // rounds, missiles and flak) runs on a clock the level slows, so on Easy it all comes on at a
  // gentler pace, the same shapes in the sky, just longer to read them and get out of the way.
  const td = dt * LEVELS[g.level].pace;

  // ---------- The formations ----------
  if (g.phase === "play") {
    g.clock += td;
    const waves = g.waves;
    for (; g.nextWave < waves.length && g.clock >= waves[g.nextWave].at; g.nextWave++) {
      const w = waves[g.nextWave];
      for (let i = 0; i < w.count; i++) {
        g.enemies.push(newEnemy(w.leader && i === 0 ? "leader" : w.kind, {
          path: w.path, mirror: w.mirror, age: -i * w.gap, squad: g.nextWave, home: w.xs?.[i] ?? 0.5,
          snappy: w.kind === "scout" && (g.stage > 1 || i % 2 === 1), // every other scout at first, then all of them
          ...(w.path ? onPath(w.path, 0, w.mirror, field) : { x: (w.xs?.[i] ?? 0.5) * field.width }),
          ...(w.kind === "chaser" ? { y: field.height + 40 } : {}), // (from below)
        }));
      }
      g.squads[g.nextWave] = { size: w.count, downed: 0 };
      g.flew += w.count;
    }
    // What else is in the sky: up to the flagship.
    for (; g.boss === "none" && g.nextHazard < g.hazards.length && g.clock >= g.hazards[g.nextHazard].at; g.nextHazard++) {
      const h = g.hazards[g.nextHazard];
      if (h.kind === "cloud") g.clouds.push({ x: h.x * field.width, y: -h.w * 0.3, w: h.w, h: h.w * 0.55 });
      else if (h.kind === "balloon") g.enemies.push(newEnemy("balloon", { home: h.x, x: h.x * field.width, y: -40 }));
      else for (let i = 0; i < h.bursts; i++) g.flak.push({ x: 0, y: 0, wait: 0.05 + i * FLAK_APART, fuse: FLAK_FUSE });
    }
    // And when the last of them has gone, the flagship.
    if (g.boss === "none" && g.nextWave >= waves.length && g.enemies.every(scenery)) {
      g.boss = "out";
      g.enemies.push(newEnemy("flagship", { hp: flagshipHp(g.stage), hpMax: flagshipHp(g.stage), x: field.width / 2, y: -90 }));
      g.flew++;
      events.push({ type: "warning" });
    }
  }

  // Points for something shot down (or cut loose, or shot out of the sky), times the chain it's part of.
  const award = (at: Pt, base: number) => {
    g.chain = g.chainFor > 0 ? g.chain + 1 : 1;
    g.chainFor = CHAIN_WINDOW + CHAIN_PERK * has(g, "chain");
    const times = chainTimes(g.chain), n = Math.round(base * times);
    g.score += n;
    events.push({ type: "points", x: at.x, y: at.y, n, times });
  };
  const leads = (squad: number) => g.enemies.some((l) => l.kind === "leader" && !l.gone && l.squad === squad);
  const down = (e: Enemy) => {
    e.gone = true;
    g.downed++;
    events.push({ type: "boom", x: e.x, y: e.y, big: e.hpMax > 1 });
    award(e, ENEMY[e.kind].points * (e.panic ? 0.5 : 1) * (e.kind === "ace" && g.twist === "aces" ? 2 : 1));
    // The ferry was carrying something: wingmen, or another loop if you have them all already.
    if (e.kind === "ferry") g.crates.push({ x: e.x, y: e.y, what: g.wingmen.every(Boolean) ? "loop" : "wingmen", age: 0 });
    // A mine goes off: a ring of slow rounds, all the way round.
    if (e.kind === "mine") for (let i = 0; i < MINE_RING; i++) fire(e, 150, (i / MINE_RING) * Math.PI * 2 + Math.PI / MINE_RING);
    // The rest of its formation break their line, one to each side in turn, so the next burst doesn't get them all. (smarter)
    // (Not while their leader's flying: they hold the line it gives them.)
    if (e.kind === "leader") {
      // Their leader's down: the rest panic, and run for it, every way out, firing nothing. (Any
      // still to come in don't.)
      for (const mate of g.enemies) {
        if (mate === e || mate.gone || mate.squad !== e.squad) continue;
        if (mate.age < 0) { mate.gone = true; g.flew--; g.squads[e.squad].size--; continue; }
        const a = Math.atan2(mate.y - e.y, mate.x - e.x) || -DOWN;
        Object.assign(mate, { panic: true, path: null, heading: a, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, cool: 0 });
      }
    } else if (e.path && g.squads[e.squad]?.size >= 3 && !leads(e.squad)) {
      let side = 1;
      for (const mate of g.enemies) if (mate !== e && !mate.gone && mate.squad === e.squad && mate.jink === 0) { mate.jink = side * BREAK; side = -side; }
    }
    // A hauler spills its drones: scouts that scatter downwards, each with one round in it.
    if (e.kind === "hauler") {
      for (let i = 0; i < DRONES; i++) {
        const a = DOWN + (i - (DRONES - 1) / 2) * 0.6;
        g.enemies.push(newEnemy("scout", { x: e.x, y: e.y, heading: a, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, cool: 0.5 + i * 0.15 }));
      }
      g.flew += DRONES;
    }
    // An aircraft carrier goes down in a string of explosions, and leaves a crate: wingmen, or a medal if you have them.
    if (e.kind === "carrier") {
      for (let i = 0; i < 5; i++) events.push({ type: "boom", x: e.x + (i % 2 ? 10 : -10), y: e.y + (i - 2) * 24, big: true });
      g.crates.push({ x: e.x, y: e.y, what: g.wingmen.every(Boolean) ? "medal" : "wingmen", age: 0 });
    }
    if (e.kind === "boat") for (let i = 0; i < 3; i++) events.push({ type: "boom", x: e.x, y: e.y + (i - 1) * 16, big: true });
    if (e.kind === "flagship") {
      g.boss = "done";
      g.rounds = []; g.missiles = []; g.flak = []; // its guns stop with it (and the ones below)
      for (let i = 0; i < 6; i++) events.push({ type: "boom", x: e.x + (i - 2.5) * 26, y: e.y + ((i * 37) % 50) - 25, big: true });
    }
    // The last of a formation, with none of it missed: a bonus, and a crate.
    const squad = g.squads[e.squad];
    if (squad && ++squad.downed === squad.size && squad.size >= 3) {
      const bonus = FLIGHT_BONUS * squad.size;
      g.score += bonus;
      events.push({ type: "flight", x: e.x, y: e.y, n: bonus });
      g.crates.push({ x: e.x, y: e.y, what: g.guns < GUNS_MAX ? "gun" : "medal", age: 0 });
    }
  };

  for (const e of g.enemies) {
    e.age += td;
    if (e.hurt > 0) e.hurt -= td;
    if (e.age < 0 || e.gone) continue;
    const off = e.x < -60 || e.x > field.width + 60 || e.y > field.height + 60;
    if (e.path) {
      const path = PATHS[e.path], u = e.age / path.lasts;
      if (u >= 1) { e.gone = true; continue; } // it got away
      const at = onPath(e.path, u, e.mirror, field);
      e.off = towards(e.off, e.jink, 140 * td); // out of line, if its formation has broken
      Object.assign(e, { x: at.x - Math.sin(at.heading) * e.off, y: at.y + Math.cos(at.heading) * e.off, heading: at.heading });
      const onField = e.y > 0 && e.y < field.height && e.x > 0 && e.x < field.width;
      // Its guns: a round at you (three in a fan from a heavy), at each point of its path that says
      // so. Under a leader, they hold their fire for its word, and then all fire together.
      const led = e.kind !== "leader" && leads(e.squad);
      while (e.fired < path.fires.length && u >= path.fires[e.fired]) {
        e.fired++;
        if (!p.alive || !onField || led) continue;
        const aim = aimOf(e, roundSpeed(g.stage));
        for (const turn of e.kind === "heavy" ? [-0.28, 0, 0.28] : [0]) fire(e, roundSpeed(g.stage), aim + turn);
        if (e.kind === "leader") {
          for (const mate of g.enemies) {
            if (mate !== e && !mate.gone && mate.age >= 0 && mate.squad === e.squad && mate.y > 0 && mate.y < field.height && mate.x > 0 && mate.x < field.width) fire(mate, roundSpeed(g.stage), aimOf(mate, roundSpeed(g.stage)));
          }
        }
      }
      // And one more, once, for a plane sitting right under its path waiting for it (if they can see it). (smarter)
      if (e.snappy && !led && onField && p.alive && !g.hidden && Math.abs(p.x - e.x) < 50 && p.y > e.y + 90) { e.snappy = false; fire(e, roundSpeed(g.stage), aimOf(e, roundSpeed(g.stage))); }
    } else if (e.kind === "dart") {
      if (e.vx === 0 && e.vy === 0) {
        // At the top, sliding across to line up, nose on you the whole time: this is the warning.
        e.y = -30 + 90 * Math.min(1, e.age / DART_LINES_UP);
        if (e.age < td * 1.5) e.x = e.home * field.width;
        e.x = towards(e.x, p.alive ? them.x : e.x, 200 * td);
        e.heading = p.alive ? Math.atan2(them.y - e.y, them.x - e.x) : DOWN;
        // …and then it goes: at where you were, and a little ahead of the way you were going. (smarter)
        if (e.age >= DART_LINES_UP) { const a = p.alive ? aimOf(e, DART_SPEED) : e.heading; e.vx = Math.cos(a) * DART_SPEED; e.vy = Math.sin(a) * DART_SPEED; e.heading = a; }
      } else {
        e.x += e.vx * td; e.y += e.vy * td;
        if (off || e.y < -80) e.gone = true;
      }
    } else if (e.kind === "ace") {
      const level = field.height * 0.28;
      if (e.age < 1) { e.x = e.home * field.width; e.y = -40 + (level + 40) * e.age; e.heading = DOWN; }
      else if (e.age < 1 + ACE_STAYS) {
        // It follows you across, firing pairs: but to one side of your guns, not over them, and
        // swapping sides now and then (which is your chance). A burst coming up at it, it jinks
        // out of the way of, though not twice in a row. (smarter)
        const side = Math.floor((e.age - 1) / ACE_SWAPS) % 2 ? 1 : -1;
        const want = Math.max(40, Math.min(field.width - 40, (p.alive ? them.x : e.x) + side * ACE_OFF));
        e.cool2 -= td;
        const coming = g.shots.find((s) => Math.abs(s.x - e.x) < 24 && s.y > e.y + 20 && s.y - e.y < 240);
        if (coming && e.cool2 <= 0 && e.burst <= 0) { e.burst = ACE_DODGE; e.cool2 = ACE_NERVE; e.vx = coming.x <= e.x ? 1 : -1; }
        if (e.burst > 0) { e.burst -= td; e.x = Math.max(30, Math.min(field.width - 30, e.x + e.vx * 330 * td)); }
        else e.x = towards(e.x, want, 170 * td);
        e.y = level + Math.sin(e.age * 2) * 12;
        e.heading = DOWN;
        e.cool -= td;
        if (e.cool <= 0 && p.alive) { e.cool = 1.15; const aim = aimOf(e, roundSpeed(g.stage)); for (const turn of [-0.09, 0.09]) fire(e, roundSpeed(g.stage), aim + turn); }
      } else { e.y -= 280 * td; e.heading = -DOWN; if (e.y < -50) e.gone = true; } // had enough: away
    } else if (e.kind === "mine") {
      // It drifts across towards the column you're in. (smarter)
      if (p.alive) e.home = towards(e.home, them.x / field.width, (MINE_DRIFT / field.width) * td);
      e.x = e.home * field.width + Math.sin(e.age * 1.3) * 14;
      e.y = -30 + 55 * e.age;
      e.heading = -DOWN; // (it's round: drawn the same whichever way)
      if (e.y > field.height + 30) e.gone = true;
    } else if (e.kind === "carrier") {
      // Straight down the screen at its own pace, bow first, sending its scouts up at you one
      // after another and firing from the gun at each end in turn.
      e.x = e.home * field.width;
      e.y = -HULL.long - 30 + CARRIER_SPEED * e.age;
      e.heading = DOWN;
      if (e.y > field.height + HULL.long + 30) e.gone = true; // it got past you
      else if (p.alive && e.y > 20 && e.y < field.height - 60) {
        if (e.fired < CARRIER_PLANES && (e.cool -= td) <= 0) {
          e.cool = CARRIER_LAUNCHES;
          e.fired++;
          const bow = { x: e.x, y: e.y + HULL.long - 16 }, a = Math.atan2(them.y - bow.y, them.x - bow.x);
          g.enemies.push(newEnemy("scout", { ...bow, heading: a, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230, cool: 0.7 }));
          g.flew++;
        }
        if ((e.cool2 -= td) <= 0) {
          e.cool2 = CARRIER_GUNS;
          e.burst = e.burst ? 0 : 1; // the bow gun, then the stern gun
          const gun = { x: e.x + (e.burst ? 9 : -9), y: e.y + (e.burst ? 34 : -34) };
          fire(gun, roundSpeed(g.stage), aimOf(e, roundSpeed(g.stage), gun));
        }
      }
    } else if (e.kind === "chaser") {
      // Waiting below the bottom of the screen, under you (the warning), then up your column from
      // behind; once it's past you, a pair back down at you, on its way out.
      if (e.age < CHASE_WARN) { e.x = towards(e.x, p.alive ? them.x : e.x, 260 * td); e.y = field.height + 40; }
      else {
        e.y -= CHASER_SPEED * td;
        if (p.alive && e.y > them.y) e.x = towards(e.x, them.x, CHASER_STEER * td);
        else if (e.fired === 0 && p.alive && e.y < p.y - 70) { e.fired = 1; const aim = aimOf(e, roundSpeed(g.stage)); for (const turn of [-0.1, 0.1]) fire(e, roundSpeed(g.stage), aim + turn); }
        if (e.y < -50) e.gone = true;
      }
      e.heading = -DOWN;
    } else if (e.kind === "gunship") {
      // Down to a quarter of the way, drifting from side to side, nose turned slowly towards you
      // (and its armour with it), firing pairs where the nose points. Come at it from the side.
      const level = field.height * 0.22;
      if (e.age < 1.2) { e.x = e.home * field.width; e.y = -40 + (level + 40) * (e.age / 1.2); e.heading = DOWN; }
      else if (e.age < 1.2 + GUNSHIP_STAYS) {
        e.x = Math.max(40, Math.min(field.width - 40, e.home * field.width + Math.sin((e.age - 1.2) * 0.6) * field.width * 0.18));
        e.y = level + Math.sin(e.age * 1.7) * 8;
        const want = DOWN - Math.max(-1.3, Math.min(1.3, ((p.alive ? them.x : e.x) - e.x) / GUNSHIP_REACH));
        e.heading = towards(e.heading, want, GUNSHIP_TURN * td);
        if ((e.cool -= td) <= 0 && p.alive) { e.cool = GUNSHIP_FIRES; for (const turn of [-0.07, 0.07]) fire(e, roundSpeed(g.stage), e.heading + turn); }
      } else { e.y -= 200 * td; e.heading = towards(e.heading, DOWN, GUNSHIP_TURN * td); if (e.y < -60) e.gone = true; }
    } else if (e.kind === "boat") {
      // A missile boat, down the screen on the water like the carrier, firing missiles that home in on you.
      e.x = e.home * field.width;
      e.y = -BOAT_HULL.long - 30 + BOAT_SPEED * e.age;
      e.heading = DOWN;
      if (e.y > field.height + BOAT_HULL.long + 30) e.gone = true;
      else if (p.alive && e.y > 20 && e.y < field.height - 80 && e.fired < BOAT_MISSILES && (e.cool -= td) <= 0) {
        e.cool = BOAT_FIRES;
        e.fired++;
        g.missiles.push({ x: e.x, y: e.y + 12, heading: Math.atan2(them.y - e.y, them.x - e.x), age: 0, gone: false });
      }
    } else if (e.kind === "balloon") {
      // Down with the wind, swaying on its cable; cut loose, up and away.
      if (e.fired) { e.vy -= 90 * td; e.y += e.vy * td; if (e.y < -80) e.gone = true; }
      else { e.y = -40 + BALLOON_SPEED * e.age; if (e.y > field.height + CABLE + 40) e.gone = true; }
      e.x = e.home * field.width + Math.sin(e.age * 0.8) * 18;
      e.heading = DOWN;
    } else if (e.kind === "flagship") {
      // Down to the top of the screen, then back and forth along it for as long as it lasts.
      const level = field.height * 0.17, t = Math.max(0, e.age - 1.5);
      e.y = e.age < 1.5 ? -90 + (level + 90) * (e.age / 1.5) : level + Math.sin(e.age * 1.1) * 10;
      e.x = field.width / 2 + Math.sin(t * 0.7) * field.width * 0.32;
      e.heading = DOWN;
      if (e.age >= 1.5 && p.alive) {
        const rate = e.hp * 2 <= e.hpMax ? 0.7 : 1; // half done for, and angrier
        const hurt = rate < 1, here = Math.atan2(them.y - e.y, them.x - e.x), nose = { x: e.x, y: e.y + 20 };
        // One gun: a fan of five at where you are; and, once it's hurt, every third time a wall
        // right across with one gap in it to find. (smarter)
        if ((e.cool -= td) <= 0) {
          e.cool = 1.7 * rate;
          e.fired++;
          if (hurt && e.fired % 3 === 0) for (const a of wall(e.fired / 3)) fire(e, roundSpeed(g.stage) * 0.7, a);
          else for (const turn of [-0.5, -0.25, 0, 0.25, 0.5]) fire(e, roundSpeed(g.stage) * 0.85, here + turn);
        }
        // The other: three in a row at where you're going to be. Between them, standing still and running are both wrong. (smarter)
        if ((e.cool2 -= td) <= 0) { if (e.burst <= 0) e.burst = 3; fire(nose, roundSpeed(g.stage) * 1.15, aimOf(e, roundSpeed(g.stage) * 1.15, nose)); e.burst--; e.cool2 = e.burst > 0 ? 0.14 : 2.6 * rate; }
      }
    } else {
      // A drone, out of a hauler: straight on the way it was thrown, one round on the way.
      e.x += e.vx * td; e.y += e.vy * td;
      // (And a flight that's lost its leader, running for it, any way out.)
      if (e.cool > 0 && (e.cool -= td) <= 0 && p.alive) fire(e, roundSpeed(g.stage), leadAim(e, them, roundSpeed(g.stage), 0.5));
      if (off || e.y < -80) e.gone = true;
    }
    if (e.gone) continue;
    // Flying into one costs you the plane (and anything small, its own).
    if (SHIPS.has(e.kind)) continue; // (it's down on the water: you fly over it)
    if (exposed() && near(e, p, ENEMY[e.kind].size * 0.7 + PLAYER_SIZE)) { if (LIGHT.has(e.kind)) down(e); struck(); }
    else if (p.alive && p.loop <= 0) g.wingmen.forEach((there, i) => { if (there && !e.gone && near(e, wingAt(g, i), ENEMY[e.kind].size * 0.7 + WING_SIZE)) { loseWing(i); if (LIGHT.has(e.kind)) down(e); } });
  }

  // ---------- Missiles ----------
  // Slow, turning after you (or where they last saw you) until they run out.
  g.missiles = g.missiles.filter((m) => {
    m.age += td;
    if (m.gone) return false;
    if (m.age > MISSILE_LIFE) { events.push({ type: "spark", x: m.x, y: m.y }); return false; }
    if (p.alive) {
      const want = Math.atan2(them.y - m.y, them.x - m.x), turn = Math.atan2(Math.sin(want - m.heading), Math.cos(want - m.heading));
      m.heading += Math.max(-MISSILE_TURN * td, Math.min(MISSILE_TURN * td, turn));
    }
    m.x += Math.cos(m.heading) * MISSILE_SPEED * td; m.y += Math.sin(m.heading) * MISSILE_SPEED * td;
    if (m.x < -30 || m.y < -30 || m.x > field.width + 30 || m.y > field.height + 30) return false;
    if (exposed() && near(m, p, MISSILE_SIZE + PLAYER_SIZE)) { events.push({ type: "boom", x: m.x, y: m.y, big: false }); struck(); return false; }
    const i = p.alive && p.loop <= 0 ? g.wingmen.findIndex((there, k) => there && near(m, wingAt(g, k), MISSILE_SIZE + WING_SIZE)) : -1;
    if (i >= 0) { loseWing(i); return false; }
    return true;
  });

  // ---------- Flak ----------
  // A patch of sky marked where they see you, and a moment later it goes off. Loop through it for a bonus.
  g.flak = g.flak.filter((f) => {
    if (f.wait > 0) {
      if ((f.wait -= td) > 0) return true;
      if (!p.alive) return false;
      f.x = them.x; f.y = them.y;
      return true;
    }
    if ((f.fuse -= td) > 0) return true;
    events.push({ type: "flak", x: f.x, y: f.y });
    if (p.alive && near(f, p, FLAK_RADIUS)) {
      if (p.loop > 0) { g.score += FLAK_DODGE; events.push({ type: "dodge", x: p.x, y: p.y, n: FLAK_DODGE }); }
      else if (exposed()) struck();
    } else if (p.alive && p.loop <= 0) {
      const i = g.wingmen.findIndex((there, k) => there && near(f, wingAt(g, k), FLAK_RADIUS));
      if (i >= 0) loseWing(i);
    }
    return false;
  });

  // ---------- Your rounds ----------
  const hull = (e: Enemy) => (e.kind === "carrier" ? HULL : BOAT_HULL);
  const body = (e: Enemy, s: Pt) => near(e, s, ENEMY[e.kind].size + SHOT_SIZE);
  // A balloon's cable, straight down from it (until it's been cut).
  const cable = (e: Enemy, s: Pt) => !e.fired && Math.abs(s.x - e.x) <= CABLE_WIDE + SHOT_SIZE && s.y > e.y && s.y < e.y + ENEMY.balloon.size + CABLE;
  const hits = (e: Enemy, s: Pt) => SHIPS.has(e.kind)
    ? Math.abs(s.x - e.x) <= hull(e).wide + SHOT_SIZE && Math.abs(s.y - e.y) <= hull(e).long + SHOT_SIZE // anywhere on its hull
    : body(e, s) || (e.kind === "balloon" && cable(e, s));
  g.shots = g.shots.filter((s) => {
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.y < -12) return false;
    const m = g.missiles.find((it) => !it.gone && near(it, s, MISSILE_SIZE + SHOT_SIZE));
    if (m) { m.gone = true; events.push({ type: "boom", x: m.x, y: m.y, big: false }); award(m, MISSILE_POINTS); return false; }
    const e = g.enemies.find((it) => !it.gone && it.age >= 0 && hits(it, s));
    if (!e) return true;
    // A balloon stops a round; its cable, cut, lets it go (and what it was guarding: a crate).
    if (e.kind === "balloon") {
      if (body(e, s)) { events.push({ type: "block", x: s.x, y: s.y }); return false; }
      e.fired = 1; e.vy = -30;
      events.push({ type: "spark", x: s.x, y: s.y });
      award(e, ENEMY.balloon.points);
      g.crates.push({ x: s.x, y: s.y, what: g.loops < LOOPS_MAX ? "loop" : "medal", age: 0 });
      return false;
    }
    if (shielded(e)) { events.push({ type: "block", x: s.x, y: s.y }); return false; } // off the gunship's armour
    e.hp--;
    if (e.hp > 0) { e.hurt = 0.1; events.push({ type: "spark", x: s.x, y: s.y }); return false; }
    down(e);
    if (has(g, "pierce") && !s.spent) { s.spent = true; return true; } // on into the next
    return false;
  });

  // ---------- Theirs ----------
  g.rounds = g.rounds.filter((r) => {
    r.x += r.vx * td; r.y += r.vy * td;
    if (r.x < -20 || r.y < -20 || r.x > field.width + 20 || r.y > field.height + 20) return false;
    if (!p.alive || p.loop > 0) return true; // (a loop takes the wingmen over the top with you)
    if (p.safe <= 0 && near(r, p, ROUND_SIZE + PLAYER_SIZE)) { struck(); return false; }
    const i = g.wingmen.findIndex((there, k) => there && near(r, wingAt(g, k), ROUND_SIZE + WING_SIZE));
    if (i < 0) return true;
    loseWing(i);
    return false;
  });
  g.enemies = g.enemies.filter((e) => !e.gone);
  g.missiles = g.missiles.filter((m) => !m.gone);

  // ---------- Crates ----------
  g.crates = g.crates.filter((c) => {
    c.age += dt;
    c.y += 80 * dt;
    if (p.alive && has(g, "magnet")) c.x = towards(c.x, p.x, MAGNET * dt);
    if (c.y > field.height + 30) return false;
    if (!p.alive || p.loop > 0 || !near(c, p, CRATE_SIZE + PLAYER_SIZE)) return true;
    if (c.what === "wingmen") g.wingmen = g.wingmen.map(() => true);
    else if (c.what === "loop") g.loops = Math.min(LOOPS_MAX, g.loops + 1);
    else if (c.what === "gun") g.guns = Math.min(GUNS_MAX, g.guns + 1);
    else g.score += MEDAL;
    events.push({ type: "pickup", x: c.x, y: c.y, what: c.what });
    return false;
  });

  // ---------- The end of the stage ----------
  if (g.phase === "play" && g.boss === "done" && g.enemies.every(scenery) && !g.rounds.length) {
    const percent = g.flew ? Math.round((100 * g.downed) / g.flew) : 0, clean = g.lost === 0;
    g.tally = { downed: g.downed, flew: g.flew, percent, clean, bonus: percent * 20 * g.stage + (clean ? CLEAN_BONUS * g.stage : 0) };
    g.score += g.tally.bonus;
    g.phase = "tally"; g.since = 0;
  }
  // Another plane, every so many points.
  while (g.score >= g.nextLife) {
    g.nextLife += EXTRA_EVERY;
    if (g.lives < LIVES_MAX && g.phase !== "over") { g.lives++; events.push({ type: "extra", x: p.x, y: p.y }); }
  }
  return events;
}
