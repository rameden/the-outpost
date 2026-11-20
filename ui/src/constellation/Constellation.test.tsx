// The memory map: its stars and their names, the panel a star opens and what it can do (pin,
// forget, merge), and what it says when there's nothing to draw.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConfirmHost } from "../components/Confirm.tsx";
import type { GraphNode, MemoryGraph, Why } from "../types.ts";
import { Constellation, labelAngle, placeClass, placeSays } from "./Constellation.tsx";
import { BULB, CLEFT, fibre } from "./Synapse.tsx";

const node = (id: string, where: GraphNode["where"], place: string, text: string, more: Partial<GraphNode> = {}): GraphNode =>
  ({ id, where, place, kind: where === "about" ? "about" : where.startsWith("project:") ? "project" : "agent", text, pinned: false, recalls: 0, ...more });
const british = node("m1", "agent:scribe", "Scribe's memory", "Use British spelling", { date: "2026-01-02", recalls: 3, lastRecalled: "2026-03-04T09:00:00.000Z", lastThread: { id: "t7", title: "Fix the docs" }, origin: { how: "remember", run: "r1", thread: "t1", title: "Write the release notes" } });
const docs = node("m2", "agent:scribe", "Scribe's memory", "Use British spelling in docs", { date: "2026-01-05" });
const emoji = node("m3", "agent:scribe", "Scribe's memory", "No emoji in headings", { pinned: true });
const sources = node("m4", "agent:scout", "Scout's memory", "Cite the source of every figure", { recalls: 1, lastRecalled: "2026-03-01T09:00:00.000Z" });
const zone = node("m5", "about", "About you", "Eastern time");
const full: MemoryGraph = { nodes: [british, docs, emoji, sources, zone], since: "2026-03-01T09:00:00.000Z",
  edges: [{ a: "m1", b: "m2", kind: "alike", weight: 0.6 }, { a: "m1", b: "m4", kind: "together", weight: 2 }] };
const history: Why[] = [{ time: "2026-03-04T09:00:00.000Z", how: "relevant", score: 2.4, run: "r7", thread: "t7", title: "Fix the docs" }, { time: "2026-03-02T09:00:00.000Z", how: "recall" }];

let graph: MemoryGraph = full;
let answer: (path: string, body: any) => Response | undefined = () => undefined;
const calls: { path: string; body?: any }[] = [];
beforeEach(() => {
  graph = full; calls.length = 0; answer = () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(body === undefined ? { path } : { path, body });
    const said = answer(path, body);
    if (said) return said;
    if (path.startsWith("/api/memory/graph")) return new Response(JSON.stringify(graph));
    if (path.startsWith("/api/memory/why")) return new Response(JSON.stringify({ history }));
    return new Response(JSON.stringify({ ok: true }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = () => {
  const on = { onClose: vi.fn(), onOpenConversation: vi.fn(), onOpenMemory: vi.fn() };
  render(<><Constellation {...on} /><ConfirmHost /></>);
  return on;
};
const posts = () => calls.filter((c) => c.body !== undefined);
const star = (name: RegExp) => screen.findByRole("button", { name });

test("every line is a star you can reach and read by name, and the map says when its history starts", async () => {
  open();
  const map = screen.getByRole("dialog", { name: /^Memory constellation/ });
  expect(within(map).getByRole("status").textContent).toBe("Reading the memory…");
  const s = await star(/^Use British spelling Scribe's memory\. Recalled 3 times\.$/);
  expect(s.getAttribute("tabindex")).toBe("0");
  expect(s.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "No emoji in headings Scribe's memory. Pinned. Not recalled yet." })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cite the source of every figure Scout's memory. Recalled 1 time." })).toBeTruthy();
  expect(screen.getByText("5 lines in 3 places")).toBeTruthy();
  expect(screen.getByText(/^Recall history starts on .*2026/)).toBeTruthy();
  // A crew member's stars wear their colour by id; the note about you and a project's notes have their own.
  expect(s.classList.contains("c-scribe")).toBe(true);
  expect(s.classList.contains("used")).toBe(true);
  expect(placeClass("about")).toBe("con-about");
  expect(placeClass("project:atlas")).toBe("con-project");
  expect(placeClass("agent:warden")).toBe("c-warden");
  // The two kinds of join are drawn apart, and a pinned star is ringed.
  expect(map.querySelectorAll(".con-sky .con-edge.alike")).toHaveLength(1);
  expect(map.querySelectorAll(".con-sky .con-edge.together")).toHaveLength(1);
  expect(map.querySelectorAll(".con-star.pinned .con-pin")).toHaveLength(1);
  expect(screen.queryByRole("complementary")).toBeNull();
});

test("each place says, under its name, how many lines it holds, how many are pinned and how often they were used", async () => {
  open();
  await star(/^Use British spelling Scribe's memory/);
  const says = [...document.querySelectorAll(".con-place")].map((g) => [...g.querySelectorAll("text:not(.orb-emoji)")].map((t) => t.textContent));
  expect(says).toEqual([
    ["Scribe's memory", "3 lines · 1 pinned · recalled 3 times"],
    ["Scout's memory", "1 line · recalled 1 time"],
    ["About you", "1 line · not recalled yet"],
  ]);
  expect(placeSays([])).toBe("0 lines · not recalled yet");
});

test("it stands on Orbit's sky: the same sheets of stars, each place an open contour line with its owner's mark on it", async () => {
  open();
  await star(/^Use British spelling Scribe's memory/);
  expect(document.querySelectorAll(".constellation > .orb-stars")).toHaveLength(3);
  const places = [...document.querySelectorAll(".con-place")];
  // No filled disc any more: one line that wanders as Orbit's do.
  expect(places.map((g) => [g.querySelectorAll(":scope > circle").length, g.querySelectorAll("path.con-line").length])).toEqual([[0, 1], [0, 1], [0, 1]]);
  expect(places[0].querySelector("path.con-line")!.getAttribute("d")).toMatch(/^M[\d.]+ 0\.0L.+Z$/);
  // On the line, whoever the place belongs to, as Orbit draws them: a crew member's planet (halo, disc, their mark); the note about you, which Orbit has no mark for, its first letter.
  expect(places.map((g) => [g.querySelectorAll(".con-badge .orb-halo, .con-badge .orb-disc").length, g.querySelectorAll(".orb-mark path").length, g.querySelector(".orb-emoji")?.textContent ?? ""])).toEqual([[2, 2, ""], [2, 3, ""], [2, 0, "A"]]);
  expect(places.map((g) => g.classList.contains("c-scribe") || g.classList.contains("c-scout") || g.classList.contains("con-about"))).toEqual([true, true, true]);
});

test("the Quartermaster's place carries Orbit's sun, and a project (which Orbit has no mark for) its emoji", async () => {
  graph = { nodes: [node("q1", "agent:quartermaster", "Quartermaster's memory", "Plan before dispatching"), node("p1", "project:atlas", "Atlas", "Ships on Fridays", { emoji: "🗺️" })], edges: [] };
  open();
  await star(/^Plan before dispatching/);
  const [lead, atlas] = [...document.querySelectorAll(".con-place")];
  expect([lead.querySelectorAll(".con-sun .orb-sun-core").length, lead.querySelectorAll(".con-sun .orb-sun-dial circle").length, lead.querySelectorAll(".orb-disc").length]).toEqual([1, 2, 0]);
  expect([atlas.querySelectorAll(".orb-disc").length, atlas.querySelector(".orb-emoji")!.textContent]).toEqual([1, "🗺️"]);
  // The name stands alone above: the icon on the line is the only one.
  expect([...atlas.querySelectorAll("text:not(.orb-emoji)")].map((t) => t.textContent)).toEqual(["Atlas", "1 line · not recalled yet"]);
});

test("a join is a nerve fibre: a curve that stops short of each star, with a bulb at each end, and the same every time", () => {
  const a = { x: 0, y: 0, r: 5 }, b = { x: 100, y: 0, r: 10 };
  const f = fibre(a, b, "alike m1 m2");
  expect(f.from).toEqual([5 + CLEFT, 0]);
  expect(f.to).toEqual([100 - 10 - CLEFT, 0]);
  expect(f.d).toMatch(/^M8\.0 0\.0C[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ 87\.0 0\.0$/);
  expect(fibre(a, b, "alike m1 m2").d).toBe(f.d);
  expect(fibre(a, b, "together m1 m4").d).not.toBe(f.d);
  // It bows off the straight line, but never far.
  const [, y1, , y2] = f.d.slice(f.d.indexOf("C") + 1).split(" ").map(Number);
  expect(Math.max(Math.abs(y1), Math.abs(y2))).toBeGreaterThan(0);
  expect(Math.max(Math.abs(y1), Math.abs(y2))).toBeLessThanOrEqual(26);
  // Two stars that overlap: there's no room for a gap, so it runs centre to centre.
  expect(fibre(a, { x: 8, y: 0, r: 10 }, "x").d).toMatch(/^M0\.0 0\.0C.+ 8\.0 0\.0$/);
  expect(BULB).toBeLessThan(CLEFT);
});

test("joins on the map: lines used together carry beads, and the picked star's joins fire out from it", async () => {
  open();
  const joins = () => [...document.querySelectorAll(".con-sky .con-edge")];
  await star(/^Use British spelling Scribe's memory/);
  expect(joins().map((g) => [g.querySelectorAll("path.con-fibre").length, g.querySelectorAll("circle.con-bulb").length, g.querySelectorAll(".con-beads").length, g.querySelectorAll(".con-pulse").length]))
    .toEqual([[1, 2, 0, 0], [1, 2, 1, 0]]);
  // The scout's line is the far end of its one join: the pulse runs back along it, away from the picked star.
  fireEvent.click(await star(/^Cite the source/));
  expect(joins().map((g) => [g.classList.contains("on"), g.querySelector(".con-pulse")?.classList.contains("back") ?? null])).toEqual([[false, null], [true, true]]);
  fireEvent.click(await star(/^Use British spelling Scribe's memory/));
  expect(joins().map((g) => [g.classList.contains("on"), g.querySelector(".con-pulse")?.classList.contains("back") ?? null])).toEqual([[true, false], [true, false]]);
  // The key at the foot shows the two kinds the same way.
  expect([...document.querySelectorAll(".con-key .con-edge")].map((g) => g.querySelectorAll(".con-beads").length)).toEqual([0, 1]);
});

const withRuns: MemoryGraph = { ...full, runs: [
  { id: "r9", time: "2026-03-04T09:00:00.000Z", lines: ["m1", "m4"], thread: { id: "t7", title: "Fix the docs" } },
  { id: "r8", time: "2026-03-03T09:00:00.000Z", lines: ["m3"], thread: { id: "t8" } },
  { id: "r7", time: "2026-03-01T09:00:00.000Z", lines: ["m1", "gone"] },
] };
const dimmed = () => [...document.querySelectorAll(".con-star.dim title")].map((t) => t.textContent);

test("the runs that used memory are listed down the side: pick one and only its lines stay lit, pick more and theirs join them", async () => {
  graph = withRuns;
  const on = open();
  const runs = await screen.findByRole("complementary", { name: "Runs that used memory" });
  const rows = within(runs).getAllByRole("button", { pressed: false });
  expect(rows.map((b) => b.querySelector("b")!.textContent)).toEqual(["Fix the docs", "An untitled conversation", "A run with no conversation"]);
  expect(rows.map((b) => b.textContent!.replace(/^.*· /, ""))).toEqual(["2 lines", "1 line", "2 lines"]);
  expect([...rows[0].querySelectorAll(".con-dot")].map((d) => d.className)).toEqual(["con-dot c-scribe", "con-dot c-scout"]); // a dot for each place its lines live in
  expect(document.querySelector(".constellation")!.classList.contains("isolating")).toBe(false);
  expect(dimmed()).toEqual([]);

  fireEvent.click(rows[0]);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(".constellation")!.classList.contains("isolating")).toBe(true);
  expect(dimmed()).toEqual(["Use British spelling in docs", "No emoji in headings", "Eastern time"]);
  expect(screen.getByText("2 of 5 lines, used by 1 run")).toBeTruthy();
  // A join is lit only when both its ends are; a place with none of the run's lines steps back.
  expect([...document.querySelectorAll(".con-sky .con-edge")].map((e) => e.classList.contains("dim"))).toEqual([true, false]);
  expect([...document.querySelectorAll(".con-place")].map((g) => g.classList.contains("dim"))).toEqual([false, false, true]);

  fireEvent.click(rows[1]);
  expect(dimmed()).toEqual(["Use British spelling in docs", "Eastern time"]);
  expect(screen.getByText("3 of 5 lines, used by 2 runs")).toBeTruthy();
  fireEvent.click(rows[0]); // let the first go
  expect(dimmed()).toEqual(["Use British spelling", "Use British spelling in docs", "Cite the source of every figure", "Eastern time"]);

  // Show all, or Esc, brings the whole map back; only then does Esc close it.
  fireEvent.click(within(runs).getByRole("button", { name: "Show all" }));
  expect(dimmed()).toEqual([]);
  expect(within(runs).queryByRole("button", { name: "Show all" })).toBeNull();
  fireEvent.click(rows[2]);
  expect(dimmed()).toHaveLength(4); // (a line that's gone since isn't counted)
  expect(screen.getByText("1 of 5 lines, used by 1 run")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(dimmed()).toEqual([]);
  expect(on.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(on.onClose).toHaveBeenCalledTimes(1);
});

test("the runs can be put away and brought back (the Runs button, or R), and say so when no run has used a line", async () => {
  graph = withRuns;
  open();
  const runs = await screen.findByRole("complementary", { name: "Runs that used memory" });
  const button = screen.getByRole("button", { name: "Runs" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(runs).getByRole("button", { name: /Fix the docs/ }));
  fireEvent.click(within(runs).getByRole("button", { name: "Hide the runs" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(dimmed()).toHaveLength(3); // what you picked stays picked while the list is away
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "r" });
  expect(within(screen.getByRole("complementary")).getByRole("button", { name: /Fix the docs/ }).getAttribute("aria-pressed")).toBe("true");
  cleanup();

  // With no runs on record the list starts closed, and says why it's empty when it's opened.
  graph = full;
  open();
  await star(/^Use British spelling Scribe's memory/);
  expect(screen.queryByRole("complementary")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Runs" }));
  expect(within(screen.getByRole("complementary")).getByText(/No run has used a line that's on the map yet/)).toBeTruthy();
});

test("a new log says recall history starts filling in from now", async () => {
  graph = { nodes: [zone], edges: [] };
  open();
  await star(/^Eastern time/);
  expect(screen.getByText("1 line in 1 place")).toBeTruthy();
  expect(screen.getByText("Recall history starts filling in from now: a star grows each time its line is used.")).toBeTruthy();
});

test("picking a star opens its panel: the line, where it came from, when it was used, and its neighbours", async () => {
  const on = open();
  fireEvent.click(await star(/^Use British spelling Scribe/));
  const panel = within(screen.getByRole("complementary", { name: "The line you picked" }));
  expect(panel.getByRole("heading", { name: "Scribe's memory" })).toBeTruthy();
  expect(panel.getByText("Use British spelling")).toBeTruthy();
  expect(panel.getByText("2026-01-02")).toBeTruthy();
  expect(panel.getByText(/the crew noted it/)).toBeTruthy();
  expect(panel.getByText(/^Recalled 3 times, last on /)).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: "Write the release notes" }));
  expect(on.onOpenConversation).toHaveBeenLastCalledWith("t1");
  // Its history is asked for by place and line, and comes newest first.
  await waitFor(() => expect(panel.getByText("Found with recall")).toBeTruthy());
  expect(calls.some((c) => c.path === "/api/memory/why?where=agent%3Ascribe&line=Use%20British%20spelling")).toBe(true);
  expect([...document.querySelectorAll(".con-history li")].map((li) => li.querySelector("span")!.textContent)).toEqual(["Loaded: it bore on the request · 2.4", "Found with recall"]);
  // The joined lines are listed, and one of them takes you to its star.
  expect(panel.getByRole("heading", { name: "Lines like it" })).toBeTruthy();
  expect(panel.getByRole("heading", { name: "Used with it" })).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: /^Cite the source of every figure/ }));
  expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "Scout's memory" })).toBeTruthy();
  expect((await star(/^Cite the source/)).getAttribute("aria-pressed")).toBe("true");
  // Esc steps back: first off the star, then out of the map.
  const map = screen.getByRole("dialog", { name: /^Memory constellation/ });
  fireEvent.keyDown(map, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(on.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(map, { key: "Escape" });
  expect(on.onClose).toHaveBeenCalledTimes(1);
});

test("a star opens from the keyboard, and focus alone picks it", async () => {
  open();
  const s = await star(/^Use British spelling in docs/);
  fireEvent.focus(s);
  expect(within(screen.getByRole("complementary")).getByText("Use British spelling in docs")).toBeTruthy();
  expect(within(screen.getByRole("complementary")).getByText("Not recalled yet")).toBeTruthy();
  const other = await star(/^No emoji in headings/);
  fireEvent.keyDown(other, { key: "Enter" });
  expect(within(screen.getByRole("complementary")).getByText("No emoji in headings")).toBeTruthy();
});

test("pinning and unpinning a line, and no pin for the note about you", async () => {
  open();
  fireEvent.click(await star(/^Use British spelling Scribe/));
  graph = { ...full, nodes: full.nodes.map((n) => (n.id === "m1" ? { ...n, pinned: true } : n)) };
  fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(posts().at(-1)).toEqual({ path: "/api/memory/pin", body: { where: "agent:scribe", line: "Use British spelling", on: true } }));
  // The map is read again, and the star and its panel now say it's pinned.
  fireEvent.click(await within(screen.getByRole("complementary")).findByRole("button", { name: "Unpin" }));
  await waitFor(() => expect(posts().at(-1)).toEqual({ path: "/api/memory/pin", body: { where: "agent:scribe", line: "Use British spelling", on: false } }));
  expect(screen.getByRole("button", { name: /^Use British spelling Scribe's memory\. Pinned\./ })).toBeTruthy();
  fireEvent.click(await star(/^Eastern time/));
  const you = within(screen.getByRole("complementary"));
  expect(you.queryByRole("button", { name: "Pin" })).toBeNull();
  expect(you.getByRole("button", { name: "Forget" })).toBeTruthy();
  // What the camp refuses is said in the panel.
  answer = (path) => (path === "/api/memory/pin" ? new Response(JSON.stringify({ error: "That line isn't there any more." }), { status: 400 }) : undefined);
  fireEvent.click(await star(/^Use British spelling in docs/));
  fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Pin" }));
  expect((await within(screen.getByRole("complementary")).findByRole("alert")).textContent).toBe("That line isn't there any more.");
});

test("forgetting a line asks first, and takes its star off the map", async () => {
  open();
  fireEvent.click(await star(/^Use British spelling in docs/));
  fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Forget" }));
  let sure = within(await screen.findByRole("alertdialog"));
  expect(sure.getByText("Forget this line?")).toBeTruthy();
  fireEvent.click(sure.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(posts()).toEqual([]);
  fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Forget" }));
  sure = within(await screen.findByRole("alertdialog"));
  graph = { ...full, nodes: full.nodes.filter((n) => n.id !== "m2"), edges: full.edges.filter((e) => e.b !== "m2") };
  fireEvent.click(sure.getByRole("button", { name: "Forget" }));
  await waitFor(() => expect(posts().at(-1)).toEqual({ path: "/api/memory/forget", body: { where: "agent:scribe", line: "Use British spelling in docs" } }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Use British spelling in docs/ })).toBeNull());
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.getByText("4 lines in 3 places")).toBeTruthy();
});

test("merging: pick a second star of the same place, and the draft waits on the Memory page", async () => {
  const on = open();
  fireEvent.click(await star(/^Use British spelling Scribe/));
  const panel = () => within(screen.getByRole("complementary"));
  fireEvent.click(panel().getByRole("button", { name: "Merge with…" }));
  expect(panel().getByRole("button", { name: "Merge with…" }).getAttribute("aria-pressed")).toBe("true");
  expect(panel().getByText(/Merge with which line\?/)).toBeTruthy();
  // Only the other lines of that place can be picked: the rest step back.
  const far = await star(/^Cite the source/);
  expect(far.getAttribute("aria-disabled")).toBe("true");
  expect(far.getAttribute("tabindex")).toBe("-1");
  fireEvent.click(far);
  expect(posts()).toEqual([]);
  expect(panel().getByRole("heading", { name: "Scribe's memory" })).toBeTruthy();
  answer = (path) => (path === "/api/memory/merge" ? new Response(JSON.stringify({ ok: true, proposal: { id: "p9", kind: "merge", text: "Use British spelling, in docs too" } })) : undefined);
  fireEvent.click(await star(/^Use British spelling in docs Scribe/));
  await waitFor(() => expect(posts().at(-1)).toEqual({ path: "/api/memory/merge", body: { where: "agent:scribe", a: "Use British spelling", b: "Use British spelling in docs" } }));
  expect(await panel().findByText("Use British spelling, in docs too")).toBeTruthy();
  expect(panel().getByText(/Nothing has changed yet/)).toBeTruthy();
  fireEvent.click(panel().getByRole("button", { name: "Review it" }));
  expect(on.onOpenMemory).toHaveBeenCalledTimes(1);
});

test("merging from the panel's list, stepping back out of it, and a draft that can't be written", async () => {
  const on = open();
  fireEvent.click(await star(/^Use British spelling Scribe/));
  const panel = () => within(screen.getByRole("complementary"));
  fireEvent.click(panel().getByRole("button", { name: "Merge with…" }));
  // Esc leaves the picking, not the star.
  fireEvent.keyDown(screen.getByRole("dialog", { name: /^Memory constellation/ }), { key: "Escape" });
  expect(panel().queryByText(/Merge with which line\?/)).toBeNull();
  expect(on.onClose).not.toHaveBeenCalled();
  fireEvent.click(panel().getByRole("button", { name: "Merge with…" }));
  answer = (path) => (path === "/api/memory/merge" ? new Response(JSON.stringify({ error: "The draft couldn't be written just now." }), { status: 500 }) : undefined);
  fireEvent.click(panel().getByRole("button", { name: "No emoji in headings" }));
  await waitFor(() => expect(posts().at(-1)).toEqual({ path: "/api/memory/merge", body: { where: "agent:scribe", a: "Use British spelling", b: "No emoji in headings" } }));
  expect((await panel().findByRole("alert")).textContent).toBe("The draft couldn't be written just now.");
  // A place with one line has nothing to merge it with.
  fireEvent.click(await star(/^Eastern time/));
  fireEvent.click(panel().getByRole("button", { name: "Merge with…" }));
  expect(panel().getByText("There's no other line in About you to merge it with.")).toBeTruthy();
});

test("nothing remembered yet: the map says so, plainly", async () => {
  graph = { nodes: [], edges: [] };
  const on = open();
  expect(await screen.findByText("Nothing's remembered yet")).toBeTruthy();
  expect(screen.getByText(/it appears here as a star/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Recalled|Not recalled/ })).toBeNull();
  expect(screen.queryByText(/Recall history/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close the map" }));
  expect(on.onClose).toHaveBeenCalledTimes(1);
});

test("a map that can't be read says why, and can be tried again", async () => {
  answer = (path) => (path.startsWith("/api/memory/graph") ? new Response(JSON.stringify({ error: "The camp isn't answering." }), { status: 500 }) : undefined);
  open();
  expect((await screen.findByRole("alert")).textContent).toMatch(/The camp isn't answering\./);
  answer = () => undefined;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await star(/^Eastern time/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the tools move the map without moving a star", async () => {
  open();
  const s = await star(/^Eastern time/);
  const world = () => screen.getByRole("dialog", { name: /^Memory constellation/ }).querySelector("svg.con-sky > g")!.getAttribute("transform")!;
  const at = s.getAttribute("transform"), before = world();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  const closer = world();
  expect(closer).not.toBe(before);
  fireEvent.keyDown(screen.getByRole("dialog", { name: /^Memory constellation/ }), { key: "ArrowLeft" });
  expect(world()).not.toBe(closer);
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(world()).toBe(before);
  expect(s.getAttribute("transform")).toBe(at);
});

test("a place's owner and name sit on the side of its line that faces out of the map", () => {
  const deg = (c: { x: number; y: number }) => Math.round((labelAngle(c, 200) * 180) / Math.PI);
  expect(deg({ x: 0, y: -200 })).toBe(-90);   // at the top: on top
  expect(deg({ x: 0, y: 0 })).toBe(-90);      // the only place: on top
  expect(deg({ x: 120, y: 200 })).toBe(90);   // below the middle: underneath
  expect(deg({ x: -300, y: 60 })).toBe(90);
  expect(deg({ x: 100, y: -100 })).toBe(-45); // above it and to the right: leaning right
  expect(deg({ x: 320, y: 0 })).toBe(-35);    // at the right-hand end: as far round as a name goes
  expect(deg({ x: -320, y: -10 })).toBe(-145);
});

test("on the map, a place's line starts where its owner sits, and a name below the middle is under its owner", async () => {
  const low = [0, 1, 2, 3].flatMap((p) => [0, 1, 2].map((i) => node(`z${p}${i}`, `project:z${p}`, `Project ${p}`, `Line ${p} ${i}`)));
  graph = { ...full, nodes: low, edges: [], runs: [] };
  open();
  await waitFor(() => expect(document.querySelectorAll(".con-place")).toHaveLength(4));
  const at = (g: Element) => { const [x, y] = g.querySelector(".con-badge")!.getAttribute("transform")!.match(/-?[\d.]+/g)!.map(Number); return { x, y, name: Number(g.querySelector("text:not(.orb-emoji)")!.getAttribute("y")), turn: Number(g.querySelector(".con-line")!.getAttribute("transform")!.match(/rotate\((-?[\d.]+)\)/)![1]) }; };
  const all = [...document.querySelectorAll(".con-place")].map(at);
  // Four alike, clockwise from the top: two above the middle (their names over them), two below (their names under them, their lines turned to start at the bottom).
  expect(all.map((p) => Math.sign(p.name - p.y))).toEqual([-1, 1, 1, -1]);
  expect(all.map((p) => p.turn === 90)).toEqual([false, true, true, false]);
});
