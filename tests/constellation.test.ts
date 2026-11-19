// The memory as a map: the log of when a line was used, the graph drawn from it, one line's
// history, and merging two lines into one with your approval. The smallest model is stood in for
// by a function, so nothing is called.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("constellation");
const { readMemory, writeMemory, fullMemory, MEMORY_MAX_CHARS } = await import("../src/memory.ts");
const { writeAbout, originsOf } = await import("../src/memlog.ts");
const rlog = await import("../src/recalllog.ts");
const g = await import("../src/memgraph.ts");
const k = await import("../src/keeping.ts");
const { recallTool } = await import("../src/recall.ts");
const { recordTurn } = await import("../src/threads.ts");
const { withExpedition } = await import("../src/context.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const inRun = <T>(id: string, fn: () => T | Promise<T>) => withExpedition({ id, project: "general", scope: [] }, async () => fn());
const logged = () => rlog.readRecalls().map((r) => [r.where, r.key, r.how, r.run]);
const clear = () => rmSync(rlog.RECALL_LOG, { recursive: true, force: true });

// ---------- The recall log ----------
test("a line is written down once per run, and once a day when there's no run to go by", () => {
  clear();
  rlog.logRecalls("agent:scout", [{ text: "- 2026-01-01 📌 Cite  Sources with links", score: 1.23456 }], "relevant", "run1");
  rlog.logRecalls("agent:scout", [{ text: "cite sources with links" }, { text: "- 2026-01-02 Prefer primary sources" }], "recall", "run1");
  rlog.logRecalls("agent:scout", [{ text: "- Cite sources with links" }], "relevant", "run2");
  rlog.logRecalls("agent:scribe", [{ text: "- Cite sources with links" }], "relevant", "run2"); // the same words in another place are another line
  rlog.logRecalls("about", [{ text: "- Eastern time" }, { text: "- Eastern time" }, { text: "   " }], "relevant");
  rlog.logRecalls("about", [{ text: "- Eastern time" }], "recall");
  assert.deepEqual(logged(), [
    ["agent:scout", "cite sources with links", "relevant", "run1"],
    ["agent:scout", "prefer primary sources", "recall", "run1"],
    ["agent:scout", "cite sources with links", "relevant", "run2"],
    ["agent:scribe", "cite sources with links", "relevant", "run2"],
    ["about", "eastern time", "relevant", undefined],
  ]);
  assert.equal(rlog.readRecalls()[0].score, 1.23);
  assert.match(rlog.readRecalls()[0].time, /^\d{4}-\d{2}-\d{2}T/);
  // What's on disk is what's read back, one entry a line.
  const onDisk = readFileSync(rlog.RECALL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(onDisk, rlog.readRecalls());
  // One line's, newest first, found by the line however it's written.
  assert.deepEqual(rlog.recallsOf("agent:scout", "- 2026-01-01 Cite sources with links").map((r) => r.run), ["run2", "run1"]);
  assert.deepEqual(rlog.recallsOf("agent:nobody", "Cite sources with links"), []);
});

test("the log keeps its newest entries and lets the oldest go", () => {
  clear();
  const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ text: `line number ${from + i}` }));
  rlog.logRecalls("agent:scout", many(0, rlog.RECALL_MAX), "relevant", "big");
  assert.equal(rlog.readRecalls().length, rlog.RECALL_MAX); // at the bound: nothing's dropped yet
  rlog.logRecalls("agent:scout", many(rlog.RECALL_MAX, 600), "relevant", "big");
  const now = rlog.readRecalls();
  assert.equal(now.length, rlog.RECALL_MAX);
  assert.equal(now.at(-1)!.key, `line number ${rlog.RECALL_MAX + 599}`);
  assert.equal(now[0].key, "line number 600");
  assert.equal(readFileSync(rlog.RECALL_LOG, "utf8").trim().split("\n").length, rlog.RECALL_MAX);
  // A line that was dropped can be written down again in the same run; one that's still there can't.
  rlog.logRecalls("agent:scout", [{ text: "line number 0" }, { text: "line number 600" }], "relevant", "big");
  assert.equal(rlog.readRecalls().length, rlog.RECALL_MAX + 1);
});

test("a log that can't be read or written never gets in a prompt's way", () => {
  clear();
  writeFileSync(rlog.RECALL_LOG, `not json\n{"time":"2026-01-01T00:00:00.000Z","where":"about","key":"kept","how":"recall"}\n{"key":7}\n\n`);
  assert.deepEqual(rlog.readRecalls().map((r) => r.key), ["kept"]);
  clear();
  mkdirSync(rlog.RECALL_LOG); // a folder where the file should be: nothing can be read or appended
  assert.doesNotThrow(() => rlog.logRecalls("about", [{ text: "- Eastern time" }], "relevant", "run9"));
  assert.doesNotThrow(() => rlog.logRelevant("about", "- Eastern time", { relevant: new Map([[0, 2]]) }, "run9"));
  assert.doesNotThrow(() => rlog.logAboutRelevant("eastern time", "run9"));
  assert.deepEqual(rlog.readRecalls(), []);
  assert.deepEqual(rlog.recallsOf("about", "Eastern time"), []);
  writeMemory("scout", "- 2026-01-01 Deploys go through the staging server first");
  assert.match(readMemory("scout", "deploy to the staging server"), /staging server/);
  // Odd input is no worse.
  clear();
  assert.doesNotThrow(() => rlog.logRecalls("about", [{ text: undefined as unknown as string }, { text: "ok then", score: NaN }], "recall"));
  assert.deepEqual(rlog.readRecalls().map((r) => [r.key, r.score]), [["ok then", undefined]]);
});

test("building a prompt writes down the lines that bear on the request, not the ones loaded for being pinned or new", async () => {
  clear();
  writeMemory("scout", ["# Lessons", "- 2026-01-01 📌 Answer in British English", "- 2026-01-02 Deploys go through the staging server first", "- 2026-01-03 The changelog lives in docs/changes.md"].join("\n"));
  // No request to judge by: nothing is written down, though every line is loaded.
  readMemory("scout");
  assert.deepEqual(logged(), []);
  await inRun("runA", () => {
    readMemory("scout", "Deploy the new build to the staging server");
    readMemory("scout", "Deploy the new build to the staging server"); // the same run builds its prompt again
  });
  assert.deepEqual(logged(), [["agent:scout", "deploys go through the staging server first", "relevant", "runA"]]);
  assert.ok(rlog.readRecalls()[0].score! > 0);

  // A memory too long to load whole: an old line that bears on the request is loaded and written
  // down; the newest lines are loaded too, and aren't.
  clear();
  const filler = Array.from({ length: 80 }, (_, i) => `- 2026-02-${String((i % 28) + 1).padStart(2, "0")} Filler note ${i} about nothing in particular, long enough to take up room in the prompt`);
  writeMemory("scribe", ["- 2026-01-01 Kubernetes rollouts need the canary flag", ...filler].join("\n"));
  assert.ok(fullMemory("scribe").length > MEMORY_MAX_CHARS);
  await inRun("runB", () => {
    const text = readMemory("scribe", "Do the kubernetes rollout");
    assert.match(text, /canary flag/);
    assert.match(text, /Filler note 79/);
  });
  assert.deepEqual(logged(), [["agent:scribe", "kubernetes rollouts need the canary flag", "relevant", "runB"]]);

  // The note about you is loaded whole whatever the request: its lines are judged the same way.
  clear();
  writeAbout("- 2026-01-01 Prefers short answers\n- 2026-01-02 The staging server is called Juniper");
  rlog.logAboutRelevant("Restart the staging server", "runC");
  assert.deepEqual(logged(), [["about", "the staging server is called juniper", "relevant", "runC"]]);
});

test("what the recall tool brings back from a memory is written down as recalled", async () => {
  clear();
  writeMemory("artificer", "- 2026-01-01 The flaky nav test needs a retry wrapper\n- 2026-01-02 Lint runs with oxlint");
  await inRun("runR", async () => {
    assert.match(String(await recallTool("artificer").run!({ query: "flaky nav test", where: "memory" })), /From your memory/);
    assert.match(String(await recallTool("artificer").run!({ query: "zebra crossing", where: "memory" })), /^Nothing/);
  });
  assert.deepEqual(logged(), [["agent:artificer", "the flaky nav test needs a retry wrapper", "recall", "runR"]]);
});

// ---------- The graph ----------
const place = (where: string, name: string, lines: (string | { text: string; date?: string; pinned?: boolean })[]) =>
  ({ where, name, kind: where.startsWith("agent:") ? "agent" as const : where === "about" ? "about" as const : "project" as const, lines: lines.map((l) => (typeof l === "string" ? { text: l } : l)) });
const at = (n: number) => `2026-03-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const used = (where: string, text: string, day: number, run?: string, how: "relevant" | "recall" = "relevant", score?: number) =>
  ({ time: at(day), where, key: text.toLowerCase(), how, ...(score !== undefined ? { score } : {}), ...(run ? { run } : {}) });

test("the graph: a line is one point, with how often it was used, when last and where", () => {
  const places = [
    place("agent:scout", "Scout's memory", [{ text: "Cite sources with links", date: "2026-01-01", pinned: true }, "Prefer primary sources", "Cite sources with links"]),
    place("about", "About you", ["Eastern time"]),
  ];
  const recalls = [
    used("agent:scout", "Cite sources with links", 1, "run1"),
    used("agent:scout", "Cite sources with links", 3, "run2", "recall"),
    used("agent:scout", "Cite sources with links", 2),
    used("agent:scout", "A line that was forgotten since", 2, "run2"),
    used("agent:scribe", "Cite sources with links", 5, "run2"), // another place's line
  ];
  const threadOf = (run: string) => (run === "run2" ? { id: "t2", title: "Research the market" } : run === "run1" ? { id: "t1" } : undefined);
  const graph = g.buildGraph(places, recalls, threadOf);
  assert.deepEqual(graph.nodes.map((n) => [n.where, n.text, n.recalls]), [["agent:scout", "Cite sources with links", 3], ["agent:scout", "Prefer primary sources", 0], ["about", "Eastern time", 0]]);
  const [cite, prefer] = graph.nodes;
  assert.deepEqual([cite.id, cite.place, cite.kind, cite.date, cite.pinned], [g.nodeId("agent:scout", "- 2026-01-01 📌 cite  sources with LINKS"), "Scout's memory", "agent", "2026-01-01", true]);
  assert.match(cite.id, /^m[0-9a-f]{12}$/);
  assert.notEqual(cite.id, g.nodeId("agent:scribe", "Cite sources with links"));
  assert.deepEqual([cite.lastRecalled, cite.lastThread], [at(3), { id: "t2", title: "Research the market" }]);
  assert.deepEqual([prefer.pinned, prefer.lastRecalled, prefer.lastThread, prefer.date], [false, undefined, undefined, undefined]);
  assert.equal(graph.since, at(1));
  assert.deepEqual(g.buildGraph(places, []), { nodes: graph.nodes.map((n) => ({ ...n, recalls: 0, lastRecalled: undefined, lastThread: undefined })).map((n) => JSON.parse(JSON.stringify(n))), edges: [] });
  assert.deepEqual(g.buildGraph([], recalls), { nodes: [], edges: [], since: at(1) });
});

test("the graph: lines alike are joined, each to its three strongest at most", () => {
  const lines = ["Sign every commit with the GPG key", "Every commit is signed with the GPG key, checked after", "A commit without a GPG signature is never pushed", "GPG key commit signing fails inside the sandbox", "Commit messages: GPG signed, key named in the body", "The office is closed on Fridays"];
  const graph = g.buildGraph([place("agent:warden", "Warden's memory", lines.slice(0, 3)), place("about", "About you", lines.slice(3))], []);
  const alike = graph.edges.filter((e) => e.kind === "alike");
  assert.ok(alike.length >= 4, `only ${alike.length} joined`);
  const ends = new Map<string, number>();
  for (const e of alike) for (const id of [e.a, e.b]) ends.set(id, (ends.get(id) ?? 0) + 1);
  assert.ok([...ends.values()].every((n) => n <= 3), "a line kept more than three");
  assert.ok(alike.every((e) => e.weight >= g.ALIKE_AT && e.weight <= 1 && e.a !== e.b));
  assert.ok(alike.some((e) => graph.nodes.find((n) => n.id === e.a)!.where !== graph.nodes.find((n) => n.id === e.b)!.where), "lines in different places can be alike");
  assert.ok(!ends.has(g.nodeId("about", "The office is closed on Fridays")));
  // Asked twice, the same joins in the same order.
  assert.deepEqual(g.buildGraph([place("agent:warden", "Warden's memory", lines.slice(0, 3)), place("about", "About you", lines.slice(3))], []).edges, graph.edges);
});

test("the graph: lines used in the same run at least twice are joined as used together", () => {
  const places = [place("agent:scout", "Scout's memory", ["Alpha note", "Beta note", "Gamma thing"]), place("about", "About you", ["Delta item"])];
  const recalls = [
    used("agent:scout", "Alpha note", 1, "r1"), used("agent:scout", "Beta note", 1, "r1"), used("about", "Delta item", 1, "r1"),
    used("agent:scout", "Alpha note", 2, "r2"), used("agent:scout", "Beta note", 2, "r2"), used("agent:scout", "Gamma thing", 2, "r2"),
    used("agent:scout", "Alpha note", 3, "r3"), used("agent:scout", "Beta note", 3, "r3"), used("agent:scout", "Gone since", 3, "r3"),
    used("agent:scout", "Gamma thing", 4), used("about", "Delta item", 4), // no run: nothing to say they were together
  ];
  const together = g.buildGraph(places, recalls).edges.filter((e) => e.kind === "together");
  assert.equal(together.length, 1);
  assert.deepEqual([[together[0].a, together[0].b].sort(), together[0].weight], [[g.nodeId("agent:scout", "Alpha note"), g.nodeId("agent:scout", "Beta note")].sort(), 3]);
});

test("why: one line's history, newest first, with the conversation it was used in", () => {
  const recalls = [
    used("agent:scout", "Cite sources with links", 1, "run1", "relevant", 2.5),
    used("agent:scribe", "Cite sources with links", 2, "run1"),
    used("agent:scout", "Cite sources with links", 4),
    used("agent:scout", "Cite sources with links", 3, "run2", "recall", 7),
    used("agent:scout", "Something else", 5, "run2"),
  ];
  const threadOf = (run: string) => (run === "run2" ? { id: "t2", title: "Research the market" } : undefined);
  assert.deepEqual(g.whyOf(recalls, "agent:scout", "- 2026-01-01 📌 Cite sources with links", threadOf), [
    { time: at(4), how: "relevant" },
    { time: at(3), how: "recall", score: 7, run: "run2", thread: "t2", title: "Research the market" },
    { time: at(1), how: "relevant", score: 2.5, run: "run1" },
  ]);
  assert.deepEqual(g.whyOf(recalls, "agent:scout", "Never used"), []);
  assert.equal(g.whyOf(recalls, "agent:scout", "Cite sources with links", threadOf, 2).length, 2);
});

test("the camp's own graph and history: real places, real runs, real conversations", async () => {
  clear();
  writeMemory("scout", "- 2026-01-01 📌 Cite sources with links\n- 2026-01-02 Deploys go through the staging server first");
  writeAbout("- 2026-01-03 The staging server is called Juniper");
  recordTurn({ thread: "tg", expedition: "runG", agent: "scout", direct: true, task: "Ship it to staging", reply: "Done.", status: "done" });
  await inRun("runG", () => { readMemory("scout", "Deploy to the staging server"); rlog.logAboutRelevant("Deploy to the staging server", "runG"); });
  await inRun("runH", () => { readMemory("scout", "Is the staging server deploy finished?"); rlog.logAboutRelevant("Is the staging server deploy finished?", "runH"); });

  const graph = g.memoryGraph();
  const deploy = graph.nodes.find((n) => n.text.startsWith("Deploys go"))!, juniper = graph.nodes.find((n) => n.where === "about")!, cite = graph.nodes.find((n) => n.text.startsWith("Cite"))!;
  assert.deepEqual([deploy.where, deploy.place, deploy.kind, deploy.date, deploy.recalls], ["agent:scout", "Scout's memory", "agent", "2026-01-02", 2]);
  assert.deepEqual([cite.pinned, cite.recalls, cite.lastRecalled], [true, 0, undefined]);
  assert.equal(juniper.recalls, 2);
  assert.ok(graph.edges.some((e) => e.kind === "together" && [e.a, e.b].sort().join() === [deploy.id, juniper.id].sort().join() && e.weight === 2));
  assert.ok(graph.since);

  const why = g.memoryWhy("agent:scout", deploy.text);
  assert.deepEqual(why.map((w) => [w.how, w.run, w.thread, w.title]), [["relevant", "runH", undefined, undefined], ["relevant", "runG", "tg", "Ship it to staging"]]);
  assert.ok(why.every((w) => typeof w.score === "number"));
  assert.deepEqual(g.memoryWhy("agent:scout", "Cite sources with links"), []);
  assert.throws(() => g.memoryWhy("agent:nobody", "x"), /no such memory/);
});

// ---------- Merging two lines ----------
test("merging: one line is drafted for two, waits for you, and takes both lines' place when you approve", async () => {
  writeMemory("warden", "- 2026-01-01 📌 Sign every commit with -S\n- 2026-02-01 Review the diff before approving\n- 2026-03-01 Commits must be signed with the GPG key");
  const asked: string[] = [];
  const ask = async (system: string, prompt: string) => { asked.push(system, prompt); return '```\n- 2026-03-01 "Sign every commit with -S, using the GPG key"\n```'; };
  // The newer line is named first here: the draft is still asked for older-then-newer.
  const p = await k.proposeMerge("agent:warden", "- 2026-03-01 Commits must be signed with the GPG key", "Sign every commit with -S", ask);
  assert.ok(p.kind === "merge");
  assert.deepEqual([p.where, p.name, p.lines, p.text], ["agent:warden", "Warden's memory", ["Sign every commit with -S", "Commits must be signed with the GPG key"], "Sign every commit with -S, using the GPG key"]);
  assert.match(asked[0], /merge two notes/);
  assert.ok(asked[1].indexOf("Sign every commit with -S") < asked[1].indexOf("Commits must be signed"));
  assert.equal(fullMemory("warden").split("\n").length, 3); // nothing's changed yet

  // Asked for the same two again, the newer draft takes the older one's place in the queue.
  const again = await k.proposeMerge("agent:warden", "Sign every commit with -S", "Commits must be signed with the GPG key", async () => "Sign every commit with -S (GPG key)");
  assert.deepEqual(k.proposals().filter((x) => x.kind === "merge").map((x) => x.id), [again.id]);
  // A run's suggestions replace earlier suggestions, never a merge that's waiting.
  k.proposeKeeps([{ where: "agent:warden", text: "Check the signature after committing" }], "runK");
  k.proposeKeeps([{ where: "agent:warden", text: "Check the signature after every commit" }], "runL");
  assert.ok(k.proposals().some((x) => x.id === again.id));

  // Approved (with your own edit of the draft): one line where the later one was, dated as the newer, pinned because one was.
  assert.deepEqual(k.settleProposal(again.id, "approve", "Sign every commit with -S, using the GPG key"), { ok: true, kept: "Warden's memory" });
  assert.equal(fullMemory("warden").trim(), "- 2026-02-01 Review the diff before approving\n- 2026-03-01 📌 Sign every commit with -S, using the GPG key");
  assert.equal(originsOf("agent:warden").get("sign every commit with -s, using the gpg key")?.how, "tidy");
  assert.ok(!k.proposals().some((x) => x.id === again.id));
});

test("merging: what can't be merged says why, and a draft whose lines have gone isn't applied", async () => {
  writeMemory("scribe", "- 2026-01-01 Short sentences\n- 2026-01-02 Keep sentences short and plain\n- 2026-01-03 No emoji in headings");
  const say = (text: string) => async () => text;
  await assert.rejects(k.proposeMerge("agent:scribe", "Short sentences", "short  SENTENCES", say("x")), /two different lines/);
  await assert.rejects(k.proposeMerge("agent:scribe", "Short sentences", "A line that isn't there", say("x")), /no longer there/);
  await assert.rejects(k.proposeMerge("agent:scribe", "Short sentences", "No emoji in headings", say("\n  \n")), /Nothing usable came back/);
  await assert.rejects(k.proposeMerge("agent:nobody", "a", "b", say("x")), /no such memory/);
  assert.equal(k.cleanMerge("- 2026-01-01 📌 “One line.”\nAnd a second the model shouldn't have sent"), "One line.");
  assert.equal(k.cleanMerge("x".repeat(601)), null);

  const p = await k.proposeMerge("agent:scribe", "Short sentences", "Keep sentences short and plain", say("Keep sentences short and plain"));
  assert.ok(k.forgetLine("agent:scribe", "Short sentences"));
  assert.throws(() => k.settleProposal(p.id, "approve"), /has changed since this was drafted/);
  assert.ok(!k.proposals().some((x) => x.id === p.id));
  assert.equal(fullMemory("scribe").trim(), "- 2026-01-02 Keep sentences short and plain\n- 2026-01-03 No emoji in headings");

  // Dismissed: gone from the queue, the memory as it was.
  const q = await k.proposeMerge("agent:scribe", "Keep sentences short and plain", "No emoji in headings", say("Short plain sentences, no emoji in headings"));
  assert.deepEqual(k.settleProposal(q.id, "dismiss"), { ok: true });
  assert.equal(fullMemory("scribe").trim().split("\n").length, 2);
});
