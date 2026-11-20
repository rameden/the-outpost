// A join between two lines, drawn as a nerve fibre rather than a ruled line: it bows a little on
// its way, stops just short of each star (the gap a synapse has) and ends there in a small bulb.
// It glows faintly, in the colour of the place at each end, running from the one to the other.
// Lines that are alike are a plain fibre. Lines that are used together carry beads along it, and
// now and then a spark runs down it (they fire together). The joins of the star you picked are
// lit, and fire steadily: a pulse runs out from it along each of them.
import { memo, type CSSProperties } from "react";
import { cx } from "../format.ts";

export type End = { x: number; y: number; r: number }; // a star: where it is and how far out its edge is
export const CLEFT = 3;    // the gap between a fibre's bulb and the star it reaches
export const BULB = 1.7;   // the bulb's radius
const BOW = 0.2, BOW_MOST = 26; // how far a fibre bows off the straight line: a share of its length, and the most it may be

// Two numbers from -1 to 1 that are always the same for the same join (FNV-1a over its name).
function sway(seed: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h >>>= 0;
  return [((h & 0xffff) / 0xffff) * 2 - 1, ((h >>> 16) / 0xffff) * 2 - 1];
}
const SPARK_S = 7; // a spark every this many seconds (the stylesheet's con-spark is as long); each join starts somewhere of its own in that
const n1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// The fibre from a to b: its path, and where its two bulbs sit (its two ends).
export function fibre(a: End, b: End, seed: string): { d: string; from: [number, number]; to: [number, number] } {
  const dx = b.x - a.x, dy = b.y - a.y, far = Math.hypot(dx, dy) || 1;
  const ux = dx / far, uy = dy / far;
  // Two stars that touch or overlap have no room for a gap: the fibre runs centre to centre, under them.
  const room = far - a.r - b.r, gap = Math.min(CLEFT, room / 4);
  const off = room > 0 ? [a.r + gap, b.r + gap] : [0, 0];
  const x0 = a.x + ux * off[0], y0 = a.y + uy * off[0], x1 = b.x - ux * off[1], y1 = b.y - uy * off[1];
  const span = Math.hypot(x1 - x0, y1 - y0), bow = Math.min(span * BOW, BOW_MOST), [s1, s2] = sway(seed);
  // Two handles a third and two thirds of the way, each pushed off to one side: some fibres curve one way, some turn back on themselves.
  const c = (t: number, s: number) => `${n1(x0 + (x1 - x0) * t - uy * bow * s)} ${n1(y0 + (y1 - y0) * t + ux * bow * s)}`;
  return { d: `M${n1(x0)} ${n1(y0)}C${c(1 / 3, s1)} ${c(2 / 3, s2)} ${n1(x1)} ${n1(y1)}`, from: [x0, y0], to: [x1, y1] };
}

export const Synapse = memo(function Synapse({ a, b, seed, kind, ca, cb, on, back, dim }: {
  a: End; b: End; seed: string; kind: "alike" | "together";
  ca?: string; cb?: string; // the class that colours the place at each end
  on?: boolean;   // it's a join of the star that's picked
  back?: boolean; // …and that star is b, so the pulse runs from b to a
  dim?: boolean;
}) {
  const f = fibre(a, b, seed), id = `con-f-${seed.replace(/[^\w-]/g, "")}`, paint = `url(#${id})`;
  return (
    <g className={cx("con-edge", kind, on && "on", dim && "dim")} style={{ "--d": (((sway(seed)[0] + 1) / 2) * SPARK_S).toFixed(2) } as CSSProperties}>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={n1(f.from[0])} y1={n1(f.from[1])} x2={n1(f.to[0])} y2={n1(f.to[1])}>
        <stop offset="0" className={cx("con-stop", ca)} /><stop offset="1" className={cx("con-stop", cb)} />
      </linearGradient>
      <path className="con-glow" d={f.d} stroke={paint} />
      <path className="con-fibre" d={f.d} stroke={paint} />
      {kind === "together" && <path className="con-beads" d={f.d} />}
      {kind === "together" && !on && <path className="con-spark" d={f.d} pathLength={100} />}
      {on && <path className={cx("con-pulse", back && "back")} d={f.d} pathLength={100} />}
      <circle className={cx("con-bulb", ca)} cx={n1(f.from[0])} cy={n1(f.from[1])} r={BULB} />
      <circle className={cx("con-bulb", cb)} cx={n1(f.to[0])} cy={n1(f.to[1])} r={BULB} />
    </g>
  );
});
