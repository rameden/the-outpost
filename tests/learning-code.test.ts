// The learning review on the Claude Code runtime (your subscription). There's no request to
// copy there, so the review is a short Claude Code run of its own: the same system prompt, model
// and tool list as the run, the work so far told to it, and every tool answering as a review's
// tool. A fake `query` plays both sessions (the run, and the review it sets off).
import { test as nodeTest, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox, REPO, NEEDS_SH } from "./helpers/sandbox.ts";

const test = (name: string, fn: () => void | Promise<void>) => nodeTest(name, { skip: NEEDS_SH }, fn);

enterSandbox("learning-code");
process.env.CAMP_RUNTIME = "claude-code";
const fakeClaude = join(REPO, "tests/fixtures/fake-claude.sh");
chmodSync(fakeClaude, 0o755);
process.env.CLAUDE_CODE_EXECUTABLE = fakeClaude;

const { useQueryForTests } = await import("../src/claude-code.ts");
const { runDirect } = await import("../src/quartermaster.ts");
const L = await import("../src/learning.ts");
const { proposals } = await import("../src/keeping.ts");
const { pendingSkills } = await import("../src/forge.ts");
const { readMemory } = await import("../src/memory.ts");
const { setLearning } = await import("../src/settings.ts");
const { rl } = await import("../src/tools.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
after(() => { useQueryForTests(null); rl.close(); });

type Call = { name: string; args: any };
type Seen = { options: any; task: string; tools: string[]; results: string[]; permissions: Record<string, any> };
let sessions: Seen[] = [];
beforeEach(() => {
  sessions = [];
  for (const p of ["camp/memory-proposals.json", "skills/_pending", L.REVIEW_LOG]) rmSync(p, { recursive: true, force: true });
  setLearning({ review: false, every: 10 });
});

// One fake Claude Code for both: it reads what it was asked, and plays the review when that's a
// learning review, the run otherwise.
function fakeClaudeCode(run: { calls: Call[]; text: string }, review: { calls: Call[]; text: string }) {
  return async function* ({ prompt, options }: any) {
    let task = "";
    for await (const first of prompt) { task = String(first.message.content); break; }
    const mine = task.includes("[Learning review.") ? review : run;
    const seen: Seen = { options, task, tools: [], results: [], permissions: {} };
    sessions.push(seen);
    for (const name of ["mcp__camp__remember", "Bash", "Write", "WebSearch"]) seen.permissions[name] = await options.canUseTool(name, {}, { signal: new AbortController().signal });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await options.mcpServers.camp.instance.connect(b);
    const client = new Client({ name: "fake-claude", version: "0" });
    await client.connect(a);
    seen.tools = (await client.listTools()).tools.map((t: any) => t.name);
    let n = 0;
    for (const c of mine.calls) {
      const id = `tu_${++n}`;
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: `mcp__camp__${c.name}`, input: c.args }] } };
      const res: any = await client.callTool({ name: c.name, arguments: c.args });
      const text = res.content.map((x: any) => x.text ?? `[${x.type}]`).join("");
      seen.results.push(text);
      yield { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } };
    }
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: mine.text }] } };
    await client.close();
    yield { type: "result", subtype: "success", result: mine.text, num_turns: mine.calls.length + 1, total_cost_usd: 0.004, is_error: false,
      usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } };
  };
}

const LOOK = { calls: [{ name: "list_dir", args: { path: "." } }, { name: "list_dir", args: { path: "skills" } }, { name: "list_dir", args: { path: "camp" } }], text: "REPORT: looked around." };
const REVIEW = {
  calls: [
    { name: "write_file", args: { path: "review-was-here.txt", content: "no" } },
    { name: "bash", args: { command: "touch review-ran-a-command.txt" } },
    { name: "remember", args: { entry: "Prefers the answer first, then the reasoning", about: "user" } },
    { name: "remember", args: { entry: "The camp's tests need the UI built first" } },
  ],
  text: "<skill_proposal>\nowner: artificer\nname: map-a-new-codebase\ndescription: Get your bearings in a codebase you haven't seen\nreason: The same first steps each time.\n---\n" +
    "1. List the top level before opening any file: the layout says where to look.\n</skill_proposal>",
};

test("off by default: the run is the only Claude Code session", async () => {
  useQueryForTests(fakeClaudeCode(LOOK, REVIEW) as any);
  const r = await runDirect("artificer", "Look around the camp");
  await L.reviewsSettled();
  assert.equal(r?.status, "done");
  assert.equal(sessions.length, 1);
  assert.ok(!existsSync(L.REVIEW_LOG));
});

test("on: a second, short session with the run's prompt, model and tools, where every tool only proposes", async () => {
  setLearning({ review: true, every: 2 });
  useQueryForTests(fakeClaudeCode(LOOK, REVIEW) as any);
  const r = await runDirect("artificer", "Look around the camp");
  await L.reviewsSettled();

  assert.equal(r?.status, "done");
  assert.equal(r?.text, "REPORT: looked around.");
  assert.equal(sessions.length, 2, "three tool calls at an interval of two: one review, not two");
  const run = sessions.find((s) => !s.task.includes("[Learning review."))!, review = sessions.find((s) => s.task.includes("[Learning review."))!;

  // The same footing as the run…
  assert.equal(review.options.systemPrompt, run.options.systemPrompt);
  assert.equal(review.options.model, run.options.model);
  assert.deepEqual(review.tools, run.tools);
  assert.equal(review.options.maxTurns, L.MAX_REVIEW_TURNS);
  // …told what the run was asked and what it had done by then.
  assert.match(review.task, /Look around the camp/);
  assert.match(review.task, /list_dir/);

  // Claude Code's own tools are closed to it, and the camp's answer as a review's tools.
  assert.equal(review.permissions.Bash.behavior, "deny");
  assert.match(review.permissions.Bash.message, /isn't available in a learning review/);
  assert.equal(review.permissions.Write.behavior, "deny");
  assert.equal(review.permissions.WebSearch.behavior, "deny");
  assert.equal(review.permissions.mcp__camp__remember.behavior, "allow");
  assert.match(review.results[0], /Refused: write_file isn't available in a learning review/);
  assert.match(review.results[1], /Refused: bash isn't available in a learning review/);
  assert.match(review.results[2], /Proposed/);
  assert.ok(!existsSync("review-was-here.txt") && !existsSync("review-ran-a-command.txt"));

  // What it put forward waits for you.
  assert.deepEqual(proposals().flatMap((p) => (p.kind === "keep" ? [`${p.where}: ${p.text}`] : [])),
    ["about: Prefers the answer first, then the reasoning", "agent:artificer: The camp's tests need the UI built first"]);
  assert.doesNotMatch(readMemory("artificer"), /UI built first/);
  assert.deepEqual(pendingSkills().map((p) => `${p.owner}/${p.name}`), ["artificer/map-a-new-codebase"]);
  assert.match(readFileSync("skills/_pending/artificer/map-a-new-codebase/SKILL.md", "utf8"), /^created_by: artificer \(learning review\)$/m);

  // And its cost is on its own line.
  const [entry, ...rest] = L.reviews();
  assert.equal(rest.length, 0);
  assert.deepEqual([entry.agent, entry.runtime, entry.memory, entry.skills, entry.refused], ["artificer", "claude-code", 2, 1, 2]);
  assert.equal(entry.costUsd, 0.004);
  assert.equal(entry.usage.cacheRead, 5000);
});
