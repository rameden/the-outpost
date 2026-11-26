// The Memory page: List (the lines and the wiki together), Map (the constellation, drawn in the page) and By member.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { CampState, MemoryPlace } from "../types.ts";
import { MemoryHome } from "./MemoryHome.tsx";

afterEach(cleanup);

const about: MemoryPlace = { where: "about", name: "About you", kind: "about", size: 10, limit: 2500, unloaded: 0, other: 0, raw: "", lines: [{ text: "Eastern time", loaded: true }] };
const scribe: MemoryPlace = { where: "agent:scribe", name: "Scribe's memory", kind: "agent", size: 20, limit: 5000, unloaded: 0, other: 0, lines: [{ text: "British spelling", loaded: true }] };
const scout: MemoryPlace = { where: "agent:scout", name: "Scout's memory", kind: "agent", size: 20, limit: 5000, unloaded: 0, other: 0, lines: [{ text: "Cite sources", loaded: true }] };
const S = {
  characters: [{ id: "scout", name: "Scout" }, { id: "scribe", name: "Scribe" }],
  memory: [about, scribe, scout], memoryProposals: [],
  wiki: [{ section: "facts", path: "camp/wiki/facts/release-process.md", summary: "How releases go out.", updated: "2026-11-02" }],
  settings: { memoryCare: { tidy: true, suggest: false } },
} as unknown as CampState;

function show(tab: "list" | "map" | "member", over: { member?: string; page?: string; mapFull?: boolean } = {}) {
  const setView = vi.fn(), onMapFull = vi.fn(), onOpenConversation = vi.fn(), onOpenSettings = vi.fn();
  render(<MemoryHome S={S} tab={tab} setView={setView} refresh={vi.fn()} onMapFull={onMapFull} onOpenConversation={onOpenConversation} onOpenSettings={onOpenSettings} {...over} />);
  return { setView, onMapFull, onOpenConversation, onOpenSettings };
}

test("List: the lines of every place and the wiki's pages, in one page", () => {
  const { setView } = show("list");
  expect(within(screen.getByRole("tablist", { name: "Memory" })).getAllByRole("tab").map((t) => t.textContent)).toEqual(["List", "Map", "By member"]);
  expect(screen.getByRole("region", { name: "About you" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Scribe's memory" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Scout's memory" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /release-process/ }));
  expect(setView).toHaveBeenCalledWith({ kind: "memory", tab: "list", page: "camp/wiki/facts/release-process.md" });
});

test("Map: the constellation is drawn in the page, goes over the whole page when asked, and its draft to review is on List", async () => {
  const star = (id: string, text: string) => ({ id, where: "agent:scribe", place: "Scribe's memory", kind: "agent", text, pinned: false, recalls: 0, origin: { how: "remember", run: "r1", thread: "t1", title: "Write the release notes" } });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify(
    path.startsWith("/api/memory/graph") ? { nodes: [star("m1", "British spelling"), star("m2", "British spelling in docs")], edges: [] }
      : path === "/api/memory/merge" ? { ok: true, proposal: { id: "p1", kind: "merge", text: "British spelling, in docs too" } }
      : { history: [] }))));
  const { setView, onMapFull, onOpenConversation } = show("map");
  expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");
  // No way in to click any more: the map itself is here, as a part of the page (not a dialog).
  const map = await screen.findByRole("region", { name: /^Memory constellation/ });
  expect(screen.queryByRole("button", { name: "Open the map" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(await within(map).findByRole("button", { name: /^British spelling Scribe's memory/ }));
  const panel = () => within(within(map).getByRole("complementary", { name: "The line you picked" }));
  fireEvent.click(panel().getByRole("button", { name: "Write the release notes" }));
  expect(onOpenConversation).toHaveBeenCalledWith("t1");
  fireEvent.click(panel().getByRole("button", { name: "Merge with…" }));
  fireEvent.click(panel().getByRole("button", { name: "British spelling in docs" }));
  fireEvent.click(await panel().findByRole("button", { name: "Review it" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "memory", tab: "list" });
  fireEvent.click(within(map).getByRole("button", { name: "Full screen" }));
  expect(onMapFull).toHaveBeenLastCalledWith(true);
  cleanup();

  // Over the whole page (the app holds that: /constellation opens it so) it's a dialog, and leaving it is asked of the app.
  const again = show("map", { mapFull: true });
  const over = await screen.findByRole("dialog", { name: /^Memory constellation/ });
  await waitFor(() => expect(within(over).getByRole("button", { name: "Leave full screen" })).toBeTruthy());
  fireEvent.click(within(over).getByRole("button", { name: "Leave full screen" }));
  expect(again.onMapFull).toHaveBeenLastCalledWith(false);
  vi.unstubAllGlobals();
});

test("the map is only drawn on Map: List and By member don't fetch it", () => {
  const fetched = vi.fn(async (_path: string) => new Response("{}"));
  vi.stubGlobal("fetch", fetched);
  show("list");
  expect(screen.queryByRole("region", { name: /^Memory constellation/ })).toBeNull();
  cleanup();
  show("member");
  expect(screen.queryByRole("region", { name: /^Memory constellation/ })).toBeNull();
  expect(fetched.mock.calls.filter(([path]) => String(path).startsWith("/api/memory/graph"))).toEqual([]);
  vi.unstubAllGlobals();
});

test("By member: one member's memory, picked from the crew, and the first member when none is named", () => {
  const { setView } = show("member", { member: "scribe" });
  expect(screen.getByRole("region", { name: "Scribe's memory" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Scout's memory" })).toBeNull();
  expect(screen.queryByRole("region", { name: "About you" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Crew member" }), { target: { value: "scout" } });
  expect(setView).toHaveBeenCalledWith({ kind: "memory", tab: "member", member: "scout" });
  cleanup();
  show("member");
  expect(screen.getByRole("region", { name: "Scout's memory" })).toBeTruthy();
});

test("switching to By member carries a member with it; Settings is a click away", () => {
  const { setView, onOpenSettings } = show("list");
  fireEvent.click(screen.getByRole("tab", { name: "By member" }));
  expect(setView).toHaveBeenCalledWith({ kind: "memory", tab: "member", member: "scout" });
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  expect(onOpenSettings).toHaveBeenCalled();
});

test("a wiki page being read takes the page, and Back returns to the list", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "---\nsummary: x\n---\nBody" }))));
  const { setView } = show("list", { page: "camp/wiki/facts/release-process.md" });
  fireEvent.click(screen.getByRole("button", { name: "← All pages" }));
  expect(setView).toHaveBeenCalledWith({ kind: "memory", tab: "list" });
  vi.unstubAllGlobals();
});
