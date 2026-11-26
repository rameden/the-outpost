// The Inbox: everything that waits on you in one list, and each thing answered where it's listed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import { NO_INBOX, inboxCount, type InboxCount } from "../inbox.ts";
import type { Need } from "../needs.ts";
import type { BriefLine, CampEvent, CampState } from "../types.ts";
import { Inbox } from "./Inbox.tsx";

const calls: { url: string; body?: any }[] = [];
let brief: { written: string; needs: BriefLine[] } | null = null;
let answer: (url: string, body?: any) => { status?: number; json: unknown } = () => ({ json: { ok: true } });
beforeEach(() => {
  calls.length = 0; brief = null; answer = () => ({ json: { ok: true } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (String(url).startsWith("/api/home")) return new Response(JSON.stringify({ name: "Ryley", today: "2026-11-16", brief, days: [] }), { status: 200 });
    calls.push({ url, body });
    const a = answer(url, body);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const need = (kind: Need["kind"], conversation: string, title: string, says: string): Need => ({ key: `${kind}:${conversation}`, kind, conversation, title, says });
const camp = (over: object = {}) => ({
  history: { conversations: [{ id: "c9", title: "Ship the nav" }, { id: "c1", title: "Open button" }], projects: [] },
  running: [], queued: [], memoryProposals: [], skills: [], inbox: [], ...over,
}) as unknown as CampState;

function events(store: ReturnType<typeof createFeedStore>, ...bodies: object[]) {
  act(() => { bodies.forEach((b, i) => store.apply({ ...b, seq: store.getState().lastSeq + i + 1, time: new Date().toISOString() } as CampEvent)); });
}

function show(over: { S?: CampState; needs?: Need[]; count?: InboxCount; store?: ReturnType<typeof createFeedStore> } = {}) {
  const S = over.S ?? camp(), needs = over.needs ?? [], store = over.store ?? createFeedStore();
  const on = { refresh: vi.fn(), onSeenAll: vi.fn(), setView: vi.fn(), onStartTicket: vi.fn() };
  const count = over.count ?? inboxCount(S, needs, store.getState().asks.length);
  const view = render(<Inbox S={S} store={store} needs={needs} count={count} {...on} />);
  return { ...on, store, ...view };
}
const section = (name: string) => within(screen.getByRole("region", { name }));
const sections = () => screen.queryAllByRole("region").map((r) => r.getAttribute("aria-label"));

test("with nothing in it, the Inbox says so and what will land here", async () => {
  show({ count: NO_INBOX });
  expect(screen.getByRole("status").textContent).toBe("Nothing is waiting on you. Everything that waits on you is listed here, and this is where you answer it.");
  expect(screen.getByText("Inbox is empty")).toBeTruthy();
  expect(screen.getByText(/pull requests with something new, runs that failed/)).toBeTruthy();
  expect(sections()).toEqual([]);
  await waitFor(() => expect(fetch).toHaveBeenCalled()); // the brief is read; it had nothing to add
  expect(sections()).toEqual([]);
});

test("decisions come first: each with who asked and where, its card to answer on, and its conversation a click away", async () => {
  const store = createFeedStore();
  events(store,
    { type: "expedition_start", id: "a", task: "Ship the nav", source: "user", thread: "c9" },
    { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan", body: "1. Scout reads the nav", expeditionId: "a" },
    { type: "ask", id: "ask2", kind: "plan", title: "📋 Plan", body: "1. A plan from a job", lead: "Quartermaster" }); // not in a conversation
  const { setView } = show({ store, needs: [need("decision", "c9", "Ship the nav", "Waiting on your decision")] });
  expect(screen.getByRole("status").textContent).toMatch(/^2 waiting on you\. Everything that waits on you is listed here/);
  expect(screen.queryByText("Inbox is empty")).toBeNull();
  const box = section("Decisions");
  expect(box.getByRole("heading").textContent).toBe("Decisions 2");
  const rows = box.getAllByRole("listitem").filter((li) => li.parentElement!.classList.contains("inbox-asks"));
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector(".inbox-ask-from .meta")!.textContent).toMatch(/ · Ship the nav$/);
  expect(within(rows[0]).getByText("1. Scout reads the nav")).toBeTruthy();
  // The one with no conversation has its card all the same, and nowhere to open.
  expect(within(rows[1]).getByText("1. A plan from a job")).toBeTruthy();
  expect(within(rows[1]).queryByRole("button", { name: "Open the conversation" })).toBeNull();
  fireEvent.click(within(rows[0]).getByRole("button", { name: "Open the conversation" }));
  expect(setView).toHaveBeenCalledWith({ kind: "conversation", id: "c9" });
  // Answered here, on the card.
  await act(async () => { fireEvent.click(within(rows[0]).getByRole("button", { name: "Approve and start" })); });
  expect(calls).toEqual([{ url: "/api/answer", body: { id: "ask1", answer: "" } }]);
  // Once the answer lands it leaves the list.
  events(store, { type: "answered", id: "ask1", answer: "" });
  await waitFor(() => expect(section("Decisions").getByRole("heading").textContent).toBe("Decisions 1"));
  events(store, { type: "answered", id: "ask2", answer: "" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Decisions" })).toBeNull());
});

test("chained requests are started or taken off here, the held ones counted", async () => {
  const S = camp({
    running: [{ id: "a", label: "expedition", task: "Build the Open button" }],
    queued: [{ id: "plain", label: "expedition", task: "Just queued", after: null, held: null }, { id: "b", label: "@scribe", task: "Write the release notes", after: "a", held: null }, { id: "c", label: "expedition", task: "Deploy it", after: "gone", held: "stopped" }],
  });
  const { refresh, setView } = show({ S, needs: [need("held", "c", "Deploy it", "Held: the work it was waiting on ended as stopped")] });
  expect(screen.getByRole("status").textContent).toMatch(/^1 waiting on you\./);
  const box = section("Chained requests");
  expect(box.getByRole("heading").textContent).toBe("Chained requests 1"); // one of the two is held
  const list = within(box.getByRole("group", { name: "Waiting to start" }));
  expect(list.queryByText("Just queued")).toBeNull();
  expect(list.getByText('Starts when "Build the Open button" has finished.')).toBeTruthy();
  fireEvent.click(list.getByRole("button", { name: "Start now" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  fireEvent.click(list.getByRole("button", { name: "Start it anyway" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  fireEvent.click(list.getAllByRole("button", { name: "Take it off" })[1]);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(3));
  expect(calls).toEqual([{ url: "/api/queue/release", body: { id: "b" } }, { url: "/api/queue/release", body: { id: "c" } }, { url: "/api/stop", body: { id: "c" } }]);
  fireEvent.click(list.getByRole("button", { name: "Write the release notes" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "b" });
  // Chained but not held isn't counted, yet the Inbox isn't called empty while it lists one.
  cleanup();
  show({ S: camp({ queued: [{ id: "b", label: "@scribe", task: "Write the release notes", after: "a", held: null }] }), count: NO_INBOX });
  expect(screen.getByRole("status").textContent).toMatch(/^Nothing is waiting on you\./);
  expect(screen.queryByText("Inbox is empty")).toBeNull();
  expect(section("Chained requests").getByRole("heading").textContent!.trim()).toBe("Chained requests");
});

test("pull requests with something new and runs that didn't finish each open their conversation, with the brief's next step beside them", async () => {
  brief = { written: "2026-11-16T08:00:00.000Z", needs: [
    { kind: "pull", title: "#7 Open button", says: "Changes requested", url: "https://github.com/o/r/pull/7", conversation: "c1", act: { do: "address", url: "https://github.com/o/r/pull/7" } },
    { kind: "run", title: "Bump the deps", says: "Ended as failed", conversation: "c8", act: { do: "resume", run: "r8" } },
  ] };
  answer = (url) => ({ json: { thread: url === "/api/send" ? "c8-again" : "c1" } });
  const needs = [need("pr", "c1", "Open button", "Pull request #7: changes requested"), need("pr", "c2", "Footer", "Pull request #9: checks failed"), need("failed", "c8", "Bump the deps", "Ended as failed")];
  const { setView } = show({ needs });
  expect(screen.getByRole("status").textContent).toMatch(/^3 waiting on you\./);
  const prs = section("Pull requests");
  expect(prs.getByRole("heading").textContent).toBe("Pull requests 2");
  expect(within(prs.getByRole("list", { name: "Pull requests with something new" })).getAllByRole("listitem").map((r) => r.querySelector(".home-line-text")!.textContent)).toEqual([
    "Open buttonPull request #7: changes requested", "FooterPull request #9: checks failed"]);
  fireEvent.click(prs.getByRole("button", { name: "Open Footer" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c2" });
  fireEvent.click(prs.getByRole("button", { name: "Open button" })); // its title opens it too
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c1" });

  const failed = section("Runs that didn't finish");
  expect(failed.getByRole("heading").textContent).toBe("Runs that didn't finish 1");
  fireEvent.click(failed.getByRole("button", { name: "Open Bump the deps" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c8" });
  expect(calls).toEqual([]);

  // The brief's line for the same thing gives it its one next step; the brief doesn't list it a second time.
  const address = await prs.findByRole("button", { name: "Address it: Open button" });
  expect(prs.queryByRole("button", { name: /Address it: Footer/ })).toBeNull();
  expect(screen.queryByRole("region", { name: "From the brief" })).toBeNull();
  fireEvent.click(address);
  await waitFor(() => expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c1" }));
  expect(calls).toEqual([{ url: "/api/pulls/address", body: { url: "https://github.com/o/r/pull/7" } }]);
  fireEvent.click(failed.getByRole("button", { name: "Resume: Bump the deps" }));
  await waitFor(() => expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c8-again" }));
  expect(calls.at(-1)).toEqual({ url: "/api/send", body: { resume: "r8" } });
});

test("what the crew proposed to remember is approved or dropped on its card, with Memory a click away", async () => {
  const S = camp({ memoryProposals: [
    { id: "p2", kind: "keep", where: "about", name: "About you", created: "2026-03-02T11:00:00Z", text: "Wants a test with every change", run: "r9", thread: "t9", title: "Add the share button" },
    { id: "p1", kind: "tidy", where: "agent:scribe", name: "Scribe's memory", created: "2026-03-02T10:00:00Z", before: "- a\n- b", after: "- 2026-01-05 Use British spelling" },
  ] });
  const { refresh, setView } = show({ S });
  expect(screen.getByRole("status").textContent).toMatch(/^2 waiting on you\./);
  const box = section("Memory");
  expect(box.getByRole("heading").textContent).toBe("Memory 2");
  expect(box.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Suggested for About you", "A shorter version of Scribe's memory"]);
  fireEvent.click(box.getByRole("button", { name: "Open Memory" }));
  expect(setView).toHaveBeenCalledWith({ kind: "memory" });
  fireEvent.click(within(box.getByRole("listitem", { name: "Suggested for About you" })).getByRole("button", { name: "Keep it" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls).toEqual([{ url: "/api/memory/proposal", body: { id: "p2", action: "approve", text: "Wants a test with every change" } }]);
});

test("skills the lead proposed are approved or rejected here", async () => {
  const S = camp({ skills: [{ owner: "scribe", name: "release-notes", reason: "It worked twice.", proposed: "Write them from the merged pull requests." }] });
  const { refresh } = show({ S });
  const box = section("Skills");
  expect(box.getByRole("heading").textContent).toBe("Skills 1");
  expect(box.getByText("Write them from the merged pull requests.")).toBeTruthy();
  fireEvent.click(box.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  fireEvent.click(box.getByRole("button", { name: "Reject" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(calls).toEqual([{ url: "/api/skills", body: { owner: "scribe", name: "release-notes", action: "approve" } }, { url: "/api/skills", body: { owner: "scribe", name: "release-notes", action: "reject" } }]);
});

test("what finished since you looked is news: opened one at a time, or all marked as seen", () => {
  const needs = [need("finished", "c7", "Fix the footer", "Finished since you last looked"), need("finished", "c6", "Rename the flag", "Ended as stopped")];
  const { onSeenAll, setView } = show({ needs });
  expect(screen.getByRole("status").textContent).toMatch(/^2 new\. Everything that waits on you/);
  const box = section("Finished since you looked");
  expect(box.getByRole("heading").textContent).toMatch(/^Finished since you looked 2/);
  expect(within(box.getByRole("list", { name: "Finished since you looked" })).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(box.getByRole("button", { name: "Open Rename the flag" }));
  expect(setView).toHaveBeenCalledWith({ kind: "conversation", id: "c6" });
  expect(onSeenAll).not.toHaveBeenCalled();
  fireEvent.click(box.getByRole("button", { name: "Mark what's finished as seen" }));
  expect(onSeenAll).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([]);
});

test("From the brief: what it found that isn't on the live list, each with its next step, and not counted", async () => {
  brief = { written: "2026-11-16T08:00:00.000Z", needs: [
    { kind: "pull", title: "#7 Open button", says: "Changes requested", url: "https://github.com/o/r/pull/7", act: { do: "address", url: "https://github.com/o/r/pull/7" } },
    { kind: "run", title: "Fix the flaky date test", says: "Ended as stopped", conversation: "c5", act: { do: "resume", run: "r5" } },
    { kind: "ticket", title: "WEB-12 Dark mode", says: "Nothing has picked it up", act: { do: "start", jira: "WEB-12" } },
  ] };
  answer = (url) => url === "/api/send" ? { status: 500, json: { error: "That run can't be resumed." } } : { json: { thread: "c1" } };
  const { setView, onStartTicket } = show({ count: NO_INBOX });
  const box = within(await screen.findByRole("region", { name: "From the brief" }));
  expect(screen.queryByText("Inbox is empty")).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/^Nothing is waiting on you\./); // a snapshot: listed, not counted
  expect(box.getByText(/^What the brief found waiting on you when it was written/).textContent).toMatch(/write the brief again on Today to bring it up to date\.$/);
  const rows = within(box.getByRole("list", { name: "From the brief" })).getAllByRole("listitem");
  expect(rows.map((r) => r.querySelector(".home-line-text")!.textContent)).toEqual(["#7 Open buttonChanges requested", "Fix the flaky date testEnded as stopped", "WEB-12 Dark modeNothing has picked it up"]);
  // One opened outside the camp links out; one with a conversation here opens it.
  expect(within(rows[0]).getByRole("link", { name: "Open #7 Open button in a new tab" }).getAttribute("href")).toBe("https://github.com/o/r/pull/7");
  expect(within(rows[0]).queryByRole("button", { name: "#7 Open button" })).toBeNull();
  fireEvent.click(within(rows[1]).getByRole("button", { name: "Fix the flaky date test" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c5" });

  fireEvent.click(box.getByRole("button", { name: "Address it: #7 Open button" }));
  await waitFor(() => expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c1" }));
  expect(calls).toEqual([{ url: "/api/pulls/address", body: { url: "https://github.com/o/r/pull/7" } }]);
  fireEvent.click(box.getByRole("button", { name: "Start: WEB-12 Dark mode" }));
  await waitFor(() => expect(onStartTicket).toHaveBeenCalledWith({ key: "WEB-12", summary: "Dark mode" }));
  expect(calls).toHaveLength(1); // a ticket's kickoff asks before anything is sent
  // A step that fails says why, here.
  fireEvent.click(box.getByRole("button", { name: "Resume: Fix the flaky date test" }));
  expect((await screen.findByRole("alert")).textContent).toBe("That run can't be resumed.");
  expect(setView).toHaveBeenCalledTimes(2);
});

test("reports from scheduled jobs are read and marked as read here", async () => {
  const S = camp({ inbox: [
    { heading: "2026-11-16 08:00 · morning-brief", body: "Where things stand.", seen: false },
    { heading: "2026-11-15 09:00 · digest", body: "Two new pages.", seen: false },
    { heading: "2026-11-14 09:00 · digest", body: "Old news.", seen: true },
  ] });
  const { refresh } = show({ S });
  expect(screen.getByRole("status").textContent).toMatch(/^2 new\./);
  const box = section("Reports");
  expect(box.getByText("2 unread")).toBeTruthy();
  expect(box.getAllByRole("button", { name: "Mark as read" })).toHaveLength(2);
  await act(async () => { fireEvent.click(box.getAllByRole("button", { name: "Mark as read" })[0]); });
  await act(async () => { fireEvent.click(box.getByRole("button", { name: "Mark all as read" })); });
  expect(calls).toEqual([{ url: "/api/inbox/seen", body: { heading: "2026-11-16 08:00 · morning-brief" } }, { url: "/api/inbox/seen", body: { all: true } }]);
  expect(refresh).toHaveBeenCalledTimes(2);
  // All read: nothing is new, but the reports are still here to read, so it isn't called empty.
  cleanup();
  show({ S: camp({ inbox: [{ heading: "2026-11-14 09:00 · digest", body: "Old news.", seen: true }] }) });
  expect(screen.getByRole("status").textContent).toMatch(/^Nothing is waiting on you\./);
  expect(screen.queryByText("Inbox is empty")).toBeNull();
  expect(section("Reports").getByText("All read.")).toBeTruthy();
});

test("the sections come in the order you'd get to them", async () => {
  brief = { written: "2026-11-16T08:00:00.000Z", needs: [{ kind: "ticket", title: "WEB-12 Dark mode", says: "Nothing has picked it up", act: { do: "start", jira: "WEB-12" } }] };
  const store = createFeedStore();
  events(store, { type: "expedition_start", id: "a", task: "Ship the nav", source: "user", thread: "c9" }, { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "a" });
  const S = camp({
    queued: [{ id: "c", label: "expedition", task: "Deploy it", after: "gone", held: "stopped" }],
    memoryProposals: [{ id: "p2", kind: "keep", where: "about", name: "About you", created: "2026-03-02T11:00:00Z", text: "Wants a test with every change" }],
    skills: [{ owner: "scribe", name: "release-notes", reason: "", proposed: "Steps." }],
    inbox: [{ heading: "2026-11-16 08:00 · morning-brief", body: "Where things stand.", seen: false }],
  });
  const needs = [need("decision", "c9", "Ship the nav", "Waiting on your decision"), need("pr", "c1", "Open button", "Pull request #7: changes requested"), need("held", "c", "Deploy it", "Held"),
    need("failed", "c8", "Bump the deps", "Ended as failed"), need("finished", "c7", "Fix the footer", "Finished since you last looked")];
  show({ S, needs, store });
  await screen.findByRole("region", { name: "From the brief" });
  expect(screen.getByRole("status").textContent).toMatch(/^6 waiting on you · 2 new\. /);
  expect(sections()).toEqual(["Decisions", "Chained requests", "Pull requests", "Runs that didn't finish", "Memory", "Skills", "Finished since you looked", "From the brief", "Reports"]);
});
