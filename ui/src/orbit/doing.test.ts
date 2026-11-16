// What one of the crew is doing right now, read out of the live feed.
import { expect, test } from "vitest";
import { applyEvent, emptyFeed, type FeedState } from "../feed/reducer.ts";
import type { CampEvent } from "../types.ts";
import { LOG_LINES, questsOf, runsOf } from "./doing.ts";

function feedOf(bodies: object[]): FeedState {
  return bodies.reduce<FeedState>((s, b, i) => applyEvent(s, { ...b, seq: i + 1, time: new Date(Date.UTC(2026, 0, 1, 9, 0, i)).toISOString() } as CampEvent), emptyFeed);
}
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };
const scout = { who: "Scout", emoji: "🏹", depth: 1 };
const scribe = { who: "Scribe", emoji: "🪶", depth: 1 };

const s = feedOf([
  { type: "expedition_start", id: "A", task: "Audit the login flow", source: "user", thread: "A" },
  { type: "text", ...qm, text: "Here is **the plan**.", expeditionId: "A" },
  { type: "ask", id: "k1", kind: "plan", title: "Approve the plan", body: "1. Look\n2. Write", expeditionId: "A" },
  { type: "answered", id: "k1", answer: "y" },
  { type: "plan", steps: [{ n: 1, text: "Look" }, { n: 2, text: "Write" }], expeditionId: "A" },
  { type: "dispatch", ...scout, questId: "q1", brief: "Read the session code", step: 1, expeditionId: "A" },
  { type: "dispatch", ...scout, questId: "q2", brief: "Check the cookie flags", expeditionId: "A" },
  { type: "tool", ...scout, tool: "read_file", input: "links/app/src/session.ts", questId: "q1", expeditionId: "A" },
  { type: "file", ...scout, path: "camp/agents/scout/outputs/notes.md", change: "created", bytes: 120, questId: "q1", expeditionId: "A" },
  { type: "text_delta", ...scout, delta: "The session is ", questId: "q1", expeditionId: "A" },
  { type: "text_delta", ...scout, delta: "kept in a cookie", questId: "q1", expeditionId: "A" },
  { type: "ask", id: "k2", kind: "shell", title: "Run a command", body: "curl -I localhost", questId: "q2", expeditionId: "A" },
  // Meanwhile you messaged the Scribe yourself: that isn't a quest.
  { type: "expedition_start", id: "B", task: "Tidy the README", source: "direct", thread: "B" },
  { type: "tool", ...scribe, tool: "read_file", input: "README.md", expeditionId: "B" },
]);

test("each quest that's out comes with its last few steps, and a reply still arriving is marked as live", () => {
  const [q1, q2] = questsOf(s, "Scout");
  expect(q1).toMatchObject({ id: "q1", brief: "Read the session code", step: 1, waiting: false });
  expect(q1.log.map((l) => [l.tag, l.text])).toEqual([
    ["tool", "read_file links/app/src/session.ts"],
    ["file", "Created camp/agents/scout/outputs/notes.md"],
    ["said", "The session is kept in a cookie"],
  ]);
  expect(q1.log.at(-1)!.live).toBe(true);
  expect(q2).toMatchObject({ id: "q2", brief: "Check the cookie flags", waiting: true });
  expect(q2.log.map((l) => [l.tag, l.text])).toEqual([["ask", "Run a command: waiting for your OK"]]);
  expect(questsOf(s, "Scribe")).toEqual([]); // nobody sent them on one
});

test("only the last few steps are kept, and a long reply is shown by its latest words while it arrives", () => {
  const busy = feedOf([
    { type: "expedition_start", id: "A", task: "Dig", source: "user" },
    { type: "dispatch", ...scout, questId: "q1", expeditionId: "A" },
    ...Array.from({ length: 9 }, (_, i) => ({ type: "tool", ...scout, tool: "grep", input: `pattern ${i}`, questId: "q1", expeditionId: "A" })),
    { type: "text_delta", ...scout, delta: `${"word ".repeat(80)}and the end`, questId: "q1", expeditionId: "A" },
  ]);
  const [q] = questsOf(busy, "Scout");
  expect(q.log.length).toBe(LOG_LINES);
  expect(q.log[0].text).toBe("grep pattern 4");
  const reply = q.log.at(-1)!;
  expect(reply.text.startsWith("…")).toBe(true);
  expect(reply.text.endsWith("and the end")).toBe(true);
});

test("the Quartermaster has every expedition the crew is on, with how its plan stands", () => {
  const [a, ...rest] = runsOf(s, "Quartermaster");
  expect(rest).toEqual([]); // not the one you sent straight to the Scribe
  expect(a).toMatchObject({ expId: "A", task: "Audit the login flow", thread: "A", steps: { done: 0, out: 1, total: 2 } });
  expect(a.log.map((l) => [l.tag, l.text])).toEqual([["said", "Here is the plan."], ["ask", "Approve the plan: ✓ Plan approved"]]);
});

test("anyone else has only what they're working on outside a quest: someone you messaged yourself", () => {
  expect(runsOf(s, "Scout")).toEqual([]); // the Scout's work is all in quests
  const [b] = runsOf(s, "Scribe");
  expect(b).toMatchObject({ expId: "B", task: "Tidy the README", thread: "B" });
  expect(b.steps).toBeUndefined();
  expect(b.log.map((l) => l.text)).toEqual(["read_file README.md"]);
});

test("once it's over there is nothing left to show", () => {
  const done = feedOf([
    { type: "expedition_start", id: "A", task: "Dig", source: "user" },
    { type: "dispatch", ...scout, questId: "q1", expeditionId: "A" },
    { type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" },
    { type: "expedition_end", id: "A", status: "done", text: "Done" },
  ]);
  expect(questsOf(done, "Scout")).toEqual([]);
  expect(runsOf(done, "Quartermaster")).toEqual([]);
});
