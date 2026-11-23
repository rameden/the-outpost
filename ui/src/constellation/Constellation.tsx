// The memory, as a map over the whole page: every remembered line a star, standing with the other
// lines of the place it lives in (a crew member's memory, a project's notes, the note about you),
// and joined to the lines it's like and the lines it's used with. A star grows each time its line
// is used. Pick one to read it, see where it came from and when it was used, and pin, forget or
// merge it. The runs that used memory are listed down the left side (RunsPanel): pick one or a few
// and only the lines they used stay lit.
//
// It stands on Orbit's night sky, whatever the theme: the same sheets of stars behind it, each
// place one open contour line as Orbit's orbits are, and on that line whoever the place belongs to,
// drawn as Orbit draws them (a crew member's planet, the Quartermaster's sun). The joins are drawn
// as nerve fibres (Synapse.tsx).
//
// The map is worked out once from what the camp sends (layout.ts) and then stands still: nothing
// the stars stay where they are. Only the joins stir: a spark now and then along lines used
// together, and a steady pulse out of the star you picked. /constellation opens it; Esc steps back, then closes it.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKey, type PointerEvent as ReactPointer } from "react";
import { api, errorText } from "../api.ts";
import { Icon } from "../components/bits.tsx";
import { contour, MARKS } from "../components/MaeSystem.tsx";
import { crewNow, cx, plural } from "../format.ts";
import type { GraphNode, GraphRun, MemoryGraph } from "../types.ts";
import { PLANET_R, STARS, wrap } from "../orbit/scene.ts";
import { layout } from "./layout.ts";
import { LinePanel, type Merge } from "./LinePanel.tsx";
import { RunsPanel } from "./RunsPanel.tsx";
import { Synapse, type End } from "./Synapse.tsx";

const BUILT_IN = ["quartermaster", "scout", "scribe", "artificer", "warden", "wizard"];
// The class that colours a place's stars. A crew member's is theirs, found by their id (never by
// the name they're shown under); a project's notes and the note about you have their own.
export function placeClass(where: string): string {
  if (where === "about") return "con-about";
  if (!where.startsWith("agent:")) return "con-project";
  const id = where.slice("agent:".length);
  if (BUILT_IN.includes(id)) return `c-${id}`;
  const added = crewNow().find((c) => c.id === id);
  return added?.custom && added.color ? `c-x-${added.color}` : "";
}

// A place at a glance, under its name: how many lines it holds, and how many of them are pinned and how often they've been used.
export function placeSays(lines: Pick<GraphNode, "pinned" | "recalls">[]): string {
  const pinned = lines.filter((n) => n.pinned).length, recalls = lines.reduce((sum, n) => sum + Math.max(0, n.recalls), 0);
  return [`${lines.length} ${plural(lines.length, "line")}`, pinned && `${pinned} pinned`, recalls ? `recalled ${recalls} ${plural(recalls, "time")}` : "not recalled yet"].filter(Boolean).join(" · ");
}

// A place's line: a little outside its stars (the line wanders in and out, and no star should end up beyond it).
// Whoever the place belongs to sits where the line starts, which is turned to the top.
// Where a place's owner and name sit on its line: on the side that faces out of the map, where there's
// room for them. A place below the middle has them underneath. One above has them on top, leaning
// out to the side it's on (never more than LEAN from the top, so the name stays near the map).
const UP = -Math.PI / 2, DOWN = Math.PI / 2, LEAN = (55 * Math.PI) / 180;
export function labelAngle(c: { x: number; y: number }, tall: number): number {
  if (c.y > tall * 0.2) return DOWN;
  if (!c.x && !c.y) return UP; // the only place there is, in the middle
  return UP + clamp(Math.atan2(c.x, -c.y), -LEAN, LEAN); // atan2: how far round from straight up, clockwise
}
// The owner's spot on the line (bx, by), and where the two lines of the name go: under it, over it, or beside it.
function labelAt(p: { x: number; y: number }, r: number, own: number, at: number) {
  const ux = Math.cos(at), uy = Math.sin(at), bx = p.x + r * ux, by = p.y + r * uy;
  if (uy > 0.5) return { bx, by, tx: bx, ty: by + own + 20, sy: by + own + 36, anchor: "middle" as const };
  if (Math.abs(ux) < 0.3) return { bx, by, tx: bx, ty: by - own - 24, sy: by - own - 8, anchor: "middle" as const };
  return { bx, by, tx: bx + Math.sign(ux) * (own + 9), ty: by - 3, sy: by + 13, anchor: ux > 0 ? "start" as const : "end" as const };
}
const OWN_ROOM = 26;               // the room an owner is given when the page is fitted (it's drawn to the zoom, so this is a fair most)
const TOP = 56, FOOT = 84, EDGE = 28; // page pixels the fitted map keeps clear: the heading and tools above it, the key below, a margin each side
const lineOf = (r: number) => Math.round((r * 1.06 + 4) * 10) / 10;
// Whose place it is, drawn as Orbit draws them and with Orbit's own styles (orb-*), so the two can't drift apart: the
// Quartermaster is the sun (at planet size here), a crew member their planet (a halo, a dark disc and their mark), and
// anyone or anything Orbit has no mark for the same planet with their emoji or first letter, as Orbit does it.
const SUN = 0.5;    // Orbit's sun is far bigger than its planets: this brings its outer dial to about a planet's size
const OWNER_R = 13; // how far out the furthest of either reaches (the sun's outer dial), before it's sized
// How much bigger than Orbit's they're drawn: 1.6 times, but never so small on the page that the mark can't be read, nor so big it crowds the place.
const ownerSize = (k: number) => clamp(PLANET_R * 1.6 * k, 11, 22) / (PLANET_R * k);
function Owner({ where, id, emoji, name }: { where: string; id: string; emoji?: string; name: string }) {
  const who = where.startsWith("agent:") ? where.slice("agent:".length) : "";
  if (who === "quartermaster") return (
    <g className="con-sun" transform={`scale(${SUN})`}>
      <radialGradient id={id}><stop offset="0" className="orb-g0" /><stop offset=".3" className="orb-g1" /><stop offset="1" className="orb-g2" /></radialGradient>
      <circle className="orb-corona" r={16 * 4.8} fill={`url(#${id})`} opacity=".72" />
      <g className="orb-sun-dial"><circle r={16 + 9} /></g>
      <g className="orb-sun-dial inner"><circle r={16 + 4.5} /></g>
      <circle className="orb-sun-core" r={16} />
    </g>
  );
  const mark = MARKS[who];
  return <>
    <radialGradient id={id}><stop offset="0" className="orb-g0" /><stop offset=".45" className="orb-g1" /><stop offset="1" className="orb-g2" /></radialGradient>
    <circle className="orb-halo" r={PLANET_R * 3.6} fill={`url(#${id})`} />
    <circle className="orb-disc" r={PLANET_R} />
    {mark ? <g className="orb-mark" transform="translate(-6 -6) scale(.5)">{mark}</g>
      : <text className="orb-emoji" y="3.7" textAnchor="middle">{emoji ?? name.slice(0, 1)}</text>}
  </>;
}

type Cam = { x: number; y: number; k: number }; // the point of the map at the middle of the page, and how close you are
const NEAR = 4, FAR = 0.15, PANEL = 400;
const RUNS = 292, NARROW = 760; // the room the runs take down the left side, and the width below which they sit along the bottom instead
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const short = (text: string, most = 110) => (text.length > most ? text.slice(0, most).trimEnd() + "…" : text);
const day = (iso: string) => new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

export function Constellation({ onClose, onOpenConversation, onOpenMemory }: {
  onClose: () => void;
  onOpenConversation: (id: string) => void;
  onOpenMemory: () => void;   // the Memory page, where a drafted merge waits for you
}) {
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [merge, setMerge] = useState<Merge>(null);
  const [runsOpen, setRunsOpen] = useState<boolean | null>(null); // null: open when there are runs to list and room for them
  const [runsPicked, setRunsPicked] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const sky = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [cam, setCam] = useState<Cam | null>(null); // null: fitted to the whole map

  const load = useCallback(() => {
    setError("");
    return api<MemoryGraph>("/api/memory/graph").then(
      (g) => setGraph({ nodes: Array.isArray(g?.nodes) ? g.nodes : [], edges: Array.isArray(g?.edges) ? g.edges : [], ...(g?.since ? { since: g.since } : {}),
        runs: Array.isArray(g?.runs) ? g.runs.filter((r) => r && typeof r.id === "string" && Array.isArray(r.lines)) : [] }),
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => { void load(); root.current?.focus(); }, [load]);
  // The page's size, for keeping the map in the middle of it.
  useEffect(() => {
    const measure = () => { const r = sky.current?.getBoundingClientRect(); if (r && r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height }); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const nodes = graph?.nodes ?? [], edges = graph?.edges ?? [], runs: GraphRun[] = graph?.runs ?? [], count = nodes.length;
  const upright = size.h > size.w; // a page that's taller than it's wide (a phone held up) has the map stand that way too
  const map = useMemo(() => layout(nodes, edges, upright), [graph, upright]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [graph]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where a join ends on a star (at its edge, or at its ring if it's pinned), and the colour of the star's place.
  const ends = useMemo(() => new Map(nodes.flatMap((n): [string, End & { cls: string }][] => { const s = map.stars.get(n.id); return s ? [[n.id, { x: s.x, y: s.y, r: s.r + (n.pinned ? 5 : 0), cls: placeClass(n.where) }]] : []; })), [map]); // eslint-disable-line react-hooks/exhaustive-deps
  const tall = map.clusters.reduce((far, c) => Math.max(far, Math.abs(c.y)), 0);
  const places = useMemo(() => map.clusters.map((c) => { const lines = nodes.filter((n) => n.where === c.where); return { ...c, of: lines[0], says: placeSays(lines), ids: lines.map((n) => n.id), at: labelAngle(c, tall) }; }), [map]); // eslint-disable-line react-hooks/exhaustive-deps
  // The box the whole map takes: every place's line, and its owner and name (a name's width is reckoned from its letters).
  const frame = useMemo(() => {
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    const take = (ax: number, bx: number, ay: number, by: number) => { x0 = Math.min(x0, ax); x1 = Math.max(x1, bx); y0 = Math.min(y0, ay); y1 = Math.max(y1, by); };
    places.forEach((p, i) => {
      const r = lineOf(p.r), l = labelAt(p, r, OWN_ROOM, p.at), w = Math.max(p.of.place.length * 7.2, p.says.length * 5.3), out = r * 1.06;
      const left = l.anchor === "middle" ? l.tx - w / 2 : l.anchor === "start" ? l.tx : l.tx - w;
      if (!i) { x0 = x1 = p.x; y0 = y1 = p.y; }
      take(p.x - out, p.x + out, p.y - out, p.y + out);
      take(l.bx - OWN_ROOM, l.bx + OWN_ROOM, l.by - OWN_ROOM, l.by + OWN_ROOM);
      take(left, left + w, l.ty - 13, l.sy + 4);
    });
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }, [places]);
  const node = picked ? byId.get(picked) ?? null : null;
  useEffect(() => { if (picked && graph && !byId.has(picked)) { setPicked(null); setMerge(null); } }, [picked, graph, byId]);

  // The runs you picked, and the lines they used between them (null: none picked, the whole map is lit).
  // A run that's gone from the list since simply isn't counted.
  const chosen = runs.filter((r) => runsPicked.includes(r.id));
  const lit = chosen.length ? new Set(chosen.flatMap((r) => r.lines).filter((id) => byId.has(id))) : null;
  const wide = size.w >= NARROW;
  const listing = graph !== null && nodes.length > 0 && (runsOpen ?? (runs.length > 0 && wide));
  const toggleRun = (id: string) => setRunsPicked((was) => (was.includes(id) ? was.filter((r) => r !== id) : [...was, id]));

  // The whole map, names and all, as big as the page the runs leave free will take, and in the middle of it.
  const inset = listing && wide ? RUNS : 0, mid = (size.w + inset) / 2;
  const fitK = clamp(Math.min((size.w - inset - 2 * EDGE) / Math.max(1, frame.w), (size.h - TOP - FOOT) / Math.max(1, frame.h)), FAR, 1.6);
  const fitted: Cam = { x: frame.x, y: frame.y - (TOP - FOOT) / 2 / fitK, k: fitK };
  const view = cam ?? fitted;
  const zoom = (factor: number, px = mid, py = size.h / 2) => setCam((was) => {
    const c = was ?? fitted, k = clamp(c.k * factor, FAR, NEAR);
    const wx = c.x + (px - mid) / c.k, wy = c.y + (py - size.h / 2) / c.k; // what's under the pointer stays under it
    return { k, x: wx - (px - mid) / k, y: wy - (py - size.h / 2) / k };
  });
  const pan = (dx: number, dy: number) => setCam((was) => { const c = was ?? fitted; return { ...c, x: c.x - dx / c.k, y: c.y - dy / c.k }; });
  // A star that's off the page, or under the panel or the runs, is brought to where it can be seen.
  const reveal = (id: string) => {
    const s = map.stars.get(id);
    if (!s) return;
    const free = Math.max(inset + 200, size.w - PANEL);
    const sx = mid + (s.x - view.x) * view.k, sy = size.h / 2 + (s.y - view.y) * view.k;
    if (sx < inset + 40 || sx > free - 40 || sy < 90 || sy > size.h - 60) setCam({ k: view.k, x: s.x - ((inset + free) / 2 - mid) / view.k, y: s.y });
  };
  const pick = (id: string) => { setPicked(id); setMerge(null); reveal(id); };

  // Scroll to zoom, about the pointer. (Set by hand: React's own wheel listener can't stop the page scrolling.)
  const act = useRef({ zoom });
  act.current = { zoom };
  useEffect(() => {
    const el = sky.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      act.current.zoom(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : ev.deltaMode === 1 ? 0.05 : 0.0016)), ev.clientX - r.left, ev.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // Drag to move. The pointer is only held once it has really moved, so a click on a star stays a click.
  const drag = useRef<{ id: number; x: number; y: number; moving: boolean } | null>(null);
  const onDown = (ev: ReactPointer<SVGSVGElement>) => { if (ev.button === 0) drag.current = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moving: false }; };
  const onMove = (ev: ReactPointer<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== ev.pointerId) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (!d.moving) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moving = true;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    }
    d.x = ev.clientX; d.y = ev.clientY;
    pan(dx, dy);
  };
  const onUp = () => { drag.current = null; };

  // Merging: the second line, picked on the map or from the panel's list.
  const mergeWith = async (other: GraphNode) => {
    if (!node || other.id === node.id || other.where !== node.where) return;
    setMerge({ step: "drafting" });
    try {
      const r = await api<{ proposal: { text: string } }>("/api/memory/merge", { where: node.where, a: node.text, b: other.text });
      setMerge({ step: "drafted", text: r.proposal?.text ?? "" });
    } catch (e) { setMerge({ step: "failed", error: errorText(e) }); }
  };
  const picking = merge?.step === "pick" && !!node;
  const onStar = (n: GraphNode) => { if (picking) void mergeWith(n); else pick(n.id); };

  const onKey = (ev: ReactKey<HTMLDivElement>) => {
    if (ev.defaultPrevented) return;
    const typing = ev.target instanceof HTMLElement && ev.target.closest("input, textarea, select");
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (picking) setMerge(null);
      else if (picked) { setPicked(null); setMerge(null); root.current?.focus(); }
      else if (lit) setRunsPicked([]);
      else onClose();
    } else if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    else if (ev.key === "+" || ev.key === "=") zoom(1.4);
    else if (ev.key === "-" || ev.key === "_") zoom(1 / 1.4);
    else if (ev.key === "0") setCam(null);
    else if (ev.key === "r" || ev.key === "R") setRunsOpen(!listing);
    else if (ev.key === "ArrowLeft") pan(60, 0);
    else if (ev.key === "ArrowRight") pan(-60, 0);
    else if (ev.key === "ArrowUp") pan(0, 60);
    else if (ev.key === "ArrowDown") pan(0, -60);
    else return;
    if (ev.key.startsWith("Arrow")) ev.preventDefault();
  };

  const placeCount = map.clusters.length;
  const owner = ownerSize(view.k);
  const near = new Set(node ? edges.flatMap((e) => (e.a === node.id ? [e.b] : e.b === node.id ? [e.a] : [])) : []);
  return (
    <div className={cx("constellation", picking && "picking", lit && "isolating", listing && "runs-open")} ref={root} role="dialog" aria-modal="true" aria-label="Memory constellation: what the crew remembers, as a map" tabIndex={-1} onKeyDown={onKey}>
      {STARS.map(([tile, depth], j) => (
        <div key={j} className={`orb-stars s${j + 1}`} aria-hidden="true"
          style={{ transform: `translate3d(${wrap(-view.x * view.k * depth, tile).toFixed(1)}px, ${wrap(-view.y * view.k * depth, tile).toFixed(1)}px, 0)` }} />
      ))}
      <svg className="con-sky" ref={sky} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label="The map">
        <g transform={`translate(${(mid - view.x * view.k).toFixed(2)} ${(size.h / 2 - view.y * view.k).toFixed(2)}) scale(${view.k.toFixed(4)})`} style={{ "--k": view.k.toFixed(4) } as CSSProperties}>
          {places.map((p, i) => {
            const r = lineOf(p.r), l = labelAt(p, r, OWNER_R * owner, p.at); // the name stands clear of whoever is on the line
            return (
              <g key={p.where} className={cx("con-place", placeClass(p.where), lit && !p.ids.some((id) => lit.has(id)) && "dim")} aria-hidden="true">
                <path className="con-line" transform={`translate(${p.x} ${p.y}) rotate(${((p.at * 180) / Math.PI).toFixed(1)})`} d={contour(r, i % 3)} />{/* the line starts, exactly r out, where its owner sits */}
                <g className="con-badge" transform={`translate(${l.bx.toFixed(1)} ${l.by.toFixed(1)}) scale(${owner.toFixed(3)})`}>
                  <Owner where={p.where} id={`con-glow-${i}`} emoji={p.of.emoji} name={p.of.place} />
                </g>
                <text x={l.tx.toFixed(1)} y={l.ty.toFixed(1)} textAnchor={l.anchor}>{p.of.place}</text>
                <text className="con-place-says" x={l.tx.toFixed(1)} y={l.sy.toFixed(1)} textAnchor={l.anchor}>{p.says}</text>
              </g>
            );
          })}
          <g aria-hidden="true">
            {edges.map((e) => {
              const a = ends.get(e.a), b = ends.get(e.b), on = !!node && (e.a === node.id || e.b === node.id);
              return a && b ? <Synapse key={`${e.kind}${e.a}${e.b}`} a={a} b={b} seed={`${e.kind}${e.a}${e.b}`} kind={e.kind} ca={a.cls} cb={b.cls} on={on} back={on && e.b === node!.id} dim={!!lit && !(lit.has(e.a) && lit.has(e.b))} /> : null;
            })}
          </g>
          {nodes.map((n) => {
            const s = map.stars.get(n.id);
            if (!s) return null;
            const can = !picking || (n.where === node!.where && n.id !== node!.id);
            return (
              <g key={n.id} className={cx("con-star", placeClass(n.where), n.pinned && "pinned", n.recalls > 0 && "used", n.id === picked && "sel", near.has(n.id) && "near", lit && !lit.has(n.id) && "dim", picking && n.id !== picked && (can ? "can" : "off"))}
                transform={`translate(${s.x} ${s.y})`} role="button" tabIndex={can ? 0 : -1} aria-disabled={can ? undefined : true} aria-pressed={n.id === picked}
                aria-label={`${short(n.text)} ${n.place}. ${n.pinned ? "Pinned. " : ""}${n.recalls ? `Recalled ${n.recalls} ${plural(n.recalls, "time")}.` : "Not recalled yet."}`}
                onClick={() => { if (can) onStar(n); }}
                onFocus={() => { if (!picking && n.id !== picked) pick(n.id); }}
                onKeyDown={(ev) => { if ((ev.key === "Enter" || ev.key === " ") && can) { ev.preventDefault(); onStar(n); } }}>
                <title>{n.text}</title>
                <circle className="con-hit" r={Math.max(s.r + 7, 13)} />
                {n.pinned && <circle className="con-pin" r={s.r + 4} />}
                <circle className="con-body" r={s.r} />
                <circle className="con-ring" r={s.r + (n.pinned ? 8 : 5)} />
              </g>
            );
          })}
        </g>
      </svg>

      <header className="con-top">
        <div className="con-title">
          <h2>Memory</h2>
          {graph && count > 0 && <p>{lit
            ? `${lit.size} of ${count} ${plural(count, "line")}, used by ${chosen.length} ${plural(chosen.length, "run")}`
            : `${count} ${plural(count, "line")} in ${placeCount} ${plural(placeCount, "place")}`}</p>}
        </div>
        <div className="con-tools">
          {graph && count > 0 && <button type="button" className="con-tool worded" title="The runs that used memory (R)" aria-pressed={listing} onClick={() => setRunsOpen(!listing)}>Runs</button>}
          <button type="button" className="con-tool" title="Closer (+)" aria-label="Zoom in" onClick={() => zoom(1.4)}>+</button>
          <button type="button" className="con-tool" title="Further (-)" aria-label="Zoom out" onClick={() => zoom(1 / 1.4)}>−</button>
          <button type="button" className="con-tool worded" title="The whole map (0)" onClick={() => setCam(null)}>Fit</button>
          <button type="button" className="con-tool" title="Close (Esc)" aria-label="Close the map" onClick={onClose}><Icon name="x" /></button>
        </div>
      </header>

      {error ? (
        <div className="con-empty" role="alert">
          <b>The map couldn't be drawn</b>
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>Try again</button>
        </div>
      ) : !graph ? (
        <p className="con-empty" role="status">Reading the memory…</p>
      ) : count === 0 ? (
        <div className="con-empty">
          <b>Nothing's remembered yet</b>
          <p>When the crew notes a lesson, or you tell them something worth keeping, it appears here as a star, with the other lines of the place it lives in.</p>
        </div>
      ) : null}

      {graph && count > 0 && (
        <footer className="con-foot">
          <ul className="con-key" aria-label="How to read the map">
            <li><svg viewBox="0 0 34 16" aria-hidden="true"><circle className="con-body" cx="6" cy="8" r="3" /><circle className="con-body" cx="24" cy="8" r="7" /></svg>bigger: used more often</li>
            <li><svg viewBox="0 0 18 16" aria-hidden="true"><circle className="con-body" cx="9" cy="8" r="4" /><circle className="con-pin" cx="9" cy="8" r="7" /></svg>pinned</li>
            <li><svg viewBox="0 0 30 16" aria-hidden="true"><Synapse a={{ x: 2, y: 8, r: 0 }} b={{ x: 28, y: 8, r: 0 }} seed="alike" kind="alike" /></svg>alike</li>
            <li><svg viewBox="0 0 30 16" aria-hidden="true"><Synapse a={{ x: 2, y: 8, r: 0 }} b={{ x: 28, y: 8, r: 0 }} seed="together" kind="together" /></svg>used together</li>
          </ul>
          <p className="con-since">{graph.since
            ? `Recall history starts on ${day(graph.since)}: nothing before that was written down.`
            : "Recall history starts filling in from now: a star grows each time its line is used."}</p>
          <p className="con-hint" aria-hidden="true">Scroll to zoom · drag to move · click a star to read it · Esc to step back</p>
        </footer>
      )}

      {listing && (
        <RunsPanel runs={runs} picked={new Set(chosen.map((r) => r.id))} byId={byId} classOf={placeClass}
          onToggle={toggleRun} onClear={() => setRunsPicked([])} onClose={() => { setRunsOpen(false); root.current?.focus(); }} />
      )}

      {node && (
        <LinePanel node={node} cls={placeClass(node.where)} edges={edges} nodes={nodes} merge={merge}
          onClose={() => { setPicked(null); setMerge(null); root.current?.focus(); }}
          onSelect={pick} onMerge={setMerge} onPick={(other) => void mergeWith(other)}
          onChanged={(gone) => { if (gone) { setPicked(null); setMerge(null); root.current?.focus(); } void load(); }}
          onOpenConversation={onOpenConversation} onOpenMemory={onOpenMemory} />
      )}
    </div>
  );
}
