// The camp at rest: the films' solar system (docs/films), small and slow, for a page with nothing on
// it yet. The logo's amber dot is the sun, which is the Quartermaster, and the crew circle it as
// planets, each on its own orbit at its own pace with a short tail behind it. The orbits are drawn
// as the films draw their map: contour lines, a little uneven and more so further out. A planet
// sits on its line and the line turns with it, so the tail behind a planet is a stretch of that
// same line, bends and all.
//
// It keeps itself busy the way the films do. The crew take turns: a quest leaves the sun for the
// next of them as a small comet in their colour, their contour line lights up, the planet rings as
// the quest lands, a moon circles it while it works, and then a report flies home and the sun sends
// a ring out, which lights each contour line as it passes through it, as a ping does on the films'
// map. Then the next one, and round again.
//
// Who is in the rotation is the camp's own crew (everyone but the Quartermaster, who is the sun),
// so someone you add, like the Test Pilot, gets an orbit too: the next one out, in the colour you gave
// them. With nobody (`crew` empty: outside a project there is no crew until you call one in) the
// lines are empty and the sun just sends a ring out now and then.
//
// It's drawn as SVG. The stylesheet (.mae-system in styles.css) does all the moving, sets its size
// and its colours for each theme, and stops it for anyone who has asked their system for less
// motion (the planets then rest where they start). The only script is whose turn it is.
// Point at a line and it turns the sun's amber: each has a wider, unseen line over it to catch the pointer.
// And it can be strummed: a line the pointer crosses is plucked, flashing amber and shivering out from
// the sun and back as it settles, harder the faster the pointer was going, and it plays out after the
// pointer has moved on, so a sweep across the lines rings each in turn. (Less motion: just the flash.)
// Each line sounds its own note as it's plucked, the nearest highest (chime.ts's strum), when the strum sound is on in Settings → Appearance.
//
// Decoration: the words beside it say what the page is.

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cClass } from "../format.ts";
import { strum } from "../chime.ts";
import { motionOK } from "../motion.tsx";

export type Orbiter = { id: string; name: string; emoji?: string };

// The camp's own four, for when the page doesn't know its crew yet.
const BUILT_IN: Orbiter[] = [{ id: "scout", name: "Scout" }, { id: "artificer", name: "Artificer" }, { id: "scribe", name: "Scribe" }, { id: "warden", name: "Warden" }];
// Each one's mark, drawn in a 24-unit box as the films draw them. Anyone else shows their emoji.
export const MARKS: Record<string, ReactNode> = {
  scout: <><path d="M7 3.5 C16.5 6.5 16.5 17.5 7 20.5" /><path d="M7 3.5 V20.5" /><path d="M2.5 12 H20.5 M17.5 9 L20.5 12 L17.5 15" /></>,
  artificer: <g transform="rotate(40 12 12)"><rect x="5.5" y="3.5" width="13" height="6.5" rx="1.5" /><path d="M12 10 V21.5" /></g>,
  scribe: <><path d="M20 4 C12 4.5 7 9 6 17 C13.5 16.5 19 12 20 4 Z" /><path d="M3.8 20.2 L13 11" /></>,
  warden: <><path d="M12 3 L19.5 6 V11.5 C19.5 16.2 16.4 19.4 12 21 C7.6 19.4 4.5 16.2 4.5 11.5 V6 Z" /><path d="M8.8 11.9 L11.2 14.3 L15.4 9.9" /></>,
  wizard: <><path d="M4 20 L14.5 9.5" /><path d="M17.5 3 V8 M15 5.5 H20" /><path d="M19.5 11.5 V13.5 M18.5 12.5 H20.5" /></>,
};

// Where things are, in the drawing's own units. The stylesheet has a pace and a reach for each orbit
// (.sys-o1 to .sys-o7), and a width for each size of system, so seven is as many as it draws.
export const MOST = 7;
const FIRST = 42, APART = 22;
const orbit = (i: number) => FIRST + APART * i;
// Each planet starts a good way round from the one inside it (the golden angle), so they begin spread out.
export const startOf = (i: number) => Math.round((60 + i * 137.5) % 360);
export const TURN_MS = 8000; // how long one of the crew has the quest; the stylesheet's turn animations are as long
// How long a lap takes, in seconds, orbit by orbit outwards. The stylesheet turns the planets here
// (.sys-o1 …) and has the same numbers; the full-screen view (orbit/) turns its own by these.
export const LAPS = [24, 37, 56, 86, 124, 170, 228];

// A contour line: a ring of radius r that wanders in and out a little as it goes round, as the films'
// map does (the same two waves, three and five to a turn). `i` counts outwards: each line is shaped
// differently, and wanders more than the one inside it. Where it starts (due right of the sun) the
// two waves cancel, so the line is exactly r from the sun there: that is where its planet sits.
export function contourPoints(r: number, i: number): [number, number][] {
  const n = 120, wander = Math.min(1, 0.25 + i * 0.15);
  const p = (i % 2 ? Math.PI : 0) + 0.6 * Math.sin(2.1 * i + 1), q0 = Math.asin(1.5 * Math.sin(p)), q = i % 3 ? q0 : Math.PI - q0;
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI;
    const at = r * (1 + wander * (0.06 * Math.sin(3 * a + p) - 0.04 * Math.sin(5 * a + q)));
    return [at * Math.cos(a), at * Math.sin(a)];
  });
}
// The same line as an SVG path. (The full-screen view's 3D drawing takes the points themselves.)
export function contour(r: number, i: number): string {
  return contourPoints(r, i).map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
}
// The tail: three stretches of the planet's own line that end at the planet, each shorter than the
// last, so it is faintest furthest back. Each is the whole line with all but that stretch left
// undrawn: the line is measured as 1000 units round (LAP), and the stretch is its last few. A nearer
// planet is quicker, so its tail is longer (in degrees).
export const TAIL = [1, 0.62, 0.3];
export const LAP = 1000;
export const stretch = (r: number, k: number) => Math.round(((2600 / r) * k * LAP) / 360);
// A quest or a report in flight: a head and three smaller dots that follow it a moment behind.
const COMET = [3.2, 2.6, 2, 1.4];

// A plucked line: how far it swings out (as a share of its size) and how long it takes to settle.
// It swings out, back in a little less, and so on, each swing smaller.
export const PLUCK_MS = 900;
const SWINGS = [0, 1, -0.7, 0.45, -0.28, 0.15, -0.06, 0];
// How hard: a slow pass barely moves it, a quick sweep makes it ring (speed in px per ms).
export const pluckReach = (speed: number) => Math.min(0.05, 0.01 + 0.02 * speed);

// crew: who circles the sun, in order from the nearest orbit out. Left out, it's the camp's own four.
export function MaeSystem({ crew = BUILT_IN, className }: { crew?: Orbiter[]; className?: string }) {
  const planets = crew.slice(0, MOST);
  const n = planets.length;
  // A line for each orbit (four at least, so an empty system still has its map), and a fainter one beyond.
  const lines = Math.max(n, 4);
  const contours = useMemo(() => Array.from({ length: lines + 1 }, (_, i) => contour(i < lines ? orbit(i) : orbit(lines - 1) + 19, i)), [lines]);
  const half = orbit(lines - 1) + 18;

  // How fast the pointer is going, so a quick strum rings harder than a slow pass.
  const pointer = useRef({ x: 0, y: 0, t: 0, speed: 0 });
  const track = (e: PointerEvent<SVGSVGElement>) => {
    const p = pointer.current, dt = e.timeStamp - p.t;
    if (dt > 0 && dt < 100) p.speed = 0.6 * p.speed + 0.4 * (Math.hypot(e.clientX - p.x, e.clientY - p.y) / dt);
    else if (dt >= 100) p.speed = 0;
    Object.assign(p, { x: e.clientX, y: e.clientY, t: e.timeStamp });
  };
  // Pluck line `i` as the pointer crosses it (the visible line beside the unseen one that caught it).
  // A pointer wavering on the edge of a line doesn't keep plucking it: once a line has gone, it waits a moment.
  const plucked = useRef<number[]>([]);
  const pluck = (e: PointerEvent<SVGPathElement>, i: number) => {
    if (e.timeStamp - (plucked.current[i] ?? -Infinity) < 120) return;
    plucked.current[i] = e.timeStamp;
    strum(i, pluckReach(pointer.current.speed) / 0.05);
    const line = e.currentTarget.parentElement?.querySelector<SVGPathElement>(":scope > .sys-ring");
    if (!line?.animate) return;
    const amber = getComputedStyle(line).getPropertyValue("--logo-dot").trim() || "#d9982b";
    // From amber back to however the line is drawn now (still amber while the pointer rests on it).
    line.animate([{ offset: 0, stroke: amber, opacity: 1, strokeWidth: "2.4px" }], { duration: PLUCK_MS, easing: "ease-out" });
    if (!motionOK()) return;
    const reach = pluckReach(pointer.current.speed);
    line.animate(SWINGS.map((k) => ({ transform: `scale(${1 + k * reach})` })), { duration: PLUCK_MS * 0.8, easing: "ease-out" });
  };

  // Whose turn it is to take a quest: nobody at first, then each in order, and round again.
  const [turn, setTurn] = useState(-1);
  useEffect(() => {
    setTurn(-1);
    if (!n || !motionOK()) return;
    let every: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setTurn(0);
      every = setInterval(() => setTurn((t) => (t + 1) % n), TURN_MS);
    }, 900);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [n]);

  // A line as the sun's ring lights it in passing. It is drawn afresh for each ring the sun sends, so
  // its flash starts with that ring; the stylesheet has each line wait until the ring reaches it (.sys-l…).
  const lit = (d: string, i: number) => <path key={`lit${turn}`} className={`sys-lit sys-l${i + 1}${n ? (turn >= 0 ? " sys-on" : "") : " sys-alone"}`} d={d} />;

  return (
    <svg className={["mae-system", lines > 4 && `sys-n${lines}`, className].filter(Boolean).join(" ")} xmlns="http://www.w3.org/2000/svg" viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`} aria-hidden="true" onPointerMove={track}>
      {/* The lines nobody is on drift round slowly by themselves. A planet's own line is drawn with it, below. */}
      {contours.map((d, i) => (
        <g key={i} className={`sys-drift sys-c${i + 1}`}>
          <path className={i < lines ? "sys-ring" : "sys-ring sys-far"} d={d} />
          {lit(d, i)}
          <path className="sys-hit" d={d} onPointerEnter={(e) => pluck(e, i)} />
        </g>
      )).filter((_, i) => !planets[i])}
      {/* The ring the sun sends out: as a report lands, or just now and then when there is no crew. */}
      <circle key={turn} className={n ? (turn >= 0 ? "sys-ping sys-on" : "sys-ping") : "sys-ping sys-alone"} r="13" />
      <circle className="sys-glow" r="30" />
      <circle className="sys-sun" r="13" />
      {planets.map((p, i) => {
        const r = orbit(i), from = startOf(i), mark = MARKS[p.id];
        return (
          // Where it starts is set here, as an attribute; the turning is the stylesheet's, and it turns
          // the planet and its line as one. The planet's own mark is turned back by as much, so it
          // stays upright the whole way round.
          <g key={p.id} className={["sys-planet", cClass(p.name), i === turn && "sys-on"].filter(Boolean).join(" ")} data-who={p.id} transform={`rotate(${from})`}>
            <g className={`sys-orbit sys-o${i + 1}`}>
              <path className="sys-ring" d={contours[i]} />
              {lit(contours[i], i)}
              <path className="sys-hit" d={contours[i]} onPointerEnter={(e) => pluck(e, i)} />
              {/* The same line in the planet's colour, lit while it has the quest. */}
              <path className="sys-tone" d={contours[i]} />
              {TAIL.map((k) => { const len = stretch(r, k); return <path key={k} className="sys-tail" d={contours[i]} pathLength={LAP} strokeDasharray={`${len} ${LAP - len}`} strokeDashoffset={len} />; })}
              {/* Out along the line from the sun to the planet, and home along it: the line turns with the planet, so the flight bends as the films' comets do. */}
              {COMET.map((size, k) => <circle key={k} className={`sys-comet sys-lag${k}`} r={size} />)}
              <g transform={`translate(${r} 0) rotate(${-from})`}>
                <g className={`sys-upright sys-o${i + 1}`}>
                  <circle className="sys-pulse" r="9.5" />
                  <g className="sys-moon"><circle cx="15.5" r="1.9" /></g>
                  <circle className="sys-disc" r="9.5" />
                  {mark ? <g className="sys-mark" transform="translate(-6 -6) scale(.5)">{mark}</g>
                    : <text className="sys-emoji" y="3.7" textAnchor="middle">{p.emoji ?? p.name.slice(0, 1)}</text>}
                </g>
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
