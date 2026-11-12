// The header chips and the Quests card, on a Claude subscription with a plan limit used up
// (the parts a fake-API run can't show), plus the busy chip with several expeditions.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { Quests } from "../panels/Quests.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { Header } from "./Header.tsx";
import type { Need } from "../needs.ts";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) }); // what the page sends, not what it reads
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
  expect(screen.queryByText("Live")).toBeNull(); // connected is the normal state: nothing to show

  events(store, { type: "expedition_start", id: "a", task: "One", source: "user" });
  expect(screen.getByText("On expedition · 1 queued")).toBeTruthy();
  events(store,
    { type: "expedition_start", id: "b", task: "Two", source: "user" },
    { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "a" },
    { type: "ask", id: "ask2", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "b" },
  );
  expect(screen.getByText("2 expeditions running · 1 queued")).toBeTruthy();
  expect(screen.getByRole("button", { name: "2 decisions need you" })).toBeTruthy();
  expect(document.title).toBe("(2) Satchel");

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

test("focus mode: one button closes the panels, and shows when they're closed", () => {
  const onToggleFocus = vi.fn();
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} focused={false} onToggleFocus={onToggleFocus} />);
  const focus = screen.getByRole("button", { name: "Focus mode" });
  expect(focus.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(focus);
  expect(onToggleFocus).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /the terminal/ })).toBeNull(); // the terminal has its own tab now
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} focused onToggleFocus={onToggleFocus} />);
  expect(screen.getByRole("button", { name: "Leave focus mode" }).getAttribute("aria-pressed")).toBe("true");
});

test("what needs you is one chip: several things open a list, and each row goes to its own", () => {
  const onNeed = vi.fn(), onSeenAll = vi.fn();
  const need = (kind: string, conversation: string, title: string, says: string) => ({ key: `${kind}:${conversation}`, kind, conversation, title, says }) as Need;
  const list = [need("decision", "d", "Still going", "Waiting on your decision"), need("pr", "a", "Open button", "Pull request #7: 1 failing check"), need("finished", "c", "Fix the nav", "Finished since you last looked")];
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} needs={list} onNeed={onNeed} onSeenAll={onSeenAll} />);
  const chip = screen.getByRole("button", { name: "2 things need you · 1 finished" });
  expect(chip.className).toContain("needs");
  fireEvent.click(chip);
  const rows = within(screen.getByRole("menu", { name: "What needs you" })).getAllByRole("menuitem");
  expect(rows.map((r) => r.textContent)).toEqual(["Still goingWaiting on your decision", "Open buttonPull request #7: 1 failing check", "Fix the navFinished since you last looked", "Mark what's finished as seen"]);
  fireEvent.click(rows[1]);
  expect(onNeed).toHaveBeenCalledWith(list[1]);
  expect(screen.queryByRole("menu")).toBeNull();
  // One thing: the chip goes straight to it.
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} needs={[list[1]]} onNeed={onNeed} />);
  fireEvent.click(screen.getByRole("button", { name: "1 pull request needs you" }));
  expect(onNeed).toHaveBeenLastCalledWith(list[1]);
  // Only news (runs that finished): a quiet chip, and one click clears it.
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} needs={[list[2], { ...list[2], key: "finished:x" }]} onNeed={onNeed} onSeenAll={onSeenAll} />);
  const news = screen.getByRole("button", { name: "2 finished" });
  expect(news.className).not.toContain("needs");
  fireEvent.click(news);
  fireEvent.click(screen.getByRole("menuitem", { name: "Mark what's finished as seen" }));
  expect(onSeenAll).toHaveBeenCalledTimes(1);
  // Nothing: no chip.
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} needs={[]} onNeed={onNeed} />);
  expect(screen.queryByRole("button", { name: /need/ })).toBeNull();
});

test("the name is the wordmark, drawn in the theme's text colour, with no subtitle beside it", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  const name = screen.getByRole("heading", { level: 1 });
  const mark = within(name).getByRole("img", { name: "Satchel" });
  expect(mark.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
  expect(mark.getAttribute("viewBox")).toBe("36 -656 2633 805");
  expect(mark.querySelector("metadata")).toBeNull(); // the outline only
  expect(screen.queryByText("Mission control")).toBeNull();
  expect(name.textContent).toBe(""); // no emoji, no words: the drawing is the name
});

test("the connection only shows when it's lost or not made yet", () => {
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByTitle(/Connection to the camp/)).toBeNull();
  rerender(<Header S={camp()} store={createFeedStore()} conn="reconnecting" refresh={() => {}} />);
  expect(screen.getByText("Reconnecting…")).toBeTruthy();
  rerender(<Header S={camp()} store={createFeedStore()} conn="connecting" refresh={() => {}} />);
  expect(screen.getByText("Connecting…")).toBeTruthy();
});

test("a Tour link beside the wordmark opens the splash page in a new tab", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  const link = screen.getByRole("link", { name: "Tour" });
  expect(link.getAttribute("href")).toBe("/splash");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});
