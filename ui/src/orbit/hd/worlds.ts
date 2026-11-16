// What each of the crew's world is like in the HD view: made up from a number (the seed), so the
// same number always makes the same worlds, and another makes others. Reroll in Orbit picks a new
// number. Pure, and nothing in it is left to chance but the number itself (newSeed), so it can be
// checked by itself.
//
// Every one of them is a world you could live on: seas, land, cloud, ice at the poles. What's
// made up is which sort of such a world it is (mostly sea, or dry, or cold, or thick with green,
// or somewhere between), how big it is, how far it's tipped and how it turns, whether it has
// rings, how many moons of its own it has and where they go, how thick its air is, and a second
// colour for it. What isn't: its first colour, which is its crew member's and says whose it is;
// and the Artificer, who builds things, has a station and not a world (though how that's built is
// made up too).
//
// A world's own moons are not the moons the view puts round it for quests (frame.ts): those come
// and go with the work and are its crew member's colour; these are grey, further out, and always there.
//
// The seed 0 is the camp's own: a sort for each orbit, every setting at its middle.
//
// And any one of them can be made your own (Custom): rolled again by itself, or changed a setting
// at a time, rings and moons and satellites added or taken away. What you've changed about a world
// is kept apart from the seed, and laid over whatever the seed makes of it.

import type { Vec3 } from "./math.ts";

export const WORLD = 0, STATION = 4;
export type Moon = { far: number; lap: number; start: number; tip: number; size: number }; // far, size: in the world's radii. lap: seconds round
// A world, as the drawing takes it. p: four settings.
//   a world:   how high the sea stands (higher: less land), how much cloud (lower: more), how far from the equator its ice begins, how dry its land is
//   a station: how many spokes, whether it has a second ring (1 or 0), how big its ring is, how long its solar wings are
export type World = {
  kind: number; sort: string; seed: number; size: number; tilt: number; spin: number; // size: of the usual radius. spin: radians a second, either way
  p: [number, number, number, number]; scale: number;                                 // scale: how fine its features are, all told
  color2: Vec3; ring: { inner: number; outer: number } | null; air: number; moons: Moon[]; // ring: in the world's radii. air: how thick, of the usual
  sats: number; // how many satellites it has at camp (more join them while there's work on, unless it has none)
};
// What you've changed about one world: a seed of its own (roll), and any of its settings.
export type Custom = Partial<Pick<World, "sort" | "size" | "tilt" | "spin" | "p" | "ring" | "air" | "moons" | "sats">> & { roll?: number };
// How far each setting can be taken by hand (a little past what the seed ever makes).
export const LIMITS = {
  size: [0.7, 1.35], tilt: [-0.7, 0.7], spin: [-0.25, 0.25], air: [0.4, 1.8], sea: [0.4, 0.62], cloud: [0.42, 0.72], ice: [0.5, 0.96], dry: [0, 1],
  ringIn: [1.25, 1.7], ringWide: [0.3, 1.2], moons: [0, 4], sats: [0, 6], spokes: [3, 8], stationRing: [0.66, 0.9], wings: [0.12, 0.34],
} as const;
export const RING_USUAL = { inner: 1.4, outer: 2.2 };

// The sorts of world there are, each as the range its four settings are drawn from.
type Range = [number, number];
const SORTS: Record<string, [Range, Range, Range, Range]> = {
  temperate: [[0.49, 0.53], [0.52, 0.62], [0.74, 0.84], [0.2, 0.45]],   // sea and land in balance
  ocean:     [[0.55, 0.6],  [0.47, 0.56], [0.78, 0.9],  [0.05, 0.25]],  // mostly sea, with islands
  arid:      [[0.42, 0.46], [0.6, 0.7],   [0.84, 0.92], [0.65, 0.95]],  // mostly land, much of it desert, under clear skies
  frost:     [[0.47, 0.53], [0.5, 0.6],   [0.56, 0.68], [0.15, 0.4]],   // ice reaching well down from the poles
  jungle:    [[0.46, 0.5],  [0.45, 0.52], [0.86, 0.94], [0, 0.12]],     // green from shore to shore, under heavy cloud
};
export const SORT_NAMES = Object.keys(SORTS);
// A sort's settings at their middle: what picking that sort by hand gives a world.
export const middle = (sort: string) => SORTS[sort].map(([lo, hi]) => (lo + hi) / 2) as World["p"];
const STATION_USUAL: World["p"] = [4, 1, 0.8, 0.24];
// The camp's own: which sort each orbit's world is, outwards; which of them have rings; and how many moons each has.
const BY_ORBIT = ["temperate", "arid", "ocean", "frost", "jungle"];
const OWN_RINGS = [false, false, true, false, false, true, false];
const OWN_MOONS = [1, 0, 2, 1, 0, 1, 2];
export const sortOf = (i: number) => BY_ORBIT[i % BY_ORBIT.length];

// Numbers that look random but always come out the same for the same start (mulberry32).
function numbers(start: number) {
  let a = start >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// A start for those numbers out of the seed and a name (FNV-1a), so each of the crew has their own run of them.
function startOf(seed: number, name: string) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return h;
}
// Another seed. (The one place chance comes in.) Never 0, which is the camp's own.
export const newSeed = () => 1 + Math.floor(Math.random() * 2147483646);

// A colour turned round the colour wheel by so many degrees, and made lighter or darker, staying a colour.
export function shifted(c: Vec3, degrees: number, lighter: number): Vec3 {
  const max = Math.max(...c), min = Math.min(...c), l = (max + min) / 2, d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1);
  if (d) h = max === c[0] ? ((c[1] - c[2]) / d) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  const hue = (((h * 60 + degrees) % 360) + 360) % 360, light = Math.min(0.85, Math.max(0.15, l + lighter));
  const chroma = (1 - Math.abs(2 * light - 1)) * Math.min(1, s), x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1)), m = light - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r + m, g + m, b + m];
}

// Moons of its own: each further out than the last, slower the further out, on a path tipped its own way.
// from: where a number between 0 and 1 comes from (so the camp's own can have theirs without chance).
const moonAt = (j: number, from: () => number): Moon => {
  const far = 2 + j * 0.34 + from() * 0.2;
  return { far, lap: 16 + far * 5 + from() * 8, start: from() * 2 * Math.PI, tip: 0.15 + from() * 1.1, size: 0.13 + from() * 0.13 };
};
const moonsFor = (count: number, from: () => number): Moon[] => Array.from({ length: count }, (_, j) => moonAt(j, from));
// Another moon for a world that has `have` of them already: the next one out, and always the same one for the same world.
export const anotherMoon = (world: World, have: number): Moon => moonAt(have, numbers(startOf(world.seed, `moon ${have}`)));

// The crew's worlds, in the order they're given (from the nearest orbit out), each with their colour.
export function worldsFor(seed: number, crew: { id: string; color: Vec3 }[]): World[] {
  if (!seed) {
    return crew.map((c, i) => {
      const station = c.id === "artificer", sort = station ? "station" : sortOf(i), steady = numbers(startOf(0, `${i}`));
      return {
        kind: station ? STATION : WORLD, sort, seed: i + 1, size: 1, tilt: 0.41, spin: 0.11, p: station ? [...STATION_USUAL] as World["p"] : middle(sort), scale: 1, color2: c.color,
        ring: !station && OWN_RINGS[i % OWN_RINGS.length] ? { ...RING_USUAL } : null, air: 1, moons: station ? [] : moonsFor(OWN_MOONS[i % OWN_MOONS.length], steady), sats: 2,
      };
    });
  }
  // The sorts are dealt, not drawn one at a time: all five come up before any comes up twice, so a small crew never has two alike.
  const deal = numbers(startOf(seed, "the deal"));
  const hand = (): string[] => { const h = [...SORT_NAMES]; for (let i = h.length - 1; i > 0; i--) { const j = Math.floor(deal() * (i + 1)); [h[i], h[j]] = [h[j], h[i]]; } return h; };
  let dealt: string[] = [];
  return crew.map((c) => {
    const next = numbers(startOf(seed, c.id)), between = (lo: number, hi: number) => lo + (hi - lo) * next();
    const station = c.id === "artificer";
    if (!station && !dealt.length) dealt = hand();
    const sort = station ? "station" : dealt.shift()!;
    // (Every number is drawn whatever it turns out to be for, so what's made up for someone doesn't shift about with the sort they were dealt.)
    const u = [next(), next(), next(), next()];
    const p: World["p"] = station ? [[3, 4, 4, 5, 6][Math.floor(u[0] * 5)], u[1] < 0.7 ? 1 : 0, 0.7 + 0.16 * u[2], 0.16 + 0.14 * u[3]]
      : SORTS[sort].map(([lo, hi], n) => lo + (hi - lo) * u[n]) as World["p"];
    const ringed = next(), inner = between(1.3, 1.6), wide = between(0.45, 1.05), big = next(), howMany = next(), own = moonsFor(3, next);
    return {
      kind: station ? STATION : WORLD, sort, seed: 1 + Math.floor(next() * 997), size: station ? 1 : 0.82 + 0.4 * big,
      tilt: between(0.05, 0.62) * (next() < 0.5 ? -1 : 1), spin: between(0.05, 0.2) * (next() < 0.18 ? -1 : 1),
      p, scale: between(0.75, 1.4), color2: shifted(c.color, between(22, 75) * (next() < 0.5 ? -1 : 1), between(-0.12, 0.14)),
      ring: !station && ringed < 0.3 ? { inner, outer: inner + wide } : null, air: between(0.7, 1.5),
      moons: station ? [] : own.slice(0, howMany < 0.2 ? 0 : howMany < 0.62 ? 1 : howMany < 0.9 ? 2 : 3), // most have one or two; some none, a few three
      sats: 1 + Math.floor(next() * 3),
    };
  });
}

// One world as you've made it: what the seed makes of it (or, rolled by itself, what its own seed does), with whatever
// you've changed laid over that. A station stays a station and a world a world, whatever is asked.
export function customised(base: World, custom: Custom | undefined, me: { id: string; color: Vec3 }): World {
  if (!custom) return base;
  const { roll, ...changed } = custom;
  const from = roll ? worldsFor(roll, [me])[0] : base;
  if (from.kind === STATION) { delete changed.sort; delete changed.ring; delete changed.moons; }
  else if (changed.sort && !SORTS[changed.sort]) delete changed.sort;
  return { ...from, ...changed };
}
