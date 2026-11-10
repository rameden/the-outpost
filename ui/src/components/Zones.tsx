// A layout on screen: its splits and zones as nested boxes, with a line between neighbours that
// you drag (or move with the arrow keys) to resize them.
//
// The page itself is drawn this way, each zone holding a real part of mission control; so is the
// small map in the layout editor, where each zone is a labelled box. What goes in a zone, and
// whether it's on show, is up to whoever uses the frame.

import { Fragment, useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { drag, fitsContent, isGrow, zonesOf, type Item, type Layout, type Size, type Split, type Zone } from "../layout.ts";
import { cx } from "../format.ts";
import { LEAVE_MS, motionOK } from "../motion.tsx";

// hidden: takes no room at all. collapsed: only a small tab that brings it back.
export type ZoneState = "shown" | "hidden" | "collapsed";

type FrameProps = {
  layout: Layout;
  onChange: (next: Layout) => void;
  stateOf?: (zone: Zone) => ZoneState;
  children: (zone: Zone, state: ZoneState, within: Split) => ReactNode;
  // The map is the page drawn small: fixed sizes are scaled by this, and a drag by its inverse.
  scale?: { x: number; y: number };
  className?: string;
  // A zone that's switched on or off slides into place or away, rather than jumping.
  animate?: boolean;
};

// A zone on its way in or out: which, and what it was before.
type Move = { kind: "in" | "out"; was: ZoneState };
// Where a zone sits among the ones on show in its split: which way it slides in from.
const edgeOf = (i: number, n: number) => (n === 1 ? "only" : i === 0 ? "start" : i === n - 1 ? "end" : "mid");

const shownState = (): ZoneState => "shown";

function flexOf(size: Size, k: number, collapsed: boolean, mustFill: boolean): CSSProperties {
  if (collapsed) return { flex: "0 0 auto" };
  if (mustFill) return { flex: "1 1 0px" };
  if (isGrow(size)) return { flex: `${size.grow} 1 0px` };
  if ("px" in size) return { flex: `0 1 ${Math.round(size.px * k)}px` };
  return { flex: "0 0 auto" };
}

export function LayoutFrame({ layout, onChange, stateOf: asked = shownState, children, scale = { x: 1, y: 1 }, className, animate = false }: FrameProps) {
  // Notice zones changing state between one drawing and the next. One that's going stays drawn
  // as it was until it has slid away; one that's arriving is marked so it can slide in. The zone
  // itself takes or gives up its room in one step: easing its size would lay the whole page out
  // again on every frame, which stutters with a long conversation beside it.
  const now: Record<string, ZoneState> = Object.fromEntries(zonesOf(layout).map((z) => [z.id, asked(z)]));
  const stamp = JSON.stringify(now);
  const [seen, setSeen] = useState({ stamp, states: now });
  const [moves, setMoves] = useState<Record<string, Move>>({});
  let moving = moves;
  if (seen.stamp !== stamp) {
    if (animate && motionOK()) {
      moving = { ...moves };
      for (const [id, is] of Object.entries(now)) {
        const was = seen.states[id];
        if (!was || was === is) continue; // a zone that's new to the layout just appears
        if (is === "shown") moving[id] = { kind: "in", was };
        else if (was === "shown") moving[id] = { kind: "out", was };
        else delete moving[id];
      }
      setMoves(moving);
    }
    setSeen({ stamp, states: now });
  }
  const busy = Object.keys(moves).length > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setMoves({}), LEAVE_MS + 40);
    return () => clearTimeout(t);
  }, [moves, busy]);
  const stateOf = (zone: Zone): ZoneState => (moving[zone.id]?.kind === "out" ? moving[zone.id].was : asked(zone));

  const visible = (item: Item): boolean => (item.kind === "zone" ? stateOf(item) !== "hidden" : item.items.some(visible));
  const collapsed = (item: Item) => item.kind === "zone" && stateOf(item) === "collapsed";

  function resize(split: Split, a: Item, b: Item, line: HTMLElement, delta: number | null, start?: { aPx: number; bPx: number }) {
    const k = split.dir === "row" ? scale.x : scale.y;
    const along = (el: Element | null) => { const r = el?.getBoundingClientRect(); return r ? (split.dir === "row" ? r.width : r.height) / k : 0; };
    const aPx = start?.aPx ?? along(line.previousElementSibling), bPx = start?.bPx ?? along(line.nextElementSibling);
    if (delta === null) return { aPx, bPx };
    onChange(drag(layout, a.id, b.id, aPx, bPx, delta / k));
    return { aPx, bPx };
  }

  // Drag the line: every move is worked out from where the drag started.
  function startDrag(ev: ReactPointerEvent<HTMLElement>, split: Split, a: Item, b: Item) {
    ev.preventDefault();
    const line = ev.currentTarget;
    const from = split.dir === "row" ? ev.clientX : ev.clientY;
    const start = resize(split, a, b, line, null);
    const move = (m: PointerEvent) => resize(split, a, b, line, (split.dir === "row" ? m.clientX : m.clientY) - from, start);
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }
  function onKey(ev: KeyboardEvent<HTMLElement>, split: Split, a: Item, b: Item) {
    const step = split.dir === "row" ? { ArrowLeft: -16, ArrowRight: 16 }[ev.key] : { ArrowUp: -16, ArrowDown: 16 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    resize(split, a, b, ev.currentTarget, step * (split.dir === "row" ? scale.x : scale.y));
  }

  const draw = (split: Split, style: CSSProperties, outer: boolean): ReactNode => {
    const k = split.dir === "row" ? scale.x : scale.y;
    const shown = split.items.filter(visible);
    // Something has to take up the leftover space: the last one on show, when nothing else does.
    const fits = (i: Item) => fitsContent(i, split.dir);
    const filler = shown.some((i) => isGrow(i.size) && !collapsed(i) && !fits(i)) ? null : [...shown].reverse().find((i) => !collapsed(i) && !fits(i)) ?? null;
    return (
      <div className={cx("split", split.dir, outer && className)} style={style}>
        {shown.map((item, i) => {
          const before = shown[i - 1];
          const fixed = !before || collapsed(before) || collapsed(item) || fits(before) || fits(item); // nothing to drag beside a tab, or the roster's bar
          const flex = flexOf(item.size, k, collapsed(item) || fits(item), item === filler);
          return (
            <Fragment key={item.id}>
              {before && (fixed
                ? <div className="zone-line" />
                : <div className="zone-line drag" role="separator" tabIndex={0} aria-orientation={split.dir === "row" ? "vertical" : "horizontal"}
                    aria-label="Resize these zones" title="Drag to resize"
                    onPointerDown={(ev) => startDrag(ev, split, before, item)} onKeyDown={(ev) => onKey(ev, split, before, item)} />)}
              {item.kind === "split" ? draw(item, flex, false) : (
                <div className={cx("zone", collapsed(item) && "collapsed", moving[item.id]?.kind === "in" && "entering", moving[item.id]?.kind === "out" && "leaving")}
                  data-edge={edgeOf(i, shown.length)} data-zone={item.id} data-part={item.part ?? "empty"} data-in={split.dir} style={flex}>
                  {children(item, stateOf(item), split)}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    );
  };
  return draw(layout, { flex: "1 1 0px" }, true);
}
