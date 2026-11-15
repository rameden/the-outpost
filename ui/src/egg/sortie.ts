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
//   flagship   ends every stage: back and forth along the top with two guns' worth of patterns,
//              faster once it's half done for.
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
export type EnemyKind = "scout" | "heavy" | "ferry" | "dart" | "ace" | "mine" | "hauler" | "carrier" | "flagship";
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
};
// The ones a collision brings down along with you. (Anything bigger flies on.)
const LIGHT: ReadonlySet<EnemyKind> = new Set(["scout", "ferry", "dart", "mine"]);
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
};
export type Shot = Pt & { vx: number; vy: number };
export type CrateKind = "wingmen" | "loop" | "gun" | "medal";
export type SortieCrate = Pt & { what: CrateKind; age: number };

// How far ahead of you they aim: 0 at where you are, 1 at exactly where you'll be if you keep
// going as you are. The scouts get better at it every stage.
export const leadOf = (kind: EnemyKind, stage: number) =>
  kind === "ace" || kind === "flagship" ? 1 : kind === "scout" ? Math.min(0.75, 0.25 * (stage - 1)) : kind === "dart" ? 0.6 : 0.5;
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

// ---------- The stages ----------
// A stage is its formations, in the order they come: `at` seconds in, `count` aircraft a `gap`
// apart. On a path they follow one another along it; the ones that fly themselves come in
// spread across the top (`xs`: where, as shares of the width).
export type Wave = { at: number; kind: EnemyKind; path: PathName | null; count: number; gap: number; mirror: boolean; xs?: number[] };
const wave = (at: number, path: PathName, count: number, mirror = false): Wave =>
  ({ at, path, count, mirror, gap: 0.38, kind: path === "prowl" ? "heavy" : path === "ferry" ? "ferry" : path === "haul" ? "hauler" : "scout" });
const spread = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
const darts = (at: number, count: number): Wave => ({ at, kind: "dart", path: null, count, gap: 0.45, mirror: false, xs: spread(count) });
const ace = (at: number, mirror = false): Wave => ({ at, kind: "ace", path: null, count: 1, gap: 0, mirror, xs: [mirror ? 0.75 : 0.25] });
const mines = (at: number, xs: number[]): Wave => ({ at, kind: "mine", path: null, count: xs.length, gap: 0.6, mirror: false, xs });
const carrier = (at: number, x: number): Wave => ({ at, kind: "carrier", path: null, count: 1, gap: 0, mirror: false, xs: [x] });
export const STAGES: Wave[][] = [
  [wave(1.5, "sweep", 5), wave(6.5, "sweep", 5, true), wave(11.5, "dive", 4), wave(15, "ferry", 1), darts(17, 3), wave(20, "cross", 5, true),
    carrier(22, 0.72), wave(24.5, "hook", 4), mines(27, [0.3, 0.7]), wave(30, "sweep", 6), wave(32, "dive", 4, true), wave(36.5, "weave", 5)],
  [wave(1.5, "cross", 5), wave(3.5, "cross", 5, true), ace(7), wave(9, "hook", 5), wave(11, "hook", 5, true), carrier(13, 0.3), darts(15, 4), wave(18, "prowl", 1),
    wave(20, "sweep", 6), wave(24, "ferry", 1, true), wave(25, "haul", 1), wave(28, "weave", 6), mines(31, [0.2, 0.5, 0.8]), wave(33, "dive", 5),
    wave(34, "dive", 5, true), ace(38, true), wave(40, "sweep", 6, true)],
  [wave(1.5, "weave", 6), wave(4, "sweep", 6), wave(5.5, "sweep", 6, true), carrier(8, 0.25), darts(9, 5), wave(12, "prowl", 1), wave(14, "hook", 6), wave(17, "ferry", 1),
    wave(18, "haul", 1), ace(20), ace(21, true), wave(24, "cross", 6), wave(25.5, "cross", 6, true), carrier(27, 0.7), mines(28, [0.15, 0.4, 0.6, 0.85]), wave(30, "dive", 6),
    wave(32, "hook", 6, true), wave(35, "haul", 1, true), wave(37, "prowl", 1), wave(38, "prowl", 1, true), darts(41, 5), wave(43, "weave", 7), wave(45, "sweep", 7)],
];
// After the last one they come round again, harder (the rounds fly faster each stage, and the flagship takes more).
export const wavesOf = (stage: number) => STAGES[(stage - 1) % STAGES.length];

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
export const WING_OUT = 46, WING_BACK = 14; // where a wingman flies, from your middle
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

// ---------- The game ----------
// intro: the stage's name is up. play: formations are coming. tally: the stage is over, and its
// score is up until you fire. over: no planes left.
export type Phase = "intro" | "play" | "tally" | "over";
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
  boss: "none" | "out" | "done"; // the stage's flagship: not yet, up, shot down
  score: number; lives: number; nextLife: number; loops: number; guns: number; wingmen: [boolean, boolean];
  chain: number; chainFor: number; // kills in the chain so far, and the seconds left to add to it
  player: Player;
  enemies: Enemy[]; shots: Shot[]; rounds: Shot[]; crates: SortieCrate[];
  squads: { size: number; downed: number }[]; // this stage's formations: how many flew, and how many of them you got
  flew: number; downed: number; lost: number; // this stage: aircraft that came in, how many you shot down, planes of yours lost
  tally: Tally | null;
  scroll: number;
};
// What the keys say this moment. loop and go are true only on the frame the key goes down.
export type Input = { x: number; y: number; fire: boolean; loop: boolean; go: boolean };
// What just happened, for the drawing to make something of (an explosion, a number floating up).
export type SortieEvent =
  | { type: "boom"; x: number; y: number; big: boolean }
  | { type: "spark"; x: number; y: number }
  | { type: "points"; x: number; y: number; n: number; times: number }
  | { type: "flight"; x: number; y: number; n: number } // a whole formation shot down
  | { type: "pickup"; x: number; y: number; what: CrateKind }
  | { type: "extra"; x: number; y: number } // another plane earned
  | { type: "warning" } // the flagship is coming
  | { type: "lost"; x: number; y: number };

const startAt = (field: Field): Pt => ({ x: field.width / 2, y: field.height - 80 });
const newPlayer = (field: Field): Player => ({ ...startAt(field), alive: true, down: 0, safe: SAFE, loop: 0, cool: 0, lean: 0, vx: 0, vy: 0 });
const DOWN = Math.PI / 2;

export function newGame(field: Field): Game {
  return {
    phase: "intro", since: 0, stage: 1, clock: 0, nextWave: 0, boss: "none",
    score: 0, lives: LIVES, nextLife: EXTRA_EVERY, loops: LOOPS, guns: 1, wingmen: [false, false],
    chain: 0, chainFor: 0,
    player: newPlayer(field), enemies: [], shots: [], rounds: [], crates: [],
    squads: [], flew: 0, downed: 0, lost: 0, tally: null, scroll: 0,
  };
}

// An aircraft, coming in. (Its place is set as it flies; this is only what it starts with.)
export function newEnemy(kind: EnemyKind, over: Partial<Enemy> = {}): Enemy {
  return {
    kind, path: null, mirror: false, age: 0, x: 0, y: -60, heading: DOWN, hp: ENEMY[kind].hp, hpMax: ENEMY[kind].hp,
    fired: 0, hurt: 0, gone: false, squad: -1, home: 0.5, vx: 0, vy: 0, cool: 1, cool2: 2, burst: 0, jink: 0, off: 0, snappy: false, ...over,
  };
}

export const looping = (g: Game) => g.player.loop > 0;
// Where wingman 0 (on the left) or 1 (on the right) is flying.
export const wingAt = (g: Game, i: number): Pt => ({ x: g.player.x + (i ? WING_OUT : -WING_OUT), y: g.player.y + WING_BACK });
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
  if (g.phase === "over" && g.since > 1 && input.go) Object.assign(g, newGame(field));
  if (g.phase === "tally" && g.since > 1 && input.go) {
    Object.assign(g, { phase: "intro", since: 0, stage: g.stage + 1, clock: 0, nextWave: 0, boss: "none", squads: [], flew: 0, downed: 0, lost: 0, tally: null, loops: LOOPS, rounds: [], enemies: [] });
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
    p.y = Math.max(40, Math.min(field.height - 30, p.y + (input.y / len) * v * dt));
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
  // Up in a loop, or just come on: nothing can touch it.
  const exposed = () => p.alive && p.loop <= 0 && p.safe <= 0;
  const lose = () => {
    events.push({ type: "lost", x: p.x, y: p.y });
    p.alive = false; p.down = RESPAWN; p.loop = 0; p.vx = p.vy = 0;
    g.wingmen = [false, false];
    g.guns = Math.max(1, g.guns - 1); // the next plane's guns are a step back
    g.chain = 0; g.chainFor = 0;
    g.lives--; g.lost++;
    if (g.lives <= 0) { g.phase = "over"; g.since = 0; }
  };
  const loseWing = (i: number) => { const w = wingAt(g, i); g.wingmen[i] = false; events.push({ type: "boom", x: w.x, y: w.y, big: false }); };
  // You've been hit. A wingman takes it for you if you have one (and you're clear for a moment
  // after, so the same round doesn't take the next); with none left, it's the plane.
  const struck = () => {
    const i = g.wingmen.indexOf(true);
    if (i < 0) return lose();
    loseWing(i);
    p.safe = Math.max(p.safe, WING_SAVES);
  };
  // A round from an enemy, at an angle.
  const fire = (e: Pt, speed: number, angle: number) => { g.rounds.push({ x: e.x, y: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }); };
  // The angle one of them shoots at to hit you: ahead of the way you're going, as far as its kind can judge it. (smarter)
  const aimOf = (e: Enemy, speed: number, from: Pt = e) => leadAim(from, p, speed, leadOf(e.kind, g.stage));

  // ---------- The formations ----------
  if (g.phase === "play") {
    g.clock += dt;
    const waves = wavesOf(g.stage);
    for (; g.nextWave < waves.length && g.clock >= waves[g.nextWave].at; g.nextWave++) {
      const w = waves[g.nextWave];
      for (let i = 0; i < w.count; i++) {
        g.enemies.push(newEnemy(w.kind, {
          path: w.path, mirror: w.mirror, age: -i * w.gap, squad: g.nextWave, home: w.xs?.[i] ?? 0.5,
          snappy: w.kind === "scout" && (g.stage > 1 || i % 2 === 1), // every other scout at first, then all of them
          ...(w.path ? onPath(w.path, 0, w.mirror, field) : { x: (w.xs?.[i] ?? 0.5) * field.width }),
        }));
      }
      g.squads[g.nextWave] = { size: w.count, downed: 0 };
      g.flew += w.count;
    }
    // And when the last of them has gone, the flagship.
    if (g.boss === "none" && g.nextWave >= waves.length && !g.enemies.length) {
      g.boss = "out";
      g.enemies.push(newEnemy("flagship", { hp: flagshipHp(g.stage), hpMax: flagshipHp(g.stage), x: field.width / 2, y: -90 }));
      g.flew++;
      events.push({ type: "warning" });
    }
  }

  const down = (e: Enemy) => {
    e.gone = true;
    g.downed++;
    g.chain = g.chainFor > 0 ? g.chain + 1 : 1;
    g.chainFor = CHAIN_WINDOW;
    const times = chainTimes(g.chain), n = ENEMY[e.kind].points * times;
    g.score += n;
    events.push({ type: "boom", x: e.x, y: e.y, big: e.hpMax > 1 }, { type: "points", x: e.x, y: e.y, n, times });
    // The ferry was carrying something: wingmen, or another loop if you have both already.
    if (e.kind === "ferry") g.crates.push({ x: e.x, y: e.y, what: g.wingmen[0] && g.wingmen[1] ? "loop" : "wingmen", age: 0 });
    // A mine goes off: a ring of slow rounds, all the way round.
    if (e.kind === "mine") for (let i = 0; i < MINE_RING; i++) fire(e, 150, (i / MINE_RING) * Math.PI * 2 + Math.PI / MINE_RING);
    // The rest of its formation break their line, one to each side in turn, so the next burst doesn't get them all. (smarter)
    if (e.path && g.squads[e.squad]?.size >= 3) {
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
      g.crates.push({ x: e.x, y: e.y, what: g.wingmen[0] && g.wingmen[1] ? "medal" : "wingmen", age: 0 });
    }
    if (e.kind === "flagship") {
      g.boss = "done";
      g.rounds = []; // its guns stop with it
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
    e.age += dt;
    if (e.hurt > 0) e.hurt -= dt;
    if (e.age < 0 || e.gone) continue;
    const off = e.x < -60 || e.x > field.width + 60 || e.y > field.height + 60;
    if (e.path) {
      const path = PATHS[e.path], u = e.age / path.lasts;
      if (u >= 1) { e.gone = true; continue; } // it got away
      const at = onPath(e.path, u, e.mirror, field);
      e.off = towards(e.off, e.jink, 140 * dt); // out of line, if its formation has broken
      Object.assign(e, { x: at.x - Math.sin(at.heading) * e.off, y: at.y + Math.cos(at.heading) * e.off, heading: at.heading });
      const onField = e.y > 0 && e.y < field.height && e.x > 0 && e.x < field.width;
      // Its guns: a round at you (three in a fan from a heavy), at each point of its path that says so.
      while (e.fired < path.fires.length && u >= path.fires[e.fired]) {
        e.fired++;
        if (!p.alive || !onField) continue;
        const aim = aimOf(e, roundSpeed(g.stage));
        for (const turn of e.kind === "heavy" ? [-0.28, 0, 0.28] : [0]) fire(e, roundSpeed(g.stage), aim + turn);
      }
      // And one more, once, for a plane sitting right under its path waiting for it. (smarter)
      if (e.snappy && onField && p.alive && Math.abs(p.x - e.x) < 50 && p.y > e.y + 90) { e.snappy = false; fire(e, roundSpeed(g.stage), aimOf(e, roundSpeed(g.stage))); }
    } else if (e.kind === "dart") {
      if (e.vx === 0 && e.vy === 0) {
        // At the top, sliding across to line up, nose on you the whole time: this is the warning.
        e.y = -30 + 90 * Math.min(1, e.age / DART_LINES_UP);
        if (e.age < dt * 1.5) e.x = e.home * field.width;
        e.x = towards(e.x, p.alive ? p.x : e.x, 200 * dt);
        e.heading = p.alive ? Math.atan2(p.y - e.y, p.x - e.x) : DOWN;
        // …and then it goes: at where you were, and a little ahead of the way you were going. (smarter)
        if (e.age >= DART_LINES_UP) { const a = p.alive ? aimOf(e, DART_SPEED) : e.heading; e.vx = Math.cos(a) * DART_SPEED; e.vy = Math.sin(a) * DART_SPEED; e.heading = a; }
      } else {
        e.x += e.vx * dt; e.y += e.vy * dt;
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
        const want = Math.max(40, Math.min(field.width - 40, (p.alive ? p.x : e.x) + side * ACE_OFF));
        e.cool2 -= dt;
        const coming = g.shots.find((s) => Math.abs(s.x - e.x) < 24 && s.y > e.y + 20 && s.y - e.y < 240);
        if (coming && e.cool2 <= 0 && e.burst <= 0) { e.burst = ACE_DODGE; e.cool2 = ACE_NERVE; e.vx = coming.x <= e.x ? 1 : -1; }
        if (e.burst > 0) { e.burst -= dt; e.x = Math.max(30, Math.min(field.width - 30, e.x + e.vx * 330 * dt)); }
        else e.x = towards(e.x, want, 170 * dt);
        e.y = level + Math.sin(e.age * 2) * 12;
        e.heading = DOWN;
        e.cool -= dt;
        if (e.cool <= 0 && p.alive) { e.cool = 1.15; const aim = aimOf(e, roundSpeed(g.stage)); for (const turn of [-0.09, 0.09]) fire(e, roundSpeed(g.stage), aim + turn); }
      } else { e.y -= 280 * dt; e.heading = -DOWN; if (e.y < -50) e.gone = true; } // had enough: away
    } else if (e.kind === "mine") {
      // It drifts across towards the column you're in. (smarter)
      if (p.alive) e.home = towards(e.home, p.x / field.width, (MINE_DRIFT / field.width) * dt);
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
        if (e.fired < CARRIER_PLANES && (e.cool -= dt) <= 0) {
          e.cool = CARRIER_LAUNCHES;
          e.fired++;
          const bow = { x: e.x, y: e.y + HULL.long - 16 }, a = Math.atan2(p.y - bow.y, p.x - bow.x);
          g.enemies.push(newEnemy("scout", { ...bow, heading: a, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230, cool: 0.7 }));
          g.flew++;
        }
        if ((e.cool2 -= dt) <= 0) {
          e.cool2 = CARRIER_GUNS;
          e.burst = e.burst ? 0 : 1; // the bow gun, then the stern gun
          const gun = { x: e.x + (e.burst ? 9 : -9), y: e.y + (e.burst ? 34 : -34) };
          fire(gun, roundSpeed(g.stage), aimOf(e, roundSpeed(g.stage), gun));
        }
      }
    } else if (e.kind === "flagship") {
      // Down to the top of the screen, then back and forth along it for as long as it lasts.
      const level = field.height * 0.17, t = Math.max(0, e.age - 1.5);
      e.y = e.age < 1.5 ? -90 + (level + 90) * (e.age / 1.5) : level + Math.sin(e.age * 1.1) * 10;
      e.x = field.width / 2 + Math.sin(t * 0.7) * field.width * 0.32;
      e.heading = DOWN;
      if (e.age >= 1.5 && p.alive) {
        const rate = e.hp * 2 <= e.hpMax ? 0.7 : 1; // half done for, and angrier
        const hurt = rate < 1, here = Math.atan2(p.y - e.y, p.x - e.x), nose = { x: e.x, y: e.y + 20 };
        // One gun: a fan of five at where you are; and, once it's hurt, every third time a wall
        // right across with one gap in it to find. (smarter)
        if ((e.cool -= dt) <= 0) {
          e.cool = 1.7 * rate;
          e.fired++;
          if (hurt && e.fired % 3 === 0) for (const a of wall(e.fired / 3)) fire(e, roundSpeed(g.stage) * 0.7, a);
          else for (const turn of [-0.5, -0.25, 0, 0.25, 0.5]) fire(e, roundSpeed(g.stage) * 0.85, here + turn);
        }
        // The other: three in a row at where you're going to be. Between them, standing still and running are both wrong. (smarter)
        if ((e.cool2 -= dt) <= 0) { if (e.burst <= 0) e.burst = 3; fire(nose, roundSpeed(g.stage) * 1.15, aimOf(e, roundSpeed(g.stage) * 1.15, nose)); e.burst--; e.cool2 = e.burst > 0 ? 0.14 : 2.6 * rate; }
      }
    } else {
      // A drone, out of a hauler: straight on the way it was thrown, one round on the way.
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.cool > 0 && (e.cool -= dt) <= 0 && p.alive) fire(e, roundSpeed(g.stage), leadAim(e, p, roundSpeed(g.stage), 0.5));
      if (off) e.gone = true;
    }
    if (e.gone) continue;
    // Flying into one costs you the plane (and anything small, its own).
    if (e.kind === "carrier") continue; // (it's down on the water: you fly over it)
    if (exposed() && near(e, p, ENEMY[e.kind].size * 0.7 + PLAYER_SIZE)) { if (LIGHT.has(e.kind)) down(e); struck(); }
    else if (p.alive && p.loop <= 0) g.wingmen.forEach((there, i) => { if (there && !e.gone && near(e, wingAt(g, i), ENEMY[e.kind].size * 0.7 + WING_SIZE)) { loseWing(i); if (LIGHT.has(e.kind)) down(e); } });
  }

  // ---------- Your rounds ----------
  g.shots = g.shots.filter((s) => {
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.y < -12) return false;
    const e = g.enemies.find((it) => !it.gone && it.age >= 0 && (it.kind === "carrier"
      ? Math.abs(s.x - it.x) <= HULL.wide + SHOT_SIZE && Math.abs(s.y - it.y) <= HULL.long + SHOT_SIZE // anywhere on its hull
      : near(it, s, ENEMY[it.kind].size + SHOT_SIZE)));
    if (!e) return true;
    e.hp--;
    if (e.hp <= 0) down(e); else { e.hurt = 0.1; events.push({ type: "spark", x: s.x, y: s.y }); }
    return false;
  });

  // ---------- Theirs ----------
  g.rounds = g.rounds.filter((r) => {
    r.x += r.vx * dt; r.y += r.vy * dt;
    if (r.x < -20 || r.y < -20 || r.x > field.width + 20 || r.y > field.height + 20) return false;
    if (!p.alive || p.loop > 0) return true; // (a loop takes the wingmen over the top with you)
    if (p.safe <= 0 && near(r, p, ROUND_SIZE + PLAYER_SIZE)) { struck(); return false; }
    const i = g.wingmen.findIndex((there, k) => there && near(r, wingAt(g, k), ROUND_SIZE + WING_SIZE));
    if (i < 0) return true;
    loseWing(i);
    return false;
  });
  g.enemies = g.enemies.filter((e) => !e.gone);

  // ---------- Crates ----------
  g.crates = g.crates.filter((c) => {
    c.age += dt;
    c.y += 80 * dt;
    if (c.y > field.height + 30) return false;
    if (!p.alive || p.loop > 0 || !near(c, p, CRATE_SIZE + PLAYER_SIZE)) return true;
    if (c.what === "wingmen") g.wingmen = [true, true];
    else if (c.what === "loop") g.loops = Math.min(LOOPS_MAX, g.loops + 1);
    else if (c.what === "gun") g.guns = Math.min(GUNS_MAX, g.guns + 1);
    else g.score += MEDAL;
    events.push({ type: "pickup", x: c.x, y: c.y, what: c.what });
    return false;
  });

  // ---------- The end of the stage ----------
  if (g.phase === "play" && g.boss === "done" && !g.enemies.length && !g.rounds.length) {
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
