// The header chips and the Quests card, on a Claude subscription with a plan limit used up
// (the parts a fake-API run can't show), plus the busy chip with several expeditions.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { Quests } from "../panels/Quests.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { Header } from "./Header.tsx";
import type { Need } from "../needs.ts";
import { readAloud } from "../readaloud.ts";

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
  expect(screen.queryByText("$1.50 today")).toBeNull(); // today's spend is in the status chip's menu, not the bar
  fireEvent.click(screen.getByRole("button", { name: /^Idle · 1 queued/ }));
  expect(within(screen.getByRole("menu", { name: "The camp" })).getByText("$1.50 today")).toBeTruthy();
  expect(screen.getByText(/Up to 3 expeditions run at once/)).toBeTruthy();
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
  expect(document.title).toBe("(2) Mae, My Alter Ego");

  events(store, { type: "answered", id: "ask1", answer: "" });
  expect(screen.getByRole("button", { name: "1 decision needs you" })).toBeTruthy();
});

test("the runtime chip switches what runs the crew, after you confirm", async () => {
  const refresh = vi.fn();
  render(<Header S={onSubscription()} store={createFeedStore()} conn="live" refresh={refresh} />);
  expect(screen.getByRole("button", { name: /Plan limit · resets in 30 min/ })).toBeTruthy();
  expect(screen.queryByText("Claude Max")).toBeNull(); // set once, so it's in the status chip's menu
  fireEvent.click(screen.getByRole("button", { name: /^Idle/ }));
  expect(screen.getByText("$1.50 today (est.)")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /Claude Max/ })); });
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
  fireEvent.click(screen.getByRole("button", { name: "More" })); // it's in the ··· menu
  const focus = screen.getByRole("menuitemcheckbox", { name: "Focus mode" });
  expect(focus.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(focus);
  expect(onToggleFocus).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu", { name: "More" })).toBeNull(); // picking shuts the menu
  expect(screen.queryByRole("button", { name: /the terminal/ })).toBeNull(); // the terminal has its own tab now
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} focused onToggleFocus={onToggleFocus} />);
  const more = screen.getByRole("button", { name: "More" });
  expect(more.className).toContain("on"); // lit while focus is on
  fireEvent.click(more);
  expect(screen.getByRole("menuitemcheckbox", { name: "Focus mode" }).getAttribute("aria-checked")).toBe("true");
});

test("the Arcade menu holds Orbit, the trail map, the constellation and Barnstorm, and is lit while one is open", () => {
  const onOrbit = vi.fn(), onTrail = vi.fn(), onConstellation = vi.fn(), onBarnstorm = vi.fn();
  const on = { onOrbit, onTrail, onConstellation, onBarnstorm };
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} {...on} />);
  const arcade = screen.getByRole("button", { name: "Arcade" });
  expect(arcade.classList.contains("on")).toBe(false);
  expect(screen.queryByRole("button", { name: "Orbit" })).toBeNull(); // none of them has a button of its own in the bar
  fireEvent.click(arcade);
  const menu = screen.getByRole("menu", { name: "Arcade" });
  expect(within(menu).getAllByRole("menuitemcheckbox").map((i) => i.getAttribute("aria-label"))).toEqual(["Orbit", "Trail map", "Constellation", "Barnstorm"]);
  fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Constellation" }));
  expect(onConstellation).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu", { name: "Arcade" })).toBeNull(); // picking shuts the menu
  fireEvent.click(arcade);
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Trail map" }));
  fireEvent.click(arcade);
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Orbit" }));
  expect([onOrbit, onTrail, onBarnstorm].map((f) => f.mock.calls.length)).toEqual([1, 1, 0]);
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} {...on} constellation />);
  expect(arcade.classList.contains("on")).toBe(true);
  fireEvent.click(arcade);
  expect(screen.getByRole("menuitemcheckbox", { name: "Leave the constellation" }).getAttribute("aria-checked")).toBe("true");
});

test("with nothing to open, there's no Arcade menu", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByRole("button", { name: "Arcade" })).toBeNull();
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

test("the name is the logo kit's logo, with no subtitle and no orb beside it", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  const name = screen.getByRole("heading", { level: 1 });
  // The logo is one drawing, the mark and the name, in the colour of the text around it (the kit's ink for the theme), read as "Mae".
  const logo = within(name).getByRole("img", { name: "Mae" });
  expect([...logo.querySelectorAll("path")].every((p) => [p.getAttribute("fill"), p.parentElement!.getAttribute("stroke")].includes("currentColor"))).toBe(true);
  expect(logo.querySelector("circle.logo-dot")).toBeTruthy(); // the amber centre, coloured by the stylesheet
  expect(name.textContent).toBe(""); // no words beside the drawing
  expect(screen.queryByText("Mission control")).toBeNull();
  // The header has the static logo only: the orb is the sign-in page's.
  expect(document.querySelector(".mae-orb")).toBeNull();
  expect(logo.hasAttribute("style")).toBe(false); // the page allows no inline styles
});

test("the connection only shows when it's lost or not made yet", () => {
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByTitle(/Connection to the camp/)).toBeNull();
  rerender(<Header S={camp()} store={createFeedStore()} conn="reconnecting" refresh={() => {}} />);
  expect(screen.getByText("Reconnecting…")).toBeTruthy();
  rerender(<Header S={camp()} store={createFeedStore()} conn="connecting" refresh={() => {}} />);
  expect(screen.getByText("Connecting…")).toBeTruthy();
});

test("a Tour link beside the name opens the splash page in a new tab", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  const link = screen.getByRole("link", { name: "Tour" });
  expect(link.getAttribute("href")).toBe("/splash");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});

test("the connection chip: quiet while live, and after a long outage it says the camp isn't running and what to do", () => {
  const store = createFeedStore();
  const refresh = vi.fn();
  const { rerender } = render(<Header S={camp()} store={store} conn="live" refresh={refresh} />);
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<Header S={camp()} store={store} conn="reconnecting" refresh={refresh} />);
  expect(screen.getByRole("status").textContent).toBe("Reconnecting…");
  rerender(<Header S={camp()} store={store} conn="offline" refresh={refresh} />);
  expect(screen.getByRole("status").textContent).toBe("The camp isn't running. Start it again, or reopen the link it prints in the terminal.");
  // Connected, but the panels' last reload failed: a chip says so, and a click tries again.
  rerender(<Header S={camp()} store={store} conn="live" stale refresh={refresh} />);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Out of date · retry" }));
  expect(refresh).toHaveBeenCalledTimes(1);
  // While the stream is down that's the news; the stale chip waits its turn.
  rerender(<Header S={camp()} store={store} conn="reconnecting" stale refresh={refresh} />);
  expect(screen.queryByRole("button", { name: "Out of date · retry" })).toBeNull();
});

test("the logo is the way home: it opens Today", () => {
  const onHome = vi.fn();
  render(<Header S={null} store={createFeedStore()} conn="live" refresh={() => {}} onHome={onHome} />);
  fireEvent.click(screen.getByRole("button", { name: "Mae" }));
  expect(onHome).toHaveBeenCalled();
});

test("on extra-usage credit: the header says so with what's left, and Quests shows the credit row", () => {
  const until = Date.now() + 2 * 3_600_000;
  const S = camp({
    runtime: "claude-code",
    login: { ok: true, plan: "max" },
    limits: [{ type: "seven_day", label: "weekly limit", status: "allowed_warning", utilization: 1, resetsAt: until, seen: Date.now() }],
    skills: [],
    credit: { inUse: true, until, out: false, limit: 50, used: 12.4, left: 37.6, currency: "USD", measured: Date.now() },
  } as Partial<CampState>);
  const opened: string[] = [];
  render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onOpenSettings={(s) => opened.push(String(s))} />);
  fireEvent.click(screen.getByRole("button", { name: "💳 On credit · $37.60 left" }));
  expect(opened).toEqual(["usage"]);
  cleanup();
  render(<Quests S={S} refresh={() => {}} />);
  expect(screen.getByText("Extra usage (credit)")).toBeTruthy();
  expect(screen.getByText("$37.60 left of $50.00")).toBeTruthy();
  expect(screen.getByText(/carrying on with credit until it resets in/)).toBeTruthy();
  // Not on credit: no chip, but the row still says what's left.
  cleanup();
  const idle = { ...S, credit: { ...S.credit!, inUse: false, until: null } } as CampState;
  render(<Header S={idle} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByText(/On credit/)).toBeNull();
});

test("what's being read aloud has its controls in the bar, just before the status chip", async () => {
  vi.stubGlobal("Audio", class { src = ""; playbackRate = 1; onended = null; onerror = null; play() { return Promise.resolve(); } pause() {} removeAttribute() {} });
  URL.createObjectURL = vi.fn(() => "blob:speech");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["mp3"]))));
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByRole("region", { name: "Reading aloud" })).toBeNull();
  act(() => readAloud("Three runs, two quests.", { what: "Debrief" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  const bar = screen.getByRole("region", { name: "Reading aloud" });
  expect(bar.textContent).toContain("Debrief");
  expect(bar.nextElementSibling?.querySelector(".chip-status")).toBeTruthy();
  fireEvent.click(within(bar).getByRole("button", { name: "Stop reading" }));
  expect(screen.queryByRole("region", { name: "Reading aloud" })).toBeNull();
});
