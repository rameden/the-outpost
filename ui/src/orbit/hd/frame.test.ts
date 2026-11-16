// What the HD view draws in a frame, worked out from what Orbit knows.
import { expect, test } from "vitest";
import { orbitOf } from "../scene.ts";
import { HD_PLANET, HD_SUN, hdFrame, type HdBody, type HdInput } from "./frame.ts";
import { MINE, STATION, WORLD, asKind, worldsFor } from "./worlds.ts";

const IDS = ["scout", "artificer", "scribe", "warden", "hacker"];
// (The camp's own worlds, unless a test says otherwise: every one the usual size. Their own moons are left off here,
// so the moons a test counts are the quests'; one test below puts them back.)
const OWN = worldsFor(0, IDS.map((id) => ({ id, color: [0.5, 0.5, 0.5] }))).map((w) => ({ ...w, moons: [] }));
const body = (i: number, over: Partial<HdBody> = {}): HdBody => ({
  id: IDS[i], i, angle: 30 + i * 70, color: [0.2 * i, 0.5, 0.9], world: OWN[i], turned: 0, glow: 0, waiting: false, focused: false,
  blip: -1, land: -1, quests: [], flight: null, ...over,
});
const input = (bodies: HdBody[], over: Partial<HdInput> = {}): HdInput => ({
  seconds: 12, w: 1440, h: 860, cx: 720, cy: 430, at: { x: 0, y: 0 }, k: 1.3, yaw: Math.PI / 2, pitch: 0.6, lead: "quartermaster",
  sun: { glow: 0, waiting: false }, bodies, lines: [0, 1, 2, 3, 4].map((i) => ({ rot: 0, lit: 0, body: i < bodies.length ? i : -1 })),
  ping: { r: 0, a: 0 }, reach: 262, flightMs: 1600, ...over,
});

test("each of the crew is a world on its own orbit, flat on the table; the Artificer has a station", () => {
  const { frame, spots } = hdFrame(input([body(0), body(1), body(2), body(3), body(4)]));
  expect(frame.planets.length).toBe(5);
  frame.planets.forEach((p, i) => {
    expect(Math.hypot(p.pos[0], p.pos[2])).toBeCloseTo(orbitOf(i));
    expect(p.pos[1]).toBe(0);
    expect(p.radius).toBe(HD_PLANET);
  });
  expect(frame.planets.map((p) => p.kind)).toEqual([WORLD, STATION, WORLD, WORLD, WORLD]);
  expect(frame.sun.radius).toBe(HD_SUN);
  // Where each is on the screen: the sun first (in the middle, where the camera looks), then the planets in order.
  expect(spots.map((s) => s.id)).toEqual(["quartermaster", "scout", "artificer", "scribe", "warden", "hacker"]);
  expect(spots[0].x).toBeCloseTo(720, 0);
  expect(spots[0].y).toBeCloseTo(430, 0);
  expect(spots[0].r).toBeGreaterThan(spots[1].r * 1.3); // the sun is the biggest thing there
  for (const s of spots) expect(s.r).toBeGreaterThan(5);
});

test("a moon for each quest out, each on a path of its own round the planet; one that's waiting is marked", () => {
  const { frame } = hdFrame(input([body(0, { quests: [false, true] }), body(1)]));
  const [scout, artificer] = frame.planets;
  expect(scout.moons.map((m) => m.waiting)).toEqual([false, true]);
  expect(artificer.moons).toEqual([]);
  const far = scout.moons.map((m) => Math.hypot(m.pos[0] - scout.pos[0], m.pos[1], m.pos[2] - scout.pos[2]));
  expect(far[0]).toBeGreaterThan(HD_PLANET);
  expect(far[1]).toBeGreaterThan(far[0]);
  // They go round: a moment later each is somewhere else.
  const later = hdFrame(input([body(0, { quests: [false, true] })], { seconds: 13 })).frame.planets[0];
  expect(later.moons[0].pos).not.toEqual(scout.moons[0].pos);
});

test("a quest sent is a comet from the sun to its planet, lifting off the table on the way; a report comes home", () => {
  const head = (kind: "out" | "home", since: number) => hdFrame(input([body(1, { flight: { kind, since } })])).frame.points[0];
  const r = orbitOf(1), from = (p: { pos: number[] }) => Math.hypot(p.pos[0], p.pos[2]);
  expect(from(head("out", 150))).toBeLessThan(r * 0.25);       // just left the sun
  expect(from(head("out", 1450))).toBeGreaterThan(r * 0.75);   // nearly there
  expect(head("out", 800).pos[1]).toBeGreaterThan(8);          // highest in the middle
  expect(head("out", 150).pos[1]).toBeLessThan(head("out", 800).pos[1]);
  expect(from(head("home", 150))).toBeGreaterThan(from(head("home", 1450))); // the other way
  // A trail of points behind the head, each fainter; and nothing once it has landed, or with nobody flying.
  const all = hdFrame(input([body(1, { flight: { kind: "out", since: 800 } })])).frame.points;
  expect(all.length).toBeGreaterThan(8);
  expect(all[0].a).toBeGreaterThan(all.at(-1)!.a);
  expect(hdFrame(input([body(1, { flight: { kind: "out", since: 5000 } })])).frame.points).toEqual([]);
  expect(hdFrame(input([body(1)])).frame.points).toEqual([]);
});

test("someone at work is lit up: their world, their line, and a stream of light out to them from the sun", () => {
  const quiet = hdFrame(input([body(0), body(1)])).frame;
  expect(quiet.planets.map((p) => p.active)).toEqual([0, 0]);
  expect(quiet.lines.map((l) => l.tone)).toEqual([0, 0, 0, 0, 0]);
  expect(quiet.points).toEqual([]);
  const busy = hdFrame(input([body(0, { glow: 1 }), body(1, { waiting: true })], { sun: { glow: 1, waiting: false } })).frame;
  expect(busy.planets[0].active).toBe(1);
  expect(busy.planets[1].waiting).toBe(1);
  expect(busy.sun.active).toBe(1);
  expect(busy.lines.slice(0, 2).every((l) => l.tone > 0)).toBe(true); // the one waiting on you has its line lit too
  expect(busy.lines[0].color).toEqual(busy.planets[0].color);
  expect(busy.lines[0].tail).toBe(true);
  expect(busy.lines[3]).toMatchObject({ tone: 0, tail: false }); // a line with nobody on it
  // The stream lies along the line from the sun to the planet at work, and only to that one.
  expect(busy.points.length).toBeGreaterThan(15);
  const [px, , pz] = busy.planets[0].pos;
  for (const pt of busy.points) expect(Math.abs(pt.pos[0] * pz - pt.pos[2] * px)).toBeLessThan(0.01);
});

// Close to: the camera with the planet, near enough that it's a good size on the screen.
const closeTo = (b: HdBody, over: Partial<HdInput> = {}) => {
  const a = (b.angle * Math.PI) / 180, r = orbitOf(b.i);
  return hdFrame(input([b], { at: { x: r * Math.cos(a), y: r * Math.sin(a) }, k: 6, pitch: 0.2, ...over })).frame;
};
const round = (f: ReturnType<typeof closeTo>) => f.points.map((pt) => Math.hypot(pt.pos[0] - f.planets[0].pos[0], pt.pos[1], pt.pos[2] - f.planets[0].pos[2]) / HD_PLANET);

test("close to, a planet has satellites low over it: a couple at camp, more as its crew member gets busy", () => {
  const atCamp = closeTo(body(0)), atWork = closeTo(body(0, { glow: 1 }), { sun: { glow: 1, waiting: false } }); // (the camp's own has two of its own)
  const low = (f: ReturnType<typeof closeTo>) => round(f).filter((d) => d > 1.15 && d < 1.7).length;
  expect(low(atCamp)).toBeGreaterThanOrEqual(2);
  expect(low(atCamp)).toBeLessThanOrEqual(4);      // (two of them, each with its light perhaps mid-blink)
  expect(low(atWork)).toBeGreaterThanOrEqual(6);
  // They come one at a time as the work picks up, not all at once.
  const counts = [0, 0.3, 0.6, 1].map((glow) => new Set(closeTo(body(0, { glow })).points.filter((pt) => pt.size === 0.55).map((pt) => pt.pos.join())).size);
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  expect(counts[0]).toBe(2);
  expect(counts[3]).toBe(6);
  // And they go round: a moment later they're somewhere else.
  expect(closeTo(body(0), { seconds: 13 }).points[0].pos).not.toEqual(atCamp.points[0].pos);
});

test("ships go out to each quest's moon and back, more of them the busier it is, and none to one that's waiting on you", () => {
  // (A ship and its burn are the smallest points there are, bar a satellite's own speck; the bigger ones are satellites' lights and the stream from the sun.)
  const isShip = (pt: { size: number }) => pt.size < 0.9 && pt.size !== 0.55;
  const ships = (b: HdBody) => closeTo(b).points.filter(isShip).length;
  expect(ships(body(0, { glow: 1 }))).toBe(0);                                // nothing out: nowhere to go
  const one = ships(body(0, { glow: 0, quests: [false] })), busy = ships(body(0, { glow: 1, quests: [false] }));
  expect(one).toBeGreaterThan(0);
  expect(busy).toBeGreaterThan(one);
  expect(ships(body(0, { glow: 1, quests: [false, false] }))).toBeGreaterThan(busy);
  expect(ships(body(0, { glow: 1, quests: [true] }))).toBe(0);                // waiting for your OK: nothing moves
  // A ship is on the line between the planet and the moon (lifted a little off it), never beyond the moon.
  const f = closeTo(body(0, { glow: 1, quests: [false] })), moon = f.planets[0].moons[0];
  const reach = Math.hypot(moon.pos[0] - f.planets[0].pos[0], moon.pos[1], moon.pos[2] - f.planets[0].pos[2]) / HD_PLANET;
  expect(f.points.some(isShip)).toBe(true);
  round(f).forEach((d, n) => { if (isShip(f.points[n])) { expect(d).toBeLessThan(reach + 0.2); expect(d).toBeGreaterThan(1); } });
});

test("none of that is drawn from far off, where it would only be specks over the whole system", () => {
  const far = hdFrame(input([body(0, { quests: [false] }), body(1)])).frame; // the whole system in view, the Scout at camp with a quest out
  expect(far.points).toEqual([]);
});

test("a world is drawn as it was made up: its size, its tilt, its rings, how far it has turned", () => {
  const [made] = worldsFor(7, [{ id: "scribe", color: [0.6, 0.5, 0.9] }]);
  const { frame, spots } = hdFrame(input([body(2, { turned: 2.5, world: { ...made, size: 1.25, ring: { inner: 1.4, outer: 2.2 } } })]));
  const [p] = frame.planets;
  expect(p.radius).toBeCloseTo(HD_PLANET * 1.25);
  expect(p).toMatchObject({ kind: made.kind, seed: made.seed, tilt: made.tilt, p: made.p, scale: made.scale, color2: made.color2, air: made.air, ring: { inner: 1.4, outer: 2.2 } });
  // A bigger world is a bigger thing to click on, and its name sits further out.
  const usual = hdFrame(input([body(2)])).spots[1];
  expect(spots[1].r).toBeCloseTo(usual.r * 1.25, 1);
  expect(p.spin).toBe(2.5); // (Orbit keeps how far each has turned, so changing how fast one spins doesn't fling it round)
});

test("a world's own moons are always there, grey and further out than a quest's; ships go to the quests' moons only", () => {
  const [made] = worldsFor(0, [{ id: "scout", color: [0.5, 0.5, 0.5] }]);
  const withMoon = { ...made, moons: [{ far: 2.3, lap: 30, start: 1, tip: 0.4, size: 0.2 }] };
  const quiet = hdFrame(input([body(0, { world: withMoon })])).frame.planets[0];
  expect(quiet.moons).toEqual([expect.objectContaining({ own: true, waiting: false })]);
  expect(Math.hypot(quiet.moons[0].pos[0] - quiet.pos[0], quiet.moons[0].pos[1], quiet.moons[0].pos[2] - quiet.pos[2])).toBeCloseTo(2.3 * HD_PLANET);
  expect(quiet.moons[0].radius).toBeCloseTo(0.2 * HD_PLANET);
  // With a quest out there are two: the quest's first (nearer), then its own.
  const out = hdFrame(input([body(0, { world: withMoon, quests: [false] })])).frame.planets[0];
  expect(out.moons.map((m) => !!m.own)).toEqual([false, true]);
  const far = out.moons.map((m) => Math.hypot(m.pos[0] - out.pos[0], m.pos[1], m.pos[2] - out.pos[2]));
  expect(far[0]).toBeLessThan(far[1]);
  // Close to, at work, with only its own moon: satellites, but no ships (there's no quest to go to).
  const f = closeTo(body(0, { world: withMoon, glow: 1 }));
  expect(f.points.filter((pt) => pt.size < 0.9 && pt.size !== 0.55)).toEqual([]);
});

test("a world has as many satellites of its own as it was given; more join them at work, unless it has none", () => {
  const [made] = worldsFor(0, [{ id: "scout", color: [0.5, 0.5, 0.5] }]);
  const specks = (sats: number, glow: number) => new Set(closeTo(body(0, { glow, world: { ...made, moons: [], sats } })).points.filter((pt) => pt.size === 0.55).map((pt) => pt.pos.join())).size;
  expect([0, 1, 3, 6].map((n) => specks(n, 0))).toEqual([0, 1, 3, 6]);
  expect(specks(3, 1)).toBe(7);
  expect(specks(6, 1)).toBe(10);
  expect(specks(0, 1)).toBe(0); // a world you've left bare stays bare
});

test("a cluster of asteroids: a main rock with the rig where the planet would be, the rest going round it; haulers between them, and beams at work", () => {
  const cluster = { ...asKind(OWN[0], MINE), p: [6, 1.2, 0.58, 0.26] as [number, number, number, number] };
  const quiet = hdFrame(input([body(0, { world: cluster })])).frame.planets[0];
  expect(quiet.kind).toBe(MINE);
  expect(quiet.rocks!.length).toBe(6);
  expect(quiet.rough).toBe(0.26);
  const [main, ...rest] = quiet.rocks!;
  expect(main).toMatchObject({ pos: quiet.pos, rig: true });
  expect(main.radius).toBeCloseTo(0.58 * quiet.radius);
  for (const rock of rest) {
    expect(rock.rig).toBe(false);
    expect(rock.radius).toBeLessThan(main.radius);
    const far = Math.hypot(rock.pos[0] - quiet.pos[0], rock.pos[1], rock.pos[2] - quiet.pos[2]);
    expect(far).toBeGreaterThan(main.radius);                 // clear of the main rock
    expect(far).toBeLessThan(quiet.radius * 1.3);              // and inside where a quest's moon goes
  }
  expect(new Set(rest.map((r) => r.seed)).size).toBe(5);       // each its own shape
  // They go round, and it's the same cluster a moment later: the same rocks, somewhere else.
  const later = hdFrame(input([body(0, { world: cluster })], { seconds: 20 })).frame.planets[0].rocks!;
  expect(later.map((r) => r.radius)).toEqual(quiet.rocks!.map((r) => r.radius));
  expect(later[1].pos).not.toEqual(rest[0].pos);
  // More rocks when asked for.
  expect(hdFrame(input([body(0, { world: { ...cluster, p: [9, 1.2, 0.58, 0.26] } })])).frame.planets[0].rocks!.length).toBe(9);
  // A world has none.
  expect(hdFrame(input([body(0)])).frame.planets[0].rocks).toBeUndefined();
  // Close to: haulers at camp (small points, as ships are), more of them at work, and at work the beams: a line of light to a rock, with a spark on it.
  const small = (f: ReturnType<typeof closeTo>) => f.points.filter((pt) => pt.size < 0.9 && pt.size !== 0.55 && pt.size !== 0.75).length;
  const beams = (f: ReturnType<typeof closeTo>) => f.points.filter((pt) => pt.size === 0.75 || pt.size === 2.4).length;
  const atCamp = closeTo(body(0, { world: cluster })), atWork = closeTo(body(0, { world: cluster, glow: 1 }), { seconds: 12.5 });
  expect(small(atCamp)).toBeGreaterThan(0);
  expect(small(atWork)).toBeGreaterThan(small(atCamp));
  expect(beams(atCamp)).toBe(0);
  expect(beams(atWork)).toBeGreaterThan(10);
  // From far off there are no haulers, but a cluster at work still shows its beams, fainter.
  const far = hdFrame(input([body(0, { world: cluster, glow: 1 })], { seconds: 12.5 })).frame;
  expect(far.points.filter((pt) => pt.size < 0.9 && pt.size !== 0.75)).toEqual([]);
  expect(far.points.some((pt) => pt.size === 2.4)).toBe(true);
});
