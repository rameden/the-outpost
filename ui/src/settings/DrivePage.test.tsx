// Two pages of Settings: the week in numbers, and the switches for what the camp does unasked.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { CampState, HomePage, WeekScore } from "../types.ts";
import { AutomaticPage, AutomaticSummary, StatsPage, shownWeek } from "./DrivePage.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const week = (over: Partial<WeekScore> = {}): WeekScore => ({
  week: "2026-11-09", label: "Nov 9 to Nov 15, 2026", requests: 12, byMae: 1, conversations: 3,
  kinds: { work: 5, feedback: 3, writeup: 3, goahead: 1, question: 0, review: 0 }, operating: 58, perTicket: 10,
  crew: [{ who: "Quartermaster", runs: 9, seconds: 4000 }, { who: "Artificer", runs: 6, seconds: 3000 }], seconds: 5400, cost: 12.5, finished: 96,
  prs: { opened: 2, merged: 1, rounds: 2, hoursToMerge: 72 }, ratings: { up: 1, down: 0 }, ...over,
});
const page = (over: Partial<HomePage> = {}): HomePage => ({
  name: "Ryley", today: "2026-11-13", brief: null, days: [],
  board: { weeks: [week({ week: "2026-11-02", label: "Nov 2 to Nov 8, 2026", requests: 20, operating: 70, byMae: 0 }), week()] },
  offers: [{ key: "github-pr:web", what: "Watch your pull requests in links/web", why: "In the last two weeks: 3 times you brought a pull request's review comments to the crew yourself.",
    trigger: { name: "my-pull-requests-web", kind: "github-pr", link: "web", describe: false, project: "p1" } }],
  held: [], retros: [{ project: "p1", name: "web", week: "2026-11-09", label: "Nov 9 to Nov 15, 2026", written: "2026-11-13T20:00:00.000Z", requests: 12, heard: 4, proposed: ["Sign every commit."], skill: "scribe/release-notes" }],
  drive: { brief: true, briefAt: "08:00", retro: false, debrief: false }, pulls: { fetched: "2026-11-13T12:55:00.000Z", count: 2 }, ...over,
});
const S = (over: Record<string, unknown> = {}) => ({
  history: { projects: [{ id: "general", name: "General" }, { id: "p1", name: "web" }], conversations: [] },
  settings: { prWatch: true }, triggers: [], ...over,
}) as unknown as CampState;

function camp(answers: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${init.body}` : ""}`);
    const hit = Object.keys(answers).find((k) => String(url).startsWith(k));
    return new Response(JSON.stringify(hit ? answers[hit] : { error: "Not found" }), { status: hit ? 200 : 404 });
  }));
  return asked;
}

test("the week whose numbers are shown is this one once it has anything in it, otherwise the last that had", () => {
  const quiet = week({ week: "2026-11-16", requests: 0, byMae: 0 });
  expect(shownWeek([week(), quiet])?.week.week).toBe("2026-11-09"); // Monday morning: last week's
  expect(shownWeek([quiet])).toBeNull();
});

test("Stats: the week in headline numbers, ranked bars, and every week as a table; one project's on request", async () => {
  const asked = camp({ "/api/home": page() });
  render(<StatsPage S={S()} />);
  expect(await screen.findByText("The week of Nov 9 to Nov 15, 2026")).toBeTruthy();
  const tile = (label: string) => screen.getAllByText(label)[0].parentElement!.textContent; // (the table below names some of the same things)
  expect(tile("Requests you typed")).toBe("Requests you typed12down from 20 the week before");
  expect(tile("Spent operating")).toBe("Spent operating58%down from 70% the week before");
  expect(tile("Pull requests merged")).toBe("Pull requests merged12 rounds of review, 72 h open");
  expect(tile("Crew time")).toBe("Crew time1.5 h$12.50 at API prices");
  const asks = within(screen.getByText("What you asked for").parentElement!).getAllByRole("listitem").map((r) => r.textContent);
  expect(asks).toEqual(["Building and changing5", "Bringing in review feedback3", "Asking for a write-up3", "Saying “go ahead”1"]); // largest first; a kind with none isn't listed
  expect(within(screen.getByText("Who did the work").parentElement!).getAllByRole("listitem")[0].getAttribute("title")).toBe("Quartermaster: 9 runs (60%)");
  const rows = within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent);
  expect(rows).toEqual(["Week ofYou typedOperatingStarted by MaeMergedCrew timeUsed", "Nov 9 to Nov 151258%111.5 h$12.50", "Nov 2 to Nov 82070%011.5 h$12.50"]); // newest first
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "p1" } });
  await waitFor(() => expect(asked).toContain("GET /api/home?project=p1"));
  cleanup();

  camp({ "/api/home": page({ board: { weeks: [week({ requests: 0, byMae: 0 })] } }) });
  render(<StatsPage S={S()} />);
  expect(await screen.findByText(/there's nothing to count yet/)).toBeTruthy();
});

test("Automatic work: the brief and its time, the retro, the watch on your pull requests, and the trigger that turns feedback into work", async () => {
  const asked = camp({ "/api/home": page(), "/api/drive": { ok: true }, "/api/brief": {}, "/api/retro": {}, "/api/pr-watch": { ok: true }, "/api/triggers": { ok: true } });
  const refresh = vi.fn(), onOpenSection = vi.fn();
  const trigger = { name: "my-prs", kind: "github-pr", link: "web", describe: true, enabled: true, task: "x", created: "", seen: 2 };
  render(<AutomaticPage S={S({ triggers: [trigger, { ...trigger, name: "issues", kind: "github-issue" }] })} refresh={refresh} onOpenSection={onOpenSection} />);
  const row = async (name: string) => (await screen.findByText(name)).closest(".set-row") as HTMLElement;

  const brief = await row("Morning brief");
  expect(within(brief).getByLabelText("When the morning brief is written").getAttribute("value")).toBe("08:00");
  fireEvent.change(within(brief).getByLabelText("When the morning brief is written"), { target: { value: "07:30" } });
  await waitFor(() => expect(asked).toContain('POST /api/drive {"briefAt":"07:30"}'));
  fireEvent.click(within(brief).getByRole("checkbox"));
  await waitFor(() => expect(asked).toContain('POST /api/drive {"brief":false}'));
  fireEvent.click(within(brief).getByRole("button", { name: "Write one now" }));
  await waitFor(() => expect(asked).toContain("POST /api/brief {}"));

  const retro = await row("Weekly retro");
  expect(retro.textContent).toMatch(/read 12 requests and 4 reviewer comments, and proposed 1 thing to keep/);
  fireEvent.click(within(retro).getByRole("button", { name: "Look them over" }));
  expect(onOpenSection).toHaveBeenLastCalledWith("memory");
  expect(retro.textContent).toMatch(/It drafted a how-to, scribe\/release-notes, for work you kept asking for/);
  fireEvent.click(within(retro).getByRole("button", { name: "Review the draft" }));
  expect(onOpenSection).toHaveBeenLastCalledWith("skills");
  fireEvent.click(within(retro).getByRole("checkbox"));
  await waitFor(() => expect(asked).toContain('POST /api/drive {"retro":true}'));
  fireEvent.click(within(retro).getByRole("button", { name: "Hold web's now" }));
  await waitFor(() => expect(asked).toContain('POST /api/retro {"id":"p1"}'));

  const debrief = await row("Ticket debrief");
  fireEvent.click(within(debrief).getByRole("checkbox"));
  await waitFor(() => expect(asked).toContain('POST /api/drive {"debrief":true}'));

  const watch = await row("Your pull requests");
  expect(watch.textContent).toMatch(/2 open\./);
  fireEvent.click(within(watch).getByRole("checkbox"));
  await waitFor(() => expect(asked).toContain('POST /api/pr-watch {"on":false}'));

  const work = await row("Feedback on a pull request starts work");
  expect(within(work).getAllByRole("listitem").map((l) => l.textContent)).toEqual([expect.stringContaining("my-prslinks/web · descriptions kept current")]); // only the pull-request ones
  fireEvent.click(within(within(work).getByRole("listitem")).getByRole("checkbox"));
  await waitFor(() => expect(asked).toContain('POST /api/triggers {"name":"my-prs","action":"disable"}'));
  fireEvent.click(within(work).getByRole("button", { name: "Turn it on" }));
  await waitFor(() => expect(asked).toContain('POST /api/triggers {"action":"add","trigger":{"name":"my-pull-requests-web","kind":"github-pr","link":"web","describe":false,"project":"p1"}}'));
  fireEvent.click(within(work).getByRole("button", { name: "Scheduled jobs" }));
  expect(onOpenSection).toHaveBeenLastCalledWith("jobs");
  expect(refresh).toHaveBeenCalled();
});

test("Night shift: off until you switch it on, with its hours, a run on request and a line on the last night", async () => {
  const asked = camp({ "/api/home": page(), "/api/drive": { ok: true }, "/api/night": { ok: true } });
  render(<AutomaticPage S={S()} refresh={vi.fn()} onOpenSection={vi.fn()} />);
  const row = (await screen.findByText("Night shift")).closest(".set-row") as HTMLElement;
  // It says plainly what it will and won't do.
  expect(row.textContent).toMatch(/It only drafts and reports: nothing is applied, deleted or changed until you approve it\./);
  expect(row.textContent).toMatch(/at most three small model calls a night, and waits while your usage limit is used up/);
  expect((within(row).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(within(row).queryByLabelText("When the night shift may start")).toBeNull(); // no hours to set while it's off
  expect(row.textContent).not.toMatch(/Last night shift/);
  fireEvent.click(within(row).getByRole("checkbox"));
  await waitFor(() => expect(asked).toContain('POST /api/drive {"night":true}'));
  fireEvent.click(within(row).getByRole("button", { name: "Run it now" }));
  await waitFor(() => expect(asked).toContain("POST /api/night {}"));
  // It comes after the ticket debrief, as its own row.
  const titles = [...document.querySelectorAll(".set-row .set-label > b")].map((b) => b.textContent);
  expect(titles.indexOf("Night shift")).toBe(titles.indexOf("Ticket debrief") + 1);
});

test("Night shift, switched on: its two times can be changed, and the last night is summed up in a line", async () => {
  const on = page();
  const asked = camp({ "/api/home": { ...on, drive: { ...on.drive, night: true, nightFrom: "23:00", nightTo: "05:30" }, lastNight: { day: "2026-11-12", finished: "2026-11-13T02:10:00.000Z", line: "Drafted shorter versions of 2 memories, listed 5 old lines worth a look." } }, "/api/drive": { ok: true } });
  render(<AutomaticPage S={S()} refresh={vi.fn()} onOpenSection={vi.fn()} />);
  const row = (await screen.findByText("Night shift")).closest(".set-row") as HTMLElement;
  expect((within(row).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  const from = within(row).getByLabelText("When the night shift may start") as HTMLInputElement, to = within(row).getByLabelText("When the night shift stops") as HTMLInputElement;
  expect([from.value, to.value]).toEqual(["23:00", "05:30"]);
  fireEvent.change(from, { target: { value: "00:30" } });
  await waitFor(() => expect(asked).toContain('POST /api/drive {"nightFrom":"00:30"}'));
  fireEvent.change(to, { target: { value: "04:00" } });
  await waitFor(() => expect(asked).toContain('POST /api/drive {"nightTo":"04:00"}'));
  expect(row.textContent).toMatch(/Last night shift, .+: Drafted shorter versions of 2 memories, listed 5 old lines worth a look\./);
});

test("Automatic work: each row says what it does in one line, and keeps the rest under How it works, closed until asked for", async () => {
  camp({ "/api/home": page() });
  render(<AutomaticPage S={S()} refresh={vi.fn()} onOpenSection={vi.fn()} />);
  const brief = (await screen.findByText("Morning brief")).closest(".set-row") as HTMLElement;
  expect(within(brief).getByText("Each weekday, where your work stands: what's waiting on you, your tickets and your latest notes.")).toBeTruthy();
  const more = brief.querySelector("details.set-more") as HTMLDetailsElement;
  expect(more.open).toBe(false);
  expect(more.querySelector("summary")!.textContent).toBe("How it works");
  expect(more.textContent).toMatch(/no model is called/);
  // Every row has both: the line, and the longer account.
  const rows = [...document.querySelectorAll(".unasked-page .set-row")];
  expect(rows.map((r) => r.querySelector(".set-label > b")!.textContent)).toEqual(["Morning brief", "AI news in the brief", "Weekly retro", "Ticket debrief", "Night shift", "Your pull requests", "Feedback on a pull request starts work"]);
  for (const r of rows) {
    expect(r.querySelector(".set-label > p")!.textContent!.length).toBeGreaterThan(20);
    expect(r.querySelectorAll("details.set-more > summary")).toHaveLength(1);
    expect((r.querySelector("details.set-more") as HTMLDetailsElement).open).toBe(false);
  }
  expect(screen.getByText(/^What the camp does before you ask/).textContent).toMatch(/nothing is kept or sent until you approve it\.$/);
});

test("Activity's Automatic work: what's on and what's off, read-only, with the way to its switches in Settings", async () => {
  const on = page();
  on.drive = { ...on.drive, night: true, nightFrom: "02:00", nightTo: "04:30" };
  const asked = camp({ "/api/home": on });
  const onOpen = vi.fn();
  const trigger = { name: "my-prs", kind: "github-pr", link: "web", describe: true, enabled: true, task: "x", created: "", seen: 2 };
  const { unmount } = render(<AutomaticSummary S={S({ triggers: [trigger, { ...trigger, name: "off", enabled: false }, { ...trigger, name: "issues", kind: "github-issue" }] })} onOpen={onOpen} />);
  const list = await screen.findByRole("list", { name: "Automatic work" });
  expect(within(list).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
    "Morning briefOn, at 08:00", "AI news in the briefOff", "Weekly retroOff", "Ticket debriefOff", "Night shiftOn, from 02:00 to 04:30", "Your pull requestsWatching",
    "Feedback on a pull request starts workOn for 1 repository"]);
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Settings, Automatic work" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(asked.filter((a) => a.startsWith("POST"))).toEqual([]);
  unmount();

  // With the brief off, its news has no line; nothing watched and no trigger say so.
  const off = page();
  off.drive = { ...off.drive, brief: false };
  camp({ "/api/home": off });
  render(<AutomaticSummary S={S({ settings: { prWatch: false } })} onOpen={onOpen} />);
  const quiet = await screen.findByRole("list", { name: "Automatic work" });
  expect(within(quiet).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
    "Morning briefOff", "Weekly retroOff", "Ticket debriefOff", "Night shiftOff", "Your pull requestsNot watching", "Feedback on a pull request starts workOff"]);
});
