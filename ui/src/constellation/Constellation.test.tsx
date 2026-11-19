// The memory map: its stars and their names, the panel a star opens and what it can do (pin,
// forget, merge), and what it says when there's nothing to draw.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConfirmHost } from "../components/Confirm.tsx";
import type { GraphNode, MemoryGraph, Why } from "../types.ts";
import { Constellation, placeClass } from "./Constellation.tsx";

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
  expect(map.querySelectorAll(".con-sky line.con-edge.alike")).toHaveLength(1);
  expect(map.querySelectorAll(".con-sky line.con-edge.together")).toHaveLength(1);
  expect(map.querySelectorAll(".con-star.pinned .con-pin")).toHaveLength(1);
  expect(screen.queryByRole("complementary")).toBeNull();
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
