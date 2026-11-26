// The Activity page: Usage, Stats, Automatic work, Scheduled jobs and the Inbox as tabs, with the
// inbox's count on its tab (the number the header and the sidebar show) and ways into Settings.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import type { InboxCount } from "../inbox.ts";
import type { CampState } from "../types.ts";
import { ActivityPage, activityTabs } from "./ActivityPage.tsx";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) });
    if (String(path).startsWith("/api/home")) return new Response(JSON.stringify(home), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const home = { name: "Ryley", today: "2026-11-16", brief: null, days: [], board: { weeks: [] }, offers: [], held: [], retros: [],
  drive: { brief: true, briefAt: "08:00", retro: true, debrief: false }, pulls: { count: 0 } };
const inbox = [
  { heading: "2026-11-16 08:00 · morning-brief", body: "Where things stand.", seen: false },
  { heading: "2026-11-15 09:00 · digest", body: "Two new pages.", seen: false },
  { heading: "2026-11-14 09:00 · digest", body: "Old news.", seen: true },
];
const camp = (over: object = {}) => ({
  characters: [], skills: [], connectors: [], links: [], jobs: [], inbox, parallel: 3, budgetUsd: null, runtime: "api", login: null, quests: [], spend: { today: 0, week: 0, total: 0 }, limits: [],
  settings: { questsAtOnce: 4, outpost: "Home", prWatch: true }, history: { conversations: [], projects: [] }, queued: [], running: [], memoryProposals: [], triggers: [], ...over,
}) as unknown as CampState;

function show(tab: "usage" | "stats" | "unasked" | "jobs" | "inbox", S = camp(), count: InboxCount = { waiting: 0, fresh: 2, total: 2 }) {
  const setTab = vi.fn(), refresh = vi.fn(), onOpenSettings = vi.fn(), setView = vi.fn(), onSeenAll = vi.fn(), onStartTicket = vi.fn();
  render(<ActivityPage S={S} store={createFeedStore()} tab={tab} setTab={setTab} refresh={refresh} onOpenSettings={onOpenSettings} setView={setView} inbox={count} onSeenAll={onSeenAll} onStartTicket={onStartTicket} />);
  return { setTab, refresh, onOpenSettings, setView, onSeenAll };
}

test("the tabs are Usage, Stats, Automatic work, Scheduled jobs and Inbox; the Inbox tab carries the inbox's count", () => {
  const { setTab } = show("usage", camp(), { waiting: 3, fresh: 2, total: 5 });
  const tabs = within(screen.getByRole("tablist", { name: "Activity" })).getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Usage", "Stats", "Automatic work", "Scheduled jobs", "Inbox5"]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.click(tabs[3]);
  expect(setTab).toHaveBeenCalledWith("jobs");
  expect(screen.getByText(/what's waiting on you\.$/)).toBeTruthy();
  // With nothing in the inbox the tab has no number.
  expect(activityTabs().map((t) => [t.id, t.label, t.count ?? 0])).toEqual([["usage", "Usage", 0], ["stats", "Stats", 0], ["unasked", "Automatic work", 0], ["jobs", "Scheduled jobs", 0], ["inbox", "Inbox", 0]]);
  expect(activityTabs(4).at(-1)!.count).toBe(4);
});

test("Automatic work says what's on and off, and sends you to Settings to change it", async () => {
  const { onOpenSettings } = show("unasked");
  const list = await screen.findByRole("list", { name: "Automatic work" });
  expect(within(list).getAllByRole("listitem").map((l) => l.textContent).slice(0, 3)).toEqual(["Morning briefOn, at 08:00", "AI news in the briefOff", "Weekly retroOn"]);
  expect(screen.getByRole("tabpanel", { name: "Automatic work" })).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Settings, Automatic work" }));
  expect(onOpenSettings).toHaveBeenCalledWith("automatic");
});

test("the arrow keys move along the tabs", () => {
  const { setTab } = show("usage");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Usage" }), { key: "ArrowRight" });
  expect(setTab).toHaveBeenLastCalledWith("stats");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Usage" }), { key: "ArrowLeft" });
  expect(setTab).toHaveBeenLastCalledWith("inbox");
});

test("Usage links to the limits in Settings, where they're changed", () => {
  const { onOpenSettings } = show("usage");
  expect(screen.getByText("No budget · up to 3 at once")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Change limits" }));
  expect(onOpenSettings).toHaveBeenCalledWith("limits");
});

test("the Inbox tab is the Inbox: its count in a sentence, and reports that can be marked as read, one at a time or all at once", async () => {
  const { refresh } = show("inbox");
  expect(screen.getByRole("status").textContent).toBe("2 new. Everything that waits on you is listed here, and this is where you answer it.");
  expect(screen.getByRole("region", { name: "Reports" })).toBeTruthy();
  expect(screen.getByText("2 unread")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "Mark as read" });
  expect(buttons).toHaveLength(2); // the read one has none
  await act(async () => { fireEvent.click(buttons[0]); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark all as read" })); });
  expect(posts).toEqual([
    { path: "/api/inbox/seen", body: { heading: "2026-11-16 08:00 · morning-brief" } },
    { path: "/api/inbox/seen", body: { all: true } },
  ]);
  expect(refresh).toHaveBeenCalledTimes(2);
});
