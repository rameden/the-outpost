// The memory, as a map over the whole page: every remembered line a star, standing with the other
// lines of the place it lives in (a crew member's memory, a project's notes, the note about you),
// and joined to the lines it's like and the lines it's used with. A star grows each time its line
// is used. Pick one to read it, see where it came from and when it was used, and pin, forget or
// merge it.
//
// The map is worked out once from what the camp sends (layout.ts) and then stands still: nothing
// here runs between your own moves. /constellation opens it; Esc steps back, then closes it.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKey, type PointerEvent as ReactPointer } from "react";
import { api, errorText } from "../api.ts";
import { Icon } from "../components/bits.tsx";
import { crewNow, cx, plural } from "../format.ts";
import type { GraphNode, MemoryGraph } from "../types.ts";
import { layout } from "./layout.ts";
import { LinePanel, type Merge } from "./LinePanel.tsx";

const BUILT_IN = ["quartermaster", "scout", "scribe", "artificer", "warden"];
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

type Cam = { x: number; y: number; k: number }; // the point of the map at the middle of the page, and how close you are
const NEAR = 4, FAR = 0.15, PANEL = 400;
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
  const root = useRef<HTMLDivElement>(null);
  const sky = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [cam, setCam] = useState<Cam | null>(null); // null: fitted to the whole map

  const load = useCallback(() => {
    setError("");
    return api<MemoryGraph>("/api/memory/graph").then(
      (g) => setGraph({ nodes: Array.isArray(g?.nodes) ? g.nodes : [], edges: Array.isArray(g?.edges) ? g.edges : [], ...(g?.since ? { since: g.since } : {}) }),
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

  const nodes = graph?.nodes ?? [], edges = graph?.edges ?? [];
  const map = useMemo(() => layout(nodes, edges), [graph]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [graph]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = useMemo(() => map.clusters.map((c) => ({ ...c, of: nodes.find((n) => n.where === c.where)! })), [map]); // eslint-disable-line react-hooks/exhaustive-deps
  const node = picked ? byId.get(picked) ?? null : null;
  useEffect(() => { if (picked && graph && !byId.has(picked)) { setPicked(null); setMerge(null); } }, [picked, graph, byId]);

  // The whole map, with room round it.
  const fitted: Cam = { x: 0, y: 0, k: clamp(Math.min(size.w, size.h) / (2 * map.extent + 140), FAR, 1.6) };
  const view = cam ?? fitted;
  const zoom = (factor: number, px = size.w / 2, py = size.h / 2) => setCam((was) => {
    const c = was ?? fitted, k = clamp(c.k * factor, FAR, NEAR);
    const wx = c.x + (px - size.w / 2) / c.k, wy = c.y + (py - size.h / 2) / c.k; // what's under the pointer stays under it
    return { k, x: wx - (px - size.w / 2) / k, y: wy - (py - size.h / 2) / k };
  });
  const pan = (dx: number, dy: number) => setCam((was) => { const c = was ?? fitted; return { ...c, x: c.x - dx / c.k, y: c.y - dy / c.k }; });
  // A star that's off the page, or under the panel, is brought to where it can be seen.
  const reveal = (id: string) => {
    const s = map.stars.get(id);
    if (!s) return;
    const free = Math.max(200, size.w - PANEL);
    const sx = size.w / 2 + (s.x - view.x) * view.k, sy = size.h / 2 + (s.y - view.y) * view.k;
    if (sx < 40 || sx > free - 40 || sy < 90 || sy > size.h - 60) setCam({ k: view.k, x: s.x - (free / 2 - size.w / 2) / view.k, y: s.y });
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
      else onClose();
    } else if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    else if (ev.key === "+" || ev.key === "=") zoom(1.4);
    else if (ev.key === "-" || ev.key === "_") zoom(1 / 1.4);
    else if (ev.key === "0") setCam(null);
    else if (ev.key === "ArrowLeft") pan(60, 0);
    else if (ev.key === "ArrowRight") pan(-60, 0);
    else if (ev.key === "ArrowUp") pan(0, 60);
    else if (ev.key === "ArrowDown") pan(0, -60);
    else return;
    if (ev.key.startsWith("Arrow")) ev.preventDefault();
  };

  const count = nodes.length, placeCount = map.clusters.length;
  const near = new Set(node ? edges.flatMap((e) => (e.a === node.id ? [e.b] : e.b === node.id ? [e.a] : [])) : []);
  return (
    <div className={cx("constellation", picking && "picking")} ref={root} role="dialog" aria-modal="true" aria-label="Memory constellation: what the crew remembers, as a map" tabIndex={-1} onKeyDown={onKey}>
      <svg className="con-sky" ref={sky} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label="The map">
        <g transform={`translate(${(size.w / 2 - view.x * view.k).toFixed(2)} ${(size.h / 2 - view.y * view.k).toFixed(2)}) scale(${view.k.toFixed(4)})`}>
          {places.map((p) => (
            <g key={p.where} className={cx("con-place", placeClass(p.where))} aria-hidden="true">
              <circle cx={p.x} cy={p.y} r={p.r} />
              <text x={p.x} y={p.y - p.r - 12} textAnchor="middle">{p.of.emoji && <tspan>{p.of.emoji}</tspan>}<tspan dx={p.of.emoji ? 7 : 0}>{p.of.place}</tspan></text>
            </g>
          ))}
          <g aria-hidden="true">
            {edges.map((e) => {
              const a = map.stars.get(e.a), b = map.stars.get(e.b);
              return a && b ? <line key={`${e.kind}${e.a}${e.b}`} className={cx("con-edge", e.kind, node && (e.a === node.id || e.b === node.id) && "on")} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null;
            })}
          </g>
          {nodes.map((n) => {
            const s = map.stars.get(n.id);
            if (!s) return null;
            const can = !picking || (n.where === node!.where && n.id !== node!.id);
            return (
              <g key={n.id} className={cx("con-star", placeClass(n.where), n.pinned && "pinned", n.recalls > 0 && "used", n.id === picked && "sel", near.has(n.id) && "near", picking && n.id !== picked && (can ? "can" : "off"))}
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
          {graph && count > 0 && <p>{count} {plural(count, "line")} in {placeCount} {plural(placeCount, "place")}</p>}
        </div>
        <div className="con-tools">
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
            <li><svg viewBox="0 0 26 16" aria-hidden="true"><line className="con-edge alike on" x1="1" y1="8" x2="25" y2="8" /></svg>alike</li>
            <li><svg viewBox="0 0 26 16" aria-hidden="true"><line className="con-edge together on" x1="1" y1="8" x2="25" y2="8" /></svg>used together</li>
          </ul>
          <p className="con-since">{graph.since
            ? `Recall history starts on ${day(graph.since)}: nothing before that was written down.`
            : "Recall history starts filling in from now: a star grows each time its line is used."}</p>
          <p className="con-hint" aria-hidden="true">Scroll to zoom · drag to move · click a star to read it · Esc to step back</p>
        </footer>
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
