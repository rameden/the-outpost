// The crew's worlds in the HD view, made up from a number: each one a world you could live on.
import { expect, test } from "vitest";
import type { Vec3 } from "./math.ts";
import { KINDS, LIMITS, MINE, SORT_NAMES, STATION, WORLD, anotherMoon, asKind, customised, laidOut, middle, newSeed, shifted, sortOf, worldsFor } from "./worlds.ts";

const crew = ["scout", "artificer", "scribe", "warden", "hacker", "cook", "smith"].map((id, i) => ({ id, color: [0.3 + i * 0.08, 0.6, 0.9 - i * 0.08] as Vec3 }));

test("the same number makes the same worlds, and another number makes others", () => {
  expect(worldsFor(42, crew)).toEqual(worldsFor(42, crew));
  expect(worldsFor(42, crew)).not.toEqual(worldsFor(43, crew));
  // Someone's world is theirs: whoever else is in the crew with them, only what goes with the sort they were dealt differs.
  const alone = worldsFor(42, [crew[2]])[0], among = worldsFor(42, crew)[2];
  const apart = (w: typeof alone) => ({ ...w, sort: "", p: 0 });
  expect(apart(alone)).toEqual(apart(among));
});

test("every one of them is a world you could live on, of one sort or another; the Artificer has a station", () => {
  for (const seed of [0, 1, 2, 3, 99, 2026, 123456789]) {
    const made = worldsFor(seed, crew);
    expect(made[1]).toMatchObject({ kind: STATION, sort: "station", ring: null, moons: [] });
    for (const w of made.filter((_, i) => i !== 1)) {
      expect(w.kind).toBe(WORLD);
      expect(SORT_NAMES).toContain(w.sort);
      const [sea, cloud, ice, dryness] = w.p;
      expect(sea).toBeGreaterThanOrEqual(0.42); expect(sea).toBeLessThanOrEqual(0.6);      // there's always both sea and land
      expect(cloud).toBeGreaterThanOrEqual(0.45); expect(cloud).toBeLessThanOrEqual(0.7);
      expect(ice).toBeGreaterThanOrEqual(0.56); expect(ice).toBeLessThanOrEqual(0.94);     // ice at the poles, never all the way down
      expect(dryness).toBeGreaterThanOrEqual(0); expect(dryness).toBeLessThanOrEqual(0.95);
    }
  }
});

test("the sorts are dealt: five of the crew have five different worlds, and each of them gets every sort sooner or later", () => {
  for (const seed of [1, 2, 3, 99, 2026]) {
    const sorts = worldsFor(seed, crew).filter((w) => w.kind === WORLD).map((w) => w.sort);
    expect(new Set(sorts.slice(0, 5))).toEqual(new Set(SORT_NAMES));
  }
  expect(new Set(Array.from({ length: 60 }, (_, n) => worldsFor(n + 1, crew)[0].sort))).toEqual(new Set(SORT_NAMES));
  // A mostly-sea world has more sea than a dry one, which is drier than a green one.
  const of = (sort: string) => Array.from({ length: 80 }, (_, n) => worldsFor(n + 1, crew)).flat().filter((w) => w.sort === sort);
  const mean = (ws: ReturnType<typeof of>, n: number) => ws.reduce((a, w) => a + w.p[n], 0) / ws.length;
  expect(mean(of("ocean"), 0)).toBeGreaterThan(mean(of("arid"), 0) + 0.08);
  expect(mean(of("arid"), 3)).toBeGreaterThan(mean(of("jungle"), 3) + 0.5);
  expect(mean(of("frost"), 2)).toBeLessThan(mean(of("temperate"), 2) - 0.1); // its ice begins nearer the equator
});

test("some have rings and most have a moon or two of their own, each further out than the last and clear of the world", () => {
  let ringed = 0, all = 0, backwards = 0;
  const moonCounts = new Set<number>();
  for (let seed = 1; seed <= 80; seed++) for (const w of worldsFor(seed, crew)) {
    if (w.kind !== WORLD) continue;
    all++;
    expect(w.size).toBeGreaterThanOrEqual(0.82); expect(w.size).toBeLessThanOrEqual(1.22);
    expect(Math.abs(w.tilt)).toBeLessThanOrEqual(0.62);
    expect(Math.abs(w.spin)).toBeGreaterThanOrEqual(0.05); expect(Math.abs(w.spin)).toBeLessThanOrEqual(0.2);
    expect(w.scale).toBeGreaterThanOrEqual(0.75); expect(w.scale).toBeLessThanOrEqual(1.4);
    for (const c of w.color2) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    if (w.ring) { ringed++; expect(w.ring.inner).toBeGreaterThan(1.25); expect(w.ring.outer).toBeGreaterThan(w.ring.inner + 0.4); expect(w.ring.outer).toBeLessThan(2.7); }
    if (w.spin < 0) backwards++;
    moonCounts.add(w.moons.length);
    expect(w.moons.length).toBeLessThanOrEqual(3);
    w.moons.forEach((m, j) => {
      expect(m.far).toBeGreaterThan(1.9); expect(m.far).toBeLessThan(3);     // beyond the quests' moons' usual place, short of the next orbit
      if (j) expect(m.far).toBeGreaterThan(w.moons[j - 1].far);
      expect(m.size).toBeGreaterThan(0.1); expect(m.size).toBeLessThan(0.3); // a moon, not a twin
      expect(m.lap).toBeGreaterThan(20);                                     // slower than anything a quest puts there
    });
  }
  expect(ringed).toBeGreaterThan(all * 0.15); expect(ringed).toBeLessThan(all * 0.45);
  expect(backwards).toBeGreaterThan(0); expect(backwards).toBeLessThan(all * 0.4);
  expect(moonCounts).toEqual(new Set([0, 1, 2, 3]));
});

test("the number 0 is the camp's own: a sort for each orbit at its middle, with rings and moons on some", () => {
  const own = worldsFor(0, crew);
  expect(own.map((w) => w.sort)).toEqual([sortOf(0), "station", sortOf(2), sortOf(3), sortOf(4), sortOf(5), sortOf(6)]);
  expect(new Set([0, 1, 2, 3, 4].map(sortOf))).toEqual(new Set(SORT_NAMES));
  expect(own.every((w) => w.size === 1 && w.scale === 1 && w.air === 1 && w.tilt === 0.41)).toBe(true);
  own.forEach((w, i) => expect(w.color2).toEqual(crew[i].color));
  expect(own.filter((w) => w.ring).length).toBeGreaterThan(0);
  expect(own.filter((w) => w.ring).length).toBeLessThan(own.length / 2);
  expect(own.some((w) => w.moons.length > 0)).toBe(true);
  expect(own.some((w) => w.kind === WORLD && w.moons.length === 0)).toBe(true);
  expect(worldsFor(0, crew)).toEqual(own); // (no chance in it)
  // A new number is never that one.
  for (let n = 0; n < 50; n++) { const s = newSeed(); expect(Number.isInteger(s)).toBe(true); expect(s).toBeGreaterThan(0); }
});

test("a station's build is made up too: its spokes, a second ring or not, how big its ring and how long its wings", () => {
  const builds = Array.from({ length: 60 }, (_, n) => worldsFor(n + 1, crew)[1].p);
  for (const [spokes, second, ring, wing] of builds) {
    expect([3, 4, 5, 6]).toContain(spokes); expect([0, 1]).toContain(second);
    expect(ring).toBeGreaterThanOrEqual(0.7); expect(ring).toBeLessThanOrEqual(0.86);
    expect(wing).toBeGreaterThanOrEqual(0.16); expect(wing).toBeLessThanOrEqual(0.3);
  }
  expect(new Set(builds.map((b) => b[0])).size).toBeGreaterThan(2);
  expect(new Set(builds.map((b) => b[1]))).toEqual(new Set([0, 1]));
});

test("a second colour is the first, turned round the wheel a way: still a colour, and not the same one", () => {
  const green: Vec3 = [147 / 255, 196 / 255, 125 / 255];
  const turned = shifted(green, 60, 0);
  expect(turned).not.toEqual(green);
  for (const c of turned) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
  shifted(turned, -60, 0).forEach((c, i) => expect(c).toBeCloseTo(green[i], 5)); // (and turned back, it's the first again)
  expect(shifted([0.5, 0.5, 0.5], 90, 0)).toEqual([0.5, 0.5, 0.5]); // grey has nowhere to turn
});

test("one world made your own: what you changed is laid over what the seed makes, and the rest is as it was", () => {
  const [scout, station] = worldsFor(42, crew), me = crew[0];
  expect(customised(scout, undefined, me)).toBe(scout);
  const ringed = customised(scout, { ring: { inner: 1.4, outer: 2 }, sats: 5 }, me);
  expect(ringed).toEqual({ ...scout, ring: { inner: 1.4, outer: 2 }, sats: 5 });
  // Its rings can be taken away too, which isn't the same as never having said.
  expect(customised({ ...scout, ring: { inner: 1.4, outer: 2 } }, { ring: null }, me).ring).toBe(null);
  // Picking a sort by hand gives it that sort's middle; an unknown one is ignored.
  const dry = customised(scout, { sort: "arid", p: middle("arid") }, me);
  expect(dry.sort).toBe("arid");
  expect(dry.p[3]).toBeGreaterThan(0.6);
  expect(customised(scout, { sort: "lava" }, me).sort).toBe(scout.sort);
  // Rolled again by itself: another world, the same one each time for that roll, with what's changed since laid over it.
  const rolled = customised(scout, { roll: 777 }, me);
  expect(rolled).toEqual(worldsFor(777, [me])[0]);
  expect(rolled).not.toEqual(scout);
  expect(customised(scout, { roll: 777, sats: 0 }, me)).toEqual({ ...rolled, sats: 0 });
  // A station can be rebuilt and rolled, but not given seas, rings or moons.
  const rebuilt = customised(station, { p: [6, 0, 0.8, 0.2], sort: "ocean", ring: { inner: 1.4, outer: 2 }, moons: [anotherMoon(scout, 0)] }, crew[1]);
  expect(rebuilt).toMatchObject({ kind: STATION, sort: "station", p: [6, 0, 0.8, 0.2], ring: null, moons: [] });
  expect(customised(station, { roll: 5 }, crew[1]).kind).toBe(STATION);
});

test("another moon is the next one out, and always the same one for the same world", () => {
  const [scout] = worldsFor(42, crew);
  const first = anotherMoon(scout, 0), second = anotherMoon(scout, 1), fourth = anotherMoon(scout, 3);
  expect(anotherMoon(scout, 0)).toEqual(first);
  expect(second.far).toBeGreaterThan(first.far);
  expect(fourth.far).toBeGreaterThan(second.far);
  expect(fourth.far).toBeLessThan(3.4);
  // What the seed makes is always inside how far each setting can be taken by hand.
  for (let seed = 0; seed <= 40; seed++) for (const w of worldsFor(seed, crew)) {
    if (w.kind !== WORLD) { expect(w.p[0]).toBeLessThanOrEqual(LIMITS.spokes[1]); continue; }
    const within = (v: number, [lo, hi]: readonly [number, number]) => { expect(v).toBeGreaterThanOrEqual(lo); expect(v).toBeLessThanOrEqual(hi); };
    within(w.size, LIMITS.size); within(w.tilt, LIMITS.tilt); within(w.spin, LIMITS.spin); within(w.air, LIMITS.air);
    within(w.p[0], LIMITS.sea); within(w.p[1], LIMITS.cloud); within(w.p[2], LIMITS.ice); within(w.p[3], LIMITS.dry);
    within(w.moons.length, LIMITS.moons); within(w.sats, LIMITS.sats);
    if (w.ring) { within(w.ring.inner, LIMITS.ringIn); within(w.ring.outer - w.ring.inner, LIMITS.ringWide); }
  }
});

test("anyone's can be a planet, a station or a cluster of asteroids: the same crew member's, as another kind of thing", () => {
  expect(KINDS).toEqual([WORLD, STATION, MINE]);
  for (const seed of [0, 7, 2026]) {
    const [scout, station] = worldsFor(seed, crew);
    // The Scout's world as a station, and as a cluster: built or laid out afresh, with no sea, rings or moons of its own…
    const built = asKind(scout, STATION), mined = asKind(scout, MINE);
    expect(built).toMatchObject({ kind: STATION, sort: "station", ring: null, moons: [] });
    expect(mined).toMatchObject({ kind: MINE, sort: "asteroids", ring: null, moons: [] });
    expect([3, 4, 5, 6]).toContain(built.p[0]);
    const [rocks, spread, main, rough] = mined.p;
    expect(Number.isInteger(rocks)).toBe(true);
    for (const [v, limit] of [[rocks, LIMITS.rocks], [spread, LIMITS.spread], [main, LIMITS.mainRock], [rough, LIMITS.rough]] as const) { expect(v).toBeGreaterThanOrEqual(limit[0]); expect(v).toBeLessThanOrEqual(limit[1]); }
    // …but still theirs: how it's tipped and turns, its second colour and its satellites are as they were.
    for (const made of [built, mined]) expect(made).toMatchObject({ seed: scout.seed, tilt: scout.tilt, spin: scout.spin, color2: scout.color2, sats: scout.sats });
    // The Artificer's station as a world: a sort of its own, at that sort's middle, with a moon.
    const settled = asKind(station, WORLD);
    expect(settled.kind).toBe(WORLD);
    expect(SORT_NAMES).toContain(settled.sort);
    expect(settled.p).toEqual(middle(settled.sort));
    expect(settled.moons.length).toBe(1);
    // The same thing asked twice is the same thing; what it already is, or something there's no such kind of, leaves it be.
    expect(asKind(scout, MINE)).toEqual(mined);
    expect(asKind(scout, WORLD)).toBe(scout);
    expect(asKind(scout, 9)).toBe(scout);
  }
});

test("what kind it is is one more thing you can change about a world, and is kept through a roll of its own", () => {
  const [scout] = worldsFor(42, crew), me = crew[0];
  const mined = customised(scout, { kind: MINE }, me);
  expect(mined).toEqual(asKind(scout, MINE));
  // Its settings are the cluster's from then on; a world's (a sort, rings, moons) don't apply to it, and ones left unsaid don't blank it.
  expect(customised(scout, { kind: MINE, p: [9, 1.5, 0.6, 0.3], sort: "ocean", ring: { inner: 1.4, outer: 2 } }, me)).toMatchObject({ kind: MINE, sort: "asteroids", p: [9, 1.5, 0.6, 0.3], ring: null });
  expect(customised(scout, { kind: MINE, p: undefined, sort: undefined, moons: undefined }, me)).toEqual(mined);
  // Rolled by itself and said to be a station: that roll's world, as a station.
  expect(customised(scout, { roll: 777, kind: STATION }, me)).toEqual(asKind(worldsFor(777, [me])[0], STATION));
  // The Artificer, who has a station to begin with, can have a world like anyone.
  const station = worldsFor(42, crew)[1];
  expect(customised(station, { kind: WORLD }, crew[1]).kind).toBe(WORLD);
  // Where a cluster's rocks lie is always the same for the same cluster.
  const a = laidOut(mined.seed, "rocks"), b = laidOut(mined.seed, "rocks");
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
