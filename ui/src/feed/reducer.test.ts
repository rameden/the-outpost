// The feed reducer: several expeditions at once, replies streaming in, approvals, and Stop.
import { describe, expect, test } from "vitest";
import type { CampEvent } from "../types.ts";
import { addSysLine, applyEvent, emptyFeed, findNodes, runningCount, stepState, type ExpNode, type FeedState, type PlanNode } from "./reducer.ts";

// Events as the server sends them: numbered in order, a second apart.
type Body = CampEvent extends infer E ? (E extends CampEvent ? Omit<E, "seq" | "time"> : never) : never;
function feedOf(bodies: Body[], from: FeedState = emptyFeed): FeedState {
  let s = from;
  bodies.forEach((b, i) => {
    const seq = from.lastSeq + i + 1;
    s = applyEvent(s, { ...b, seq, time: new Date(Date.UTC(2026, 0, 1, 9, 0, seq)).toISOString() } as CampEvent);
  });
  return s;
}
const exp = (s: FeedState, id: string) => s.items.find((n): n is ExpNode => n.kind === "exp" && n.expId === id)!;
const kinds = (nodes: { kind: string }[]) => nodes.map((n) => n.kind);

const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };
const scout = { who: "Scout", emoji: "🔭", depth: 1 };
const scribe = { who: "Scribe", emoji: "✒️", depth: 1 };
const start = (id: string, task: string, source: "user" | "direct" | "job" = "user"): Body => ({ type: "expedition_start", id, task, source });

describe("parallel expeditions", () => {
  // Two expeditions whose events arrive interleaved, each with a quest; B's quest has the same id as A's.
  const s = feedOf([
    start("A", "Research memory"),
    start("B", "Write the changelog"),
    { type: "text", ...qm, text: "Plan for A", expeditionId: "A" },
    { type: "text", ...qm, text: "Plan for B", expeditionId: "B" },
    { type: "dispatch", ...scout, questId: "q1", expeditionId: "A" },
    { type: "dispatch", ...scribe, questId: "q1", expeditionId: "B" },
    { type: "tool", ...scout, tool: "web_search", input: "agent memory", questId: "q1", expeditionId: "A" },
    { type: "text", ...scribe, text: "Drafting", questId: "q1", expeditionId: "B" },
    { type: "text", ...scout, text: "Found three papers", questId: "q1", expeditionId: "A" },
  ]);

  test("each event lands in its own expedition's card, and in its own quest", () => {
    expect(s.items.map((n) => n.kind)).toEqual(["exp", "exp"]);
    expect(runningCount(s)).toBe(2);
    const [a, b] = [exp(s, "A"), exp(s, "B")];
    expect(kinds(a.nodes)).toEqual(["msg", "quest"]);
    expect(kinds(b.nodes)).toEqual(["msg", "quest"]);
    expect(a.nodes[0]).toMatchObject({ text: "Plan for A" });
    expect(b.nodes[0]).toMatchObject({ text: "Plan for B" });
    expect(a.nodes[1]).toMatchObject({ who: "Scout", status: null, nodes: [{ kind: "tool", tool: "web_search" }, { kind: "msg", text: "Found three papers" }] });
    expect(b.nodes[1]).toMatchObject({ who: "Scribe", status: null, nodes: [{ kind: "msg", text: "Drafting" }] });
  });

  test("two quests in one expedition stay apart", () => {
    const two = feedOf([
      start("A", "Do two things"),
      { type: "dispatch", ...scout, questId: "q1", expeditionId: "A" },
      { type: "dispatch", ...scribe, questId: "q2", expeditionId: "A" },
      { type: "text_delta", ...scribe, delta: "Dra", questId: "q2", expeditionId: "A" },
      { type: "text_delta", ...scout, delta: "Loo", questId: "q1", expeditionId: "A" },
      { type: "text_delta", ...scribe, delta: "ft", questId: "q2", expeditionId: "A" },
      { type: "return", who: "Scout", emoji: "🔭", status: "done", questId: "q1", expeditionId: "A" },
    ]);
    const [q1, q2] = findNodes(two.items, "quest");
    expect(q1).toMatchObject({ who: "Scout", status: "done", nodes: [{ kind: "msg", text: "Loo", streaming: false }] });
    expect(q2).toMatchObject({ who: "Scribe", status: null, nodes: [{ kind: "msg", text: "Draft", streaming: true }] });
  });

  test("the crew panel follows who is working where", () => {
    expect(s.crew.Quartermaster).toMatchObject({ status: "active" });
    expect(s.crew.Scout).toEqual({ status: "active", line: "Found three papers" });
    expect(s.crew.Scribe).toEqual({ status: "active", line: "Drafting" });
  });

  test("one finishing leaves the other running, and only its own crew go back to camp", () => {
    const after = feedOf([{ type: "expedition_end", id: "A", status: "done", text: "All done", changed: 2 }], s);
    expect(runningCount(after)).toBe(1);
    expect(exp(after, "A").end).toMatchObject({ status: "done", changed: 2 });
    expect(exp(after, "B").end).toBeNull();
    expect(after.crew.Scout.status).toBe("idle");
    expect(after.crew.Scribe.status).toBe("active");
    expect(after.crew.Quartermaster.status).toBe("active"); // still planning B
    expect(exp(after, "B")).toBe(exp(s, "B")); // B's card wasn't touched, so React skips it
  });

  test("an approval lands in the expedition that asked, and waits there", () => {
    const asked = feedOf([
      { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan for A", body: "1. Scout", expeditionId: "A" },
      { type: "ask", id: "ask2", kind: "shell", title: "🖥️ Run a command", body: "npm test", questId: "q1", expeditionId: "B" },
    ], s);
    expect(asked.asks.map((a) => [a.id, a.who])).toEqual([["ask1", "Quartermaster"], ["ask2", "Scribe"]]);
    expect(asked.crew.Quartermaster.status).toBe("waiting");
    expect(asked.crew.Scribe.status).toBe("waiting");
    expect(kinds(exp(asked, "A").nodes)).toEqual(["msg", "quest", "ask"]);
    expect(findNodes(exp(asked, "B").nodes, "ask")).toMatchObject([{ askId: "ask2", askKind: "shell", outcome: null }]);

    const answered = feedOf([{ type: "answered", id: "ask2", answer: "always" }, { type: "answered", id: "ask1", answer: "" }], asked);
    expect(answered.asks).toEqual([]);
    expect(findNodes(answered.items, "ask").map((a) => a.outcome)).toEqual(["✓ Plan approved", "✓ Allowed, and won't ask again for this command"]);
    expect(answered.crew.Scribe.status).toBe("active");
  });
});

describe("streaming", () => {
  const streaming = feedOf([
    start("A", "Say hello"),
    { type: "text_delta", ...qm, delta: "Hel", expeditionId: "A" },
    { type: "text_delta", ...qm, delta: "lo **wor", expeditionId: "A" },
  ]);

  test("words arriving build one message, marked as still streaming", () => {
    expect(exp(streaming, "A").nodes).toMatchObject([{ kind: "msg", who: "Quartermaster", text: "Hello **wor", streaming: true }]);
    expect(streaming.crew.Quartermaster).toEqual({ status: "active", line: "Planning the expedition" });
  });

  test("the finished reply replaces what streamed in", () => {
    const done = feedOf([{ type: "text", ...qm, text: "Hello **world**", expeditionId: "A" }], streaming);
    expect(exp(done, "A").nodes).toMatchObject([{ kind: "msg", text: "Hello **world**", streaming: false }]);
    expect(exp(done, "A").nodes[0].id).toBe(exp(streaming, "A").nodes[0].id); // the same message, not a second one
    expect(done.live).toEqual({});
  });

  test("words after a tool call start a new message", () => {
    const s = feedOf([
      { type: "tool", ...qm, tool: "read_file", input: "README.md", expeditionId: "A" },
      { type: "text_delta", ...qm, delta: "Next", expeditionId: "A" },
    ], streaming);
    expect(exp(s, "A").nodes).toMatchObject([
      { kind: "msg", text: "Hello **wor", streaming: false },
      { kind: "tool", tool: "read_file" },
      { kind: "msg", text: "Next", streaming: true },
    ]);
  });

  test("two expeditions streaming at once don't mix their words", () => {
    const s = feedOf([
      start("B", "Second"),
      { type: "text_delta", ...qm, delta: "B says ", expeditionId: "B" },
      { type: "text_delta", ...qm, delta: "d", expeditionId: "A" },
      { type: "text_delta", ...qm, delta: "hi", expeditionId: "B" },
    ], streaming);
    expect(exp(s, "A").nodes).toMatchObject([{ text: "Hello **word" }]);
    expect(exp(s, "B").nodes).toMatchObject([{ text: "B says hi" }]);
  });

  test("a replayed event (after a reconnect) changes nothing", () => {
    const again = applyEvent(streaming, { type: "text_delta", ...qm, delta: "lo **wor", expeditionId: "A", seq: 3, time: new Date().toISOString() });
    expect(again).toBe(streaming);
  });
});

describe("stop", () => {
  // A is mid-reply with an approval waiting when you stop it; B carries on.
  const running = feedOf([
    start("A", "Long job"),
    start("B", "Other job"),
    { type: "dispatch", ...scout, questId: "q1", expeditionId: "A" },
    { type: "text_delta", ...scout, delta: "Looking into", questId: "q1", expeditionId: "A" },
    { type: "ask", id: "ask1", kind: "shell", title: "🖥️ Run a command", body: "rm -rf build", questId: "q1", expeditionId: "A" },
    { type: "text_delta", ...qm, delta: "B is still", expeditionId: "B" },
  ]);
  const stopped = feedOf([
    { type: "answered", id: "ask1", answer: "n" },
    { type: "return", who: "Scout", emoji: "🔭", status: "stopped", questId: "q1", expeditionId: "A" },
    { type: "expedition_end", id: "A", status: "stopped", text: "Stopped by you." },
  ], running);

  test("the stopped expedition closes: its approval is declined, its quest and reply end", () => {
    const a = exp(stopped, "A");
    expect(a.end).toMatchObject({ status: "stopped", changed: 0 });
    expect(findNodes(a.nodes, "ask")).toMatchObject([{ outcome: "✕ Declined" }]);
    expect(findNodes(a.nodes, "quest")).toMatchObject([{ status: "stopped" }]);
    expect(findNodes(a.nodes, "msg")).toMatchObject([{ text: "Looking into", streaming: false }]); // cut off, kept as it was
    expect(stopped.asks).toEqual([]);
    expect(stopped.crew.Scout).toEqual({ status: "idle", line: "Returned (stopped)" });
  });

  test("the other expedition keeps running and keeps streaming", () => {
    expect(runningCount(stopped)).toBe(1);
    expect(exp(stopped, "B").end).toBeNull();
    const more = feedOf([{ type: "text_delta", ...qm, delta: " going", expeditionId: "B" }], stopped);
    expect(exp(more, "B").nodes).toMatchObject([{ text: "B is still going", streaming: true }]);
  });

  test("an expedition that fails says why", () => {
    const failed = feedOf([{ type: "expedition_end", id: "B", status: "error", text: "The API is down." }], stopped);
    expect(exp(failed, "B").nodes.at(-1)).toMatchObject({ kind: "notice", text: "The API is down." });
    expect(findNodes(failed.items, "msg").every((m) => !m.streaming)).toBe(true);
    expect(runningCount(failed)).toBe(0);
  });
});

describe("the rest of the feed", () => {
  test("job runs and the page's own notes are lines between the cards", () => {
    let s = feedOf([start("A", "One"), { type: "job", name: "digest", outcome: "running" }, { type: "job", name: "digest", outcome: "quiet" }]);
    s = addSysLine(s, "Queued (#1)");
    expect(s.items.map((n) => (n.kind === "sys" ? n.text : n.kind))).toEqual(["exp", '⏰ Scheduled job "digest" is running', '🤫 "digest" found nothing new', "Queued (#1)"]);
  });

  test("a direct message is one expedition with one quest, and no Quartermaster", () => {
    const s = feedOf([
      start("D", "@scout hello", "direct"),
      { type: "dispatch", ...scout, questId: "q1", expeditionId: "D" },
      { type: "text", ...scout, text: "Hello!", questId: "q1", expeditionId: "D" },
      { type: "return", who: "Scout", emoji: "🔭", status: "done", questId: "q1", expeditionId: "D" },
      { type: "expedition_end", id: "D", status: "done", text: "Hello!" },
    ]);
    expect(s.crew.Quartermaster).toBeUndefined();
    expect(exp(s, "D")).toMatchObject({ source: "direct", end: { status: "done" }, nodes: [{ kind: "quest", status: "done", nodes: [{ text: "Hello!" }] }] });
  });

  test("an approval that lapsed in a restart is closed, not left waiting", () => {
    const s = feedOf([
      start("A", "One"),
      { type: "ask", id: "ask1", kind: "plan", title: "📋 Plan", body: "1.", expeditionId: "A" },
      { type: "answered", id: "ask1", answer: "n", lapsed: true },
      { type: "expedition_end", id: "A", status: "interrupted", text: "The camp was restarted while this was running." },
    ]);
    expect(s.asks).toEqual([]);
    expect(findNodes(s.items, "ask")[0].outcome).toBe("Not answered (the camp was restarted)");
    expect(exp(s, "A").end?.status).toBe("interrupted");
  });
});

describe("working in linked repositories", () => {
  const ws = { link: "site", path: "/repos/site-wt", branch: "camp/fix-nav", base: "abc123", created: true, changed: 2, commits: 0 };
  const s = feedOf([
    start("A", "Fix the nav"),
    start("B", "Other work"),
    { type: "steer", id: "A", text: "Use the existing Button component", expeditionId: "A" },
    { type: "expedition_end", id: "A", status: "out_of_turns", text: "partial", workspaces: [ws] },
  ]);

  test("what you say to a running expedition shows in its own card", () => {
    expect(kinds(exp(s, "A").nodes)).toEqual(["steer"]);
    expect(exp(s, "A").nodes[0]).toMatchObject({ kind: "steer", text: "Use the existing Button component" });
    expect(exp(s, "B").nodes).toEqual([]);
  });

  test("a finished expedition keeps the worktrees it worked in", () => {
    expect(exp(s, "A").end).toMatchObject({ status: "out_of_turns", workspaces: [ws] });
    const ended = feedOf([{ type: "expedition_end", id: "B", status: "done", text: "ok" }], s);
    expect(exp(ended, "B").end?.workspaces).toEqual([]);
  });
});

describe("who's out", () => {
  const smith = { who: "Artificer", emoji: "🔨", depth: 1 };
  const out = (s: FeedState) => s.quests.map((q) => `${q.who} | ${q.brief} | ${q.line}${q.waiting ? " | waiting" : ""}`);

  test("two quests by the same crew member are two quests out, each with its own brief and what it's doing", () => {
    let s = feedOf([
      start("A", "Share a whole thread"),
      { type: "dispatch", ...smith, questId: "q1", expeditionId: "A", brief: "Backend: thread links in the export module" },
      { type: "dispatch", ...smith, questId: "q2", expeditionId: "A", brief: "Studio UI: Share in the history menu" },
      { type: "dispatch", ...scout, questId: "q3", expeditionId: "A" },
      { type: "tool", ...smith, tool: "read_file", input: "{}", questId: "q1", expeditionId: "A" },
      { type: "text_delta", ...smith, delta: "Adding", questId: "q2", expeditionId: "A" },
    ]);
    expect(out(s)).toEqual([
      "Artificer | Backend: thread links in the export module | Using read_file",
      "Artificer | Studio UI: Share in the history menu | Writing…",
      "Scout |  | Setting out",
    ]);
    expect(s.quests[0].started).toBe(Date.UTC(2026, 0, 1, 9, 0, 2));
    // The crew bar's own status is one per member: it can only show one of the two.
    expect(s.crew.Artificer.line).toBe("Using read_file");
    // Their blocks in the feed carry the brief too.
    expect(findNodes(s.items, "quest").map((q) => q.brief)).toEqual(["Backend: thread links in the export module", "Studio UI: Share in the history menu", undefined]);

    // One asks for your OK (its quest waits, the other carries on); answered, it's working again.
    s = feedOf([
      { type: "ask", id: "ok1", kind: "shell", title: "Run npm test?", body: "", questId: "q1", expeditionId: "A" },
      { type: "text", ...smith, text: "Wired the **menu item**.", questId: "q2", expeditionId: "A" },
    ], s);
    expect(out(s).slice(0, 2)).toEqual(["Artificer | Backend: thread links in the export module | Using read_file | waiting", "Artificer | Studio UI: Share in the history menu | Wired the menu item."]);
    s = feedOf([{ type: "answered", id: "ok1", answer: "y" }], s);
    expect(s.quests[0].waiting).toBe(false);

    // One comes back: it's no longer out, and the other still is.
    s = feedOf([{ type: "return", ...smith, status: "done", questId: "q2", expeditionId: "A" }], s);
    expect(s.quests.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(s.crew.Artificer).toEqual({ status: "active", line: "Using read_file" }); // back from one, still out on the other: not "at camp"
    // The run is stopped with quests still out: nobody's out any more.
    s = feedOf([{ type: "expedition_end", id: "A", status: "stopped", text: "Stopped by you." }], s);
    expect(s.quests).toEqual([]);
  });

  test("quests in different runs with the same id are kept apart", () => {
    const s = feedOf([
      start("A", "One"), start("B", "Two"),
      { type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "For A" },
      { type: "dispatch", ...scribe, questId: "q1", expeditionId: "B", brief: "For B" },
      { type: "tool", ...scribe, tool: "write_file", input: "{}", questId: "q1", expeditionId: "B" },
      { type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" },
    ]);
    expect(out(s)).toEqual(["Scribe | For B | Using write_file"]);
  });
});

describe("files the crew writes", () => {
  const path = "camp/agents/scribe/outputs/brief.md";
  const call = (p: string) => ({ type: "tool", ...scribe, tool: "write_file", input: JSON.stringify({ path: p, content: "# Brief" }), questId: "q1", expeditionId: "A" }) as Body;
  const made = (change: "created" | "updated", bytes: number) => ({ type: "file", ...scribe, path, change, bytes, questId: "q1", expeditionId: "A" }) as Body;

  test("a written file takes the place of the write_file line it came from, in its own quest", () => {
    const s = feedOf([
      start("A", "Write a brief"),
      { type: "dispatch", ...scribe, questId: "q1", expeditionId: "A" },
      call(path),
      { type: "tool", ...scribe, tool: "read_file", input: "{}", questId: "q1", expeditionId: "A" },
      made("created", 7),
      { type: "text", ...scribe, text: "Done", questId: "q1", expeditionId: "A" },
    ]);
    const quest = exp(s, "A").nodes[0] as Extract<ExpNode["nodes"][number], { kind: "quest" }>;
    expect(kinds(quest.nodes)).toEqual(["file", "tool", "msg"]);
    expect(quest.nodes[0]).toMatchObject({ kind: "file", who: "Scribe", path, change: "created", bytes: 7 });
  });

  test("a second write of it is a second card; with no line to stand in for, it goes at the end", () => {
    const s = feedOf([
      start("A", "Write a brief"),
      { type: "dispatch", ...scribe, questId: "q1", expeditionId: "A" },
      call(path), made("created", 7),
      call(path), made("updated", 12),
      made("updated", 20), // its call fell out of the replay buffer
    ]);
    const quest = exp(s, "A").nodes[0] as Extract<ExpNode["nodes"][number], { kind: "quest" }>;
    expect(quest.nodes.map((n) => (n.kind === "file" ? `${n.change}:${n.bytes}` : n.kind))).toEqual(["created:7", "updated:12", "updated:20"]);
  });

  test("a write of another file is left alone; one after its run ended goes at the end of the feed", () => {
    const s = feedOf([
      start("A", "Write a brief"),
      { type: "dispatch", ...scribe, questId: "q1", expeditionId: "A" },
      call("camp/agents/scribe/outputs/other.md"),
      made("created", 7),
      { type: "expedition_end", id: "A", status: "done", text: "" },
      { ...made("updated", 9), expeditionId: "gone" } as Body,
    ]);
    const quest = exp(s, "A").nodes[0] as Extract<ExpNode["nodes"][number], { kind: "quest" }>;
    expect(kinds(quest.nodes)).toEqual(["tool", "file"]);
    expect(kinds(s.items)).toEqual(["exp", "file"]);
  });
});

describe("the plan as a list", () => {
  const smith = { who: "Artificer", emoji: "🔨", depth: 1 };
  const steps = [{ n: 1, text: "Backend" }, { n: 2, text: "Studio UI" }, { n: 3, text: "I read the diffs" }];
  const plan = (s: FeedState) => findNodes(s.items, "plan")[0] as PlanNode;
  const says = (s: FeedState) => plan(s).steps.map((st) => `${st.n} ${stepState(st, plan(s).ended)}${st.quests.length ? ` (${st.quests.map((q) => q.who).join(", ")})` : ""}`);
  const approved: Parameters<typeof feedOf>[0] = [
    start("A", "Share a whole thread"),
    { type: "ask", id: "pl", kind: "plan", title: "🗺️  The Quartermaster's plan:", body: "1. Backend\n2. Studio UI\n3. I read the diffs", expeditionId: "A" },
    { type: "answered", id: "pl", answer: "" },
    { type: "plan", steps, expeditionId: "A" },
  ];

  test("it fills in as quests go out and come back; a step nobody is sent on is the Quartermaster's", () => {
    let s = feedOf(approved);
    expect(says(s)).toEqual(["1 todo", "2 todo", "3 todo"]);
    // The list sits right after the approved plan's card, which folds its own text away.
    expect(kinds(exp(s, "A").nodes)).toEqual(["ask", "plan"]);
    expect(findNodes(s.items, "ask")[0].listed).toBe(true);
    s = feedOf([
      { type: "dispatch", ...smith, questId: "q1", expeditionId: "A", brief: "Backend", step: 1 },
      { type: "dispatch", ...smith, questId: "q2", expeditionId: "A", brief: "Studio UI", step: 2 },
      { type: "dispatch", ...scout, questId: "q3", expeditionId: "A", brief: "Check the docs", step: 2 },
      { type: "dispatch", ...scout, questId: "q4", expeditionId: "A", brief: "Not part of the plan" },
    ], s);
    expect(says(s)).toEqual(["1 out (Artificer)", "2 out (Artificer, Scout)", "3 todo"]);
    expect(findNodes(s.items, "quest").map((q) => q.step)).toEqual([1, 2, 2, undefined]);
    expect(s.quests.map((q) => q.step)).toEqual([1, 2, 2, undefined]);
    s = feedOf([
      { type: "return", ...smith, status: "done", questId: "q1", expeditionId: "A" },
      { type: "return", ...scout, status: "done", questId: "q3", expeditionId: "A" },
    ], s);
    expect(says(s)).toEqual(["1 done (Artificer)", "2 out (Artificer, Scout)", "3 todo"]); // step 2 still has one out
    s = feedOf([{ type: "return", ...smith, status: "max_turns", questId: "q2", expeditionId: "A" }], s);
    expect(says(s)[1]).toBe("2 failed (Artificer, Scout)");
    // The run finishes well: what the Quartermaster kept for itself is done with it.
    s = feedOf([{ type: "return", ...scout, status: "done", questId: "q4", expeditionId: "A" }, { type: "expedition_end", id: "A", status: "done", text: "Done." }], s);
    expect(says(s)).toEqual(["1 done (Artificer)", "2 failed (Artificer, Scout)", "3 done"]);
  });

  test("stopped mid-way, what was out is cut short; a plan submitted again keeps the quests already sent", () => {
    let s = feedOf([...approved, { type: "dispatch", ...smith, questId: "q1", expeditionId: "A", step: 1 }]);
    const again = feedOf([{ type: "plan", steps: [{ n: 1, text: "Backend, narrower" }, { n: 2, text: "Viewer" }], expeditionId: "A" }], s);
    expect(findNodes(again.items, "plan").length).toBe(1);
    expect(says(again)).toEqual(["1 out (Artificer)", "2 todo"]);
    expect(plan(again).steps[0].text).toBe("Backend, narrower");
    s = feedOf([{ type: "expedition_end", id: "A", status: "stopped", text: "Stopped by you." }], s);
    expect(says(s)).toEqual(["1 stopped (Artificer)", "2 stopped", "3 stopped"]);
    // A dispatch naming a step the plan doesn't have, or with no plan at all, is just a quest.
    const none = feedOf([start("B", "No plan"), { type: "dispatch", ...scout, questId: "q9", expeditionId: "B", step: 4 }]);
    expect(findNodes(none.items, "plan")).toEqual([]);
    expect(findNodes(none.items, "quest")[0].step).toBe(4);
  });
});

describe("a plain chat", () => {
  test("nobody from the crew is in it: the Quartermaster isn't lit up, and the words come from the model", () => {
    const s = feedOf([
      { type: "expedition_start", id: "C", task: "What's a rebase?", source: "user", chat: true },
      { type: "text_delta", who: "Chat", emoji: "💬", depth: 0, delta: "A rebase", expeditionId: "C" },
      { type: "text", who: "Chat", emoji: "💬", depth: 0, text: "A rebase replays your commits.", expeditionId: "C" },
    ]);
    expect(s.crew.Quartermaster).toBeUndefined();
    expect(findNodes(s.items, "msg").map((m) => `${m.who}: ${m.text}`)).toEqual(["Chat: A rebase replays your commits."]);
    expect(s.quests).toEqual([]);
    // The same request as an expedition does light the Quartermaster up.
    expect(feedOf([start("E", "Plan it")]).crew.Quartermaster.status).toBe("active");
    const done = feedOf([{ type: "expedition_end", id: "C", status: "done", text: "A rebase replays your commits." }], s);
    expect(exp(done, "C").end?.status).toBe("done");
  });
});
