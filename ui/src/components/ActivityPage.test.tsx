// The Activity page: Usage, Stats, Unasked, Scheduled jobs and the Inbox as tabs, with the
// inbox's unread count on its tab and a way to the limits in Settings.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { ActivityPage } from "./ActivityPage.tsx";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const inbox = [
  { heading: "2026-11-16 08:00 · morning-brief", body: "Where things stand.", seen: false },
  { heading: "2026-11-15 09:00 · digest", body: "Two new pages.", seen: false },
  { heading: "2026-11-14 09:00 · digest", body: "Old news.", seen: true },
];
const camp = (over: object = {}) => ({
  characters: [], skills: [], connectors: [], links: [], jobs: [], inbox, parallel: 3, budgetUsd: null, runtime: "api", login: null, quests: [], spend: { today: 0, week: 0, total: 0 }, limits: [],
  settings: { questsAtOnce: 4, outpost: "Home" }, ...over,
}) as unknown as CampState;

function show(tab: "usage" | "stats" | "unasked" | "jobs" | "inbox", S = camp()) {
  const setTab = vi.fn(), refresh = vi.fn(), onOpenSettings = vi.fn(), onOpenMemory = vi.fn();
  render(<ActivityPage S={S} tab={tab} setTab={setTab} refresh={refresh} onOpenSettings={onOpenSettings} onOpenMemory={onOpenMemory} />);
  return { setTab, refresh, onOpenSettings, onOpenMemory };
}

test("the tabs are Usage, Stats, Unasked, Scheduled jobs and Inbox; the unread ones count on the Inbox tab", () => {
  const { setTab } = show("usage");
  const tabs = within(screen.getByRole("tablist", { name: "Activity" })).getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Usage", "Stats", "Unasked", "Scheduled jobs", "Inbox2"]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.click(tabs[3]);
  expect(setTab).toHaveBeenCalledWith("jobs");
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

test("inbox entries can be marked as read, one at a time or all at once", async () => {
  const { refresh } = show("inbox");
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
