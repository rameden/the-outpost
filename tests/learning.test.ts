// The learning review: when it sets out (every N tool calls, one at a time), what it's allowed
// to do (propose a memory line, propose a skill, read a skill; nothing else), and that it's a
// copy of the run's own request (same system prompt, tools and model, so it reads the same
// cache) which never touches the run and never applies anything.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, lastToolResults, type Reply } from "./helpers/fake-api.ts";

enterSandbox("learning");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

const L = await import("../src/learning.ts");
const { runDirect } = await import("../src/quartermaster.ts");
const { proposals } = await import("../src/keeping.ts");
const { pendingSkills, approveSkill, skillOwners } = await import("../src/forge.ts");
const { readMemory } = await import("../src/memory.ts");
const { readAbout } = await import("../src/memlog.ts");
const { setLearning } = await import("../src/settings.ts");
const { addProject } = await import("../src/conversations.ts");
const { recentQuests } = await import("../src/questlog.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => {
  events.length = 0; api.seen.length = 0;
  for (const p of ["camp/memory-proposals.json", "skills/_pending", L.REVIEW_LOG]) rmSync(p, { recursive: true, force: true });
  setLearning({ review: false, every: 10 });
});

const SCOUT = { agent: "scout", name: "Scout", toolNames: ["read_file", "write_file", "remember", "recall", "grep"] };
const QM = { agent: "quartermaster", name: "Quartermaster", toolNames: ["dispatch", "propose_skill", "read_file", "remember", "project_remember"] };
const keeps = () => proposals().flatMap((p) => (p.kind === "keep" ? [`${p.where}: ${p.text}`] : []));
const drafts = () => pendingSkills().map((p) => `${p.owner}/${p.name}`);
const tick = () => new Promise((ok) => setImmediate(ok));

// ---------- The interval ----------
test("a review is due every N tool calls, and never when it's switched off", () => {
  assert.equal(L.reviewDue(9, 0, 10), false);
  assert.equal(L.reviewDue(10, 0, 10), true);
  assert.equal(L.reviewDue(19, 10, 10), false);
  assert.equal(L.reviewDue(20, 10, 10), true);
  assert.equal(L.reviewDue(500, 0, null), false, "off");
  assert.equal(L.reviewDue(500, 0, 0), false);

  assert.equal(L.reviewEvery(), null, "off until you turn it on");
  setLearning({ review: true });
  assert.equal(L.reviewEvery(), 10, "the default interval");
  setLearning({ every: 25 });
  assert.equal(L.reviewEvery(), 25);
});

test("a run's reviews: one at the interval, one at a time, the next after N more calls", async () => {
  const launched: { calls: number; already: string[] }[] = [];
  let calls = 0;
  let release!: (v: { proposed: string[] } | null) => void;
  const r = new L.Reviewer(3, (snapshot, already) => {
    launched.push({ calls: snapshot.length, already });
    return new Promise((ok) => (release = ok));
  });
  const note = (n: number) => { calls += n; r.note(n, () => Array.from({ length: calls }, () => ({ role: "user" as const, content: "x" }))); };

  note(1); note(1);
  assert.equal(launched.length, 0, "two calls: not yet");
  note(1);
  assert.deepEqual(launched.map((l) => l.calls), [3], "the third call sets one off");
  note(2); note(2);
  assert.equal(launched.length, 1, "it's due again, but the first is still out");
  release({ proposed: ["about: Prefers short answers"] });
  await L.reviewsSettled();
  note(1);
  assert.deepEqual(launched.map((l) => l.calls), [3, 8], "the next call after it's back");
  assert.deepEqual(launched[1].already, ["about: Prefers short answers"], "and it's told what the first put forward");
  release(null);
  await L.reviewsSettled();
  note(2);
  assert.equal(launched.length, 2, "two calls since the last: not yet");
  note(1);
  assert.equal(launched.length, 3);
  assert.equal(r.reviews, 3);
  release(null);
  await L.reviewsSettled();
});

test("a turn with several tool calls counts them all, and a failed review never reaches the run", async () => {
  let launched = 0;
  const r = new L.Reviewer(4, async () => { launched++; throw new Error("the API fell over"); });
  r.note(5, () => []);
  assert.equal(launched, 1);
  await L.reviewsSettled();
  r.note(4, () => { throw new Error("couldn't copy"); });
  await tick();
  r.note(4, () => []);
  assert.equal(launched, 2, "a snapshot that couldn't be taken is skipped, and the next one still goes");
  await L.reviewsSettled();

  let off = 0;
  const none = new L.Reviewer(null, async () => { off++; return null; });
  none.note(1000, () => []);
  assert.equal(off, 0, "switched off: nothing is ever sent");
});

// ---------- The whitelist ----------
test("only remember, project_remember, propose_skill and read_file are answered", async () => {
  assert.deepEqual([...L.REVIEW_TOOLS], ["remember", "project_remember", "propose_skill", "read_file"]);
  const out = L.emptyOutcome();
  for (const name of ["write_file", "edit_file", "run_command", "dispatch", "web_search", "wiki_write", "recall", "grep", "submit_plan", "open_pull_request", "no_such_tool"]) {
    const r = await L.reviewTool(name, { path: "review-was-here.txt", content: "x", command: "touch review-was-here.txt" }, { ...QM, toolNames: [...QM.toolNames, name] }, out);
    assert.equal(r.refused, true, name);
    assert.match(r.text, /isn't available in a learning review/);
    assert.match(r.text, /Do not retry/);
  }
  assert.equal(out.refused.length, 11);
  assert.ok(!existsSync("review-was-here.txt"));
  assert.deepEqual([keeps(), drafts()], [[], []]);

  // A tool on the list still isn't answered for someone who doesn't have it.
  const notMine = await L.reviewTool("propose_skill", { owner: "scout", name: "x", description: "d", instructions: "1. y", reason: "r" }, SCOUT, L.emptyOutcome());
  assert.equal(notMine.refused, true);
  assert.deepEqual(drafts(), []);
});

test("remember only proposes: the line waits in the approval queue, in one place", async () => {
  const out = L.emptyOutcome();
  const scope = { ...SCOUT, run: "run-1" };
  const mine = await L.reviewTool("remember", { entry: "The staging API needs the x-env header\nand a second line that's dropped" }, scope, out);
  assert.match(mine.text, /Proposed/);
  assert.match(mine.text, /NOT in memory yet/);
  const you = await L.reviewTool("remember", { entry: "Prefers the answer first, then the reasoning", about: "user" }, scope, out);
  assert.equal(you.refused, false);

  assert.deepEqual(keeps(), ["agent:scout: The staging API needs the x-env header", "about: Prefers the answer first, then the reasoning"]);
  assert.equal(proposals().every((p) => p.kind === "keep" && p.run === "run-1"), true, "each knows the run it came from");
  assert.doesNotMatch(readMemory("scout"), /x-env/, "nothing was written to memory");
  assert.doesNotMatch(readAbout(), /answer first/, "or to the note about you");
  assert.deepEqual(out.memory, keeps());

  const again = await L.reviewTool("remember", { entry: "The staging API needs the x-env header" }, scope, out);
  assert.match(again.text, /already/);
  assert.equal(keeps().length, 2, "the same line isn't queued twice");

  // Rewriting memory isn't something a review can do.
  for (const mode of ["rewrite", "brief"]) {
    const no = await L.reviewTool("remember", { entry: "Everything, rewritten", mode }, scope, out);
    assert.equal(no.refused, true, mode);
  }
  assert.equal(keeps().length, 2);
});

test("project_remember needs a project, and a review puts forward three lines at most", async () => {
  const none = await L.reviewTool("project_remember", { entry: "Deploys go out on Tuesdays" }, QM, L.emptyOutcome());
  assert.equal(none.refused, true, "the run isn't in a project");

  const out = L.emptyOutcome();
  const harbour = addProject("Harbour").id;
  const scope = { ...QM, project: harbour };
  assert.equal((await L.reviewTool("project_remember", { entry: "Deploys go out on Tuesdays" }, scope, out)).refused, false);
  assert.deepEqual(keeps(), [`project:${harbour}: Deploys go out on Tuesdays`]);
  assert.equal((await L.reviewTool("project_remember", { entry: "All of it, again", mode: "rewrite" }, scope, out)).refused, true);

  await L.reviewTool("remember", { entry: "Lint runs before the type check in CI" }, scope, out);
  await L.reviewTool("remember", { entry: "Wants British spelling in user-facing copy", about: "user" }, scope, out);
  const fourth = await L.reviewTool("remember", { entry: "Fixtures live beside the test that uses them" }, scope, out);
  assert.equal(fourth.refused, true);
  assert.match(fourth.text, /at most 3/);
  assert.equal(keeps().length, L.MAX_MEMORY_PER_REVIEW);
});

test("propose_skill drafts into the waiting pile, signed, one per review; an existing skill must be read first", async () => {
  const out = L.emptyOutcome();
  const made = await L.reviewTool("propose_skill", { owner: "artificer", name: "bisect-flaky-test", description: "Find which commit made a test flaky",
    instructions: "1. Run the test 20 times at each step: one pass proves nothing about a flaky test.", reason: "Came up twice." }, QM, out);
  assert.match(made.text, /Proposed artificer\/bisect-flaky-test/);
  assert.match(made.text, /NOT active until the user approves/);
  assert.deepEqual(drafts(), ["artificer/bisect-flaky-test"]);
  assert.ok(!existsSync("skills/artificer/bisect-flaky-test"), "it isn't a skill until you approve it");
  assert.match(readFileSync("skills/_pending/artificer/bisect-flaky-test/SKILL.md", "utf8"), /^created_by: quartermaster \(learning review\)$/m);

  const second = await L.reviewTool("propose_skill", { owner: "scribe", name: "another-one", description: "d", instructions: "1. x", reason: "r" }, QM, out);
  assert.equal(second.refused, true);
  assert.match(second.text, /at most 1 skill/);
  assert.deepEqual(drafts(), ["artificer/bisect-flaky-test"]);

  // Replacing a skill that's in use: only by something written with the current one in view.
  const blind = L.emptyOutcome();
  const better = { owner: "scribe", name: "house-style", description: "The house style", instructions: "1. Sentence case in headings.", reason: "A rule was wrong." };
  const no = await L.reviewTool("propose_skill", better, QM, blind);
  assert.equal(no.refused, true);
  assert.match(no.text, /Read skills\/scribe\/house-style\/SKILL\.md first/);
  const read = await L.reviewTool("read_file", { path: "skills/scribe/house-style/SKILL.md" }, QM, blind);
  assert.equal(read.text, readFileSync("skills/scribe/house-style/SKILL.md", "utf8"));
  const yes = await L.reviewTool("propose_skill", better, QM, blind);
  assert.match(yes.text, /would replace the current version/);
  assert.doesNotMatch(readFileSync("skills/scribe/house-style/SKILL.md", "utf8"), /Sentence case in headings/, "the skill in use is unchanged");

  // Approval is still yours, and the skill keeps the line saying who wrote it.
  assert.equal(approveSkill("artificer", "bisect-flaky-test"), true);
  assert.match(readFileSync("skills/artificer/bisect-flaky-test/SKILL.md", "utf8"), /^created_by: quartermaster \(learning review\)$/m);
  rmSync("skills/artificer/bisect-flaky-test", { recursive: true, force: true });
});

test("read_file reaches skills and nothing else, and isn't counted as a use", async () => {
  writeFileSync(".env", "SECRET=nope\n");
  mkdirSync("camp/agents/scout", { recursive: true });
  writeFileSync("camp/agents/scout/memory.md", "- private\n");
  const out = L.emptyOutcome();
  for (const path of [".env", "camp/agents/scout/memory.md", "skills/../.env", "skills/scribe/house-style/../../../.env", "/etc/hosts", "skills/_pending/scout/x/SKILL.md", "skills/scribe", "package.json"]) {
    const r = await L.reviewTool("read_file", { path }, SCOUT, out);
    assert.equal(r.refused, true, path);
    assert.doesNotMatch(r.text, /SECRET|private/);
  }
  const ok = await L.reviewTool("read_file", { path: "skills/shared/eng-synthesis/references/adr.md" }, SCOUT, out);
  assert.equal(ok.refused, false, "a skill's other files can be read too");
  assert.equal((await L.reviewTool("read_file", { path: "skills/scribe/no-such/SKILL.md" }, SCOUT, out)).text, "There's no file skills/scribe/no-such/SKILL.md.");
  const used = existsSync("camp/skill-usage.json") ? JSON.parse(readFileSync("camp/skill-usage.json", "utf8")).skills ?? {} : {};
  assert.equal(used["shared/eng-synthesis"], undefined, "a review reading a skill isn't the crew using it");
});

test("a skill written out in the reply is read as a proposal", () => {
  const text = "Nothing for memory.\n<skill_proposal>\nowner: scout\nname: trace-a-config-value\ndescription: Find where a setting really comes from\nreason: Asked for three times.\n---\n" +
    "1. Search for the key, then for its env name.\n---\n2. Read the loader last.\n</skill_proposal>\nThanks.";
  assert.deepEqual(L.skillBlocks(text), [{ owner: "scout", name: "trace-a-config-value", description: "Find where a setting really comes from", reason: "Asked for three times.",
    instructions: "1. Search for the key, then for its env name.\n---\n2. Read the loader last." }]);
  assert.deepEqual(L.skillBlocks("<skill_proposal>\nowner: scout\nname: x\n</skill_proposal>"), [], "no body: not a proposal");
  assert.deepEqual(L.skillBlocks("Nothing to save."), []);
});

test("a skill in the reply is a draft like any other: signed, and never over a skill the review didn't read", async () => {
  const block = (owner: string, name: string) => `<skill_proposal>\nowner: ${owner}\nname: ${name}\ndescription: When to use it\nreason: Because.\n---\n1. Do the thing.\n</skill_proposal>`;
  const blind = L.emptyOutcome();
  await L.proposeFromText(block("scribe", "house-style"), SCOUT, blind);
  assert.deepEqual([blind.skills, drafts()], [[], []], "it never read the skill it would replace");

  const out = L.emptyOutcome();
  await L.proposeFromText(`${block("scout", "first-one")}\n${block("scout", "second-one")}`, SCOUT, out);
  assert.deepEqual(drafts(), ["scout/first-one"], "one skill a review, however it's put forward");
  assert.match(readFileSync("skills/_pending/scout/first-one/SKILL.md", "utf8"), /^created_by: scout \(learning review\)$/m);

  // The owners the prompt offers are the ones a draft can be filed under.
  assert.match(L.reviewPrompt(SCOUT), new RegExp(`owner: ${skillOwners().join(" \\| ")}\n`));
});

// ---------- What it's told ----------
test("the review prompt carries the rules, and names only the tools this crew member has", () => {
  const scout = L.reviewPrompt(SCOUT);
  assert.match(scout, /do NOT continue it/);
  assert.match(scout, /only a PROPOSAL/);
  assert.match(scout, /Only these calls are answered: remember \(one line, mode "append"\); read_file, for files under skills\/ only\./);
  assert.match(scout, /<skill_proposal>/, "no propose_skill tool: a skill is written out in the reply");
  assert.match(scout, /Nothing to save\./);
  // Hermes's rules: each fact in one place, only what the conversation supports, skills that are
  // general and lead with the procedure, pitfalls as a rule and why, and what's never captured.
  assert.match(scout, /each fact goes to exactly ONE of them, never two/);
  assert.match(scout, /About the USER/);
  assert.match(scout, /About the ENVIRONMENT/);
  assert.match(scout, /Save only what this conversation supports/);
  assert.match(scout, /Class-level, not this task/);
  assert.match(scout, /Procedure first/);
  assert.match(scout, /a rule that generalises, plus one clause of WHY/);
  assert.match(scout, /Failures the environment caused/);
  assert.match(scout, /Claims that a tool or feature doesn't work/);
  assert.match(scout, /The story of one task/);
  assert.match(scout, /Dead ends that were never resolved/);

  const qm = L.reviewPrompt({ ...QM, project: "p-harbour" }, ["about: Prefers short answers"]);
  assert.match(qm, /remember \(one line, mode "append"\); project_remember \(one line, mode "append"\); propose_skill; read_file/);
  assert.doesNotMatch(qm, /<skill_proposal>/);
  assert.match(qm, /Already put forward from this run \(don't repeat them\)\n- about: Prefers short answers/);
  assert.doesNotMatch(L.reviewPrompt(QM), /project_remember \(one line/, "no project: project_remember isn't offered");
});

test("the prompt is added after the snapshot, which is left as it was", () => {
  const snapshot: any[] = [
    { role: "user", content: "Find the owner of src/app.ts" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "grep", input: { pattern: "app" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "src/app.ts" }] },
  ];
  const before = structuredClone(snapshot);
  const sent = L.withPrompt(snapshot, "REVIEW");
  assert.deepEqual(snapshot, before, "the snapshot isn't written to");
  assert.deepEqual(sent.slice(0, 2), before.slice(0, 2), "everything before the last message is the same, so the cache is read");
  assert.deepEqual(sent[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "src/app.ts" }, { type: "text", text: "REVIEW" }] });

  assert.deepEqual(L.withPrompt([{ role: "user", content: "hi" }], "REVIEW"), [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "text", text: "REVIEW" }] }]);
  assert.deepEqual(L.withPrompt([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], "REVIEW").at(-1), { role: "user", content: [{ type: "text", text: "REVIEW" }] });
});

// ---------- One review ----------
test("a review answers tool calls only through the whitelist, stops after four turns, and logs what it cost", async () => {
  const sent: any[][] = [];
  let n = 0;
  const LESSONS = ["Staging deploys need the x-env header", "Fixtures live beside the test that reads them", "Lint runs before the type check in continuous integration"];
  const run = (over: object = {}) => ({
    ...QM, model: "claude-test", project: "general", run: "run-9",
    ask: async (messages: any[]) => {
      sent.push(structuredClone(messages));
      n++;
      return { stop_reason: "tool_use", usage: { input: 10, output: 5, cacheRead: 900, cacheWrite: 0 }, costUsd: 0.002,
        content: [{ type: "tool_use", id: `u${n}`, name: n === 1 ? "write_file" : "remember", input: n === 1 ? { path: "review-was-here.txt", content: "x" } : { entry: LESSONS[n - 2] } }] };
    },
    ...over,
  });
  let spent = 0;
  const done = await L.runReview(run({ spend: (usd: number) => (spent += usd) }), [{ role: "user", content: "Do the thing" }]);
  assert.equal(done.turns, L.MAX_REVIEW_TURNS, "it can't go on for ever");
  assert.equal(sent.length, 4);
  assert.match(sent[0][0].content[1].text, /^\[Learning review\./);
  assert.deepEqual(sent[1].at(-1).content[0], { type: "tool_result", tool_use_id: "u1", is_error: true,
    content: "Refused: write_file isn't available in a learning review. Only remember, project_remember, propose_skill, read_file are answered here. Do not retry." });
  assert.ok(!existsSync("review-was-here.txt"));
  assert.deepEqual([done.memory, done.skills, done.refused], [3, 0, 1]);
  assert.equal(done.proposed.length, 3);
  assert.ok(Math.abs(done.costUsd - 0.008) < 1e-9 && Math.abs(spent - 0.008) < 1e-9, "every turn's cost goes to the run's tally");
  assert.deepEqual(done.usage, { input: 40, output: 20, cacheRead: 3600, cacheWrite: 0 });

  const logged = L.reviews();
  assert.equal(logged.length, 1);
  assert.deepEqual([logged[0].agent, logged[0].model, logged[0].runtime, logged[0].run, logged[0].project, logged[0].turns, logged[0].memory, logged[0].refused],
    ["quartermaster", "claude-test", "api", "run-9", "general", 4, 3, 1]);
  assert.ok(events.some((e) => e.type === "notice" && /Learning review of Quartermaster's run put 3 things forward/.test(e.text)));

  // Over budget, or stopped: nothing is sent at all, and nothing is logged.
  n = 0; sent.length = 0;
  const skipped = await L.runReview(run({ overBudget: () => true }), [{ role: "user", content: "x" }]);
  assert.deepEqual([skipped.turns, sent.length, L.reviews().length], [0, 0, 1]);
  const gone = new AbortController(); gone.abort();
  assert.equal((await L.runReview(run({ signal: gone.signal }), [{ role: "user", content: "x" }])).turns, 0);

  // A review that fails says so in the log and nowhere else.
  const failed = await L.runReview(run({ ask: async () => { throw new Error("529 overloaded"); } }), [{ role: "user", content: "x" }]);
  assert.match(failed.error ?? "", /overloaded/);
});

// ---------- End to end ----------
const inReview = (b: any) => JSON.stringify(b.messages).includes("[Learning review.");

test("off by default: a long run sends nothing but its own turns", async () => {
  let turns = 0;
  script = () => (++turns <= 6 ? { tools: [{ name: "list_dir", input: { path: "." } }, { name: "list_dir", input: { path: "skills" } }] } : { text: "REPORT: looked around." });
  const r = await runDirect("artificer", "Look around the camp");
  await L.reviewsSettled();
  assert.equal(r?.status, "done");
  assert.equal(api.seen.length, 7);
  assert.equal(api.seen.some((s) => inReview(s.body)), false);
  assert.ok(!existsSync(L.REVIEW_LOG));
});

test("on: the review is the run's own request with one block added; it only proposes, and the run goes on untouched", async () => {
  setLearning({ review: true, every: 2 });
  script = (b) => {
    if (inReview(b)) {
      if (!lastToolResults(b).includes("Proposed")) return { usage: { input_tokens: 400, output_tokens: 60 }, tools: [
        { name: "write_file", input: { path: "review-was-here.txt", content: "no" } },
        { name: "bash", input: { command: "touch review-ran-a-command.txt" } },
        { name: "remember", input: { entry: "Prefers the answer first, then the reasoning", about: "user" } },
        { name: "remember", input: { entry: "The camp's tests need the UI built first" } },
      ] };
      return { text: "That's all.\n<skill_proposal>\nowner: artificer\nname: map-a-new-codebase\ndescription: Get your bearings in a codebase you haven't seen\nreason: The same first steps each time.\n---\n" +
        "1. List the top level before opening any file: the layout says where to look.\n</skill_proposal>" };
    }
    if (isFirstTurn(b)) return { tools: [{ name: "list_dir", input: { path: "." } }, { name: "list_dir", input: { path: "skills" } }] };
    return { text: "REPORT: looked around." };
  };
  const questsBefore = recentQuests(50).length;
  const r = await runDirect("artificer", "Look around the camp");
  await L.reviewsSettled();

  // The run itself: two turns, its answer, and a transcript with nothing of the review in it.
  assert.equal(r?.status, "done");
  assert.equal(r?.text, "REPORT: looked around.");
  const run = api.seen.filter((s) => !inReview(s.body)), review = api.seen.filter((s) => inReview(s.body));
  assert.deepEqual([run.length, review.length], [2, 2]);
  assert.doesNotMatch(readFileSync(r!.session!, "utf8"), /Learning review|Prefers the answer first|review-was-here/);

  // The same request ahead of the conversation, so it reads what the run already cached…
  const mine = run[1].body, its = review[0].body;
  assert.deepEqual(its.system, mine.system, "the system prompt, block for block");
  assert.deepEqual(its.tools, mine.tools, "the tool list");
  assert.equal(its.model, mine.model);
  for (const key of ["max_tokens", "cache_control", "context_management", "output_config"]) assert.deepEqual(its[key], mine[key], key);
  // …and the conversation as it stood, plus one block of text on the end.
  assert.deepEqual(its.messages.slice(0, -1), mine.messages.slice(0, -1));
  assert.deepEqual(its.messages.at(-1).content.slice(0, -1), mine.messages.at(-1).content);
  assert.match(its.messages.at(-1).content.at(-1).text, /^\[Learning review\./);

  // What it tried that isn't allowed was refused, and did nothing.
  const answers = review[1].body.messages.at(-1).content;
  assert.deepEqual(answers.map((c: any) => !!c.is_error), [true, true, false, false]);
  assert.match(answers[0].content, /write_file isn't available in a learning review/);
  assert.ok(!existsSync("review-was-here.txt") && !existsSync("review-ran-a-command.txt"));

  // What it put forward is waiting for you, not applied.
  assert.deepEqual(keeps(), ["about: Prefers the answer first, then the reasoning", "agent:artificer: The camp's tests need the UI built first"]);
  assert.doesNotMatch(readAbout(), /answer first/);
  assert.doesNotMatch(readMemory("artificer"), /UI built first/);
  assert.deepEqual(drafts(), ["artificer/map-a-new-codebase"]);
  assert.ok(!existsSync("skills/artificer/map-a-new-codebase"));
  assert.match(readFileSync("skills/_pending/artificer/map-a-new-codebase/SKILL.md", "utf8"), /^created_by: artificer \(learning review\)$/m);

  // What it cost is on its own line, apart from the run's.
  const [entry] = L.reviews();
  assert.deepEqual([entry.agent, entry.runtime, entry.turns, entry.memory, entry.skills, entry.refused], ["artificer", "api", 2, 2, 1, 2]);
  assert.equal(entry.model, mine.model);
  assert.ok(entry.costUsd > 0);
  assert.equal(entry.usage.input, 500);
  assert.equal(recentQuests(50).length, questsBefore + 1, "the quest log has the run and nothing else");
  assert.ok(events.some((e) => e.type === "notice" && /Learning review of .* put 3 things forward/.test(e.text)));
});

test("on: a short run is never reviewed", async () => {
  setLearning({ review: true, every: 5 });
  script = (b) => (isFirstTurn(b) ? { tools: [{ name: "list_dir", input: { path: "." } }] } : { text: "REPORT: done." });
  await runDirect("artificer", "One quick look");
  await L.reviewsSettled();
  assert.equal(api.seen.some((s) => inReview(s.body)), false);
});
