// The layout editor: a small map of the page's zones. Click a zone to choose what it shows, add
// a zone beside it, or remove it; drag the lines between zones to resize them. Changes apply to
// the page behind as you make them, and are remembered in this browser.

import { useEffect, useState } from "react";
import { addZone, assign, canAssign, canRemove, defaultLayout, isGrow, MAX_ZONES, partName, PARTS, placed, removeZone, setSize, zonesOf, type Layout, type Part, type Side, type Size, type Zone } from "../layout.ts";
import { cx } from "../format.ts";
import { Icon, type IconName } from "./bits.tsx";
import { LayoutFrame } from "./Zones.tsx";

const MAP_WIDTH = 596;
const PART_ICON: Record<Part, IconName> = { chat: "reply", history: "list", roster: "users", files: "folder", terminal: "terminal" };
const SIDES: { side: Side; label: string }[] = [{ side: "left", label: "← Left" }, { side: "right", label: "Right →" }, { side: "above", label: "↑ Above" }, { side: "below", label: "↓ Below" }];
type Mode = "grow" | "px" | "auto";
const modeOf = (s: Size): Mode => (isGrow(s) ? "grow" : "px" in s ? "px" : "auto");

// How big a zone is on the page right now, along the split it sits in (for "keep this size").
function sizeOnPage(zone: Zone): number | null {
  const el = document.querySelector<HTMLElement>(`.zones [data-zone="${zone.id}"]`);
  const r = el?.getBoundingClientRect();
  if (!el || !r) return null;
  const px = el.dataset.in === "row" ? r.width : r.height;
  return px > 0 ? Math.round(px) : null;
}

export function LayoutEditor({ layout, onChange, onClose, select }: {
  layout: Layout; onChange: (next: Layout) => void; onClose: () => void; select?: string;
}) {
  const zones = zonesOf(layout);
  const [picked, setPicked] = useState<string>(select ?? zones.find((z) => z.part === "chat")?.id ?? zones[0].id);
  const zone = zones.find((z) => z.id === picked) ?? zones[0];
  const full = zones.length >= MAX_ZONES;
  const unplaced = PARTS.filter((p) => !placed(layout, p.id));

  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  // The map has the window's own shape, so what you arrange is what you get.
  const w = typeof innerWidth === "number" && innerWidth > 0 ? innerWidth : 1280, h = typeof innerHeight === "number" && innerHeight > 0 ? innerHeight : 800;
  const mapHeight = Math.round(Math.min(380, Math.max(240, MAP_WIDTH * (h / w))));
  const scale = { x: MAP_WIDTH / w, y: mapHeight / h };

  function add(side: Side) {
    const r = addZone(layout, zone.id, side);
    if (!r.id) return;
    onChange(r.layout);
    setPicked(r.id); // so you can say what goes in it straight away
  }
  function remove() {
    const next = removeZone(layout, zone.id);
    onChange(next);
    setPicked(zonesOf(next).find((z) => z.part === "chat")?.id ?? zonesOf(next)[0].id);
  }
  function setMode(mode: Mode) {
    const size: Size = mode === "grow" ? { grow: 1 } : mode === "auto" ? { auto: true } : { px: sizeOnPage(zone) ?? 280 };
    onChange(setSize(layout, zone.id, size));
  }

  return (
    <>
      <div className="drawer-backdrop layout-backdrop" onClick={onClose} />
      <div className="dialog layout-editor" role="dialog" aria-modal="true" aria-labelledby="layout-title">
        <header className="layout-head">
          <div>
            <h2 id="layout-title">Layout</h2>
            <p>Click a zone to change it. Drag the lines between zones to resize.</p>
          </div>
          <button type="button" className="btn small" onClick={() => { const next = defaultLayout(); onChange(next); setPicked("z3"); }}>Reset</button>
          <button type="button" className="btn small primary" onClick={onClose}>Done</button>
        </header>

        <div className="layout-map" style={{ height: mapHeight }}>
          <LayoutFrame layout={layout} onChange={onChange} scale={scale} className="map-root">
            {(z) => (
              <button type="button" className={cx("map-zone", z.id === zone.id && "selected", !z.part && "empty")} aria-pressed={z.id === zone.id}
                aria-label={`${partName(z.part)} zone`} title={z.part ? PARTS.find((p) => p.id === z.part)?.about : "Nothing here yet"} onClick={() => setPicked(z.id)}>
                {z.part && <Icon name={PART_ICON[z.part]} />}<span>{partName(z.part)}</span>
              </button>
            )}
          </LayoutFrame>
        </div>

        <div className="layout-zone">
          <label className="field">This zone shows
            <select aria-label="This zone shows" value={zone.part ?? ""} onChange={(ev) => onChange(assign(layout, zone.id, (ev.target.value || null) as Part | null))}>
              <option value="" disabled={!canAssign(layout, zone.id, null)}>Nothing (empty)</option>
              {PARTS.map((p) => {
                const elsewhere = placed(layout, p.id) && zone.part !== p.id;
                return <option key={p.id} value={p.id} disabled={!canAssign(layout, zone.id, p.id)}>{p.name}{elsewhere ? " (swap places)" : ""}</option>;
              })}
            </select>
          </label>
          <label className="field">Its size
            <select aria-label="Its size" value={modeOf(zone.size)} onChange={(ev) => setMode(ev.target.value as Mode)}>
              <option value="grow">Shares the leftover space</option>
              <option value="px">Stays the size it is now</option>
              <option value="auto">Fits what's in it</option>
            </select>
          </label>
          <div className="field layout-add">Add a zone beside it
            <div>
              {SIDES.map((s) => (
                <button key={s.side} type="button" className="btn small" disabled={full} aria-label={`Add a zone ${s.side === "left" || s.side === "right" ? `to the ${s.side}` : s.side}`}
                  title={full ? `A layout holds up to ${MAX_ZONES} zones` : undefined} onClick={() => add(s.side)}>{s.label}</button>
              ))}
              <button type="button" className="btn small danger" disabled={!canRemove(layout, zone.id)}
                title={zone.part === "chat" ? "Chat needs a zone. Put Chat somewhere else first." : zones.length === 1 ? "The last zone stays" : "Remove this zone. What it showed is taken off the page."}
                onClick={remove}>Remove zone</button>
            </div>
          </div>
        </div>
        {zone.part === "chat" && <p className="field-hint">Chat always has a zone. To move it, pick a zone that shows something else and set that one to Chat.</p>}
        <p className="field-hint layout-note">
          {unplaced.length ? <>Not on the page: <b>{unplaced.map((p) => p.name).join(", ")}</b>. Pick a zone and choose it to bring it back. </> : null}
          Files shows only while a folder is attached, and the terminal while it's switched on, so their zones can be closed on the page.
        </p>
      </div>
    </>
  );
}
