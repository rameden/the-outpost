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

test("the plane in the top bar's Arcade menu starts it, then is its play and pause", () => {
  const S = { characters: [], quests: [], queued: [], parallel: 3, limits: [], skills: [], spend: { today: 0, week: 0, total: 0 }, runtime: "api", login: null } as unknown as CampState;
  const toggle = vi.fn();
  const arcade = () => screen.getByRole("button", { name: "Arcade" });
  const row = (name: string) => { fireEvent.click(arcade()); return screen.getByRole("menuitemcheckbox", { name }); };
  const { rerender } = render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onBarnstorm={toggle} />);
  fireEvent.click(row("Barnstorm"));
  expect(toggle).toHaveBeenCalledTimes(1);
  rerender(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onBarnstorm={toggle} barnstorm="on" />);
  expect(arcade().classList.contains("on")).toBe(true); // lit while the game is up
  const pause = row("Pause Barnstorm");
  expect(pause.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(pause);
  rerender(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onBarnstorm={toggle} barnstorm="paused" />);
  expect([...arcade().classList]).toEqual(["icon-btn", "egg-paused"]); // not running, but there to come back to
  const resume = row("Resume Barnstorm");
  expect(resume.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(resume);
  expect(toggle).toHaveBeenCalledTimes(3);
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

test("the bar along the bottom holds the numbers and the buttons, and switches to the other game and back", () => {
  const onClose = vi.fn();
  render(<Barnstorm onClose={onClose} />);
  const bar = screen.getByRole("region", { name: "Barnstorm" });
  expect(bar.className).toBe("barnstorm-bar");
  // It starts on wrecking the page.
  const wreck = screen.getByRole("button", { name: "Wreck" }), sortie = screen.getByRole("button", { name: "Sortie" });
  expect([wreck.getAttribute("aria-pressed"), sortie.getAttribute("aria-pressed")]).toEqual(["true", "false"]);
  expect([...bar.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Score", "Best", "Wrecked", "Rebuilt"]);
  expect(bar.querySelector(".barnstorm-keys")?.textContent).toContain("throttle");

  // The Sortie: its own numbers and keys, in the same bar, over the same page.
  fireEvent.click(sortie);
  const now = screen.getByRole("region", { name: "Barnstorm" });
  expect(screen.getByRole("button", { name: "Sortie" }).getAttribute("aria-pressed")).toBe("true");
  expect([...now.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Score", "Best", "Stage", "Lives", "Loops", "Guns"]);
  expect([...now.querySelectorAll("dd")].slice(2).map((d) => d.textContent)).toEqual(["1", "3", "3", "1"]);
  expect(now.querySelector(".barnstorm-keys")?.textContent).toContain("loop");
  expect(now.parentElement?.className).toBe("barnstorm sortie");
  // Its keys are the game's too (X is the loop), and Esc and Land still put it down.
  for (const key of ["ArrowLeft", " ", "x", "X"]) expect(press(key)).toBe(false);
  expect(press("q")).toBe(true);
  expect(press("Escape")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Land" }));
  expect(onClose).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByText("Stage").nextElementSibling?.textContent).toBe("1");

  fireEvent.click(screen.getByRole("button", { name: "Wreck" }));
  expect(screen.getByText("Wrecked").nextElementSibling?.textContent).toBe("0");
  expect(press("x")).toBe(true); // and X is just a letter again
});

test("pausing puts the page back whole without forgetting what was down, and resuming takes it apart again", () => {
  const { card, go, pic } = page();
  card.style.borderTop = "1px solid rgb(9, 9, 9)";
  const w = new Wreckage(() => null);
  under = [card];
  w.strike(50, 10.5); // the card's top edge
  shoot(w, go); shoot(w, pic);
  expect(w.count).toBe(3);

  w.suspend();
  expect(document.querySelectorAll(`[${GONE}], [${EDGE}]`).length).toBe(0); // the page as it was
  expect(w.count).toBe(3); // but it remembers
  // While you were away the page dropped one of the things that was down.
  pic.remove();
  w.resume();
  expect([go.hasAttribute(GONE), card.getAttribute(EDGE)]).toEqual([true, "top"]); // down again, as they were
  expect(w.count).toBe(2); // and what's gone from the page is let go
  expect(shoot(w, card)).toMatchObject({ kind: "shell" }); // so the game carries on from there: the card's empty now
  w.restore();
  expect(document.querySelectorAll(`[${GONE}], [${EDGE}]`).length).toBe(0);
});

test("a game can be paused and picked up again: it gets out of the way, and is still there to come back to", () => {
  const onClose = vi.fn();
  render(<><input aria-label="box" /><Barnstorm onClose={onClose} /></>);
  for (const start of ["Wreck", "Sortie"]) {
    fireEvent.click(screen.getByRole("button", { name: start }));
    const sky = document.querySelector("canvas")!;
    const before = [...document.querySelectorAll(".barnstorm-bar dd")].map((d) => d.textContent);
    expect(press("ArrowUp")).toBe(false); // the game has the keys

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    // No bar, no sky: a pill in the corner, saying what's paused.
    expect(document.querySelector(".barnstorm-bar")).toBeNull();
    expect(document.querySelector(".barnstorm")?.className).toContain("paused");
    const pill = screen.getByRole("region", { name: "Barnstorm, paused" });
    expect(pill.textContent).toContain(`Paused · ${start}`);
    // And the keyboard is the page's again: arrows, space, Esc, all of it.
    screen.getByLabelText("box").focus();
    for (const key of ["ArrowUp", " ", "x", "p", "Escape"]) expect(press(key)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(document.querySelector("canvas")).toBe(sky); // the same game, not a new one
    expect([...document.querySelectorAll(".barnstorm-bar dd")].map((d) => d.textContent)).toEqual(before);
    expect(document.activeElement).toBe(document.body); // the keys are the game's again
    expect(press("ArrowUp")).toBe(false);
    // P pauses too.
    expect(press("p")).toBe(false);
    expect(screen.getByRole("region", { name: "Barnstorm, paused" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  }
  // From the pill, Land ends it for good.
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  fireEvent.click(screen.getByRole("button", { name: "Land" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("whoever shows the game can keep the pause themselves, as the app does for its top bar", () => {
  const onPause = vi.fn(), onResume = vi.fn();
  const { rerender } = render(<Barnstorm onClose={() => {}} paused={false} onPause={onPause} onResume={onResume} />);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(onPause).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("region", { name: "Barnstorm, paused" })).toBeNull(); // not until it's told so
  rerender(<Barnstorm onClose={() => {}} paused onPause={onPause} onResume={onResume} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(onResume).toHaveBeenCalledTimes(1);
  rerender(<Barnstorm onClose={() => {}} paused={false} onPause={onPause} onResume={onResume} />);
  expect(screen.getByRole("region", { name: "Barnstorm" }).className).toBe("barnstorm-bar");
});

test("a box that lets a bullet through isn't worked out again for every pixel of the bullet's flight", () => {
  const { card, go, pic } = page();
  const w = new Wreckage(() => null);
  const style = vi.mocked(window.getComputedStyle), box = vi.mocked(Element.prototype.getBoundingClientRect);
  expect(shoot(w, card)).toBeNull(); // the card still has things in it: it's looked into once…
  expect(style.mock.calls.length).toBeGreaterThan(0);
  style.mockClear(); box.mockClear();
  for (let i = 0; i < 50; i++) expect(shoot(w, card)).toBeNull(); // …and the next fifty shots over it cost nothing
  expect([style.mock.calls.length, box.mock.calls.length]).toEqual([0, 0]);
  // Until something is shot: then it's looked at afresh, and found empty in its turn.
  shoot(w, go); shoot(w, pic);
  expect(shoot(w, card)).toMatchObject({ kind: "shell" });
  // The same when something is mended: what was empty isn't any more.
  w.mend(w.pick(0, 0)!); // the card
  w.mend(w.pick(0, 0)!); // something in it
  expect(shoot(w, card)).toBeNull();
  // A box with a border is still measured against it, but only once a frame: a new frame
  // lets go of where things were, in case the page has moved.
  card.style.border = "2px solid rgb(9, 9, 9)";
  w.restore(); // (a clean slate: the border is new to it)
  under = [card];
  expect(w.strike(50, 20)).toBeNull(); // the middle of it: no edge, and things inside
  box.mockClear();
  for (let i = 0; i < 20; i++) expect(w.strike(40 + i, 20)).toBeNull();
  expect(box.mock.calls.length).toBe(0); // where the card is was already known
  w.tick();
  expect(w.strike(50, 20)).toBeNull();
  expect(box.mock.calls.length).toBe(1); // looked at again, once
  expect(w.strike(11, 20)).toMatchObject({ kind: "edge" }); // and its edge is still there to be hit
  // What's under a point never includes the game itself.
  const mine = document.body.appendChild(document.createElement("section"));
  const own = new Wreckage(() => mine);
  under = [mine, card];
  expect(own.under(1, 1)).toBe(card);
  under = [card];
  expect(own.under(1, 1)).toBe(card);
  under = [mine];
  expect(own.under(1, 1)).toBeNull();
});
