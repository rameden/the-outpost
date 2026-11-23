// The page's layout: zones you arrange yourself, each showing one part of mission control.
//
// A layout is a tree. A split lays its items out side by side (a row) or one above the other (a
// column); an item is a zone or another split. A zone shows one part (or nothing yet), and each
// part sits in at most one zone. Chat always has a zone: without it there's nowhere to talk to
// the crew. Sizes are a fixed number of pixels, a share of what's left over, or "fits its
// content" (the roster bar). Everything here is plain data in, plain data out; the layout is
// kept in the browser (camp-layout).

import { storeGet, storeSet } from "./api.ts";

import { w } from "./words.ts";
export type Part = "roster" | "history" | "chat" | "files" | "notes" | "terminal";
export const PARTS: { id: Part; name: string; about: string }[] = [
  { id: "chat", name: "Chat", about: "The conversation and the message box" },
  { id: "history", name: "History", about: "Your conversations and projects" },
  { id: "roster", name: "Agent roster", get about() { return `The ${w("crew")}, and what each is doing`; } },
  { id: "files", name: "Files", about: "The attached folder, as a tree" },
  { id: "notes", name: "Notes", about: "Your own notes, beside the conversation" },
  { id: "terminal", name: "Terminal", about: "Your own shell" },
];
export const partName = (p: Part | null) => PARTS.find((x) => x.id === p)?.name ?? "Empty";

export type Size = { px: number } | { grow: number } | { auto: true };
export type Zone = { kind: "zone"; id: string; part: Part | null; size: Size };
export type Split = { kind: "split"; id: string; dir: "row" | "col"; items: Item[]; size: Size };
export type Item = Zone | Split;
export type Layout = Split; // the outermost split
export type Side = "left" | "right" | "above" | "below";

export const MAX_ZONES = 8;
export const MIN_ZONE = 80; // the smallest a zone can be dragged to, in pixels
const MAX_DEPTH = 6;

export const isGrow = (s: Size): s is { grow: number } => "grow" in s;
// The roster is a bar when it sits in a column of zones, and a bar is as tall as what's in it:
// slim, or opened up into cards. A height of its own would only cut the cards off or leave a gap,
// so there it always fits its content, whatever size was set. (Beside other zones, in a row, it's
// a list with a width like any other.)
export const fitsContent = (item: Item, within: "row" | "col") => item.kind === "zone" && item.part === "roster" && within === "col";
const fill = (): Size => ({ grow: 1 });
const NOTES_WIDTH = 320;

// The layout the page starts with: the roster across the top, history on the left, chat in the
// middle, files and then your notes on the right, and the terminal along the bottom.
export function defaultLayout(sizes: { files?: number; terminal?: number } = {}): Layout {
  return {
    kind: "split", id: "s1", dir: "col", size: fill(), items: [
      { kind: "zone", id: "z1", part: "roster", size: { auto: true } },
      {
        kind: "split", id: "s2", dir: "row", size: fill(), items: [
          { kind: "zone", id: "z2", part: "history", size: { px: 272 } },
          { kind: "zone", id: "z3", part: "chat", size: fill() },
          { kind: "zone", id: "z4", part: "files", size: { px: sizes.files ?? 300 } },
          { kind: "zone", id: "z6", part: "notes", size: { px: NOTES_WIDTH } },
        ],
      },
      { kind: "zone", id: "z5", part: "terminal", size: { px: sizes.terminal ?? 280 } },
    ],
  };
}

export function zonesOf(item: Item): Zone[] {
  return item.kind === "zone" ? [item] : item.items.flatMap(zonesOf);
}
export const zoneOf = (layout: Layout, part: Part) => zonesOf(layout).find((z) => z.part === part);
export const placed = (layout: Layout, part: Part) => !!zoneOf(layout, part);

function splitsOf(item: Item): Split[] {
  return item.kind === "zone" ? [] : [item, ...item.items.flatMap(splitsOf)];
}
// Where an item sits: the split holding it, and its place there.
function locate(layout: Layout, id: string): { parent: Split; index: number } | null {
  for (const s of splitsOf(layout)) {
    const index = s.items.findIndex((i) => i.id === id);
    if (index >= 0) return { parent: s, index };
  }
  return null;
}
// Whether an item's split lays things out in a row or a column.
export const dirOf = (layout: Layout, id: string) => locate(layout, id)?.parent.dir;
function nextId(layout: Layout, letter: "z" | "s"): string {
  const used = [...zonesOf(layout), ...splitsOf(layout)].map((n) => (n.id[0] === letter ? Number(n.id.slice(1)) || 0 : 0));
  return `${letter}${Math.max(0, ...used) + 1}`;
}

// A new, empty zone beside one that's there. Returns the layout and the new zone's id (the
// layout comes back unchanged, with no id, when there's no room for another).
export function addZone(layout: Layout, id: string, side: Side): { layout: Layout; id?: string } {
  if (zonesOf(layout).length >= MAX_ZONES) return { layout };
  const next = structuredClone(layout);
  const at = locate(next, id);
  if (!at) return { layout };
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "above";
  const fresh: Zone = { kind: "zone", id: nextId(next, "z"), part: null, size: fill() };
  const { parent, index } = at;
  if (parent.dir === dir) {
    parent.items.splice(before ? index : index + 1, 0, fresh);
  } else {
    // The other direction: the zone becomes a small split of its own, holding itself and the new one.
    const old = parent.items[index];
    const inner: Split = { kind: "split", id: nextId(next, "s"), dir, size: old.size, items: before ? [fresh, { ...old, size: fill() }] : [{ ...old, size: fill() }, fresh] };
    parent.items[index] = inner;
  }
  return { layout: next, id: fresh.id };
}

// Chat's zone stays, and so does the last zone.
export function canRemove(layout: Layout, id: string): boolean {
  const all = zonesOf(layout);
  const zone = all.find((z) => z.id === id);
  return !!zone && all.length > 1 && zone.part !== "chat";
}

export function removeZone(layout: Layout, id: string): Layout {
  if (!canRemove(layout, id)) return layout;
  let next = structuredClone(layout);
  const at = locate(next, id)!;
  at.parent.items.splice(at.index, 1);
  // A split left holding one item isn't a split any more: the item takes its place.
  for (let tidy = true; tidy;) {
    tidy = false;
    for (const s of splitsOf(next)) {
      if (s.items.length !== 1) continue;
      const only = s.items[0];
      if (s === next) {
        if (only.kind === "split") { next = { ...only, size: fill() }; tidy = true; break; }
      } else {
        const up = locate(next, s.id)!;
        up.parent.items[up.index] = { ...only, size: s.size };
        tidy = true;
        break;
      }
    }
  }
  return next;
}

// Whether a zone can show this part (or nothing). A part that's already somewhere else trades
// places with what's here; what isn't allowed is leaving Chat with no zone.
export function canAssign(layout: Layout, id: string, part: Part | null): boolean {
  const zone = zonesOf(layout).find((z) => z.id === id);
  if (!zone) return false;
  if (zone.part !== "chat" || part === "chat") return true;
  return part !== null && placed(layout, part);
}

export function assign(layout: Layout, id: string, part: Part | null): Layout {
  if (!canAssign(layout, id, part)) return layout;
  const next = structuredClone(layout);
  const all = zonesOf(next);
  const zone = all.find((z) => z.id === id)!;
  if (zone.part === part) return layout;
  const other = part ? all.find((z) => z.part === part) : undefined;
  if (other) other.part = zone.part;
  zone.part = part;
  return next;
}

export function setSize(layout: Layout, id: string, size: Size): Layout {
  const next = structuredClone(layout);
  const at = locate(next, id);
  if (!at) return layout;
  at.parent.items[at.index].size = size;
  return next;
}

// Dragging the line between two neighbours. a and b are their sizes on screen now (pixels along
// the split), delta how far the line moved toward b. Zones with a fixed or fitted size take the
// new size in pixels; two that share the leftover space trade shares instead.
export function drag(layout: Layout, aId: string, bId: string, a: number, b: number, delta: number, min = MIN_ZONE): Layout {
  const next = structuredClone(layout);
  const at = locate(next, aId), bt = locate(next, bId);
  if (!at || !bt || at.parent !== bt.parent) return layout;
  const A = at.parent.items[at.index], B = bt.parent.items[bt.index];
  const d = Math.max(Math.min(delta, b - Math.min(min, b)), Math.min(min, a) - a);
  const na = a + d, nb = b - d;
  if (isGrow(A.size) && isGrow(B.size)) {
    const total = A.size.grow + B.size.grow;
    const share = na + nb > 0 ? na / (na + nb) : 0.5;
    A.size = { grow: +(total * share).toFixed(4) };
    B.size = { grow: +(total * (1 - share)).toFixed(4) };
  } else {
    if (!isGrow(A.size)) A.size = { px: Math.round(na) };
    if (!isGrow(B.size)) B.size = { px: Math.round(nb) };
  }
  return next;
}

// ---------- Focus mode ----------
// The panels that close to a tab. Focus mode closes whichever are open, leaving the conversation;
// used again with none open, it brings back the ones it closed (history, if it closed nothing).
export const PANELS = ["history", "files", "notes", "terminal"] as const;
export type Panel = (typeof PANELS)[number];
export function focusPlan(open: Panel[], closedBefore: string | null): { close: Panel[]; reopen: Panel[] } {
  if (open.length) return { close: open, reopen: [] };
  const back = (closedBefore ?? "").split(",").filter((p): p is Panel => (PANELS as readonly string[]).includes(p));
  return { close: [], reopen: back.length ? back : ["history"] };
}

// ---------- Kept in the browser ----------
function validSize(s: unknown): s is Size {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (o.auto === true) return true;
  if (typeof o.px === "number") return o.px >= 20 && o.px <= 10_000;
  return typeof o.grow === "number" && o.grow > 0 && o.grow <= 1000;
}
function validItem(n: unknown, depth: number, ids: Set<string>): n is Item {
  if (!n || typeof n !== "object" || depth > MAX_DEPTH) return false;
  const o = n as Record<string, unknown>;
  if (typeof o.id !== "string" || ids.has(o.id) || !validSize(o.size)) return false;
  ids.add(o.id);
  if (o.kind === "zone") return o.part === null || PARTS.some((p) => p.id === o.part);
  return o.kind === "split" && (o.dir === "row" || o.dir === "col") && Array.isArray(o.items) && o.items.length > 0 && o.items.every((i) => validItem(i, depth + 1, ids));
}

// A saved layout, if it's one this page can show: well formed, each part at most once, Chat in it.
export function parseLayout(text: string | null): Layout | null {
  if (!text) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!validItem(v, 0, new Set()) || v.kind !== "split") return null;
  const parts = zonesOf(v).flatMap((z) => (z.part ? [z.part] : []));
  if (zonesOf(v).length > MAX_ZONES || new Set(parts).size !== parts.length || !parts.includes("chat")) return null;
  return v;
}

// Notes came after layouts could be arranged, so a layout kept from before then has no zone for
// them. It's given one, at the right of Files (or of Chat, without Files).
export function withNotes(layout: Layout): Layout {
  if (placed(layout, "notes")) return layout;
  const beside = zoneOf(layout, "files") ?? zoneOf(layout, "chat")!;
  const added = addZone(layout, beside.id, "right");
  if (!added.id) return layout; // no room for another zone: Notes can be given one in the layout editor
  return setSize(assign(added.layout, added.id, "notes"), added.id, { px: NOTES_WIDTH });
}

const KNOWS_NOTES = "camp-layout-notes"; // set once a layout has been kept by a page that has Notes
export function loadLayout(): Layout {
  // Before there were zones, the terminal's height and the files flyout's width were kept on their own.
  const px = (key: string) => { const n = Number(storeGet(key)); return n >= 120 && n <= 2000 ? n : undefined; };
  const kept = parseLayout(storeGet("camp-layout"));
  if (!kept) return defaultLayout({ files: px("camp-files-width"), terminal: px("camp-term-height") });
  // Only the once: a layout you've since taken Notes out of stays without them.
  if (storeGet(KNOWS_NOTES)) return kept;
  const next = withNotes(kept);
  saveLayout(next);
  return next;
}
export function saveLayout(layout: Layout) {
  storeSet("camp-layout", JSON.stringify(layout));
  storeSet(KNOWS_NOTES, "1");
}
