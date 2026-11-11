// What needs you, in one list: decisions, pull requests with something new, held requests, and
// runs that ended while you were elsewhere.
import { beforeEach, expect, test } from "vitest";
import { loadSeen, markSeen, needsDoing, needsLabel, needsOf, seenAll, unseen } from "./needs.ts";
import type { CampState, Conversation } from "./types.ts";

beforeEach(() => localStorage.clear());
const conv = (id: string, title: string, status: string, updated: string) => ({ id, title, status, updated, created: updated, project: "general", agent: "quartermaster", direct: false, expeditions: [id] }) as Conversation;
const CONVS = [conv("a", "Open button", "done", "2026-11-10T12:00:00.000Z"), conv("b", "Fix the nav", "error", "2026-11-10T11:00:00.000Z"),
  conv("c", "Old thing", "done", "2026-11-01T09:00:00.000Z"), conv("d", "Still going", "running", "2026-11-10T12:30:00.000Z")];
const pr = (conversation: string, attention: boolean) => ({ conversation, path: `/w/${conversation}`, number: 7, failing: 1, comments: 2, conflicts: false, review: null, attention }) as CampState["prs"][number];
const SEEN = { since: "2026-11-10T00:00:00.000Z", at: {} };

test("everything waiting on you, the most pressing first", () => {
  const list = needsOf({
    conversations: CONVS, seen: SEEN, activity: { d: { running: true, needs: 2 } },
    prs: [pr("a", true), pr("c", false), pr("gone", true)],
    queued: [{ id: "q1", label: "expedition", task: "Deploy it", after: "x", held: "stopped" }, { id: "q2", label: "expedition", task: "Waiting", after: "d", held: null }],
  });
  expect(list.map((n) => [n.kind, n.conversation, n.says])).toEqual([
    ["decision", "d", "2 decisions waiting on you"],
    ["pr", "a", "Pull request #7: 1 failing check · 2 comments"],
    ["held", "q1", "Held: the work it was waiting on ended as stopped"],
    ["failed", "b", "Ended as error"],
    ["finished", "a", "Finished since you last looked"],
  ]);
  expect(list.find((n) => n.kind === "held")!.title).toBe("Deploy it");
  // Not listed: a pull request you've already brought in, one whose conversation is gone, a request
  // that's merely waiting its turn, what ended before you started, and what's still running.
});

test("what you're looking at, and what you've looked at since, isn't news", () => {
  const base = { conversations: CONVS, activity: {} };
  expect(needsOf({ ...base, seen: SEEN, viewing: "a" }).map((n) => n.conversation)).toEqual(["b"]);
  let seen = markSeen(SEEN, CONVS[1]);
  expect(needsOf({ ...base, seen }).map((n) => n.conversation)).toEqual(["a"]);
  expect(markSeen(seen, CONVS[1])).toBe(seen); // nothing new: nothing to keep
  // It ends again later: news again.
  expect(unseen(seen, { ...CONVS[1], updated: "2026-11-10T13:00:00.000Z" })).toBe(true);
  // Conversations that no longer exist are dropped from what's kept.
  seen = markSeen(seen, CONVS[0], new Set(["a"]));
  expect(Object.keys(seen.at)).toEqual(["a"]);
  expect(JSON.parse(localStorage.getItem("camp-seen")!).at).toEqual({ a: CONVS[0].updated });
});

test("the first time, everything already there counts as seen", () => {
  const first = loadSeen(new Date("2026-11-11T00:00:00.000Z"));
  expect(first).toEqual({ since: "2026-11-11T00:00:00.000Z", at: {} });
  expect(needsOf({ conversations: CONVS, activity: {}, seen: first })).toEqual([]);
  expect(loadSeen(new Date("2027-01-01T00:00:00.000Z"))).toEqual(first); // kept from then on
});

test("the chip's words", () => {
  const n = (kind: string) => ({ key: kind, kind, conversation: "a", title: "t", says: "s" }) as ReturnType<typeof needsOf>[number];
  expect(needsLabel([])).toBe("");
  expect(needsLabel([n("decision")])).toBe("1 decision needs you");
  expect(needsLabel([n("decision"), n("decision")])).toBe("2 decisions need you");
  expect(needsLabel([n("pr")])).toBe("1 pull request needs you");
  // A run that finished is news, counted apart from what needs doing.
  expect(needsLabel([n("decision"), n("pr"), n("finished")])).toBe("2 things need you · 1 finished");
  expect(needsLabel([n("failed"), n("finished"), n("finished")])).toBe("1 thing needs you · 2 finished");
  expect(needsLabel([n("finished"), n("finished")])).toBe("2 finished");
  expect(needsDoing([n("finished"), n("held")]).map((x) => x.kind)).toEqual(["held"]);
  expect(seenAll(new Date("2026-11-12T00:00:00.000Z"))).toEqual({ since: "2026-11-12T00:00:00.000Z", at: {} });
});
