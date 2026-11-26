// The Memory page: List (the lines and the wiki together), Map (opens the constellation) and By member.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function show(tab: "list" | "map" | "member", over: { member?: string; page?: string } = {}) {
  const setView = vi.fn(), onOpenMap = vi.fn(), onOpenSettings = vi.fn();
  render(<MemoryHome S={S} tab={tab} setView={setView} refresh={vi.fn()} onOpenMap={onOpenMap} onOpenSettings={onOpenSettings} {...over} />);
  return { setView, onOpenMap, onOpenSettings };
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

test("Map: a way into the full-screen constellation", () => {
  const { onOpenMap } = show("map");
  fireEvent.click(screen.getByRole("button", { name: "Open the map" }));
  expect(onOpenMap).toHaveBeenCalledTimes(1);
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
