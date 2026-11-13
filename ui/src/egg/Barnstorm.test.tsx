// Barnstorm on the page: what a bullet takes out and in what order, that it all comes back, and
// the keys (the code that starts it, the ones the plane takes while it's up).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { Header } from "../components/Header.tsx";
import type { CampState } from "../types.ts";
import { Barnstorm, useKonami } from "./Barnstorm.tsx";
import { KONAMI } from "./flight.ts";
import { EDGE, GONE, HIGHLIGHT, Wreckage } from "./targets.ts";

// jsdom lays nothing out: every element is given the same box on screen, and the test says what's under the bullet.
let under: Element[] = [];
const box = { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
const doc = document as unknown as Record<string, unknown>;
const range = Range.prototype as unknown as Record<string, unknown>;
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(box);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => real(el)); // (jsdom has no ::before to ask about)
  doc.elementsFromPoint = () => under;
  doc.elementFromPoint = () => under[0] ?? null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  for (const k of ["elementsFromPoint", "elementFromPoint", "caretPositionFromPoint"]) delete doc[k];
  for (const k of ["getClientRects", "getBoundingClientRect"]) delete range[k];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const page = () => {
  document.body.innerHTML = `<div id="root"><div id="card" style="background-color: rgb(250, 250, 250)">
    <button id="go" style="border: 1px solid rgb(0, 0, 0)">Go now</button><img id="pic" alt=""><span id="plain"> </span></div></div>`;
  return Object.fromEntries(["card", "go", "pic", "plain"].map((id) => [id, document.getElementById(id)!]));
};
const shoot = (w: Wreckage, el: Element) => { under = [el]; return w.strike(50, 20); };

test("a bullet takes out what's empty, and flies on over what still has something in it", () => {
  const { card, go, pic, plain } = page();
  const w = new Wreckage(() => null);
  expect(shoot(w, card)).toBeNull(); // the card still holds a button and a picture
  expect(shoot(w, plain)).toBeNull(); // (nor does it go by way of something in it that draws nothing)
  expect(shoot(w, go)).toMatchObject({ kind: "part", points: 25 });
  expect(go.hasAttribute(GONE)).toBe(true);
  expect(shoot(w, card)).toBeNull();
  expect(w.cleared()).toBe(false);
  expect(shoot(w, pic)).toMatchObject({ kind: "part" });
  expect(shoot(w, card)).toMatchObject({ kind: "shell", points: 50, color: "rgb(250, 250, 250)" });
  expect(w.count).toBe(3);
  expect(w.cleared()).toBe(true);
  expect(shoot(w, document.body)).toBeNull(); // the page itself is never a target

  w.restore();
  expect(document.querySelectorAll(`[${GONE}]`).length).toBe(0);
  expect(w.count).toBe(0);
  expect(w.cleared()).toBe(false);
});

test("a border goes a side at a time, whatever is still inside it", () => {
  const { card, go } = page();
  card.style.border = "2px solid rgb(9, 9, 9)";
  const w = new Wreckage(() => null);
  under = [card];
  // Every element's box here is 10–110 across and 10–30 down: the left side of the card's border is its first 2px.
  expect(w.strike(11, 20)).toMatchObject({ kind: "edge", points: 15, color: "rgb(9, 9, 9)", box: { left: 10, top: 10, width: 2, height: 20 } });
  expect(card.getAttribute(EDGE)).toBe("left");
  expect(card.hasAttribute(GONE)).toBe(false); // the card and what's in it are still there
  expect(w.strike(11, 20)).toBeNull(); // that side's gone: the bullet flies on over the card
  expect(w.strike(50, 29)).toMatchObject({ kind: "edge", box: { top: 28, height: 2, width: 100 } });
  expect(card.getAttribute(EDGE)).toBe("left bottom");
  expect(w.strike(50, 20)).toBeNull(); // the middle of a full card is no edge
  expect(go.hasAttribute(EDGE)).toBe(false);

  w.restore();
  expect(card.hasAttribute(EDGE)).toBe(false);
});

test("what's down can be mended a piece at a time, outermost first", () => {
  const { card, go, pic } = page();
  card.style.borderTop = "1px solid rgb(9, 9, 9)";
  const w = new Wreckage(() => null);
  under = [card];
  expect(w.strike(50, 10.5)).toMatchObject({ kind: "edge" });
  shoot(w, go); shoot(w, pic);
  expect(shoot(w, card)).toMatchObject({ kind: "shell" });
  expect(w.count).toBe(4);

  // With the card down, mending the button inside it would show nothing: the card comes first.
  const first = w.pick(0, 0)!;
  expect(first).toMatchObject({ kind: "shell", el: card, claimed: true });
  expect(w.pick(0, 0)).toBeNull(); // (the only other candidate is taken, and the rest are inside it)
  expect(w.mend(first)).toMatchObject({ left: 10, width: 100 });
  expect(card.hasAttribute(GONE)).toBe(false);
  expect(go.hasAttribute(GONE)).toBe(true); // what was in it is still down
  expect(w.count).toBe(3);
  expect(w.mend(first)).toBeNull(); // mended once is mended

  const rest = [w.pick(0, 0)!, w.pick(0, 0)!, w.pick(0, 0)!];
  expect(rest.map((r) => r.kind).sort()).toEqual(["edge", "part", "part"]);
  expect(w.pick(0, 0)).toBeNull();
  rest.forEach((r) => w.mend(r));
  expect(w.count).toBe(0);
  expect(card.hasAttribute(EDGE) || go.hasAttribute(GONE) || pic.hasAttribute(GONE)).toBe(false);
  expect(shoot(w, go)).toMatchObject({ kind: "part" }); // and what's mended can be shot again
});

test("the game's own score card is never hit, and what's under it still is", () => {
  const { pic } = page();
  const mine = document.body.appendChild(document.createElement("section"));
  mine.style.backgroundColor = "rgb(0, 0, 0)";
  const w = new Wreckage(() => mine);
  under = [mine, pic];
  expect(w.strike(50, 20)).toMatchObject({ kind: "part" });
  expect(pic.hasAttribute(GONE)).toBe(true);
  under = [mine];
  expect(w.strike(50, 20)).toBeNull();
  expect(mine.hasAttribute(GONE)).toBe(false);
});

test("where the browser can paint over a word, words go one at a time before what holds them", () => {
  const { go } = page();
  const text = go.firstChild as Text; // "Go now"
  const painted = new Set<Range>();
  vi.stubGlobal("Highlight", class { add(r: Range) { painted.add(r); } delete(r: Range) { painted.delete(r); } clear() { painted.clear(); } });
  vi.stubGlobal("CSS", { highlights: new Map() });
  range.getClientRects = () => [box];
  range.getBoundingClientRect = () => box;
  let caret = 1;
  doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: caret });

  const w = new Wreckage(() => null);
  expect((globalThis.CSS as unknown as { highlights: Map<string, unknown> }).highlights.has(HIGHLIGHT)).toBe(true);
  expect(shoot(w, go)).toMatchObject({ kind: "word", points: 10 });
  expect([...painted].map(String)).toEqual(["Go"]);
  expect(shoot(w, go)).toBeNull(); // that word's gone, and the button still has "now" on it
  caret = 4;
  expect(shoot(w, go)).toMatchObject({ kind: "word" });
  expect([...painted].map(String)).toEqual(["Go", "now"]);
  expect(text.data).toBe("Go now"); // nothing is cut out of the page: React still owns the text
  expect(shoot(w, go)).toMatchObject({ kind: "part" }); // nothing left on it: the button itself
  expect(w.count).toBe(3);
  // Mended in the same order as anything else: the button, then a word back onto it.
  w.mend(w.pick(0, 0)!);
  const word = w.pick(0, 0)!;
  expect(word.kind).toBe("word");
  w.mend(word);
  expect(painted.size).toBe(1);
  expect(w.count).toBe(1);

  w.dispose();
  expect(painted.size).toBe(0);
  expect(go.hasAttribute(GONE)).toBe(false);
  expect((globalThis.CSS as unknown as { highlights: Map<string, unknown> }).highlights.has(HIGHLIGHT)).toBe(false);
});

function Code({ start }: { start: () => void }) { useKonami(start); return <textarea aria-label="draft" />; }
const press = (key: string, type: "keyDown" | "keyUp" = "keyDown") => fireEvent[type](document.activeElement ?? document.body, { key });

test("typing the Konami code starts it, wherever the keyboard is", () => {
  const start = vi.fn();
  render(<Code start={start} />);
  screen.getByLabelText("draft").focus();
  KONAMI.slice(0, -1).forEach((k) => press(k));
  expect(start).not.toHaveBeenCalled();
  expect(press("a")).toBe(false); // the last letter isn't typed into the box
  expect(start).toHaveBeenCalledTimes(1);
});

test("the plane in the top bar starts it and lands it", () => {
  const S = { characters: [], quests: [], queued: [], parallel: 3, limits: [], skills: [], spend: { today: 0, week: 0, total: 0 }, runtime: "api", login: null } as unknown as CampState;
  const toggle = vi.fn();
  const { rerender } = render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onBarnstorm={toggle} />);
  fireEvent.click(screen.getByRole("button", { name: "Barnstorm" }));
  expect(toggle).toHaveBeenCalledTimes(1);
  rerender(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onBarnstorm={toggle} barnstorming />);
  expect(screen.getByRole("button", { name: "Land the plane" }).getAttribute("aria-pressed")).toBe("true");
});

test("while it's up, the arrows and space are the plane's, and Esc or Land puts it down", () => {
  const onClose = vi.fn();
  const { unmount } = render(<><input aria-label="box" autoFocus /><Barnstorm onClose={onClose} /></>);
  expect(document.activeElement).toBe(document.body); // the keyboard is taken from the text box
  expect(screen.getByText("Score").nextElementSibling?.textContent).toBe("000000");
  // Its keys never reach the page (false: the default was prevented); any other key does.
  for (const key of ["ArrowUp", "ArrowLeft", " "]) { expect(press(key)).toBe(false); expect(press(key, "keyUp")).toBe(false); }
  expect(press("x")).toBe(true);
  expect(press("Escape")).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Land" }));
  expect(onClose).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByText("Wrecked").nextElementSibling?.textContent).toBe("0");
  expect(screen.getByText("Rebuilt").nextElementSibling?.textContent).toBe("0");
  unmount();
  expect(press("ArrowUp")).toBe(true); // and it gives the keys back
});
