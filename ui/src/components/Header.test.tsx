// The header chips and the Usage card, on a Claude subscription with a plan limit used up
// (the parts a fake-API run can't show), plus the busy chip with several expeditions.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { Usage } from "../panels/Usage.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { hear } from "../bus.ts";
import { ConfirmHost } from "./Confirm.tsx";
import { Header } from "./Header.tsx";
import { readAloud } from "../readaloud.ts";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) posts.push({ path, body: JSON.parse(String(init.body)) }); // what the page sends, not what it reads
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
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

test("the busy chip counts running expeditions and what's queued, and the tab title counts the inbox", () => {
  const store = createFeedStore();
  const S = { ...camp(), queued: [{ id: "q", label: "expedition" }] } as CampState;
  const { rerender } = render(<Header S={S} store={store} conn="live" refresh={() => {}} />);
  expect(screen.getByText("Idle · 1 queued")).toBeTruthy();
  expect(screen.queryByText("$1.50 today")).toBeNull(); // today's spend is in the status chip's menu, not the bar
  fireEvent.click(screen.getByRole("button", { name: /^Idle · 1 queued/ }));
  expect(within(screen.getByRole("menu", { name: "The camp" })).getByText("$1.50 today")).toBeTruthy();
  expect(screen.getByText(/Up to 3 expeditions run at once/)).toBeTruthy();
  expect(screen.queryByText("Live")).toBeNull(); // connected is the normal state: nothing to show
  expect(document.title).toBe("Outpost Mae");

  events(store, { type: "expedition_start", id: "a", task: "One", source: "user" });
  expect(screen.getByText("On expedition · 1 queued")).toBeTruthy();
  events(store,
    { type: "expedition_start", id: "b", task: "Two", source: "user" },
    { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "a" },
    { type: "ask", id: "ask2", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "b" },
  );
  expect(screen.getByText("2 expeditions running · 1 queued")).toBeTruthy();
  // The tab's number is the inbox's (the page works it out once, for every place that shows it).
  rerender(<Header S={S} store={store} conn="live" refresh={() => {}} inbox={{ waiting: 2, fresh: 1, total: 3 }} />);
  expect(document.title).toBe("(3) Outpost Mae");
  rerender(<Header S={S} store={store} conn="live" refresh={() => {}} inbox={{ waiting: 1, fresh: 0, total: 1 }} />);
  expect(document.title).toBe("(1) Outpost Mae");
});

test("the runtime chip switches what runs the crew, after you confirm", async () => {
  const refresh = vi.fn();
  render(<><Header S={onSubscription()} store={createFeedStore()} conn="live" refresh={refresh} /><ConfirmHost /></>);
  expect(screen.getByRole("button", { name: /Plan limit · resets in 30 min/ })).toBeTruthy();
  expect(screen.queryByText("Claude Max")).toBeNull(); // set once, so it's in the status chip's menu
  fireEvent.click(screen.getByRole("button", { name: /^Idle/ }));
  expect(screen.getByText("$1.50 today (est.)")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /Claude Max/ })); });
  expect(screen.getByRole("alertdialog").textContent).toContain("Usage will be billed to your API key.");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch to the API" })); });
  expect(posts).toEqual([{ path: "/api/runtime", body: { runtime: "api" } }]);
  expect(refresh).toHaveBeenCalled();
});

test("a sign-in problem is shown instead of switching", () => {
  const said: unknown[] = [];
  const off = hear((a) => said.push(a));
  const S = camp({ runtime: "claude-code", login: { ok: false, problem: "Claude Code isn't signed in." } });
  render(<Header S={S} store={createFeedStore()} conn="reconnecting" refresh={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "⚠️ Claude Code sign-in" }));
  off();
  expect(said).toEqual([{ do: "tell", text: "Claude Code isn't signed in.", error: true }]);
  expect(posts).toEqual([]);
  expect(screen.getByText("Reconnecting…")).toBeTruthy();
});

test("Usage shows plan usage and the pause, and sends you to Settings for the budget", async () => {
  const refresh = vi.fn();
  const openSettings = vi.fn();
  const { container } = render(<Usage S={onSubscription()} refresh={refresh} onOpenSettings={openSettings} />);
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

test("the Views menu holds Orbit, and is lit while it's open; the trail map and the constellation aren't in the top bar any more", () => {
  const onOrbit = vi.fn(), onBarnstorm = vi.fn();
  const on = { onOrbit, onBarnstorm };
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} {...on} />);
  const views = screen.getByRole("button", { name: "Views" });
  expect(views.classList.contains("on")).toBe(false);
  expect(screen.queryByRole("button", { name: "Orbit" })).toBeNull(); // it has no button of its own in the bar
  fireEvent.click(views);
  const menu = screen.getByRole("menu", { name: "Views" });
  // The trail map is opened from a plan's card, and the constellation is Memory's Map (feed/Feed.tsx, MemoryHome.tsx).
  expect(within(menu).getAllByRole("menuitemcheckbox").map((i) => i.getAttribute("aria-label"))).toEqual(["Orbit"]);
  fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Orbit" }));
  expect(screen.queryByRole("menu", { name: "Views" })).toBeNull(); // picking shuts the menu
  expect([onOrbit, onBarnstorm].map((f) => f.mock.calls.length)).toEqual([1, 0]);
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} {...on} orbit />);
  expect(views.classList.contains("on")).toBe(true);
  fireEvent.click(views);
  expect(screen.getByRole("menuitemcheckbox", { name: "Leave Orbit" }).getAttribute("aria-checked")).toBe("true");
});

test("Barnstorm is the last row of the ··· menu, not in Views", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} onOrbit={() => {}} onBarnstorm={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  expect(screen.queryByRole("menuitemcheckbox", { name: "Barnstorm" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  const rows = [...screen.getByRole("menu", { name: "More" }).querySelectorAll('[role^="menuitem"]')];
  expect(rows[rows.length - 1].getAttribute("aria-label")).toBe("Barnstorm");
});

test("with nothing to open, there's no Views menu", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByRole("button", { name: "Views" })).toBeNull();
});

test("what waits on you is one chip: it says the inbox's count and opens the Inbox, with no list of its own", () => {
  const opened: string[] = [];
  const open = (t: string) => opened.push(t);
  const { rerender } = render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} onOpenActivity={open} inbox={{ waiting: 2, fresh: 1, total: 3 }} />);
  const chip = screen.getByRole("button", { name: "2 waiting on you · 1 new" });
  expect(chip.className).toContain("needs");
  expect(chip.title).toContain("Open the Inbox");
  fireEvent.click(chip);
  expect(opened).toEqual(["inbox"]);
  expect(screen.queryByRole("menu")).toBeNull(); // no menu: the Inbox is the list
  // One thing is the same chip, and the same way in.
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} onOpenActivity={open} inbox={{ waiting: 1, fresh: 0, total: 1 }} />);
  fireEvent.click(screen.getByRole("button", { name: "1 waiting on you" }));
  expect(opened).toEqual(["inbox", "inbox"]);
  // Only news (runs that finished, unread reports): a quiet chip, still opening the Inbox.
  const skills = { ...camp(), skills: [{ name: "a" }], inbox: [{ file: "r.md", unread: true }] } as unknown as CampState;
  rerender(<Header S={skills} store={createFeedStore()} conn="live" refresh={() => {}} onOpenActivity={open} onOpenSettings={() => {}} inbox={{ waiting: 0, fresh: 2, total: 2 }} />);
  const news = screen.getByRole("button", { name: "2 new" });
  expect(news.className).not.toContain("needs");
  expect(news.className).toContain("news");
  fireEvent.click(news);
  expect(opened).toEqual(["inbox", "inbox", "inbox"]);
  // The gear carries no count of its own: the chip is the one number in the bar.
  expect(screen.getByRole("button", { name: "Settings" }).textContent).toBe("");
  // Nothing: no chip.
  rerender(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} onOpenActivity={open} />);
  expect(screen.queryByRole("button", { name: /waiting on you|\d new/ })).toBeNull();
});

test("the title is Outpost, with the outpost's name under it, and the tab says both", () => {
  const meta = document.createElement("meta");
  meta.name = "outpost"; meta.content = "Work";
  document.head.append(meta);
  try {
    render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
    const logo = within(screen.getByRole("heading", { level: 1 })).getByRole("img", { name: "Outpost Work" });
    expect(logo.querySelector(".mae-mark")).toBeTruthy();
    expect(logo.querySelector(".outpost-title")!.textContent).toBe("Outpost");
    expect(logo.querySelector(".outpost-sub")!.textContent).toBe("Work");
    expect(document.title).toBe("Outpost Work");
  } finally { meta.remove(); }
});

test("a rename in the camp's state shows at once, and the page keeps the new name", () => {
  const meta = document.createElement("meta");
  meta.name = "outpost"; meta.content = "Mae";
  document.head.append(meta);
  try {
    const S = { ...camp(), settings: { ...camp().settings, outpost: "Home" } } as CampState;
    render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} />);
    expect(within(screen.getByRole("heading", { level: 1 })).getByRole("img", { name: "Outpost Home" }).querySelector(".outpost-sub")!.textContent).toBe("Home");
    expect(document.title).toBe("Outpost Home");
    expect(meta.content).toBe("Home");
  } finally { meta.remove(); }
});

test("the logo is the kit's mark and the words, with no orb beside it", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  const name = screen.getByRole("heading", { level: 1 });
  const logo = within(name).getByRole("img", { name: "Outpost Mae" });
  const mark = logo.querySelector("svg.mae-mark")!;
  expect([...mark.querySelectorAll("path")].every((p) => [p.getAttribute("fill"), p.parentElement!.getAttribute("stroke")].includes("currentColor"))).toBe(true);
  expect(mark.querySelector("circle.logo-dot")).toBeTruthy(); // the amber centre, coloured by the stylesheet
  expect(name.textContent).toBe("OutpostMae");
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

test("Tour, in the ··· menu, opens the splash page in a new tab", () => {
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  expect(screen.queryByRole("link")).toBeNull(); // nothing beside the name
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  const link = screen.getByRole("menuitem", { name: "Tour" });
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
  fireEvent.click(screen.getByRole("button", { name: "Outpost Mae" }));
  expect(onHome).toHaveBeenCalled();
});

test("on extra-usage credit: the header says so with what's left, and Usage shows the credit row", () => {
  const until = Date.now() + 2 * 3_600_000;
  const S = camp({
    runtime: "claude-code",
    login: { ok: true, plan: "max" },
    limits: [{ type: "seven_day", label: "weekly limit", status: "allowed_warning", utilization: 1, resetsAt: until, seen: Date.now() }],
    skills: [],
    credit: { inUse: true, until, out: false, limit: 50, used: 12.4, left: 37.6, currency: "USD", measured: Date.now() },
  } as Partial<CampState>);
  const opened: string[] = [];
  render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} onOpenActivity={(t) => opened.push(t)} />);
  fireEvent.click(screen.getByRole("button", { name: "💳 On credit · $37.60 left" }));
  expect(opened).toEqual(["usage"]);
  cleanup();
  render(<Usage S={S} refresh={() => {}} />);
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

test("an outpost the star chart started links back to it, from this machine only", () => {
  const S = { ...camp(), settings: { ...camp().settings, chart: "http://127.0.0.1:4700/" } } as CampState;
  const { unmount } = render(<Header S={S} store={createFeedStore()} conn="live" refresh={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "More" })); // it's in the ··· menu
  expect(screen.getByRole("menuitem", { name: "Outposts" }).getAttribute("href")).toBe("http://127.0.0.1:4700/");
  unmount();
  render(<Header S={camp()} store={createFeedStore()} conn="live" refresh={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("menuitem", { name: "Outposts" })).toBeNull();
});
