// Today, the page the camp opens on: a greeting and where things stand in a few sentences, then
// the brief as rows with one next step each: tickets, what's upcoming, your notes.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Brief, CampState, HomePage } from "../types.ts";
import type { InboxCount } from "../inbox.ts";
import type { Need } from "../needs.ts";
import { Home, RunsOn, greeting, kickoff } from "./Home.tsx";

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
  held: [], retros: [], drive: { brief: true, briefAt: "08:00", retro: true, debrief: true }, pulls: { fetched: "2026-11-13T12:55:00.000Z", count: 2 }, ...over,
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
  // Today's brief speaks from the inbox's count, the one number every other place shows.
  const quiet = { ...brief, moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } };
  const live = (waiting: number, fresh = 0): InboxCount => ({ waiting, fresh, total: waiting + fresh });
  expect(kickoff(quiet, 0, live(3, 1))).toBe("Three things are waiting on you in the Inbox.");
  expect(kickoff(quiet, 0, live(1))).toBe("One thing is waiting on you in the Inbox.");
  // Nothing live, but the brief found some when it was written: it says whose finding it is.
  expect(kickoff(quiet, 0, live(0))).toBe("The brief found two things waiting on you, starting with #7 MP-544: Open button (changes requested, 1 open comment thread).");
  expect(kickoff({ ...quiet, needs: [brief.needs[1]] }, 0, live(0, 2))).toBe("The brief found one thing waiting on you: Fix the flaky date test (ended as stopped).");
  expect(kickoff({ ...quiet, needs: [] }, 0, live(0))).toBe("Nothing is waiting on you. A good day to start something.");
  expect(kickoff({ ...quiet, needs: [] }, 0, live(2))).toBe("Two things are waiting on you in the Inbox."); // and not "a good day to start something"
});

test("the page opens with the greeting and where you left off; what the brief found waiting is a short preview that opens the Inbox", async () => {
  const asked = camp({ "/api/home": page(), "/api/pulls/address": { ok: true, id: "run-20", thread: "c1" }, "/api/send": { ok: true, id: "run-21", thread: "c2" } });
  const props = show({ onOpenInbox: vi.fn() });
  expect(await screen.findByRole("heading", { name: /^Good (morning|afternoon|evening), Ryley\.$/ })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/^The brief found two things waiting on you, starting with #7 MP-544: Open button/);
  expect(asked[0]).toBe("GET /api/home");

  const left = screen.getByText("Where you left off").closest("section")!;
  expect(left.textContent).toContain("Fix the flaky date test");
  fireEvent.click(within(left).getByRole("button", { name: "Pick it back up" }));
  expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c2" });
  // The one you left off at isn't repeated under Recent work.
  expect(within(screen.getByText("Recent work").closest("section")!).getAllByRole("listitem").map((r) => r.textContent)).toEqual([expect.stringContaining("Open button")]);

  // Nothing is counted (the brief's lines are a snapshot), so the label has no number; each line leads to the Inbox.
  const needs = screen.getByRole("region", { name: "Waiting on you" });
  expect(within(needs).getByText("Waiting on you")).toBeTruthy();
  expect(within(needs).getAllByRole("listitem").map((r) => r.textContent)).toEqual([
    "#7 MP-544: Open buttonchanges requested, 1 open comment thread · from the brief", "Fix the flaky date testEnded as stopped · from the brief"]);
  expect(within(needs).getByText("Each has its next step in the Inbox.")).toBeTruthy();
  // The next steps themselves (Address it, Resume) are in the Inbox, not here: nothing on this page starts work by itself.
  expect(within(needs).queryByRole("button", { name: /^(Address it|Resume)/ })).toBeNull();
  fireEvent.click(within(needs).getByRole("button", { name: "#7 MP-544: Open button" }));
  expect(props.onOpenInbox).toHaveBeenCalledTimes(1);
  fireEvent.click(within(needs).getByRole("button", { name: "Open the inbox" }));
  expect(props.onOpenInbox).toHaveBeenCalledTimes(2);
  expect(asked.filter((a) => a.startsWith("POST"))).toEqual([]);
  expect(within(screen.getByText("In motion · 1").closest("section")!).queryByRole("button", { name: /Address|Resume|Start/ })).toBeNull();
});

test("what's waiting right now leads: the inbox's count in the first sentence, its first few lines, and the way in", async () => {
  camp({ "/api/home": page() });
  const need = (kind: Need["kind"], conversation: string, title: string, says: string): Need => ({ key: `${kind}:${conversation}`, kind, conversation, title, says });
  const needs = [need("decision", "c9", "Ship the nav", "Waiting on your decision"), need("pr", "c1", "Open button", "Pull request #7: changes requested"),
    need("failed", "c8", "Bump the deps", "Ended as failed"), need("finished", "c7", "Fix the footer", "Finished since you last looked")];
  const withMemory = { ...S, memoryProposals: [{ id: "m1" }, { id: "m2" }], skills: [{ name: "s" }] } as unknown as CampState;
  const props = show({ S: withMemory, needs, asks: 2, inbox: { waiting: 7, fresh: 1, total: 8 }, onOpenInbox: vi.fn() });
  await screen.findByRole("heading", { name: /^Good/ });
  expect(screen.getByRole("status").textContent).toMatch(/^Seven things are waiting on you in the Inbox\. One pull request is with reviewers\./);
  const box = screen.getByRole("region", { name: "Waiting on you" });
  expect(within(box).getByText("Waiting on you · 7")).toBeTruthy();
  // Decisions first, then pull requests and runs; the brief's own line for the same pull request isn't repeated.
  expect(within(box).getAllByRole("listitem").map((r) => r.textContent)).toEqual([
    "Ship the navWaiting on your decision", "1 more decisionWaiting on you", "Open buttonPull request #7: changes requested", "Fix the flaky date testEnded as stopped · from the brief"]);
  expect(within(box).getByText("7 waiting on you · 1 new · 3 more in the Inbox")).toBeTruthy();
  fireEvent.click(within(box).getByRole("button", { name: "Open button" }));
  fireEvent.click(within(box).getByRole("button", { name: "Open the inbox" }));
  expect(props.onOpenInbox).toHaveBeenCalledTimes(2);
  expect(props.setView).not.toHaveBeenCalled(); // a line here doesn't jump past the Inbox
});

test("only news in the inbox: no lines to preview, just the count and the way in", async () => {
  camp({ "/api/home": page({ brief: { ...brief, needs: [] } }) });
  const props = show({ inbox: { waiting: 0, fresh: 2, total: 2 }, onOpenInbox: vi.fn() });
  await screen.findByRole("heading", { name: /^Good/ });
  // News isn't something waiting on you, so the section says what it is.
  const box = screen.getByRole("region", { name: "New in the inbox" });
  expect(screen.queryByRole("region", { name: "Waiting on you" })).toBeNull();
  expect(within(box).getByText("New in the inbox")).toBeTruthy();
  expect(within(box).queryAllByRole("listitem")).toEqual([]);
  expect(within(box).getByText("2 new")).toBeTruthy();
  fireEvent.click(within(box).getByRole("button", { name: "Open the inbox" }));
  expect(props.onOpenInbox).toHaveBeenCalledTimes(1);
  cleanup();
  // And with nothing at all, the section isn't there.
  camp({ "/api/home": page({ brief: { ...brief, needs: [] } }) });
  show();
  await screen.findByRole("heading", { name: /^Good/ });
  expect(screen.queryByRole("region", { name: /Waiting on you|New in the inbox/ })).toBeNull();
});

test("plans you approved to start later wait on Home, and Start carries on their conversation", async () => {
  expect(kickoff({ ...brief, needs: [], moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } }, 2)).toBe("Two plans you approved are ready to start when you are.");
  expect(kickoff({ ...brief, needs: [brief.needs[1]], moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } }, 1))
    .toBe("One thing is waiting on you: Fix the flaky date test (ended as stopped). One plan you approved is ready to start when you are.");
  expect(kickoff({ ...brief, needs: [], moving: [], tickets: [], next: [], done: { ...brief.done, finished: [], merged: [] } }, 1, { waiting: 2, fresh: 0, total: 2 }))
    .toBe("Two things are waiting on you in the Inbox. One plan you approved is ready to start when you are.");

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
  fireEvent.click(within(ready).getByRole("button", { name: /^Start the plan for/ }));
  await waitFor(() => expect(asked).toContain('POST /api/send {"start":"ask_7"}'));
  await waitFor(() => expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c3" }));
});

test("your tickets, what's upcoming and your notes are part of it; the numbers and the switches live in Settings, not here", async () => {
  camp({ "/api/home": page() });
  const props = show();
  const tickets = (await screen.findByText("Your tickets · 1")).closest("section")!;
  // A card, as on the Tickets page: the key and Jira's status on top, the summary, then where it stands here.
  expect(within(tickets).getByText("MP-544").className).toBe("jira-key");
  expect(within(tickets).getByText("In Progress").className).toContain("pill");
  expect(within(tickets).getByText("pull request #7 changes requested")).toBeTruthy();
  fireEvent.click(within(tickets).getByRole("button", { name: "MP-544 Open button" }));
  expect(props.setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c1" });
  expect(within(tickets).getByRole("link", { name: "Open MP-544 Open button in a new tab" }).getAttribute("title")).toBe("Open the ticket");

  const upcoming = screen.getByText("Upcoming · 2").closest("section")!;
  // Cards too: a ticket nothing has picked up, with Jira's status on top, and a scheduled job with when it runs.
  expect(within(upcoming).getAllByRole("listitem").map((r) => r.textContent)).toEqual(["MP-1HighTo DoNext upStart…", "Scheduledwiki-digestRuns by itself, weekdays 08:00"]);
  expect(within(upcoming).getByText("MP-1").className).toBe("jira-key");
  expect(within(upcoming).getByText("To Do").className).toContain("pill");
  fireEvent.click(within(upcoming).getByRole("button", { name: /^Start: / }));
  expect(props.onStartTicket).toHaveBeenCalledWith({ key: "MP-1", summary: "Next up" });

  fireEvent.click(within(screen.getByText("Your notes · 1").closest("section")!).getByRole("button", { name: /Share rules/ }));
  expect(props.onOpenNote).toHaveBeenCalledWith("note01");
  expect(screen.getByText(/5 requests, 1 of them started by Mae · \$2\.50 at API prices/)).toBeTruthy();

  expect(screen.getByText("Watch your pull requests in links/web")).toBeTruthy(); // what the camp could take over is still offered here
  expect(screen.queryByText("Requests you typed")).toBeNull();                    // the stats live in Settings now
  expect(screen.queryByText(/starts in/)).toBeNull();
  expect(screen.queryByRole("button", { name: /The week in numbers|What Mae does unasked/ })).toBeNull();
  // The brief's own "2 suggestions are waiting" line is gone: what waits is counted in one place, the Inbox.
  expect(screen.queryByRole("button", { name: "Look them over" })).toBeNull();
  expect(screen.queryByText(/suggestions? (is|are) waiting/)).toBeNull();
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
  expect(screen.queryByRole("button", { name: /^Address it/ })).toBeNull(); // yesterday's next steps aren't today's
  expect(screen.queryByText("Where you left off")).toBeNull();
  // It reads as it was written: its own count and lines, and no way into today's Inbox from it.
  expect(screen.getByRole("status").textContent).toMatch(/^Two things are waiting on you, starting with #7 MP-544: Open button/);
  const then = screen.getByText("Waiting on you · 2").closest("section")!;
  expect(then.textContent).toContain("Fix the flaky date test");
  expect(within(then).queryByRole("button", { name: "Open the inbox" })).toBeNull();
});

const night = (over: Partial<NonNullable<HomePage["night"]>> = {}): NonNullable<HomePage["night"]> => ({
  day: "2026-11-12", finished: "2026-11-13T02:10:00.000Z", nights: 1,
  tidied: [{ where: "agent:scout", name: "Scout's memory" }, { where: "agent:scribe", name: "Scribe's memory" }],
  stale: [{ where: "agent:warden", name: "Warden's memory", text: "Review checklist lives in the wiki", date: "2026-01-09" }, { where: "agent:scout", name: "Scout's memory", text: "The staging host moved to eu-west", date: "2026-05-02" }],
  housekeeping: [{ step: "uploads", title: "delete 3 uploaded files nothing uses any more", count: 3, bytes: 4096 }], frees: "4 KB", notes: [], ...over,
});

test("While you were away: what the night shift drafted and found, with the way to the Inbox and to Memory, and Dismiss marks it seen", async () => {
  const asked = camp({ "/api/home": page({ night: night() }), "/api/night/seen": { ok: true, seen: 1 } });
  const props = show({ onOpenInbox: vi.fn() });
  const card = await screen.findByRole("region", { name: "While you were away" });
  expect(card.textContent).toMatch(/Drafted shorter versions of 2 memories \(Scout's memory, Scribe's memory\)/);
  // The drafts wait for your say in the Inbox; the old lines themselves are in Memory.
  fireEvent.click(within(card).getByRole("button", { name: "Look them over" }));
  expect(props.onOpenInbox).toHaveBeenCalledTimes(1);
  expect(props.onOpenMemory).not.toHaveBeenCalled();
  // The old lines are folded away until you ask, each with where it is and when it was written.
  const old = within(card).getByText("2 old lines worth a look").closest("details") as HTMLDetailsElement;
  expect(old.open).toBe(false);
  expect(within(old).getAllByRole("listitem", { hidden: true }).map((l) => l.textContent)).toEqual(["Review checklist lives in the wikiWarden's memory · 2026-01-09", "The staging host moved to eu-westScout's memory · 2026-05-02"]);
  fireEvent.click(within(old).getByRole("button", { name: "Memory", hidden: true }));
  expect(props.onOpenMemory).toHaveBeenCalledTimes(1);
  expect(props.onOpenInbox).toHaveBeenCalledTimes(1);
  expect(card.textContent).toMatch(/Housekeeping could delete 3 uploaded files nothing uses any more \(about 4 KB\)\. Nothing was cleared/);
  expect(card.textContent).toMatch(/It only drafted and reported\. Nothing was applied or deleted\./);
  fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(asked).toContain("POST /api/night/seen {}"));
  expect(asked.filter((a) => a.startsWith("GET /api/home")).length).toBeGreaterThan(1); // and the page is read again
});

test("While you were away: one tidy reads as one, what couldn't be done is said, and a night that did nothing shows no card", async () => {
  camp({ "/api/home": page({ night: night({ tidied: [{ where: "agent:scout", name: "Scout's memory" }], stale: [], housekeeping: [], frees: "", notes: ["No shorter version was drafted for Scribe's memory: the model is unreachable"] }) }) });
  show();
  const card = await screen.findByRole("region", { name: "While you were away" });
  expect(card.textContent).toMatch(/Drafted a shorter version of 1 memory \(Scout's memory\)/);
  expect(within(card).getByRole("button", { name: "Look it over" })).toBeTruthy();
  expect(card.textContent).toMatch(/No shorter version was drafted for Scribe's memory: the model is unreachable/);
  expect(card.textContent).not.toMatch(/old line|Housekeeping could/);
  cleanup();

  camp({ "/api/home": page() });
  show();
  await screen.findByText(/Good (morning|afternoon|evening)/);
  expect(screen.queryByRole("region", { name: "While you were away" })).toBeNull();
});

test("AI news, when the brief has it, is its own section: each item with what it is, how it could help, and its link", async () => {
  const news = [{ kind: "feature" as const, title: "Prompt caching for tools", url: "https://example.com/caching", says: "Tool definitions can be cached.", why: "Cuts the crew's cost." }];
  camp({ "/api/home": page({ brief: { ...brief, news } }) });
  show();
  const section = (await screen.findByText(/^AI news for .* · 1$/)).closest("section")!;
  expect(within(section).getByText("Prompt caching for tools")).toBeTruthy();
  expect(within(section).getByText("Tool definitions can be cached. Cuts the crew's cost.")).toBeTruthy();
  expect(within(section).getByRole("link", { name: "Open Prompt caching for tools in a new tab" }).getAttribute("href")).toBe("https://example.com/caching");
});

test("a brief without news has no AI news section", async () => {
  camp({ "/api/home": page() });
  show();
  await screen.findByText("Your tickets · 1");
  expect(screen.queryByText(/^AI news for/)).toBeNull();
});

// ---------- First run ----------

test("a blank outpost offers requests to try: pressing one puts it in the message box", async () => {
  camp({ "/api/home": page({ name: "", brief: null, days: [], offers: [] }) });
  const onExample = vi.fn();
  show({ onExample });
  const box = await screen.findByRole("region", { name: "Requests to try" });
  expect(within(box).getByText("New here? Try one of these")).toBeTruthy();
  const tries = within(box).getAllByRole("button");
  expect(tries.length).toBeGreaterThanOrEqual(3);
  expect(tries.length).toBeLessThanOrEqual(4);
  for (const t of tries) expect(t.title).toBe("Put this in the message box");
  fireEvent.click(tries[1]);
  expect(onExample).toHaveBeenCalledTimes(1);
  expect(onExample).toHaveBeenCalledWith(tries[1].textContent);
  expect(within(box).getByText(/puts it in the message box below: change it as you like, then send\./)).toBeTruthy();
});

test("the requests to try are for a newcomer's page: no brief yet, or nothing ever asked, and nothing waiting", async () => {
  const loaded = async () => { await screen.findByRole("heading", { name: /^Good/ }); await waitFor(() => expect(screen.getByRole("status").textContent).not.toMatch(/One moment/)); };
  const tries = () => screen.queryByRole("region", { name: "Requests to try" });
  const blank = { name: "", brief: null, days: [], offers: [] };
  const quiet = { ...brief, needs: [] };
  const unused = { ...S, history: { ...S.history, conversations: [] } } as unknown as CampState;
  // Shown: a brief that wrote itself on an outpost nothing has been asked of; and unread reports don't hide them.
  camp({ "/api/home": page({ brief: quiet }) });
  show({ S: unused, onExample: vi.fn() });
  await loaded();
  expect(tries()).toBeTruthy();
  cleanup();
  camp({ "/api/home": page(blank) });
  show({ onExample: vi.fn(), inbox: { waiting: 0, fresh: 1, total: 1 } });
  await loaded();
  expect(tries()).toBeTruthy();
  cleanup();
  // Not shown: a brief on an outpost in use; something waiting; the brief found something waiting; a plan ready to start; nowhere to put them.
  camp({ "/api/home": page({ brief: quiet }) });
  show({ onExample: vi.fn() });
  await loaded();
  expect(tries()).toBeNull();
  cleanup();
  camp({ "/api/home": page(blank) });
  show({ onExample: vi.fn(), inbox: { waiting: 1, fresh: 0, total: 1 } });
  await loaded();
  expect(tries()).toBeNull();
  cleanup();
  camp({ "/api/home": page() });
  show({ S: unused, onExample: vi.fn() });
  await loaded();
  expect(tries()).toBeNull();
  cleanup();
  camp({ "/api/home": page({ ...blank, held: [{ ask: "ask_7", conversation: "c3", title: "Migrate the settings page", project: "p1", held: "2026-11-13T09:00:00.000Z", plan: "1. Go", steps: 1 }] }) });
  show({ onExample: vi.fn() });
  await loaded();
  expect(tries()).toBeNull();
  cleanup();
  camp({ "/api/home": page(blank) });
  show(); // no onExample: nothing to press them into
  await loaded();
  expect(tries()).toBeNull();
});

test("a missing Claude sign-in is said plainly on Today, with Check again and the way to an API key", async () => {
  const asked = camp({ "/api/runtime": { ok: true } });
  const refresh = vi.fn(), onOpenSettings = vi.fn();
  const camp1 = { runtime: "claude-code", login: { ok: false, problem: "Claude Code isn't signed in. Run `claude` in a terminal and sign in." }, providers: [] } as unknown as CampState;
  render(<RunsOn S={camp1} refresh={refresh} onOpenSettings={onOpenSettings} />);
  const box = screen.getByRole("alert", { name: "What the crew runs on" });
  expect(within(box).getByText("The crew can't work yet: the Claude sign-in is missing.")).toBeTruthy();
  expect(box.textContent).toContain("Claude Code isn't signed in. Run `claude` in a terminal and sign in. When you've signed in, press Check again.");
  fireEvent.click(within(box).getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(asked).toEqual(['POST /api/runtime {"runtime":"claude-code"}']);
  fireEvent.click(within(box).getByRole("button", { name: "Use an API key instead" }));
  expect(onOpenSettings).toHaveBeenCalledWith("models");
});

test("a missing API key is said plainly on Today, with the way to add one or to the Claude subscription", () => {
  camp({});
  const onOpenSettings = vi.fn();
  const noKey = { runtime: "api", login: null, anthropic: { connected: false }, providers: [{ id: "openai", connected: false }] } as unknown as CampState;
  const { rerender } = render(<RunsOn S={noKey} refresh={() => {}} onOpenSettings={onOpenSettings} />);
  const box = screen.getByRole("alert", { name: "What the crew runs on" });
  expect(within(box).getByText("The crew can't work yet: there's no API key.")).toBeTruthy();
  expect(within(box).getByRole("button", { name: "Use my Claude subscription" })).toBeTruthy();
  fireEvent.click(within(box).getByRole("button", { name: "Add an API key" }));
  expect(onOpenSettings).toHaveBeenCalledWith("models");
  // Nothing shows when the crew can run: a key for Anthropic, a key for another provider, or a signed-in subscription.
  const fine = [
    { runtime: "api", login: null, anthropic: { connected: true }, providers: [] },
    { runtime: "api", login: null, anthropic: { connected: false }, providers: [{ id: "openai", connected: true }] },
    { runtime: "claude-code", login: { ok: true }, anthropic: { connected: false }, providers: [] },
    { runtime: "claude-code", login: null, providers: [] }, // not checked yet: no alarm before there's an answer
  ];
  for (const ok of fine) {
    rerender(<RunsOn S={ok as unknown as CampState} refresh={() => {}} onOpenSettings={onOpenSettings} />);
    expect(screen.queryByRole("alert")).toBeNull();
  }
});

test("Today carries the notice above everything else, and not on an earlier day's brief", async () => {
  camp({ "/api/home": page(), "/api/brief": { ...brief, day: "2026-11-12" } });
  const noKey = { ...S, runtime: "api", login: null, anthropic: { connected: false }, providers: [] } as unknown as CampState;
  const props = show({ S: noKey, onOpenSettings: vi.fn() });
  const box = await screen.findByRole("alert", { name: "What the crew runs on" });
  fireEvent.click(within(box).getByRole("button", { name: "Add an API key" }));
  expect(props.onOpenSettings).toHaveBeenCalledWith("models");
  fireEvent.change(screen.getByRole("combobox", { name: "Which day's brief" }), { target: { value: "2026-11-12" } });
  await screen.findByText("The brief for 2026-11-12.");
  expect(screen.queryByRole("alert", { name: "What the crew runs on" })).toBeNull();
});
