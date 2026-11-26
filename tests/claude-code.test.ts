// The Claude Code runtime (your subscription): a fake `query` plays Claude Code, talking to the
// camp's in-process MCP server the way the real CLI does, so we can check what the camp sends,
// that its tools really run inside the camp (boundaries and all), and how results come back.
import { test as nodeTest, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox, REPO, NEEDS_SH } from "./helpers/sandbox.ts";

// Every test here runs against a shell-script stand-in (see NEEDS_SH): on Windows they're left out, and say so.
const test = (name: string, fn: () => void | Promise<void>) => nodeTest(name, { skip: NEEDS_SH }, fn);

enterSandbox("claude-code");
process.env.CAMP_RUNTIME = "claude-code";
process.env.ANTHROPIC_API_KEY = "sk-should-never-reach-claude-code";
const fakeClaude = join(REPO, "tests/fixtures/fake-claude.sh");
chmodSync(fakeClaude, 0o755);
process.env.CLAUDE_CODE_EXECUTABLE = fakeClaude;
writeFileSync(".env", "SECRET=nope\n");

const { useQueryForTests } = await import("../src/claude-code.ts");
const { runDirect, runExpedition } = await import("../src/quartermaster.ts");
const { onEvent } = await import("../src/events.ts");
const { setBudgetUsd } = await import("../src/settings.ts");
const { readMemory, recentSessions } = await import("../src/memory.ts");
const { recentQuests } = await import("../src/questlog.ts");
const { rl } = await import("../src/tools.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
after(() => { useQueryForTests(null); rl.close(); });

const events: any[] = [];
onEvent((e) => events.push(e));
let seen: any = null;
beforeEach(() => { events.length = 0; seen = null; delete process.env.FAKE_CLAUDE_LOGIN; setBudgetUsd(null); });

// A fake Claude Code session: connects to the camp's MCP server, calls the given tools, and
// streams back messages shaped like the real SDK's.
function fakeSession(calls: { name: string; args: any }[], finalText: string) {
  return async function* ({ prompt, options }: any) {
    seen = { options, permissions: {} as Record<string, string> };
    for await (const first of prompt) { seen.first = first; break; }
    for (const name of ["mcp__camp__read_file", "Bash", "Read", "WebSearch"]) {
      seen.permissions[name] = (await options.canUseTool(name, {}, { signal: new AbortController().signal })).behavior;
    }
    const server = options.mcpServers.camp.instance;
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "fake-claude", version: "0" });
    await client.connect(a);
    const listed = (await client.listTools()).tools;
    seen.tools = listed.map((t: any) => t.name);
    seen.sideBySide = listed.filter((t: any) => t.annotations?.readOnlyHint).map((t: any) => t.name).sort();
    seen.results = [];
    for (const c of calls) {
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: `tu_${c.name}`, name: `mcp__camp__${c.name}`, input: c.args }] } };
      const res: any = await client.callTool({ name: c.name, arguments: c.args });
      const text = res.content.map((x: any) => x.text ?? `[${x.type}]`).join("");
      seen.results.push(text);
      yield { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${c.name}`, content: text }] } };
    }
    yield { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: finalText } } };
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: finalText }] } };
    await client.close();
    yield { type: "result", subtype: "success", result: finalText, num_turns: calls.length + 1, total_cost_usd: 0.0123, is_error: false,
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } };
  };
}

test("runs on the subscription: no API key, camp prompt, only camp tools", async () => {
  useQueryForTests(fakeSession([], "I'm the Scout.") as any);
  const r = await runDirect("scout", "Who are you?");
  assert.equal(r?.status, "done");
  assert.equal(r?.runtime, "claude-code");
  const o = seen.options;
  assert.equal(o.env.ANTHROPIC_API_KEY, undefined, "the API key never reaches Claude Code");
  assert.match(o.systemPrompt, /You are the Scout/);
  assert.deepEqual(o.settingSources, [], "none of your own Claude Code settings load");
  assert.equal(o.persistSession, false);
  assert.deepEqual(o.tools, ["WebSearch", "WebFetch"], "the Scout keeps web search and fetch; no built-in file or shell tools");
  assert.deepEqual(seen.permissions, { mcp__camp__read_file: "allow", Bash: "deny", Read: "deny", WebSearch: "allow" });
  assert.ok(seen.tools.includes("read_file") && seen.tools.includes("remember") && seen.tools.includes("grep"));
  assert.ok(!seen.tools.includes("web_search"), "server tools become Claude Code built-ins, not camp tools");
});

test("camp tools run inside the camp, with its boundaries", async () => {
  useQueryForTests(fakeSession([
    { name: "remember", args: { entry: "Prefers primary sources." } },
    { name: "read_file", args: { path: ".env" } },
    { name: "list_dir", args: { path: "." } },
  ], "Noted.") as any);
  const r = await runDirect("scout", "Remember that I like primary sources.");
  assert.equal(r?.status, "done");
  assert.match(readMemory("scout"), /Prefers primary sources/, "remember wrote the Scout's own memory");
  assert.match(seen.results[1], /secrets and is off limits/, ".env stays protected through MCP too");
  assert.doesNotMatch(seen.results[2], /\.env/);
});

test("results, costs, sessions, and live events come back like any run", async () => {
  useQueryForTests(fakeSession([{ name: "list_dir", args: { path: "." } }], "All done.") as any);
  const r = await runDirect("scribe", "Tidy up");
  assert.equal(r?.text, "All done.");
  assert.equal(r?.costUsd, 0.0123);
  assert.deepEqual(r?.usage, { input: 1200, output: 80, cacheRead: 9000, cacheWrite: 0 });
  assert.ok(events.some((e) => e.type === "text_delta" && e.delta === "All done."));
  assert.ok(events.some((e) => e.type === "tool" && e.tool === "list_dir"));
  const q = recentQuests(1)[0];
  assert.equal(q.runtime, "claude-code");
  assert.equal(q.costUsd, 0.0123);
  assert.ok(existsSync(r!.session!));
  assert.ok(JSON.parse(readFileSync(r!.session!, "utf8")).messages.length >= 3, "the transcript has the steps");
  assert.ok(recentSessions("scribe").length >= 1);
});

test("an expedition budget becomes Claude Code's own budget cap", async () => {
  setBudgetUsd(1.5);
  useQueryForTests(fakeSession([], "ok") as any);
  process.env.CAMP_APPROVE_PLANS = "0";
  await runExpedition("Small thing");
  assert.equal(seen.options.maxBudgetUsd, 1.5);
});

test("a missing or API-key login is refused with a clear message", async () => {
  useQueryForTests(fakeSession([], "should not run") as any);
  process.env.FAKE_CLAUDE_LOGIN = "out";
  await assert.rejects(() => runDirect("scout", "hi") as Promise<unknown>, /isn't signed in/);
  useQueryForTests(fakeSession([], "should not run") as any); // clears the cached login
  process.env.FAKE_CLAUDE_LOGIN = "apikey";
  await assert.rejects(() => runDirect("scout", "hi") as Promise<unknown>, /bills the API, not your subscription/);
});

// A session that reports usage with each reply, like the real one does.
function meteredSession(steps: number, fail?: string) {
  return async function* ({ prompt, options }: any) {
    for await (const _ of prompt) break;
    for (let i = 0; i < steps; i++) {
      if (options.abortController.signal.aborted) throw new Error("aborted");
      yield { type: "assistant", parent_tool_use_id: null, message: { id: `msg_${i}`, content: [{ type: "text", text: `step ${i}` }],
        usage: { input_tokens: 400_000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
      await new Promise((r) => setTimeout(r, 5));
    }
    if (fail) throw new Error(fail);
    yield { type: "result", subtype: "success", result: "finished", num_turns: steps, total_cost_usd: 9, is_error: false,
      usage: { input_tokens: 400_000 * steps, output_tokens: 1000 * steps, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
}

test("the budget is enforced while a run is going, not after it", async () => {
  setBudgetUsd(1); // each reply above costs about $0.81 on the default model
  useQueryForTests(meteredSession(10) as any);
  const r = await runDirect("scribe", "Write a lot");
  assert.equal(r?.status, "over_budget");
  assert.equal(r?.turns, 2, "stopped after the reply that crossed the budget");
  assert.ok(r!.costUsd! > 1 && r!.costUsd! < 2, `spent ${r!.costUsd}`);
  assert.equal(r?.usage.input, 800_000, "a stopped run still reports what it used");
});

// Claude Code hands over a result that isn't a success and then exits with an error, which the
// SDK raises ("Claude Code returned an error result: …"). Found by the loop-budget-stop eval.
function endsWith(subtype: string, why: string) {
  return async function* ({ prompt }: any) {
    for await (const _ of prompt) break;
    yield { type: "assistant", parent_tool_use_id: null, message: { id: "msg_0", content: [{ type: "text", text: "part of the work" }] } };
    yield { type: "result", subtype, num_turns: 1, total_cost_usd: 0.5, is_error: true, errors: [why],
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    throw new Error(`Claude Code returned an error result: ${why}`);
  };
}

test("Claude Code's own budget cap ends the run as over budget, not as a failure", async () => {
  useQueryForTests(endsWith("error_max_budget_usd", "Reached maximum budget ($0.50)") as any);
  const r = await runDirect("scribe", "Write a lot");
  assert.equal(r?.status, "over_budget");
  assert.match(r!.text, /part of the work[\s\S]*reached its budget/);
  assert.equal(r?.costUsd, 0.5, "what it spent is still reported");
});

test("running out of turns ends the run as out of turns, not as a failure", async () => {
  useQueryForTests(endsWith("error_max_turns", "Reached maximum number of turns (1)") as any);
  assert.equal((await runDirect("scribe", "Go on for ever"))?.status, "out_of_turns");
});

test("any other error result is still a failure, and says why", async () => {
  useQueryForTests(endsWith("error_during_execution", "the model went away") as any);
  await assert.rejects(() => runDirect("scribe", "Doomed") as Promise<unknown>, /the model went away/);
});

test("a run that fails part-way is still logged, with what it spent", async () => {
  useQueryForTests(meteredSession(1, "connection lost") as any);
  const before = recentQuests(1000).length;
  await assert.rejects(() => runDirect("scribe", "Doomed") as Promise<unknown>, /connection lost/);
  const all = recentQuests(1000);
  assert.equal(all.length, before + 1);
  const q = all[all.length - 1];
  assert.equal(q.status, "error");
  assert.equal(q.usage.input, 400_000);
  assert.ok(q.costUsd! > 0.5);
  assert.ok(q.session && existsSync(q.session), "its transcript is kept");
});

test("steering: what you say mid-run is passed into the running session", async () => {
  const { newSteering, steer } = await import("../src/context.ts");
  const steering = newSteering();
  let got: any = null;
  useQueryForTests((async function* ({ prompt }: any) {
    const it = prompt[Symbol.asyncIterator]();
    await it.next(); // the task
    setTimeout(() => steer(steering, "Skip the changelog"), 20);
    got = (await it.next()).value; // arrives while the session is still open
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Skipping it." }] } };
    yield { type: "result", subtype: "success", result: "Skipping it.", num_turns: 1, total_cost_usd: 0, is_error: false, usage: {} };
  }) as any);
  const r = await runDirect("scribe", "Write the release notes", "direct", undefined, undefined, undefined, undefined, { steering });
  assert.equal(r?.status, "done");
  assert.match(got.message.content, /The user sent this while you were working[\s\S]*Skip the changelog/);
});

test("tools that only read, and dispatch, are marked so Claude Code runs several at once; writers and commands aren't", async () => {
  const { SIDE_BY_SIDE } = await import("../src/claude-code.ts");
  // The Quartermaster: two quests sent in one turn have to set out together, not in a queue.
  useQueryForTests(fakeSession([], "I'm the Quartermaster.") as any);
  const { runExpedition } = await import("../src/quartermaster.ts");
  await runExpedition("Who are you?");
  assert.ok(seen.sideBySide.includes("dispatch"));
  assert.ok(seen.sideBySide.includes("read_file") && seen.sideBySide.includes("grep") && seen.sideBySide.includes("recall"));
  for (const one of ["submit_plan", "ask_user", "remember", "schedule_job"]) assert.ok(!seen.sideBySide.includes(one), `${one} stays one at a time`);
  // The Artificer: reading goes side by side; writing, editing and the shell don't.
  useQueryForTests(fakeSession([], "Done.") as any);
  await runDirect("artificer", "Hello");
  assert.ok(seen.tools.includes("bash") && seen.tools.includes("write_file") && seen.tools.includes("edit_file"));
  for (const one of ["bash", "write_file", "edit_file", "wiki_write", "remember"]) assert.ok(!seen.sideBySide.includes(one), `${one} stays one at a time`);
  assert.deepEqual(seen.sideBySide.filter((t: string) => !SIDE_BY_SIDE.has(t)), []);
});
