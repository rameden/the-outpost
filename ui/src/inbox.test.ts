// The inbox's count, its label, the short preview, and which of the brief's lines the live list already has.
import { afterEach, expect, test, vi } from "vitest";
import { ACT, NO_INBOX, briefAct, briefLineFor, briefOnly, inboxCount, inboxLabel, inboxPreview } from "./inbox.ts";
import type { Need } from "./needs.ts";
import type { BriefLine, CampState } from "./types.ts";

afterEach(() => vi.unstubAllGlobals());

const need = (kind: Need["kind"], conversation: string, title: string, says: string): Need => ({ key: `${kind}:${conversation}`, kind, conversation, title, says });
const camp = (over: object = {}) => ({ memoryProposals: [], skills: [], inbox: [], ...over }) as unknown as CampState;
const needs = [
  need("decision", "c9", "Ship the nav", "2 decisions waiting on you"),
  need("pr", "c1", "Open button", "Pull request #7: changes requested"),
  need("held", "c2", "Deploy it", "Held: the work it was waiting on ended as stopped"),
  need("failed", "c8", "Bump the deps", "Ended as failed"),
  need("finished", "c7", "Fix the footer", "Finished since you last looked"),
];

test("the count: decisions, pull requests, held and failed runs and proposals are waiting on you; finished runs and unread reports are new", () => {
  const S = camp({ memoryProposals: [{ id: "m1" }, { id: "m2" }], skills: [{ name: "s" }], inbox: [{ seen: false }, { seen: true }, { seen: false }] });
  // 3 decisions open in the feed + pr, held, failed + 2 memory + 1 skill; 1 finished + 2 unread.
  expect(inboxCount(S, needs, 3)).toEqual({ waiting: 9, fresh: 3, total: 12 });
  // Decisions are counted from the feed, not from the list: a decision line with no open ask adds nothing.
  expect(inboxCount(S, needs, 0)).toEqual({ waiting: 6, fresh: 3, total: 9 });
  // The camp's own count of unread reports wins over counting the ones it sent.
  expect(inboxCount(camp({ inboxCount: 5, inbox: [{ seen: false }] }), [], 0)).toEqual({ waiting: 0, fresh: 5, total: 5 });
  // Nothing anywhere, and before the camp has loaded.
  expect(inboxCount(camp(), [], 0)).toEqual(NO_INBOX);
  expect(inboxCount(null, [], 0)).toEqual({ waiting: 0, fresh: 0, total: 0 });
  expect(inboxCount(undefined, [need("finished", "c7", "x", "y")], 1)).toEqual({ waiting: 1, fresh: 1, total: 2 });
});

test("the label says what's waiting and what's new, each only when there is some", () => {
  expect(inboxLabel({ waiting: 3, fresh: 2, total: 5 })).toBe("3 waiting on you · 2 new");
  expect(inboxLabel({ waiting: 1, fresh: 0, total: 1 })).toBe("1 waiting on you");
  expect(inboxLabel({ waiting: 0, fresh: 2, total: 2 })).toBe("2 new");
  expect(inboxLabel(NO_INBOX)).toBe("");
});

test("the preview: decisions first, then pull requests, held and failed runs, then proposals as one line each; news isn't in it", () => {
  const S = camp({ memoryProposals: [{ id: "m1" }, { id: "m2" }], skills: [{ name: "s" }], inbox: [{ seen: false }] });
  const all = inboxPreview(S, needs, 3, Infinity);
  expect(all.map((l) => `${l.title} | ${l.says}`)).toEqual([
    "Ship the nav | 2 decisions waiting on you",
    "1 more decision | Waiting on you", // 3 open, 2 of them in that conversation
    "Open button | Pull request #7: changes requested",
    "Deploy it | Held: the work it was waiting on ended as stopped",
    "Bump the deps | Ended as failed",
    "2 suggestions about memory | Nothing is kept until you approve it",
    "1 skill proposal | Nothing goes live until you approve it",
  ]);
  expect(new Set(all.map((l) => l.key)).size).toBe(all.length);
  // Three by default, or as many as asked for.
  expect(inboxPreview(S, needs, 3).map((l) => l.title)).toEqual(["Ship the nav", "1 more decision", "Open button"]);
  expect(inboxPreview(S, needs, 3, 1).map((l) => l.title)).toEqual(["Ship the nav"]);
  // Every open decision is in a conversation on the list: no "more" line. A line that says "Waiting on your decision" is one.
  expect(inboxPreview(camp(), [need("decision", "c9", "Ship the nav", "Waiting on your decision")], 1).map((l) => l.title)).toEqual(["Ship the nav"]);
  expect(inboxPreview(camp(), [need("decision", "c9", "Ship the nav", "Waiting on your decision")], 4).map((l) => l.title)).toEqual(["Ship the nav", "3 more decisions"]);
  // No decision line above them: they aren't "more" of anything.
  expect(inboxPreview(camp(), [], 2).map((l) => l.title)).toEqual(["2 decisions"]);
  expect(inboxPreview(camp(), [], 1).map((l) => l.title)).toEqual(["1 decision"]);
  // One suggestion, several skills; and only news or nothing gives no lines.
  expect(inboxPreview(camp({ memoryProposals: [{ id: "m1" }], skills: [{ name: "a" }, { name: "b" }] }), [], 0).map((l) => l.title)).toEqual(["1 suggestion about memory", "2 skill proposals"]);
  expect(inboxPreview(camp({ inbox: [{ seen: false }] }), [need("finished", "c7", "Fix the footer", "Finished since you last looked")], 0)).toEqual([]);
  expect(inboxPreview(null, [], 0)).toEqual([]);
});

const pull: BriefLine = { kind: "pull", title: "#7 Open button", says: "Changes requested", url: "https://github.com/o/r/pull/7", conversation: "c1", act: { do: "address", url: "https://github.com/o/r/pull/7" } };
const run: BriefLine = { kind: "run", title: "Bump the deps", says: "Ended as failed", conversation: "c8", act: { do: "resume", run: "r8" } };
const elsewhere: BriefLine = { kind: "pull", title: "#9 Footer", says: "Ready to merge", url: "https://github.com/o/r/pull/9" }; // opened outside the camp: no conversation here
const ticket: BriefLine = { kind: "ticket", title: "WEB-12 Dark mode", says: "Nothing has picked it up", act: { do: "start", jira: "WEB-12" } };

test("the brief's lines: the ones the live list already has carry its next step there; the rest are the brief's own", () => {
  const lines = [pull, run, elsewhere, ticket];
  expect(briefLineFor(needs[1], lines)).toBe(pull);   // the pull request's line
  expect(briefLineFor(needs[3], lines)).toBe(run);    // the failed run's line
  expect(briefLineFor(needs[0], lines)).toBeUndefined();
  // Same conversation isn't enough: a finished run isn't the brief's failed one, and a failed run isn't its pull request.
  expect(briefLineFor(need("finished", "c8", "Bump the deps", "Finished"), lines)).toBeUndefined();
  expect(briefLineFor(need("failed", "c1", "Open button", "Ended as failed"), lines)).toBeUndefined();
  expect(briefOnly(lines, needs)).toEqual([elsewhere, ticket]);
  expect(briefOnly(lines, [])).toEqual(lines);
  expect(briefOnly([], needs)).toEqual([]);
});

test("a line's next step: address a pull request's feedback or resume a run, then open the conversation; a ticket opens its kickoff", async () => {
  expect(ACT).toEqual({ address: "Address it", resume: "Resume", start: "Start…" });
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    asked.push(`${url} ${init?.body ?? ""}`);
    return new Response(JSON.stringify({ thread: url === "/api/send" ? "c8" : "c1" }), { status: 200 });
  }));
  const go = { open: vi.fn(), startTicket: vi.fn() };
  await briefAct(pull, go);
  expect(asked).toEqual(['/api/pulls/address {"url":"https://github.com/o/r/pull/7"}']);
  expect(go.open).toHaveBeenLastCalledWith("c1");
  await briefAct(run, go);
  expect(asked.at(-1)).toBe('/api/send {"resume":"r8"}');
  expect(go.open).toHaveBeenLastCalledWith("c8");
  await briefAct(ticket, go);
  expect(go.startTicket).toHaveBeenCalledWith({ key: "WEB-12", summary: "Dark mode" });
  await briefAct(elsewhere, go); // nothing to do: nothing asked
  expect(asked).toHaveLength(2);
  expect(go.open).toHaveBeenCalledTimes(2);
});
