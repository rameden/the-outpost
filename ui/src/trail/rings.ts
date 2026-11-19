// Where every plan sits when the whole map is drawn as rings (Trail.tsx), the way Orbit draws the
// crew: one centre, and each run a ring round it. Pure: (the runs, oldest first) → a radius for
// each, a place on its ring for each of its steps, and the lines.
//
// The first run asked is the innermost ring and each later one is the next ring out, so the map
// grows outward as the day goes on. A ring is as big as its steps need, and never inside the one
// before it. A run's steps go clockwise round its ring in the trail's own order (layout.ts: a step
// always comes after what it waits for), starting from its conversation's bearing. Every run of
// one conversation starts on the same bearing, so a conversation is a spoke that reaches further
// out the longer it went, and a line joins each of its runs to the one before it. Nothing else
// joins two rings: a run with no conversation (a scheduled job) is joined to nothing.
//
// Within a ring, a step that waits for the step next door is joined to it along the ring. One
// that waits for a step further back is joined across: on a lane just inside the ring, clear of
// the steps between.
//
// Angles are in degrees, clockwise from three o'clock (the screen's y runs down), so -90 is the top.

import type { PlanStep } from "../feed/reducer.ts";
import { layoutOf } from "./layout.ts";

// DISC: a waypoint, across. MOON: one of the crew beside it. SLOT: the least room a waypoint has
// along its ring. GAP: the least from one ring to the next. R0: the innermost ring. GATE: how far
// before its first step a ring's number sits, along the ring. EDGE: from the outermost ring to the
// edge of the map. LANE: from one lane to the next.
export const DISC = 30, MOON = 22, SLOT = 84, GAP = 88, R0 = 84, GATE = 48, EDGE = 68, LANE = 8;
const TURN = 137.5; // from one conversation's bearing to the next (the golden angle, as Orbit starts its planets: none ever lands on another)
const LANES = 3; // lines across a ring share a lane past this many

type Step = Pick<PlanStep, "n" | "after">;
export type RingRun = { expId: string; thread?: string; steps: Step[] }; // thread: the conversation it's in, if any
export type Way = { n: number; slot: number; a: number; x: number; y: number; after: number[] }; // slot: its place round the ring, from 0. a: its angle
export type RingEdge = { from: number; to: number; lane: number; d: string; tip: string }; // lane 0: along the ring. 1 and up: across, inside it
export type Ring = {
  expId: string; ring: number; r: number; bearing: number; // ring: from 1, the innermost
  gate: { a: number; x: number; y: number }; // where its number sits, and where a line from another ring meets it
  ways: Way[]; edges: RingEdge[]; // ways: in the plan's own order
  follows?: string; // the run before it in its conversation
};
export type RingLink = { from: string; to: string; d: string };
export type Rings = { rings: Ring[]; links: RingLink[]; size: number; c: number }; // size: the map is square. c: its centre, both ways

const f = (v: number) => Math.round(v * 10) / 10;
const rad = (deg: number) => (deg * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;
const point = (c: number, r: number, a: number): [number, number] => [f(c + r * Math.cos(rad(a))), f(c + r * Math.sin(rad(a)))];
// An arrowhead with its point at (x, y), pointing along `a`.
function tipAt([x, y]: [number, number], a: number) {
  const cos = Math.cos(rad(a)), sin = Math.sin(rad(a));
  return `M${f(x - 7 * cos + 4.5 * sin)} ${f(y - 7 * sin - 4.5 * cos)}L${x} ${y}L${f(x - 7 * cos - 4.5 * sin)} ${f(y - 7 * sin + 4.5 * cos)}`;
}

export function ringsOf(runs: RingRun[]): Rings {
  // First the radii and bearings, which is all the size of the map hangs on.
  const threads: string[] = [], newest = new Map<string, string>(); // each conversation in the order it began, and its newest run so far
  let r = R0 - GAP;
  const rough = runs.map((run) => {
    const key = run.thread === undefined ? `x:${run.expId}` : `t:${run.thread}`;
    if (!threads.includes(key)) threads.push(key);
    const lay = layoutOf(run.steps), follows = newest.get(key);
    newest.set(key, run.expId);
    r = Math.ceil(Math.max(r + GAP, (lay.spots.length * SLOT + GATE) / (2 * Math.PI)));
    return { run, lay, r, bearing: (threads.indexOf(key) * TURN - 90) % 360, follows };
  });
  const c = rough.length ? r + EDGE : 0;

  const rings = rough.map(({ run, lay, r, bearing, follows }, i): Ring => {
    const order = [...lay.spots].sort((a, b) => a.col - b.col || a.row - b.row);
    const slot = new Map(order.map((s, j) => [s.n, j]));
    const apart = order.length ? (360 - deg(GATE / r)) / order.length : 0; // (the gate's stretch of the ring is left clear)
    const angle = (n: number) => bearing + slot.get(n)! * apart;
    const ways = lay.spots.map((s): Way => { const a = angle(s.n), [x, y] = point(c, r, a); return { n: s.n, slot: slot.get(s.n)!, a: f(a), x, y, after: s.after }; });

    const lanes: number[] = []; // for each lane, the slot its last line ends at
    const lines = lay.edges.map((e) => ({ ...e, a: slot.get(e.from)!, b: slot.get(e.to)! })).sort((p, q) => p.a - q.a || p.b - q.b);
    const edges = lines.map((e): RingEdge => {
      const a = angle(e.from), b = angle(e.to);
      if (e.b - e.a === 1) {
        const stop = b - deg((DISC / 2 + 2) / r), end = point(c, r, stop);
        return { from: e.from, to: e.to, lane: 0, d: `M${point(c, r, a).join(" ")}A${r} ${r} 0 ${stop - a > 180 ? 1 : 0} 1 ${end.join(" ")}`, tip: tipAt(end, stop + 90) };
      }
      let lane = lanes.findIndex((ends) => ends <= e.a);
      if (lane < 0) lane = Math.min(lanes.length, LANES - 1);
      lanes[lane] = e.b;
      const rl = r - DISC / 2 - LANE * (lane + 1), turn = Math.min(deg(12 / rl), (b - a) / 2), end = point(c, r - DISC / 2 - 2, b);
      const d = `M${point(c, r, a).join(" ")}Q${point(c, rl, a).join(" ")} ${point(c, rl, a + turn).join(" ")}`
        + `A${rl} ${rl} 0 ${b - a - 2 * turn > 180 ? 1 : 0} 1 ${point(c, rl, b - turn).join(" ")}Q${point(c, rl, b).join(" ")} ${end.join(" ")}`;
      return { from: e.from, to: e.to, lane: lane + 1, d, tip: tipAt(end, b) };
    });
    const ga = bearing - deg(GATE / r), [gx, gy] = point(c, r, ga);
    return { expId: run.expId, ring: i + 1, r, bearing, gate: { a: f(ga), x: gx, y: gy }, ways, edges, ...(follows ? { follows } : {}) };
  });

  // A run to the one before it in its conversation: gate to gate, leaving and arriving square to the rings.
  const by = new Map(rings.map((x) => [x.expId, x]));
  const links = rings.flatMap((to): RingLink[] => {
    const from = to.follows ? by.get(to.follows) : undefined;
    if (!from) return [];
    const mid = (from.r + to.r) / 2;
    return [{ from: from.expId, to: to.expId, d: `M${from.gate.x} ${from.gate.y}C${point(c, mid, from.gate.a).join(" ")} ${point(c, mid, to.gate.a).join(" ")} ${to.gate.x} ${to.gate.y}` }];
  });
  return { rings, links, size: c * 2, c };
}

// Where the crew sent on a step sit round its waypoint: a moon each, fanned out on the side away
// from the centre (`a` is the waypoint's angle), four to a row. Offsets from the waypoint's middle.
export function moonsOf(a: number, count: number): { dx: number; dy: number }[] {
  return Array.from({ length: count }, (_, j) => {
    const row = Math.floor(j / 4), inRow = Math.min(4, count - row * 4);
    const out = DISC / 2 + 5 + MOON / 2 + row * (MOON + 3), at = rad(a + ((j % 4) - (inRow - 1) / 2) * 46);
    return { dx: f(out * Math.cos(at)), dy: f(out * Math.sin(at)) };
  });
}
