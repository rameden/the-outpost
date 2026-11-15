// The Sortie's rules: the flight paths, flying and firing, the loop, wingmen, and how a stage ends.
import { expect, test } from "vitest";
import {
  ACE_DODGE, ACE_NERVE, ACE_OFF, ACE_STAYS, ACE_SWAPS, BREAK, CARRIER_GUNS, CARRIER_LAUNCHES, CARRIER_PLANES, CARRIER_SPEED, CHAIN_WINDOW, HULL, WING_SAVES, CLEAN_BONUS, DART_LINES_UP, DRONES, ENEMY, EXTRA_EVERY, FIRE_EVERY, FLIGHT_BONUS, GUNS_MAX, INTRO, LIVES, LIVES_MAX, LOOPS, LOOPS_MAX,
  LOOP_LASTS, LOOP_REACH, MEDAL, MINE_RING, PATHS, SAFE, SPEED, STAGES, WING_OUT,
  along, chainTimes, flagshipHp, gunsAt, leadAim, leadOf, liningUp, loopPose, wall, looping, newEnemy, newGame, onPath, roundSpeed, speedOn, step, wavesOf, wingAt,
  type Enemy, type EnemyKind, type Game, type Input, type PathName, type SortieEvent,
} from "./sortie.ts";

const field = { width: 700, height: 900 };
const still: Input = { x: 0, y: 0, fire: false, loop: false, go: false };
const run = (g: Game, input: Partial<Input>, seconds: number): SortieEvent[] => {
  const events: SortieEvent[] = [];
  for (let i = 0, n = Math.round(seconds * 60); i < n; i++) events.push(...step(g, { ...still, ...input }, 1 / 60, field));
  return events;
};
// A game under way with a plane that can be hit, and a clear sky: the stage's own formations
// are held back (its clock is wound a long way back), so each test has only what it puts up.
const playing = (): Game => { const g = newGame(field); run(g, {}, INTRO + 0.05); g.player.safe = 0; g.clock = -1e6; return g; };
// An enemy put straight onto the field, part-way along a path.
const enemy = (g: Game, kind: EnemyKind, path: PathName, u: number): Enemy => {
  const e = newEnemy(kind, { path, age: u * PATHS[path].lasts, ...onPath(path, u, false, field), fired: 99 });
  g.enemies.push(e);
  return e;
};
// One that flies itself (a dart, an ace, a mine, the flagship), just coming in.
const free = (g: Game, kind: EnemyKind, over: Partial<Enemy> = {}): Enemy => { const e = newEnemy(kind, over); g.enemies.push(e); return e; };
// Rounds of yours, put right on an aircraft: enough to bring it down (or `n` of them).
const hit = (g: Game, e: Enemy, n = e.hp): SortieEvent[] => {
  const events: SortieEvent[] = [];
  for (let i = 0; i < n; i++) { g.shots.push({ x: e.x, y: e.y, vx: 0, vy: 0 }); events.push(...run(g, {}, 1 / 60)); }
  return events;
};

test("a path is a smooth curve through its points, and can be flown mirrored", () => {
  const pts = PATHS.sweep.points;
  const same = (a: { x: number; y: number }, [x, y]: [number, number]) => { expect(a.x).toBeCloseTo(x); expect(a.y).toBeCloseTo(y); };
  same(along(pts, 0), pts[0]);
  same(along(pts, 1), pts.at(-1)!);
  same(along(pts, 0.5), [0.5, 0.44]); // the middle point of five
  // No jumps: a hundredth of the way along is never far.
  for (const name of Object.keys(PATHS) as PathName[]) for (let u = 0; u < 1; u += 0.01) {
    const a = along(PATHS[name].points, u), b = along(PATHS[name].points, u + 0.01);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.06);
  }
  const here = onPath("sweep", 0.3, false, field), there = onPath("sweep", 0.3, true, field);
  expect(there.x).toBeCloseTo(field.width - here.x);
  expect(there.y).toBeCloseTo(here.y);
});

test("the sweep comes in from the upper left, banks across the firing lane, and peels away to the right", () => {
  const at = (u: number) => onPath("sweep", u, false, field);
  expect(at(0).x).toBeLessThan(0); // off the left edge…
  expect(at(0).y).toBeLessThan(field.height * 0.2); // …near the top
  const mid = at(0.5);
  expect(mid.x).toBeCloseTo(field.width / 2); // across the middle, where the player's guns point
  expect(mid.y).toBeGreaterThan(at(0.2).y); // lower than it came in: it's banked down
  expect(at(1).x).toBeGreaterThan(field.width); // and out to the right…
  expect(at(1).y).toBeLessThan(mid.y); // …climbing away
  // You can see the turn coming: it's heading down and right going in, up and right coming out.
  expect(Math.sin(at(0.25).heading)).toBeGreaterThan(0.2);
  expect(Math.sin(at(0.75).heading)).toBeLessThan(-0.2);
  expect(Math.cos(at(0.25).heading)).toBeGreaterThan(0);
  expect(Math.cos(at(0.75).heading)).toBeGreaterThan(0);
  expect(PATHS.sweep.fires).toEqual([0.5]); // and that's where it shoots
});

test("the plane slides eight ways at one speed, stays on the field, and its guns only fire straight up", () => {
  const g = playing();
  const from = { ...g.player };
  run(g, { x: 1 }, 0.5);
  expect(g.player.x - from.x).toBeCloseTo(SPEED * 0.5, 0);
  expect(g.player.y).toBe(from.y);
  const before = { ...g.player };
  run(g, { x: -1, y: -1 }, 0.5); // a diagonal goes no faster
  expect(Math.hypot(g.player.x - before.x, g.player.y - before.y)).toBeCloseTo(SPEED * 0.5, 0);
  expect(before.x - g.player.x).toBeCloseTo(before.y - g.player.y, 5);
  run(g, { x: -1, y: 1 }, 10);
  expect([g.player.x, g.player.y]).toEqual([24, field.height - 30]); // into the corner and no further

  // On a wider window the formations' paths stretch across it, and the plane is quicker to match (up to a point).
  expect(speedOn(field)).toBe(SPEED);
  expect(speedOn({ width: 3000, height: 900 })).toBe(SPEED * 1.9);
  expect(speedOn({ width: 1140, height: 900 })).toBeCloseTo(SPEED * 1.5);
  expect(speedOn({ width: 400, height: 900 })).toBe(SPEED);

  // Firing while sliding sideways: every round still goes straight up the screen.
  g.shots = [];
  run(g, { x: 1, fire: true }, FIRE_EVERY * 3);
  expect(g.shots.length).toBeGreaterThanOrEqual(6); // two guns, three bursts
  expect(g.shots.every((s) => s.vx === 0 && s.vy < 0)).toBe(true);
});

test("a stage's formations come in on time, one aircraft after another along the same path", () => {
  const g = newGame(field);
  run(g, {}, INTRO - 0.1);
  expect([g.phase, g.enemies.length]).toEqual(["intro", 0]); // nothing until the stage's name has gone
  const first = STAGES[0][0];
  run(g, {}, 0.1 + first.at + 0.1);
  expect(g.phase).toBe("play");
  expect(g.enemies.length).toBe(first.count);
  expect(g.flew).toBe(first.count);
  expect(g.enemies.every((e) => e.path === first.path && e.kind === "scout")).toBe(true);
  expect(g.enemies.filter((e) => e.age >= 0).length).toBe(1); // only the leader is in yet
  run(g, {}, first.gap * (first.count - 1) + 0.05);
  const xs = g.enemies.map((e) => e.x);
  expect(g.enemies.every((e) => e.age >= 0)).toBe(true);
  expect([...xs].sort((a, b) => b - a)).toEqual(xs); // strung out along the path, leader furthest on
  // Later stages come round again, with faster rounds.
  expect(wavesOf(STAGES.length + 1)).toBe(STAGES[0]);
  expect(roundSpeed(3)).toBeGreaterThan(roundSpeed(1));
  expect(roundSpeed(99)).toBe(300);
});

test("shooting an aircraft down scores it; one that needs more hits takes them", () => {
  const g = playing();
  const scout = enemy(g, "scout", "sweep", 0.5);
  g.player.x = scout.x; g.player.y = scout.y + 36; // slid in right underneath it
  const events = run(g, { fire: true }, 0.1);
  expect(g.enemies.includes(scout)).toBe(false);
  expect([g.score, g.downed]).toEqual([ENEMY.scout.points, 1]);
  expect(events.some((e) => e.type === "boom")).toBe(true);
  expect(events).toContainEqual(expect.objectContaining({ type: "points", n: ENEMY.scout.points }));

  const heavy = enemy(g, "heavy", "prowl", 0.4);
  g.player.x = heavy.x; g.player.y = heavy.y + 60; g.player.cool = 0;
  run(g, { fire: true }, 0.1);
  expect(heavy.hp).toBeLessThan(ENEMY.heavy.hp); // hurt…
  expect(heavy.gone).toBe(false); // …but still flying
});

test("an enemy fires at where you are, at the point in its path that says so, and a hit costs a life", () => {
  const g = playing();
  const e = enemy(g, "scout", "sweep", 0.45);
  e.fired = 0;
  g.player.x = 200; g.player.y = 800;
  run(g, {}, 0.4); // past the half-way mark
  expect(e.fired).toBe(1);
  expect(g.rounds.length).toBe(1);
  const r = g.rounds[0];
  expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(roundSpeed(1));
  expect(r.vy).toBeGreaterThan(0); // down the screen…
  expect(r.vx).toBeLessThan(0); // …and to the left, at the player
  // It takes a while to arrive: time to break away. Stay put, and it costs a plane.
  const events = run(g, {}, 4);
  expect(g.lives).toBe(LIVES - 1);
  expect(events.some((ev) => ev.type === "lost")).toBe(true);
  // The next plane comes on, and can't be hit for a moment.
  expect(g.player.alive).toBe(true);
  g.rounds.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0 });
  g.player.safe = SAFE;
  run(g, {}, 0.2);
  expect(g.lives).toBe(LIVES - 1);
});

test("a loop takes the plane over what would have hit it, and there are only so many", () => {
  const g = playing();
  expect(g.loops).toBe(LOOPS);
  const p = g.player;
  // A round sitting right on the plane, and a scout flying through it.
  g.rounds.push({ x: p.x, y: p.y, vx: 0, vy: 0 });
  run(g, { loop: true }, 1 / 60);
  expect(looping(g)).toBe(true);
  expect(g.loops).toBe(LOOPS - 1);
  enemy(g, "scout", "weave", 0.5).x = p.x;
  g.shots = [];
  run(g, { fire: true }, LOOP_LASTS - 0.1);
  expect(g.lives).toBe(LIVES); // untouched
  expect(g.shots.length).toBe(0); // and no shooting from up there
  // Level again, and the round's still there.
  g.enemies = [];
  run(g, {}, 0.3);
  expect(looping(g)).toBe(false);
  expect(g.lives).toBe(LIVES - 1);

  // Holding the key doesn't chain them, and when they're gone they're gone.
  const h = playing();
  for (let i = 0; i < LOOPS + 2; i++) { run(h, { loop: true }, 1 / 60); run(h, {}, LOOP_LASTS + 0.1); }
  expect(h.loops).toBe(0);
  run(h, { loop: true }, 1 / 60);
  expect(looping(h)).toBe(false);
});

test("the loop goes up and over: ahead, onto its back at the top, behind, and level again where it began", () => {
  expect(loopPose(0)).toEqual({ ahead: 0, height: 0, pitch: 1 });
  const quarter = loopPose(0.25), top = loopPose(0.5), three = loopPose(0.75), end = loopPose(1);
  expect(quarter.ahead).toBeCloseTo(LOOP_REACH); // pulled up and forward, standing on its tail
  expect(quarter.pitch).toBeCloseTo(0);
  expect(top.height).toBeCloseTo(1); // highest…
  expect(top.pitch).toBeCloseTo(-1); // …and upside down
  expect(top.ahead).toBeCloseTo(0);
  expect(three.ahead).toBeCloseTo(-LOOP_REACH); // coming down behind where it started
  expect(end.ahead).toBeCloseTo(0);
  expect(end.height).toBeCloseTo(0);
  expect(end.pitch).toBeCloseTo(1);
});

test("the ferry drops a crate: two wingmen who fire alongside you and each take a hit for you", () => {
  const g = playing();
  const ferry = enemy(g, "ferry", "ferry", 0.5);
  hit(g, ferry, ENEMY.ferry.hp - 1);
  expect(ferry.gone).toBe(false); // it takes a few hits
  hit(g, ferry, 1);
  expect(ferry.gone).toBe(true);
  expect(g.crates.map((c) => c.what)).toEqual(["wingmen"]);
  g.player.x = ferry.x; g.player.y = ferry.y + 60; // waiting under it
  const events = run(g, {}, 2.5); // it drifts down onto the plane
  expect(events).toContainEqual(expect.objectContaining({ type: "pickup", what: "wingmen" }));
  expect(g.wingmen).toEqual([true, true]);
  expect(wingAt(g, 1).x - wingAt(g, 0).x).toBe(WING_OUT * 2); // one each side

  g.shots = [];
  run(g, { fire: true }, 1 / 60);
  expect(g.shots.length).toBe(4); // your two guns, and one each
  expect(new Set(g.shots.map((s) => Math.round(s.x))).size).toBe(4);
  expect(g.shots.every((s) => s.vx === 0 && s.vy < 0)).toBe(true);

  // A round that finds a wingman takes him, not you.
  const w = wingAt(g, 0);
  g.rounds.push({ x: w.x, y: w.y, vx: 0, vy: 0 });
  run(g, {}, 1 / 60);
  expect(g.wingmen).toEqual([false, true]);
  expect([g.lives, g.rounds.length]).toEqual([LIVES, 0]);

  // With both wingmen already, the next ferry's crate is another loop (up to a limit).
  g.wingmen = [true, true];
  const next = enemy(g, "ferry", "ferry", 0.5);
  hit(g, next);
  g.player.x = next.x; g.player.y = next.y + 60;
  expect(g.crates.at(-1)?.what).toBe("loop");
  g.loops = LOOPS_MAX;
  run(g, {}, 2.5);
  expect(g.loops).toBe(LOOPS_MAX);
});

test("with wingmen, a hit on you costs one of them: it's the third that takes the plane", () => {
  const g = playing();
  g.wingmen = [true, true];
  const hitMe = () => { g.rounds.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0 }); return run(g, {}, 1 / 60); };
  const first = hitMe();
  expect([g.lives, g.wingmen.filter(Boolean).length]).toEqual([LIVES, 1]); // a wingman, not the plane
  expect(first.some((e) => e.type === "boom")).toBe(true);
  expect(first.some((e) => e.type === "lost")).toBe(false);
  expect(g.rounds.length).toBe(0); // and the round's spent
  // You're clear for a moment after, so one burst can't take all three at once…
  hitMe();
  expect(g.wingmen.filter(Boolean).length).toBe(1);
  expect(g.player.safe).toBeGreaterThan(0);
  g.rounds = [];
  run(g, {}, WING_SAVES + 0.1);
  // …then the second hit takes the other wingman, and only the third takes the plane.
  hitMe();
  expect([g.lives, g.wingmen.filter(Boolean).length]).toEqual([LIVES, 0]);
  g.rounds = [];
  run(g, {}, WING_SAVES + 0.1);
  const third = hitMe();
  expect(g.lives).toBe(LIVES - 1);
  expect(third.some((e) => e.type === "lost")).toBe(true);

  // Flying into something is the same: the wingman goes, you don't. And a chain isn't broken by it.
  const h = playing();
  h.wingmen = [true, false];
  h.chain = 4; h.chainFor = 2;
  const e = enemy(h, "hauler", "haul", 0.5); // (too big to be brought down by it)
  h.player.x = e.x; h.player.y = e.y;
  run(h, {}, 1 / 60);
  expect(e.gone).toBe(false);
  expect([h.lives, h.wingmen, h.chain]).toEqual([LIVES, [false, false], 4]);
});

test("a stage ends with the score and the share of what flew in that you shot down", () => {
  const g = playing();
  // Skip to the last of the stage: everything has come in (the flagship too, and it's down), 10 of 39
  // were shot down, a plane was lost on the way, and one scout is still up.
  g.nextWave = STAGES[0].length; g.boss = "done";
  g.flew = 39; g.downed = 9; g.score = 900; g.lost = 1;
  const last = enemy(g, "scout", "sweep", 0.5);
  run(g, {}, 0.1);
  expect(g.phase).toBe("play"); // not over while one's still flying
  g.player.x = last.x; g.player.y = last.y + 36;
  run(g, { fire: true }, 0.1);
  expect(g.phase).toBe("tally");
  expect(g.tally).toEqual({ downed: 10, flew: 39, percent: 26, clean: false, bonus: 26 * 20 });
  expect(g.score).toBe(900 + ENEMY.scout.points + 26 * 20);

  // It stays up until you fire (and not in the first second, in case you were still firing).
  g.loops = 0;
  run(g, { go: true }, 0.5);
  expect(g.phase).toBe("tally");
  run(g, {}, 0.6);
  run(g, { go: true }, 1 / 60);
  expect([g.phase, g.stage, g.flew, g.downed, g.lost, g.boss, g.tally, g.loops]).toEqual(["intro", 2, 0, 0, 0, "none", null, LOOPS]); // on to the next, loops back
  expect(g.score).toBe(900 + ENEMY.scout.points + 26 * 20); // the score carries on

  // One that got away counts against you: it flew in, and wasn't shot down.
  const h = playing();
  h.nextWave = STAGES[0].length; h.boss = "done"; h.flew = 5; h.downed = 4;
  enemy(h, "scout", "sweep", 0.99);
  run(h, {}, 0.3);
  // …and with no plane of yours lost, there's more on top.
  expect(h.tally).toEqual({ downed: 4, flew: 5, percent: 80, clean: true, bonus: 80 * 20 + CLEAN_BONUS });
});

test("with no planes left it's over, and firing starts again from the top", () => {
  const g = playing();
  g.lives = 1; g.score = 4200; g.stage = 2;
  g.rounds.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0 });
  run(g, {}, 1 / 60);
  expect([g.phase, g.lives, g.player.alive]).toEqual(["over", 0, false]);
  const flying = newEnemy("scout", { path: "sweep" });
  g.enemies.push(flying);
  g.rounds.push({ x: 300, y: 300, vx: 0, vy: 200 });
  run(g, { fire: true, x: 1 }, 2);
  expect([g.phase, g.player.alive, g.score, g.lives]).toEqual(["over", false, 4200, 0]); // no new plane, and nothing more to score
  expect(flying.x).toBeGreaterThan(100); // what was in the air flies on…
  expect(g.rounds[0].y).toBeGreaterThan(600);
  expect(g.rounds.length).toBe(1); // …but with nobody to shoot at
  expect(g.shots.length).toBe(0);
  run(g, { go: true }, 1 / 60);
  expect([g.phase, g.stage, g.score, g.lives, g.loops]).toEqual(["intro", 1, 0, LIVES, LOOPS]);
});

test("every stage has formations to learn, a ferry, and paths that start and end off the field", () => {
  for (const waves of STAGES) {
    expect(waves.length).toBeGreaterThanOrEqual(9);
    expect(waves.some((w) => w.kind === "ferry")).toBe(true);
    expect(waves.map((w) => w.at)).toEqual([...waves.map((w) => w.at)].sort((a, b) => a - b));
    expect(waves.filter((w) => w.kind === "scout").every((w) => w.count >= 4)).toBe(true); // a formation, not a straggler
  }
  for (const name of Object.keys(PATHS) as PathName[]) {
    const p = PATHS[name].points, off = ([x, y]: [number, number]) => x < 0 || x > 1 || y < 0 || y > 1;
    expect(off(p[0]) && off(p.at(-1)!)).toBe(true);
    expect(PATHS[name].fires.every((u) => u > 0 && u < 1)).toBe(true);
  }
});

// ---------- More to shoot at ----------

test("a dart lines up on you from the top, where you can see it, then dives at where you were", () => {
  const g = playing();
  g.player.x = 500; g.player.y = 800;
  const d = free(g, "dart", { home: 0.2 });
  run(g, {}, DART_LINES_UP * 0.5);
  expect(liningUp(d)).toBe(true);
  expect(d.y).toBeLessThan(80); // still up at the top…
  expect(d.x).toBeGreaterThan(0.2 * field.width); // …sliding across towards you…
  expect(d.heading).toBeCloseTo(Math.atan2(800 - d.y, 500 - d.x)); // …with its nose on you
  run(g, {}, DART_LINES_UP * 0.5 + 0.05);
  expect(liningUp(d)).toBe(false); // gone
  const aimedAt = { ...g.player };
  // Step aside and it goes past: it went for where you were, not where you are.
  run(g, { x: 1 }, 0.6);
  expect(g.lives).toBe(LIVES);
  run(g, {}, 1);
  expect(g.enemies.includes(d)).toBe(false); // off the bottom
  // Stay put and it doesn't miss.
  const h = playing();
  h.player.x = aimedAt.x; h.player.y = aimedAt.y;
  free(h, "dart", { home: 0.2 });
  run(h, {}, DART_LINES_UP + 1.6);
  expect(h.lives).toBe(LIVES - 1);
});

test("an ace comes down, follows you from side to side firing pairs, and leaves when it's had enough", () => {
  const g = playing();
  g.player.x = 150; g.player.y = 820;
  const a = free(g, "ace", { home: 0.75 });
  run(g, {}, 1.2);
  const from = a.x;
  expect(a.y).toBeGreaterThan(field.height * 0.2); // down to its height
  g.player.safe = 99; // (watching, not dying)
  run(g, { x: -1 }, 1.5);
  expect(a.x).toBeLessThan(from - 100); // it has come across after you
  expect(g.rounds.length).toBeGreaterThanOrEqual(2);
  expect(g.rounds.length % 2).toBe(0); // in pairs
  expect(a.hp).toBe(ENEMY.ace.hp);
  hit(g, a, 1);
  expect([a.gone, a.hp]).toEqual([false, ENEMY.ace.hp - 1]); // it takes more than one
  run(g, {}, ACE_STAYS + 1);
  expect(g.enemies.includes(a)).toBe(false); // and it's away, off the top
  expect(g.downed).toBe(0);
});

test("a mine drifts down in your way, and goes off in a ring of rounds when it's shot", () => {
  const g = playing();
  const m = free(g, "mine", { home: 0.5 });
  run(g, {}, 2);
  expect(m.y).toBeGreaterThan(50);
  expect(Math.abs(m.x - field.width / 2)).toBeLessThan(20); // more or less straight down
  expect(g.rounds.length).toBe(0); // it doesn't shoot
  g.player.x = 60; g.player.y = 850; // well out of the way
  hit(g, m);
  expect(m.gone).toBe(true);
  expect(g.rounds.length).toBe(MINE_RING);
  const ways = g.rounds.map((r) => Math.round((Math.atan2(r.vy, r.vx) * 180) / Math.PI));
  expect(new Set(ways).size).toBe(MINE_RING); // all the way round
  expect(g.rounds.some((r) => r.vy < 0) && g.rounds.some((r) => r.vy > 0) && g.rounds.some((r) => r.vx < 0) && g.rounds.some((r) => r.vx > 0)).toBe(true);
  expect(Math.hypot(g.rounds[0].vx, g.rounds[0].vy)).toBeLessThan(roundSpeed(1)); // slow ones
});

test("a hauler spills its drones when it's shot down, and they count as having flown in", () => {
  const g = playing();
  const c = enemy(g, "hauler", "haul", 0.5);
  g.flew = 1;
  g.player.x = 60; g.player.y = 850;
  hit(g, c);
  expect(c.gone).toBe(true);
  const drones = g.enemies.filter((e) => e.kind === "scout");
  expect(drones.length).toBe(DRONES);
  expect(g.flew).toBe(1 + DRONES);
  expect(new Set(drones.map((d) => Math.round(d.vx))).size).toBe(DRONES); // each its own way…
  expect(drones.every((d) => d.vy > 0)).toBe(true); // …all of them downwards
  run(g, {}, 1.2);
  expect(g.rounds.length).toBe(DRONES); // one round each
  run(g, {}, 6);
  expect(drones.every((d) => !g.enemies.includes(d))).toBe(true); // and gone, off the bottom
});

test("the flagship comes when the last formation has gone, and the stage isn't over until it's down", () => {
  const g = playing();
  g.nextWave = STAGES[0].length; g.flew = 10; g.downed = 10;
  const events = run(g, {}, 0.1);
  expect(events).toContainEqual({ type: "warning" });
  const boss = g.enemies.find((e) => e.kind === "flagship")!;
  expect([g.boss, g.flew, boss.hp, boss.hpMax]).toEqual(["out", 11, flagshipHp(1), flagshipHp(1)]);
  expect(flagshipHp(3)).toBeGreaterThan(flagshipHp(1)); // bigger every stage, up to a point
  expect(flagshipHp(99)).toBe(120);

  g.player.safe = 99;
  run(g, {}, 6);
  expect(g.phase).toBe("play");
  expect(boss.y).toBeGreaterThan(0.1 * field.height); // down at the top of the screen, and staying
  expect(g.rounds.length).toBeGreaterThan(5); // fans and bursts
  // Half done for, it fires faster.
  const count = (seconds: number) => { g.rounds = []; let n = 0; for (let i = 0; i < seconds * 60; i++) { const was = g.rounds.length; run(g, {}, 1 / 60); n += Math.max(0, g.rounds.length - was); } return n; };
  const calm = count(6);
  hit(g, boss, Math.ceil(boss.hpMax / 2));
  expect(count(6)).toBeGreaterThan(calm);

  const before = g.score;
  const end = hit(g, boss);
  expect([boss.gone, g.boss, g.rounds.length]).toEqual([true, "done", 0]); // its guns stop with it
  expect(end.filter((e) => e.type === "boom").length).toBeGreaterThan(4);
  expect(g.score).toBeGreaterThanOrEqual(before + ENEMY.flagship.points);
  expect(g.phase).toBe("tally");
  expect(g.tally).toMatchObject({ downed: 11, flew: 11, percent: 100 });
});

// ---------- More ways to score ----------

test("kills in quick succession are worth more, and the chain lapses if you take too long or lose the plane", () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map(chainTimes)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  const g = playing();
  g.player.x = 60; g.player.y = 850;
  const worth: number[] = [];
  for (let i = 0; i < 5; i++) {
    const was = g.score;
    const events = hit(g, enemy(g, "scout", "weave", 0.3));
    worth.push(g.score - was);
    expect(events).toContainEqual(expect.objectContaining({ type: "points", n: g.score - was, times: chainTimes(i + 1) }));
  }
  expect(worth).toEqual([100, 100, 200, 200, 300]);
  run(g, {}, CHAIN_WINDOW + 0.1); // too long
  expect(g.chain).toBe(0);
  const was = g.score;
  hit(g, enemy(g, "scout", "weave", 0.3));
  expect(g.score - was).toBe(100);
  // Losing the plane ends it too.
  hit(g, enemy(g, "scout", "weave", 0.3));
  g.rounds.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0 });
  run(g, {}, 1 / 60);
  expect([g.chain, g.lives]).toEqual([0, LIVES - 1]);
});

test("shooting down a whole formation earns a bonus and better guns; let one go and it doesn't", () => {
  const g = playing();
  g.player.x = 60; g.player.y = 850;
  const flight = (n: number, squad: number) => { g.squads[squad] = { size: n, downed: 0 }; return Array.from({ length: n }, () => Object.assign(enemy(g, "scout", "weave", 0.3), { squad })); };
  const four = flight(4, 0);
  four.slice(0, 3).forEach((e) => hit(g, e));
  expect(g.crates.length).toBe(0); // not yet
  const events = hit(g, four[3]);
  expect(events).toContainEqual(expect.objectContaining({ type: "flight", n: FLIGHT_BONUS * 4 }));
  expect(g.crates.map((c) => c.what)).toEqual(["gun"]);
  expect(g.score).toBe(100 + 100 + 200 + 200 + FLIGHT_BONUS * 4);

  // One gets away: no bonus, no crate.
  const three = flight(3, 1);
  hit(g, three[0]); hit(g, three[1]);
  three[2].gone = true;
  run(g, {}, 0.1);
  expect(g.crates.length).toBe(1);

  // The crate: four guns, then four that fire faster, then (as good as they get) a medal instead.
  expect(gunsAt(1).length).toBe(2);
  expect(gunsAt(2).length).toBe(4);
  const take = (what: "gun" | "medal") => { g.crates = [{ x: g.player.x, y: g.player.y, what, age: 0 }]; return run(g, {}, 1 / 60); };
  take("gun");
  expect(g.guns).toBe(2);
  g.shots = []; g.player.cool = 0;
  run(g, { fire: true }, 1 / 60);
  expect(g.shots.length).toBe(4);
  expect(g.shots.every((s) => s.vx === 0 && s.vy < 0)).toBe(true); // more of them, still straight ahead
  take("gun");
  expect(g.guns).toBe(GUNS_MAX);
  g.shots = []; g.player.cool = 0;
  run(g, { fire: true }, 11 / 60); // (less than the usual gap between bursts)
  expect(11 / 60).toBeLessThan(FIRE_EVERY);
  expect(g.shots.length).toBe(8); // a second burst already
  flight(3, 2).forEach((e) => hit(g, e));
  expect(g.crates.at(-1)?.what).toBe("medal");
  const was = g.score;
  take("medal");
  expect(g.score).toBe(was + MEDAL);
  // Losing a plane takes the guns back a step.
  g.player.safe = 0;
  g.rounds.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0 });
  run(g, {}, 1 / 60);
  expect(g.guns).toBe(GUNS_MAX - 1);
});

test("every so many points there's another plane, up to a limit", () => {
  const g = playing();
  g.score = EXTRA_EVERY - 50;
  g.player.x = 60; g.player.y = 850;
  const events = hit(g, enemy(g, "scout", "weave", 0.3));
  expect(g.lives).toBe(LIVES + 1);
  expect(events.some((e) => e.type === "extra")).toBe(true);
  expect(g.nextLife).toBe(EXTRA_EVERY * 2);
  g.lives = LIVES_MAX; g.score = EXTRA_EVERY * 2 - 50;
  hit(g, enemy(g, "scout", "weave", 0.3));
  expect(g.lives).toBe(LIVES_MAX); // no more than that
  expect(g.nextLife).toBe(EXTRA_EVERY * 3);
});

test("the later stages bring the new aircraft in", () => {
  const kinds = (i: number) => new Set(STAGES[i].map((w) => w.kind));
  expect([...kinds(0)].sort()).toEqual(["carrier", "dart", "ferry", "mine", "scout"]); // the first stage is the gentlest
  expect([...kinds(1)].sort()).toEqual(["ace", "carrier", "dart", "ferry", "hauler", "heavy", "mine", "scout"]);
  expect(kinds(2).size).toBe(8);
  // The ones that fly themselves come in spread across the top, each with its own place.
  for (const waves of STAGES) for (const w of waves.filter((it) => !it.path)) {
    expect(w.xs?.length).toBe(w.count);
    expect(w.xs!.every((x) => x > 0 && x < 1)).toBe(true);
  }
});

// ---------- Harder: slower guns, and enemies with some sense ----------

test("your guns fire slowly enough that a burst has to be placed", () => {
  expect(FIRE_EVERY).toBeGreaterThanOrEqual(0.2);
  const g = playing();
  run(g, { fire: true }, 1);
  expect(g.shots.length + 0).toBeLessThanOrEqual(2 * 5); // five bursts of two in a second, at most
  expect(g.shots.length).toBeGreaterThanOrEqual(2 * 4);
});

test("they aim ahead of the way you're going: the ace always, the scouts more each stage", () => {
  const from = { x: 350, y: 100 }, you = { x: 350, y: 700, vx: 300, vy: 0 };
  expect(leadAim(from, { ...you, vx: 0 }, 200, 1)).toBeCloseTo(Math.PI / 2); // standing still: straight at you
  expect(leadAim(from, you, 200, 0)).toBeCloseTo(Math.PI / 2); // no lead: at where you are
  const led = leadAim(from, you, 200, 1);
  expect(Math.cos(led)).toBeGreaterThan(0.5); // full lead: well out to the side you're heading for
  expect(Math.cos(leadAim(from, you, 200, 0.5))).toBeLessThan(Math.cos(led)); // half of it: in between
  expect([1, 2, 3, 4, 9].map((stage) => leadOf("scout", stage))).toEqual([0, 0.25, 0.5, 0.75, 0.75]);
  expect([leadOf("ace", 1), leadOf("flagship", 1)]).toEqual([1, 1]);

  // In play: a scout on stage 1 shoots at where you are; on stage 3, ahead of you.
  const shot = (stage: number) => {
    const g = playing();
    g.stage = stage;
    g.player.x = 200; g.player.y = 800;
    const e = enemy(g, "scout", "sweep", 0.48);
    e.fired = 0;
    run(g, { x: 1 }, 0.2); // you're sliding right as it fires
    const r = g.rounds[0], t = (g.player.y - r.y) / r.vy;
    return r.x + r.vx * t - g.player.x; // where the round will cross your height, from where you are now
  };
  expect(Math.abs(shot(1))).toBeLessThan(60); // more or less at you (you've moved a little since)
  expect(shot(3)).toBeGreaterThan(shot(1) + 100); // well ahead
});

test("a formation that has lost one breaks its line, to either side in turn; one left alone holds it", () => {
  const g = playing();
  g.player.x = 60; g.player.y = 850;
  g.squads[0] = { size: 4, downed: 0 };
  g.squads[1] = { size: 4, downed: 0 };
  const flight = [0.2, 0.26, 0.32, 0.38].map((u) => Object.assign(enemy(g, "scout", "weave", u), { squad: 0 }));
  const other = Object.assign(enemy(g, "scout", "weave", 0.3), { squad: 1 });
  run(g, {}, 0.2);
  expect(flight.every((e) => e.off === 0)).toBe(true); // nose to tail on the path
  hit(g, flight[0]);
  expect(flight.slice(1).map((e) => e.jink)).toEqual([BREAK, -BREAK, BREAK]);
  run(g, {}, 0.6);
  expect(flight.slice(1).map((e) => Math.round(e.off))).toEqual([BREAK, -BREAK, BREAK]); // out of line now
  const on = onPath("weave", flight[1].age / PATHS.weave.lasts, false, field);
  expect(Math.hypot(flight[1].x - on.x, flight[1].y - on.y)).toBeCloseTo(BREAK);
  expect([other.jink, other.off]).toEqual([0, 0]); // the other formation wasn't touched
});

test("a scout takes one snap shot at a plane camping under its path, and only one", () => {
  const g = playing();
  const e = enemy(g, "scout", "weave", 0.3);
  e.snappy = true;
  g.player.x = e.x + 300; g.player.y = 820; // off to one side: nothing
  run(g, {}, 0.1);
  expect(g.rounds.length).toBe(0);
  g.player.x = e.x; // right underneath, waiting
  run(g, {}, 1 / 60);
  expect(g.rounds.length).toBe(1);
  expect(e.snappy).toBe(false);
  expect(g.rounds[0].vy).toBeGreaterThan(0); // down at you
  g.player.safe = 99;
  run(g, {}, 0.5);
  expect(g.rounds.length).toBe(1); // that was its one
  // From a stage's own formations: every other scout at first, then every one.
  const first = newGame(field);
  run(first, {}, INTRO + STAGES[0][0].at + 0.2);
  expect(first.enemies.map((it) => it.snappy)).toEqual([false, true, false, true, false]);
  const later = newGame(field);
  later.stage = 2;
  run(later, {}, INTRO + STAGES[1][0].at + 0.2);
  expect(later.enemies.filter((it) => it.kind === "scout").every((it) => it.snappy)).toBe(true);
});

test("the ace keeps to one side of your guns, swaps sides, and jinks out of the way of a burst (once)", () => {
  const g = playing();
  g.player.x = 350; g.player.y = 820; g.player.safe = 99;
  const a = free(g, "ace", { home: 0.5 });
  run(g, {}, 1 + ACE_SWAPS - 0.1);
  expect(Math.abs(Math.abs(a.x - g.player.x) - ACE_OFF)).toBeLessThan(6); // off to one side…
  const side = Math.sign(a.x - g.player.x);
  run(g, {}, ACE_SWAPS);
  expect(Math.sign(a.x - g.player.x)).toBe(-side); // …then the other, having crossed your guns to get there

  // A burst coming straight up at it: it's gone from there before it arrives.
  a.cool2 = 0;
  const was = a.x;
  g.shots.push({ x: a.x, y: a.y + 200, vx: 0, vy: -760 });
  run(g, {}, ACE_DODGE);
  expect(Math.abs(a.x - was)).toBeGreaterThan(60);
  expect(a.hp).toBe(ENEMY.ace.hp); // missed
  // But it can't do that twice running: the next burst, straight after, gets it.
  run(g, {}, 0.05);
  expect(a.cool2).toBeGreaterThan(ACE_NERVE - ACE_DODGE - 0.2);
  g.shots.push({ x: a.x, y: a.y + 60, vx: 0, vy: -760 });
  run(g, {}, 0.12);
  expect(a.hp).toBe(ENEMY.ace.hp - 1);
});

test("a mine drifts across to the column you're in", () => {
  const g = playing();
  g.player.x = 600; g.player.y = 820;
  const m = free(g, "mine", { home: 0.3 });
  run(g, {}, 4);
  expect(m.home * field.width).toBeGreaterThan(0.3 * field.width + 100); // closing on you…
  expect(m.home * field.width).toBeLessThan(600); // …but not fast
  g.player.x = 100;
  const was = m.home;
  run(g, {}, 2);
  expect(m.home).toBeLessThan(was); // and back again when you move
});

test("a dart goes for where you're heading, not only where you were", () => {
  const launch = (x: number) => {
    const g = playing();
    g.player.x = 350; g.player.y = 800;
    const d = free(g, "dart", { home: 0.5 });
    run(g, {}, DART_LINES_UP - 0.2);
    run(g, { x }, 0.2 + 2 / 60); // moving (or not) as it goes
    return { vx: d.vx, at: Math.atan2(g.player.y - d.y, g.player.x - d.x), way: Math.atan2(d.vy, d.vx) };
  };
  const still = launch(0), right = launch(1);
  expect(still.way).toBeCloseTo(still.at, 1); // standing still: straight at you
  expect(Math.cos(right.way)).toBeGreaterThan(Math.cos(right.at) + 0.05); // sliding right: aimed to the right of you
});

test("the flagship, once it's hurt, lays a wall right across with one gap in it, a different one each time", () => {
  for (const k of [1, 2, 3, 4, 5]) {
    const w = wall(k), step = Math.round((w[1] - w[0]) * 100);
    expect(w.length).toBe(9);
    expect(w.every((a) => Math.sin(a) > 0)).toBe(true); // all of it downwards
    const gaps = w.slice(1).map((a, i) => Math.round((a - w[i]) * 100));
    expect(step).toBe(17);
    expect(gaps.filter((d) => d > 17)).toEqual([51]); // one gap, where two rounds were left out, and never at an end
  }
  expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((k) => wall(k).join())).size).toBe(8);

  const g = playing();
  g.nextWave = STAGES[0].length;
  run(g, {}, 0.1);
  const boss = g.enemies.find((e) => e.kind === "flagship")!;
  g.player.safe = 99;
  run(g, {}, 2);
  // Unhurt: no walls, however long you wait.
  const volleys = (seconds: number) => { const sizes: number[] = []; for (let i = 0; i < seconds * 60; i++) { const was = g.rounds.length; g.rounds = g.rounds.slice(); run(g, {}, 1 / 60); if (g.rounds.length > was) sizes.push(g.rounds.length - was); } return sizes; };
  g.rounds = [];
  expect(volleys(8).includes(9)).toBe(false);
  hit(g, boss, Math.ceil(boss.hpMax / 2));
  g.rounds = [];
  expect(volleys(8).includes(9)).toBe(true);
});

// ---------- The aircraft carrier ----------

test("an aircraft carrier steams down the screen under you, launching its scouts and firing from each end", () => {
  const g = playing();
  g.player.x = 600; g.player.y = 820; g.player.safe = 99;
  const ship = free(g, "carrier", { home: 0.3 });
  expect([ship.hp, ENEMY.carrier.points]).toEqual([30, 2000]);
  run(g, {}, 1);
  expect(ship.x).toBeCloseTo(0.3 * field.width);
  expect(g.enemies.length).toBe(1); // still coming on: nothing launched from off the screen
  const y1 = ship.y;
  run(g, {}, 2);
  expect(ship.y - y1).toBeCloseTo(CARRIER_SPEED * 2, 0); // straight down, slowly

  // On the screen: a scout off the deck every so often, towards you, each counted as having flown in.
  g.flew = 1;
  run(g, {}, CARRIER_LAUNCHES * 2 + 0.2);
  const up = g.enemies.filter((e) => e.kind === "scout");
  expect(up.length).toBeGreaterThanOrEqual(2);
  expect(g.flew).toBe(1 + ship.fired);
  expect(up.every((e) => e.vx > 0 && e.vy > 0)).toBe(true); // you're down and to the right of it
  // And its guns: one round at a time, from one end and then the other.
  expect(g.rounds.length).toBeGreaterThanOrEqual(2);
  g.rounds = [];
  ship.cool2 = 0; run(g, {}, 1 / 60);
  ship.cool2 = 0; run(g, {}, 1 / 60);
  expect(g.rounds.length).toBe(2);
  expect(Math.abs(g.rounds[0].y - g.rounds[1].y)).toBeGreaterThan(50); // bow and stern
  expect(CARRIER_GUNS).toBeGreaterThan(1);

  // It only has so many aircraft.
  run(g, {}, CARRIER_LAUNCHES * (CARRIER_PLANES + 2));
  expect(ship.fired).toBe(CARRIER_PLANES);
  expect(g.flew).toBe(1 + CARRIER_PLANES);
  // Left alone, it goes off the bottom, and wasn't shot down.
  run(g, {}, 12);
  expect(g.enemies.includes(ship)).toBe(false);
  expect(g.downed).toBe(0);
});

test("you fly over the carrier, hit it anywhere along its hull, and it leaves a crate when it sinks", () => {
  const g = playing();
  const ship = free(g, "carrier", { home: 0.5, age: 8 });
  ship.cool = ship.cool2 = 99; // (its guns and aircraft kept quiet)
  run(g, {}, 1 / 60);
  // Sitting right on top of it costs nothing: it's on the water.
  g.player.x = ship.x; g.player.y = ship.y;
  run(g, {}, 0.3);
  expect(g.lives).toBe(LIVES);

  // A round at its bow or its stern counts; one past the end of it, or off to the side, doesn't.
  const at = (dx: number, dy: number) => { const was = ship.hp; g.shots.push({ x: ship.x + dx, y: ship.y + dy, vx: 0, vy: 0 }); run(g, {}, 1 / 60); g.shots = []; return was - ship.hp; };
  expect(at(0, HULL.long - 4)).toBe(1);
  expect(at(0, -(HULL.long - 4))).toBe(1);
  expect(at(HULL.wide - 2, 20)).toBe(1);
  expect(at(0, HULL.long + 20)).toBe(0);
  expect(at(HULL.wide + 14, 0)).toBe(0);

  // It takes a lot of sinking. When it goes: a string of explosions, its points, and a crate of wingmen.
  g.player.x = 60; g.player.y = 850;
  hit(g, ship, ship.hp - 1);
  expect(ship.gone).toBe(false);
  const was = g.score;
  const end = hit(g, ship, 1);
  expect(ship.gone).toBe(true);
  expect(g.score).toBe(was + ENEMY.carrier.points);
  expect(end.filter((e) => e.type === "boom").length).toBeGreaterThanOrEqual(5);
  expect(g.crates.at(-1)?.what).toBe("wingmen");
  // With both wingmen already, it's a medal instead.
  g.wingmen = [true, true];
  const second = free(g, "carrier", { home: 0.5, age: 8, cool: 99, cool2: 99 });
  run(g, {}, 1 / 60);
  hit(g, second);
  expect(second.gone).toBe(true);
  expect(g.crates.at(-1)?.what).toBe("medal");
});
