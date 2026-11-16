// Today, the page the camp opens on: a greeting and where things stand in a few sentences, then
// the brief as rows with one next step each: tickets, what's upcoming, your notes.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Brief, CampState, HomePage } from "../types.ts";
import { Home, greeting, kickoff } from "./Home.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const brief: Brief = {
  day: "2026-11-13", written: "2026-11-13T13:00:00.000Z", since: "2026-11-12T13:00:00.000Z",
  needs: [
    { kind: "pull", title: "#7 MP-544: Open button", says: "changes requested, 1 open comment thread", url: "https://github.com/acme/web/pull/7", conversation: "c1", act: { do: "address", url: "https://github.com/acme/web/pull/7" } },
    { kind: "run", title: "Fix the flaky date test", says: "Ended as stopped", conversation: "c2", act: { do: "resume", run: "run-9" } },
  ],
  moving: [{ kind: "pull", title: "#9 In review", says: "waiting for review", url: "https://github.com/acme/web/pull/9" }],
  tickets: [{ kind: "ticket", title: "MP-544 Open button", says: "In Progress · pull request #7 changes requested", url: "https://x.atlassian.net/browse/MP-544", conversation: "c1" }],
  next: [{ kind: "ticket", title: "MP-1 Next up", says: "To Do · High", url: "https://x.atlassian.net/browse/MP-1", act: { do: "start", jira: "MP-1" } },
    { kind: "job", title: "wiki-digest", says: "Runs by itself, weekdays 08:00" }],
  yourNotes: [{ id: "note01", title: "Share rules", text: "Ask Ana about the share password rules.", updated: "2026-11-12T15:00:00.000Z" }],
  done: { finished: [{ conversation: "c1", title: "Open button", runs: 2 }], merged: [{ title: "#6 Merged one", url: "https://github.com/acme/web/pull/6" }], requests: 5, byMae: 1, cost: 2.5 },
  waiting: { memory: 2, skills: 0 }, notes: [],
};
const page = (over: Partial<HomePage> = {}): HomePage => ({
  name: "Ryley", today: "2026-11-13", brief, days: ["2026-11-13", "2026-11-12"], board: { weeks: [] },
  offers: [{ key: "github-pr:web", what: "Watch your pull requests in links/web", why: "In the last two weeks: 3 times you brought a pull request's review comments to the crew yourself.",
    trigger: { name: "my-pull-requests-web", kind: "github-pr", link: "web", describe: false, project: "p1" } }],
  held: [], retros: [], drive: { brief: true, briefAt: "08:00", retro: true }, pulls: { fetched: "2026-11-13T12:55:00.000Z", count: 2 }, ...over,
});
const S = {
  history: { projects: [{ id: "general", name: "General" }, { id: "p1", name: "web" }],
    conversations: [
      { id: "c2", title: "Fix the flaky date test", project: "p1", updated: "2026-11-13T12:00:00.000Z", status: "stopped", expeditions: ["run-9"] },
      { id: "c1", title: "Open button", project: "p1", jira: "MP-544", updated: "2026-11-12T12:00:00.000Z", status: "done", expeditions: ["run-1"] },
    ] },
  memoryProposals: [], triggers: [],
} as unknown as CampState;

// The camp's answers, by path; every request is noted as "METHOD path body".
function camp(answers: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${init.body}` : ""}`);
    const hit = Object.keys(answers).find((k) => String(url).startsWith(k));
    return new Response(JSON.stringify(hit ? answers[hit] : { error: "Not found" }), { status: hit ? 200 : 404 });
  }));
  return asked;
}
const show = (over: Partial<Parameters<typeof Home>[0]> = {}) => {
  const props = { S, setView: vi.fn(), onStartTicket: vi.fn(), onOpenNote: vi.fn(), onOpenMemory: vi.fn(), ...over };
  render(<Home {...props} />);
  return props;
};

test("it greets you by the clock, and says where things stand the way you'd say it", () => {
  expect(greeting(new Date(2026, 10, 13, 8), "Ryley")).toBe("Good morning, Ryley.");
  expect(greeting(new Date(2026, 10, 13, 14))).toBe("Good afternoon.");
  expect(greeting(new Date(2026, 10, 13, 21), "Ryley")).toBe("Good evening, Ryley.");
  expect(kickoff(brief)).toBe("Two things are waiting on you, starting with #7 MP-544: Open button (changes requested, 1 open comment thread). One pull request is with reviewers. " +
    "You're in the middle of one ticket. MP-1 Next up is next up. Since last time, one conversation had work finish and one pull request merged.");
  expect(kickoff({ ...brief, needs: [brief.needs[1]], moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } })).toBe("One thing is waiting on you: Fix the flaky date test (ended as stopped).");
  expect(kickoff({ ...brief, needs: [], moving: [], tickets: [], next: [brief.next[1]], done: { ...brief.done, finished: [], merged: [] } })).toBe("Nothing is waiting on you. A good day to start something.");
});

test("the page opens with the greeting and where you left off; each line of the brief carries its one next step", async () => {
  const asked = camp({ "/api/home": page(), "/api/pulls/address": { ok: true, id: "run-20", thread: "c1" }, "/api/send": { ok: true, id: "run-21", thread: "c2" } });
  const props = show();
  expect(await screen.findByRole("heading", { name: /^Good (morning|afternoon|evening), Ryley\.$/ })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/^Two things are waiting on you, starting with #7 MP-544: Open button/);
  expect(asked[0]).toBe("GET /api/home");

  const left = screen.getByText("Where you left off").closest("section")!;
  expect(left.textContent).toContain("Fix the flaky date test");
  fireEvent.click(within(left).getByRole("button", { name: "Pick it back up" }));
  expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c2" });
  // The one you left off at isn't repeated under Recent work.
  expect(within(screen.getByText("Recent work").closest("section")!).getAllByRole("listitem").map((r) => r.textContent)).toEqual([expect.stringContaining("Open button")]);

  const needs = screen.getByText("Waiting on you · 2").closest("section")!;
  expect(within(needs).getByRole("link", { name: "Open #7 MP-544: Open button in a new tab" }).getAttribute("href")).toBe("https://github.com/acme/web/pull/7");
  fireEvent.click(within(needs).getByRole("button", { name: "Address it" }));
  await waitFor(() => expect(props.setView).toHaveBeenCalledWith({ kind: "conversation", id: "c1" }));
  expect(asked).toContain('POST /api/pulls/address {"url":"https://github.com/acme/web/pull/7"}');
  fireEvent.click(within(needs).getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(asked).toContain('POST /api/send {"resume":"run-9"}'));
  expect(within(screen.getByText("In motion · 1").closest("section")!).queryByRole("button", { name: /Address|Resume|Start/ })).toBeNull();
});

test("plans you approved to start later wait on Home, and Start carries on their conversation", async () => {
  expect(kickoff({ ...brief, needs: [], moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } }, 2)).toBe("Two plans you approved are ready to start when you are.");
  expect(kickoff({ ...brief, needs: [brief.needs[1]], moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } }, 1))
    .toBe("One thing is waiting on you: Fix the flaky date test (ended as stopped). One plan you approved is ready to start when you are.");

  const held = [{ ask: "ask_7", conversation: "c3", title: "Migrate the settings page", project: "p1", held: "2026-11-13T09:00:00.000Z", plan: "1. Artificer moves it\n2. Warden reviews", steps: 2 }];
  const asked = camp({ "/api/home": page({ held }), "/api/send": { ok: true, id: "run-30", thread: "c3" } });
  const props = show();
  const ready = (await screen.findByText("Ready to start · 1")).closest("section")!;
  expect(ready.textContent).toContain("Migrate the settings page");
  expect(ready.textContent).toContain("2 steps · web · approved");
  expect(within(ready).getByText(/Warden reviews/)).toBeTruthy(); // the plan, folded under its line
  expect(screen.getByRole("status").textContent).toMatch(/One plan you approved is ready to start when you are\./);
  fireEvent.click(within(ready).getByRole("button", { name: "Migrate the settings page" }));
  expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c3" });
  fireEvent.click(within(ready).getByRole("button", { name: "Start plan" }));
  await waitFor(() => expect(asked).toContain('POST /api/send {"start":"ask_7"}'));
  await waitFor(() => expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c3" }));
});

test("your tickets, what's upcoming and your notes are part of it; the numbers and the switches live in Settings, not here", async () => {
  camp({ "/api/home": page() });
  const props = show();
  const tickets = (await screen.findByText("Your tickets · 1")).closest("section")!;
  expect(tickets.textContent).toContain("In Progress · pull request #7 changes requested");
  fireEvent.click(within(tickets).getByRole("button", { name: "MP-544 Open button" }));
  expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c1" });
  expect(within(tickets).getByRole("link", { name: "Open MP-544 Open button in a new tab" }).getAttribute("title")).toBe("Open the ticket");

  const upcoming = screen.getByText("Upcoming · 2").closest("section")!;
  expect(within(upcoming).getAllByRole("listitem").map((r) => r.textContent)).toEqual(["MP-1 Next upTo Do · HighStart…", "wiki-digestRuns by itself, weekdays 08:00"]);
  fireEvent.click(within(upcoming).getByRole("button", { name: "Start…" }));
  expect(props.onStartTicket).toHaveBeenCalledWith({ key: "MP-1", summary: "Next up" });

  fireEvent.click(within(screen.getByText("Your notes · 1").closest("section")!).getByRole("button", { name: /Share rules/ }));
  expect(props.onOpenNote).toHaveBeenCalledWith("note01");
  expect(screen.getByText(/5 requests, 1 of them started by Mae · \$2\.50 at API prices/)).toBeTruthy();

  expect(screen.getByText("Watch your pull requests in links/web")).toBeTruthy(); // what the camp could take over is still offered here
  expect(screen.queryByText("Requests you typed")).toBeNull();                    // the stats live in Settings now
  expect(screen.queryByText(/starts in/)).toBeNull();
  expect(screen.queryByRole("button", { name: /The week in numbers|What Mae does unasked/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Look them over" }));
  expect(props.onOpenMemory).toHaveBeenCalled();
});

test("with no brief yet it says so and offers to write one; an earlier day's can be read back, without its buttons", async () => {
  const asked = camp({ "/api/home": page({ name: "", brief: null, days: [], offers: [] }), "/api/brief": brief });
  show();
  expect(await screen.findByText(/There's no brief yet\./)).toBeTruthy();
  expect(screen.getByRole("heading", { name: /^Good (morning|afternoon|evening)\.$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Write today's brief" }));
  await waitFor(() => expect(asked).toContain("POST /api/brief {}"));
  cleanup();

  camp({ "/api/home": page(), "/api/brief": { ...brief, day: "2026-11-12" } });
  show();
  fireEvent.change(await screen.findByRole("combobox", { name: "Which day's brief" }), { target: { value: "2026-11-12" } });
  expect(await screen.findByText("The brief for 2026-11-12.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Address it" })).toBeNull(); // yesterday's next steps aren't today's
  expect(screen.queryByText("Where you left off")).toBeNull();
});
