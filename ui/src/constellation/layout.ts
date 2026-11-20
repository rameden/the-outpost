// Where each star goes. Lines that live in the same place (one crew member's memory, one project's
// notes, the note about you) make one cluster, and the clusters stand in a ring round the centre.
// The ring is a rounded rectangle, wider than it's tall, as a page is (or, on an upright page,
// taller than it's wide): the map fills the page, so it can be drawn bigger and still be seen whole.
//
// Nothing here moves once it's drawn, and nothing is random: a star starts where its own id puts
// it, and a fixed number of steps then spread the stars of a cluster apart and draw joined ones
// together. The same memory always makes the same map, whatever order it arrives in, and a line
// added later doesn't send the others somewhere new.

export type LayNode = { id: string; where: string; recalls: number };
export type LayEdge = { a: string; b: string };
export type Star = { x: number; y: number; r: number };
export type Cluster = { where: string; x: number; y: number; r: number; count: number };
export type Layout = { stars: Map<string, Star>; clusters: Cluster[]; extent: number };

const STEPS = 90;      // relaxation steps: always this many
const GAP = 34;        // the room a star likes round itself
const BETWEEN = 70;    // the room between two clusters
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const WIDE = 1.6;      // the ring is this many times wider than it's tall (or, upright, taller than it's wide)
const SQUARE = 2.6;    // how square its corners are: 2 would be an ellipse, more is nearer a rectangle
const RING_N = 720;    // the points the ring is measured by

// The ring, one unit each way from the middle along its short side: its points, clockwise from the
// top, and how far round each is. A cluster is put by how far round it is, not by its angle, so the
// clusters are spread as evenly along the long sides as round the ends.
type Ring = { at: [number, number][]; far: number[]; round: number };
function ringOf(upright: boolean): Ring {
  const bend = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / SQUARE), w = upright ? 1 : WIDE, h = upright ? WIDE : 1;
  const at = Array.from({ length: RING_N + 1 }, (_, k): [number, number] => { const t = -Math.PI / 2 + (k / RING_N) * 2 * Math.PI; return [w * bend(Math.cos(t)), h * bend(Math.sin(t))]; });
  const far = [0];
  for (let k = 1; k <= RING_N; k++) far.push(far[k - 1] + Math.hypot(at[k][0] - at[k - 1][0], at[k][1] - at[k - 1][1]));
  return { at, far, round: far[RING_N] };
}
const RINGS = { wide: ringOf(false), upright: ringOf(true) };
// The point a share of the way round it (0 and 1 are both the top).
function onRing(RING: Ring, share: number): [number, number] {
  const want = (share - Math.floor(share)) * RING.round;
  let k = 1;
  while (k < RING_N && RING.far[k] < want) k++;
  const t = (want - RING.far[k - 1]) / (RING.far[k] - RING.far[k - 1] || 1), [x0, y0] = RING.at[k - 1], [x1, y1] = RING.at[k];
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

// A star is bigger the more often its line was used: 4 for never, growing by the root so that one
// much-used line doesn't swallow its neighbours.
export const starSize = (recalls: number) => Math.round((4 + 2.2 * Math.sqrt(Math.min(Math.max(recalls, 0), 36))) * 10) / 10;

// A number from 0 up to 1 that depends only on the text given (FNV-1a, then mixed).
export function seeded(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const round = (n: number) => Math.round(n * 100) / 100;

// upright: the page is taller than it's wide, so the ring is too.
export function layout(nodes: LayNode[], edges: LayEdge[], upright = false): Layout {
  const RING = upright ? RINGS.upright : RINGS.wide;
  // The places, in the order they first appear; the stars of each, in the order of their ids.
  const groups = new Map<string, LayNode[]>();
  for (const n of nodes) groups.set(n.where, [...(groups.get(n.where) ?? []), n]);
  const radius = (count: number) => 30 + GAP * 0.62 * Math.sqrt(count);
  const clusters: Cluster[] = [...groups].map(([where, list]) => ({ where, x: 0, y: 0, r: radius(list.length), count: list.length }));

  // The ring: each cluster takes a share of it by its size, and the ring grows until none overlap.
  if (clusters.length > 1) {
    const around = clusters.reduce((sum, c) => sum + 2 * c.r + BETWEEN, 0);
    let ring = around / RING.round; // half the ring's short side
    let gone = 0;
    const spots = clusters.map((c) => { const share = (2 * c.r + BETWEEN) / around, here = onRing(RING, gone + share / 2); gone += share; return here; });
    const put = () => clusters.forEach((c, i) => { c.x = ring * spots[i][0]; c.y = ring * spots[i][1]; });
    const overlap = () => clusters.some((p, i) => clusters.some((q, j) => j > i && Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r + BETWEEN * 0.6));
    put();
    for (let n = 0; n < 60 && overlap(); n++) { ring *= 1.08; put(); }
  }

  const stars = new Map<string, Star>();
  const home = new Map<string, Cluster>();
  for (const c of clusters) {
    const list = [...groups.get(c.where)!].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    for (const n of list) {
      // The start: an angle and a distance from the star's own id.
      const a = seeded(n.id) * 2 * Math.PI + GOLDEN, d = (c.r - 14) * Math.sqrt(seeded(`${n.id}/d`));
      stars.set(n.id, { x: c.x + d * Math.cos(a), y: c.y + d * Math.sin(a), r: starSize(n.recalls) });
      home.set(n.id, c);
    }
    const ids = list.map((n) => n.id);
    const mine = new Set(ids);
    const joined = edges.filter((e) => mine.has(e.a) && mine.has(e.b) && e.a !== e.b).sort((p, q) => `${p.a} ${p.b}`.localeCompare(`${q.a} ${q.b}`));
    for (let step = 0; step < STEPS; step++) {
      const heat = 1 - step / STEPS; // big moves first, small ones last
      const move = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
      // Two stars too close push each other apart.
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const p = stars.get(ids[i])!, q = stars.get(ids[j])!;
        let dx = q.x - p.x, dy = q.y - p.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = Math.cos(GOLDEN * (i + 1)); dy = Math.sin(GOLDEN * (i + 1)); dist = 1; } // on top of each other: any way apart will do
        const want = GAP + p.r + q.r;
        if (dist >= want) continue;
        const push = ((want - dist) / dist) * 0.5;
        move.get(ids[i])!.x -= dx * push; move.get(ids[i])!.y -= dy * push;
        move.get(ids[j])!.x += dx * push; move.get(ids[j])!.y += dy * push;
      }
      // Two joined stars draw together, to a little more than the room they like.
      for (const e of joined) {
        const p = stars.get(e.a)!, q = stars.get(e.b)!;
        const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1;
        const pull = ((dist - (GAP * 1.3 + p.r + q.r)) / dist) * 0.12;
        if (pull <= 0) continue;
        move.get(e.a)!.x += dx * pull; move.get(e.a)!.y += dy * pull;
        move.get(e.b)!.x -= dx * pull; move.get(e.b)!.y -= dy * pull;
      }
      for (const id of ids) {
        const s = stars.get(id)!, m = move.get(id)!;
        s.x += m.x * heat + (c.x - s.x) * 0.012; // and all of them lean a little toward the middle of their place
        s.y += m.y * heat + (c.y - s.y) * 0.012;
        // Nobody leaves their place.
        const out = Math.hypot(s.x - c.x, s.y - c.y), most = Math.max(0, c.r - s.r - 4);
        if (out > most) { s.x = c.x + ((s.x - c.x) / out) * most; s.y = c.y + ((s.y - c.y) / out) * most; }
      }
    }
  }
  for (const s of stars.values()) { s.x = round(s.x); s.y = round(s.y); }
  for (const c of clusters) { c.x = round(c.x); c.y = round(c.y); c.r = round(c.r); }
  const extent = clusters.reduce((far, c) => Math.max(far, Math.hypot(c.x, c.y) + c.r), 0);
  return { stars, clusters, extent: round(extent) };
}
