// Barnstorm: what a bullet hits, and how the gremlins put it back. The page comes apart a piece a shot:
//   a word       the one under the bullet, wherever there's text;
//   an edge      one side of a border (a panel's, a card's, a button's), whatever is still inside it;
//   a part       an icon, a picture, a text box, a dot, a dividing line: something drawn with nothing inside it;
//   a shell      a button, a card, a panel: what's left once everything inside it has gone.
// Until its insides are gone a shell's background lets bullets through, so the first shot
// doesn't take the whole page with it.
//
// Nothing is removed or rewritten: React still owns every node, and would trip over a word
// that had been cut out from under it. A part or shell is hidden by an attribute, an edge by
// another (styles.css), and a word by a highlight over its range painted in no colour. So
// mending a piece is taking that off again, and anything React redraws meanwhile simply comes back.

import { POINTS, wordAt, wordsIn, type Kind } from "./flight.ts";

export const GONE = "data-barnstormed";
export const EDGE = "data-barnstorm-edge"; // which sides of its border have been shot off: "top left"
export const HIGHLIGHT = "barnstorm";

export type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export type Box = { left: number; top: number; width: number; height: number };
export type Hit = { kind: Kind; points: number; box: Box; color: string };
// One thing that's been shot and not yet mended. (claimed: a gremlin is on its way to it.)
export type Wreck = { kind: Kind; el: Element; side?: Side; node?: Text; range?: Range; claimed: boolean; mended: boolean };

// Drawn by the browser itself, whatever its CSS says.
const DRAWN = new Set(["IMG", "CANVAS", "VIDEO", "INPUT", "TEXTAREA", "SELECT", "IFRAME", "PROGRESS", "METER", "HR"]);
const NEVER = (el: Element) => el === document.body || el === document.documentElement || el.id === "root";

// A colour with anything to see in it: not "transparent", "rgba(…, 0)" or "color(… / 0)".
const seen = (color: string) => !!color && color !== "transparent" && !/[,/]\s*0(\.0+)?\s*\)$/.test(color);
const overlaps = (a: Box, b: Box) => a.width > 0 && a.height > 0 && a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
const isSvg = (el: Element) => el.namespaceURI === "http://www.w3.org/2000/svg";
const shotSides = (el: Element) => el.getAttribute(EDGE)?.split(" ").filter(Boolean) ?? [];
// The strip of an element's box that one side of its border covers.
const sideBox = (r: Box, side: Side, w: number): Box =>
  side === "top" ? { left: r.left, top: r.top, width: r.width, height: w }
  : side === "bottom" ? { left: r.left, top: r.top + r.height - w, width: r.width, height: w }
  : side === "left" ? { left: r.left, top: r.top, width: w, height: r.height }
  : { left: r.left + r.width - w, top: r.top, width: w, height: r.height };

type HighlightSet = { add(r: Range): unknown; delete(r: Range): unknown; clear(): void };
// text: it has words of its own (not in an element inside it), so where on it a bullet lands matters.
type Look = { draws: boolean; reach: boolean; text: boolean; borders: Partial<Record<Side, number>> };

export class Wreckage {
  private list: Wreck[] = [];
  private words = new WeakMap<Text, Range[]>();
  private highlight: HighlightSet | null = null;
  private paint = new Map<Element, Look>();
  private paintAt = 0;
  private alive = new WeakMap<Element, Node>(); // the last thing found still standing inside a shell
  // Asking the page what's under a point, and whether a box still has anything in it, is the
  // slow part, and a bullet asks at every few pixels of its flight. Nearly all of those are over
  // the same few boxes, with nothing having changed since the last one. So what's been learned
  // is kept for as long as it holds: until something is shot or mended (`version`), and for the
  // things that could move, only within the frame (tick()).
  private version = 0;
  private passed = new Set<Element>(); // boxes with no words of their own that are known to let a bullet through
  private rects = new Map<Element, DOMRect>(); // where things are, this frame
  private stood = new WeakMap<Element, { version: number; at: number; yes: boolean }>(); // standing(), remembered a moment

  // own: the game's own corner of the page (the plane's canvas, the score card), which nothing hits.
  constructor(private own: () => Element | null) {
    // Words need the browser's highlight registry; without it, text goes with whatever holds it.
    const registry = (globalThis.CSS as { highlights?: Map<string, unknown> } | undefined)?.highlights;
    const Make = (globalThis as { Highlight?: new () => HighlightSet }).Highlight;
    if (registry && Make) { this.highlight = new Make(); registry.set(HIGHLIGHT, this.highlight); }
  }

  // How much is down right now.
  get count() { return this.list.length; }

  // Once a frame, before any bullets are moved: what was learned last frame about where things
  // are is let go (the page may have scrolled, or redrawn something).
  tick() { this.passed.clear(); this.rects.clear(); }

  // Something has been shot or mended: what was known about which boxes are empty no longer holds.
  private changed() { this.version++; this.passed.clear(); }
  private rectOf(el: Element): DOMRect { let r = this.rects.get(el); if (!r) this.rects.set(el, r = el.getBoundingClientRect()); return r; }

  // The topmost thing on the page at a point, not counting the game itself. (Whatever is under
  // the game's bar can still be hit: the bullet goes beneath it.)
  under(x: number, y: number): Element | null {
    const el = document.elementFromPoint?.(x, y) ?? null;
    return el && this.mine(el) ? document.elementsFromPoint?.(x, y).find((e) => !this.mine(e)) ?? null : el;
  }

  // A bullet is at (x, y): what it destroys there, if anything.
  strike(x: number, y: number, el: Element | null = this.under(x, y)): Hit | null {
    if (!el) return null;
    // A box already known to let bullets through: only its border could still stop one.
    if (this.passed.has(el)) return this.strikeEdge(el, x, y);
    const look = this.look(el);
    const first = (this.highlight && look.text && !isSvg(el) ? this.strikeWord(el, x, y) : null) ?? this.strikeEdge(el, x, y);
    if (first) return first;
    // The first thing from here outwards that draws anything: it goes if it's empty, and
    // otherwise the bullet carries on over it.
    let at: Element | null = el;
    if (isSvg(el)) { at = el.closest("svg"); while (at?.parentElement?.closest("svg")) at = at.parentElement.closest("svg"); }
    for (; at && !NEVER(at); at = at.parentElement) {
      if (!this.look(at).draws) continue;
      if (!this.standing(at)) return this.wreck(at);
      break;
    }
    // Nothing here to hit. Where the answer didn't depend on a word under the bullet, it'll be
    // the same anywhere else on this box, until something changes.
    if (!look.text) this.passed.add(el);
    return null;
  }

  // Is anything left to shoot?
  cleared(): boolean { return !this.standing(document.body); }

  // ---------- Mending (the gremlins' side of it) ----------
  // The nearest wreck to (x, y) that nobody is on their way to, claimed for whoever asked.
  // Only what could be seen once mended: on screen, and not inside something that's still down.
  pick(x: number, y: number, rand: () => number = Math.random): Wreck | null {
    const n = this.list.length;
    if (!n) return null;
    const view = { left: 0, top: 0, width: innerWidth, height: innerHeight };
    let best: Wreck | null = null, near = Infinity;
    // A sample is plenty when there's a lot down: nobody needs the very nearest of a thousand.
    const looks = Math.min(n, 40), from = Math.floor(rand() * n);
    const lost: Wreck[] = [];
    for (let i = 0; i < looks; i++) {
      const w = this.list[(from + i) % n];
      if (w.claimed) continue;
      const box = this.where(w);
      if (!box) { lost.push(w); continue; } // React has redrawn it since: it's back already
      const inside = w.kind === "word" ? w.el : w.kind === "edge" ? w.el : w.el.parentElement;
      if (!overlaps(box, view) || inside?.closest(`[${GONE}]`)) continue;
      const d = Math.hypot(box.left + box.width / 2 - x, box.top + box.height / 2 - y);
      if (d < near) { near = d; best = w; }
    }
    for (const w of lost) this.mend(w);
    if (best) best.claimed = true;
    return best;
  }

  // Where a wreck is on screen now (the page may have scrolled), or null if it's no longer on the page.
  where(w: Wreck): Box | null {
    if (w.mended || !w.el.isConnected) return null;
    if (w.kind === "word") {
      const range = w.range!;
      if (range.collapsed || !w.node!.isConnected || !range.getBoundingClientRect) return null;
      const r = range.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    const r = w.el.getBoundingClientRect();
    if (w.kind !== "edge") return { left: r.left, top: r.top, width: r.width, height: r.height };
    const wide = parseFloat((getComputedStyle(w.el) as unknown as Record<string, string>)[`border${cap(w.side!)}Width`]) || 1;
    return sideBox(r, w.side!, wide);
  }

  // Put one wreck back. Answers where it was, for the sparks.
  mend(w: Wreck): Box | null {
    if (w.mended) return null;
    const box = this.where(w);
    if (w.kind === "word") {
      this.highlight?.delete(w.range!);
      const rest = (this.words.get(w.node!) ?? []).filter((r) => r !== w.range);
      if (rest.length) this.words.set(w.node!, rest); else this.words.delete(w.node!);
    } else if (w.kind === "edge") {
      const rest = shotSides(w.el).filter((s) => s !== w.side);
      if (rest.length) w.el.setAttribute(EDGE, rest.join(" ")); else w.el.removeAttribute(EDGE);
      this.paint.delete(w.el);
    } else {
      w.el.removeAttribute(GONE);
    }
    w.mended = true;
    const at = this.list.indexOf(w);
    if (at >= 0) this.list.splice(at, 1);
    this.changed();
    return box;
  }

  // Pausing: put the page back as it was for now, without forgetting what's down.
  suspend() {
    for (const w of this.list) {
      if (w.kind === "word") this.highlight?.delete(w.range!);
      else w.el.removeAttribute(w.kind === "edge" ? EDGE : GONE);
    }
    this.paint.clear();
    this.alive = new WeakMap();
    this.changed();
  }

  // …and carrying on: take it apart again the same way. Anything the page has redrawn in the
  // meantime (a word React has rewritten, a part that's gone from the page) is let go: it's back.
  resume() {
    for (const w of [...this.list]) {
      if (!this.where(w)) { this.mend(w); continue; }
      if (w.kind === "word") this.highlight?.add(w.range!);
      else if (w.kind === "edge") { if (!shotSides(w.el).includes(w.side!)) w.el.setAttribute(EDGE, [...shotSides(w.el), w.side!].join(" ")); }
      else w.el.setAttribute(GONE, "");
    }
    this.paint.clear();
    this.changed();
  }

  // Put everything back.
  restore() {
    for (const w of [...this.list]) this.mend(w);
    this.highlight?.clear();
    this.words = new WeakMap();
    this.alive = new WeakMap();
    this.paint.clear();
    this.changed();
  }

  // Restore, and give the highlight back to the browser: the game is over.
  dispose() {
    this.restore();
    (globalThis.CSS as { highlights?: Map<string, unknown> } | undefined)?.highlights?.delete(HIGHLIGHT);
    this.highlight = null;
  }

  private mine(el: Element) { return !!this.own()?.contains(el); }

  private down(w: Omit<Wreck, "claimed" | "mended">) { this.list.push({ ...w, claimed: false, mended: false }); this.changed(); }

  private strikeWord(el: Element, x: number, y: number): Hit | null {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !el.contains(caret.node)) return null;
    const node = caret.node as Text;
    const span = wordAt(node.data, caret.offset);
    if (!span || !node.parentElement || this.wordGone(node, span)) return null;
    const range = document.createRange();
    range.setStart(node, span[0]);
    range.setEnd(node, span[1]);
    // The caret lands on the nearest letter even from a line away: only a bullet on the word counts.
    const box = [...(range.getClientRects?.() ?? [])].find((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
    if (!box) return null;
    this.highlight!.add(range);
    this.words.set(node, [...(this.words.get(node) ?? []), range]);
    this.down({ kind: "word", el: node.parentElement, node, range });
    return { kind: "word", points: POINTS.word, box: { left: box.left, top: box.top, width: box.width, height: box.height }, color: getComputedStyle(node.parentElement).color };
  }

  private wordGone(node: Text, [start, end]: [number, number]) {
    // (A range whose text React has since rewritten has collapsed: that word is back.)
    return !!this.words.get(node)?.some((r) => r.startContainer === node && !r.collapsed && r.startOffset <= start && r.endOffset >= end);
  }

  // One side of a border, if the bullet is on it: it goes on its own, whatever the box still holds.
  private strikeEdge(el: Element, x: number, y: number): Hit | null {
    if (NEVER(el) || isSvg(el) || DRAWN.has(el.tagName)) return null; // (a text box goes in one piece)
    const { borders } = this.look(el);
    if (!SIDES.some((s) => borders[s])) return null;
    const r = this.rectOf(el);
    const side = SIDES.find((s) => {
      const w = borders[s];
      if (!w) return false;
      return s === "left" ? x <= r.left + w : s === "right" ? x >= r.right - w : s === "top" ? y <= r.top + w : y >= r.bottom - w;
    });
    if (!side) return null;
    const color = (getComputedStyle(el) as unknown as Record<string, string>)[`border${cap(side)}Color`];
    el.setAttribute(EDGE, [...shotSides(el), side].join(" "));
    this.paint.delete(el);
    this.down({ kind: "edge", el, side });
    return { kind: "edge", points: POINTS.edge, box: sideBox(r, side, borders[side]!), color };
  }

  private wreck(el: Element): Hit {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const color = seen(cs.backgroundColor) ? cs.backgroundColor : parseFloat(cs.borderTopWidth) > 0 && seen(cs.borderTopColor) ? cs.borderTopColor : cs.color;
    const kind: Kind = el.childElementCount > 0 && !isSvg(el) ? "shell" : "part";
    el.setAttribute(GONE, "");
    this.down({ kind, el });
    return { kind, points: POINTS[kind], box: { left: r.left, top: r.top, width: r.width, height: r.height }, color };
  }

  // What an element shows of its own (not its children), and whether a bullet can get at it.
  private look(el: Element): Look {
    const now = performance.now();
    if (now - this.paintAt > 1500) { this.paint.clear(); this.paintAt = now; } // a theme switch, a hover: don't trust it for long
    let known = this.paint.get(el);
    if (!known) {
      const cs = getComputedStyle(el);
      const s = cs as unknown as Record<string, string>;
      const reach = cs.pointerEvents !== "none"; // the browser won't say what's under a bullet there
      const pseudo = (which: string) => { const c = getComputedStyle(el, which).content; return !!c && c !== "none" && c !== "normal"; };
      // The sides of its border that are there to see (and haven't been shot off).
      const shot = shotSides(el);
      const borders: Look["borders"] = {};
      if (reach) for (const side of SIDES) {
        const w = parseFloat(s[`border${cap(side)}Width`]);
        if (w > 0 && s[`border${cap(side)}Style`] !== "none" && seen(s[`border${cap(side)}Color`]) && !shot.includes(side)) borders[side] = w;
      }
      const draws = reach && (DRAWN.has(el.tagName) || (isSvg(el) && el.tagName.toLowerCase() === "svg")
        || seen(cs.backgroundColor) || (!!cs.backgroundImage && cs.backgroundImage !== "none")
        || SIDES.some((side) => borders[side])
        || (!!cs.boxShadow && !/\bnone\b/.test(cs.boxShadow)) || pseudo("::before") || pseudo("::after")
        // Without word-by-word highlights, text counts as part of what holds it.
        || (!this.highlight && [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && /\S/.test((n as Text).data))));
      const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && /\S/.test((n as Text).data));
      known = { draws, reach, text, borders };
      this.paint.set(el, known);
    }
    return known;
  }

  // Is there anything inside this element that's still there to be shot?
  private standing(el: Element): boolean {
    // (Asked for the same box at every step of every bullet over it: the answer is kept until
    // something is shot or mended, and no longer than a moment in case the page itself changes.)
    const now = performance.now(), known = this.stood.get(el);
    if (known && known.version === this.version && now - known.at < 300) return known.yes;
    const yes = this.stands(el);
    this.stood.set(el, { version: this.version, at: now, yes });
    return yes;
  }
  private stands(el: Element): boolean {
    const last = this.alive.get(el);
    if (last && last.isConnected && el.contains(last) && this.there(last, null)) return true;
    const r = el === document.body ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : el.getBoundingClientRect();
    // Only what's on screen counts: a long thread scrolled away shouldn't make its pane bulletproof.
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const clip = { left, top, width: Math.min(innerWidth, r.left + r.width) - left, height: Math.min(innerHeight, r.top + r.height) - top };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
        const e = n as Element;
        if (e.hasAttribute(GONE) || this.mine(e)) return NodeFilter.FILTER_REJECT;
        if (isSvg(e) && e.tagName.toLowerCase() !== "svg") return NodeFilter.FILTER_REJECT; // an icon is one piece
        if (e.checkVisibility && !e.checkVisibility({ visibilityProperty: true })) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (this.there(n, clip)) { this.alive.set(el, n); return true; }
    }
    return false;
  }

  // One node: still to be shot? (clip: only if it's within this box; null skips the check.)
  private there(n: Node, clip: Box | null): boolean {
    // Where it is comes first: on a long page nearly everything is off the screen, and one look
    // at a box is much cheaper than working out what it draws or measuring each of its words.
    const e = n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element);
    if (!e || (clip && !overlaps(e.getBoundingClientRect(), clip))) return false;
    if (n.nodeType === Node.TEXT_NODE) return !!this.highlight && this.wordLeft(n as Text);
    return !e.closest(`[${GONE}]`) && this.look(e).draws;
  }

  // Does this text still have a word a bullet could reach? A word cut off by its box (a long
  // title ending in …) or under something else doesn't count: it goes when what holds it goes.
  private wordLeft(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent || !/\S/.test(node.data) || isSvg(parent) || !this.look(parent).reach) return false;
    const range = document.createRange();
    if (!range.getBoundingClientRect) return false;
    for (const span of wordsIn(node.data)) {
      if (this.wordGone(node, span)) continue;
      range.setStart(node, span[0]);
      range.setEnd(node, span[1]);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const top = document.elementFromPoint(cx, cy);
      if (top && parent.contains(top)) return true;
    }
    return false;
  }
}

// The text position under a point, by whichever name this browser has for it.
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}
