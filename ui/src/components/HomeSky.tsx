// The sky behind Today: the memory map's own night sky (Orbit's three sheets of stars, .orb-stars), and
// over the greeting a small constellation of the crew, each member a star in their own colour with the
// Quartermaster in the middle, and a few faint figures round it. It wears the page's colours, so it
// follows light, dark and the palettes (on a light page the sheets turn to ink).
//
// Nothing moves on its own but a slow twinkle (none when motion is turned down). The sheets drift with
// the page as you scroll it, the nearer ones further, as they drift when you move round Orbit.
import { forwardRef, useImperativeHandle, useRef } from "react";
import { STARS, wrap } from "../orbit/scene.ts";

// How far each sheet drifts for a pixel of scroll: Orbit's depths, made big enough to be felt.
const DRIFT = 2.4;

// The crew's figure, in a 420 × 220 box: the Quartermaster at the heart, the others round them.
const CREW: { id: string; x: number; y: number; r: number }[] = [
  { id: "quartermaster", x: 214, y: 112, r: 3.6 },
  { id: "scout", x: 92, y: 58, r: 2.6 },
  { id: "scribe", x: 330, y: 44, r: 2.6 },
  { id: "artificer", x: 372, y: 168, r: 2.6 },
  { id: "warden", x: 120, y: 186, r: 2.6 },
  { id: "wizard", x: 236, y: 26, r: 2.6 },
];
const CREW_JOINS: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 3], [0, 5], [1, 5]];
// Two quieter figures in the page's ink, for company.
const FIGURES: { at: [number, number][]; joins: [number, number][] }[] = [
  { at: [[18, 132], [44, 104], [36, 70], [64, 22]], joins: [[0, 1], [1, 2], [2, 3]] },
  { at: [[262, 196], [292, 210], [318, 192], [404, 96], [410, 62]], joins: [[0, 1], [1, 2], [3, 4]] },
];

export type HomeSkyHandle = { scrolled: (top: number) => void };

export const HomeSky = forwardRef<HomeSkyHandle>(function HomeSky(_, ref) {
  const sheets = useRef<(HTMLDivElement | null)[]>([]);
  useImperativeHandle(ref, () => ({
    scrolled: (top) => STARS.forEach(([tile, depth], j) => {
      const el = sheets.current[j];
      if (el) el.style.transform = `translate3d(0, ${wrap(-top * depth * DRIFT, tile).toFixed(1)}px, 0)`;
    }),
  }), []);
  return (
    <div className="home-sky" aria-hidden="true">
      {STARS.map((_, j) => (
        <div key={j} ref={(el) => { sheets.current[j] = el; }} className={`orb-stars s${j + 1}`} />
      ))}
      <svg className="home-figure" viewBox="0 0 420 220" preserveAspectRatio="xMidYMid meet">
        {FIGURES.map((f, i) => (
          <g key={i} className="home-figure-faint">
            {f.joins.map(([a, b]) => <line key={`${a}-${b}`} x1={f.at[a][0]} y1={f.at[a][1]} x2={f.at[b][0]} y2={f.at[b][1]} />)}
            {f.at.map(([x, y], k) => <circle key={k} cx={x} cy={y} r={1.6} style={{ animationDelay: `${-(i * 5 + k) * 0.9}s` }} />)}
          </g>
        ))}
        <g className="home-figure-crew">
          {CREW_JOINS.map(([a, b]) => <line key={`${a}-${b}`} x1={CREW[a].x} y1={CREW[a].y} x2={CREW[b].x} y2={CREW[b].y} />)}
          {CREW.map((s, k) => (
            <g key={s.id} className={`c-${s.id}`} transform={`translate(${s.x} ${s.y})`}>
              <circle className="home-figure-glow" r={s.r * 4} />
              <circle className="home-figure-star" r={s.r} style={{ animationDelay: `${-k * 1.3}s` }} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
});
