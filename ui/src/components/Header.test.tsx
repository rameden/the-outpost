// The header chips and the Quests card, on a Claude subscription with a plan limit used up
// (the parts a fake-API run can't show), plus the busy chip with several expeditions.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { Quests } from "../panels/Quests.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { Header } from "./Header.tsx";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

// Just what these two components read from /api/state.
const camp = (over: Partial<CampState> = {}) => ({
  characters: [], quests: [], queued: [], parallel: 3, limits: [], pausedUntil: null, pauseMessage: null,
  spend: { today: 1.5, week: 4, total: 12 }, budgetUsd: null, runtime: "api", login: null, ...over,
}) as unknown as CampState;

const onSubscription = () => camp({
  runtime: "claude-code",
  login: { ok: true, plan: "max" },
  limits: [
    { type: "five_hour", label: "5-hour window", status: "rejected", utilization: 1, resetsAt: Date.now() + 30 * 60_000, seen: Date.now() },
    { type: "seven_day", label: "weekly window", status: "allowed", utilization: 0.42, seen: Date.now() },
  ],
  pausedUntil: Date.now() + 30 * 60_000,
  pauseMessage: "Your plan's 5-hour window is used up.",
});

function events(store: ReturnType<typeof createFeedStore>, ...bodies: object[]) {
  act(() => {
    bodies.forEach((b, i) => store.apply({ ...b, seq: store.getState().lastSeq + i + 1, time: new Date().toISOString() } as CampEvent));
    vi.advanceTimersByTime(20);
  });
}

test("the busy chip counts running expeditions and what's queued, and the title counts decisions", () => {
  const store = createFeedStore();
  const S = { ...camp(), queued: [{ id: "q", label: "expedition" }] } as CampState;
  render(<Header S={S} store={store} conn="live" refresh={() => {}} />);
  expect(screen.getByText("Idle · 1 queued")).toBeTruthy();
  expect(screen.getByText("$1.50 today")).toBeTruthy();
  expect(screen.getByText("Live")).toBeTruthy();

  events(store, { type: "expedition_start", id: "a", task: "One", source: "user" });
  expect(screen.getByText("On expedition · 1 queued")).toBeTruthy();
  events(store,
    { type: "expedition_start", id: "b", task: "Two", source: "user" },
    { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "a" },
    { type: "ask", id: "ask2", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "b" },
  );
  expect(screen.getByText("2 expeditions running · 1 queued")).toBeTruthy();
  expect(screen.getByRole("button", { name: "2 decisions need you" })).toBeTruthy();
  expect(document.title).toBe("(2) Guild Camp");

  events(store, { type: "answered", id: "ask1", answer: "" });
  expect(screen.getByRole("button", { name: "1 decision needs you" })).toBeTruthy();
});

test("the runtime chip switches what runs the crew, after you confirm", async () => {
  const refresh = vi.fn();
  render(<Header S={onSubscription()} store={createFeedStore()} conn="live" refresh={refresh} />);
  expect(screen.getByText("$1.50 today (est.)")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Plan limit · resets in 30 min/ })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Claude Max" })); });
  expect(confirm).toHaveBeenCalledWith("Switch the crew to the API? Usage will be billed to your API key.");
  expect(posts).toEqual([{ path: "/api/runtime", body: { runtime: "api" } }]);
  expect(refresh).toHaveBeenCalled();
});

test("a sign-in problem is shown instead of switching", () => {
  vi.stubGlobal("alert", vi.fn());
  const S = camp({ runtime: "claude-code", login: { ok: false, problem: "Claude Code isn't signed in." } });
  render(<Header S={S} store={createFeedStore()} conn="reconnecting" refresh={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "⚠️ Claude Code sign-in" }));
  expect(alert).toHaveBeenCalledWith("Claude Code isn't signed in.");
  expect(posts).toEqual([]);
  expect(screen.getByText("Reconnecting…")).toBeTruthy();
});

test("Quests shows plan usage and the pause, and sends you to Settings for the budget", async () => {
  const refresh = vi.fn();
  const openSettings = vi.fn();
  const { container } = render(<Quests S={onSubscription()} refresh={refresh} onOpenSettings={openSettings} />);
  expect(screen.getByText("5-hour window")).toBeTruthy();
  expect(screen.getByText("used up · resets in 30 min")).toBeTruthy();
  expect(screen.getByText("42% used")).toBeTruthy();
  expect(container.querySelector(".meter.full")).toBeTruthy();
  expect(screen.getByText(/Your plan's 5-hour window is used up\. Queued work and scheduled jobs wait/)).toBeTruthy();
  expect(screen.getByText("No budget · up to 3 at once")).toBeTruthy();

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try anyway" })); });
  fireEvent.click(screen.getByRole("button", { name: "Change limits" }));
  expect(posts).toEqual([{ path: "/api/limits/resume", body: {} }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(openSettings).toHaveBeenCalled();
});
