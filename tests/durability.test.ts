// What keeps the camp usable day after day: state files that survive a crash or a typo, a quest
// line that doesn't strand anyone, a price for every Claude model, and a reply that's asked for
// again when the connection drops instead of ending the run.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, type Reply } from "./helpers/fake-api.ts";

enterSandbox("durability");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

const { writeAtomic, writeJsonAtomic, readJsonFile, appendLine } = await import("../src/atomic.ts");
const { loadJobs, saveJobs } = await import("../src/jobs.ts");
const settings = await import("../src/settings.ts");
const { trimFeed, saveToFeed, FEED_PATH } = await import("../src/feed.ts");
const { questSlotsForTests: slots, runDirect } = await import("../src/quartermaster.ts");
const { costOf, priceLabel } = await import("../src/costs.ts");
const { runAgent, isPassingFailure, setRetryWaitsForTests } = await import("../src/agent.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;
after(async () => { rl.close(); await api.close(); });

const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; script = () => ({ text: "ok" }); });

const damagedCopies = (name: string) => readdirSync("camp").filter((f) => f.startsWith(`${name}.damaged-`));

test("a state file is replaced whole: no temp file is left, and its mode is the one asked for", () => {
  writeJsonAtomic("camp/thing.json", { a: 1 });
  writeJsonAtomic("camp/thing.json", { a: 2 }, { mode: 0o600 });
  assert.deepEqual(JSON.parse(readFileSync("camp/thing.json", "utf8")), { a: 2 });
  assert.equal(statSync("camp/thing.json").mode & 0o777, 0o600);
  assert.deepEqual(readdirSync("camp").filter((f) => f.includes(".tmp-")), []);
  // A write that can't happen leaves the file as it was, and no temp file either.
  mkdirSync("camp/a-folder", { recursive: true });
  assert.throws(() => writeAtomic("camp/a-folder", "x"));
  assert.deepEqual(readdirSync("camp").filter((f) => f.includes(".tmp-")), []);
});

test("a damaged state file is kept aside, once, before defaults take over", () => {
  writeFileSync("camp/broken.json", '{"projects": [');
  assert.equal(readJsonFile("camp/broken.json", "fallback"), "fallback");
  assert.equal(readJsonFile("camp/broken.json", "fallback"), "fallback");
  const copies = damagedCopies("broken.json");
  assert.equal(copies.length, 1, "one copy, however often it's read");
  assert.equal(readFileSync(`camp/${copies[0]}`, "utf8"), '{"projects": [');
  assert.equal(readJsonFile("camp/not-there.json", 7), 7);
});

test("a typo in jobs.json doesn't throw (it's read on a timer): no jobs run until it's fixed", () => {
  saveJobs([{ name: "morning", schedule: "daily 08:00", task: "Say hello", created: new Date().toISOString() } as any]);
  assert.equal(loadJobs().length, 1);
  writeFileSync("camp/jobs.json", '[{"name": "morning", ');
  assert.deepEqual(loadJobs(), []);
  assert.equal(damagedCopies("jobs.json").length, 1);
  writeFileSync("camp/jobs.json", '{"not": "a list"}');
  assert.deepEqual(loadJobs(), []);
});

test("unreadable settings fall back to asking, and your rules survive in the copy kept aside", () => {
  settings.setBudgetUsd(5);
  writeFileSync("camp/settings.json", '{"shell": {"deny": ["rm -rf *"]}, "budgetUsd": 5,,}');
  assert.equal(settings.budgetUsd(), undefined);
  assert.deepEqual(settings.shellSettings(), {}, "nothing is auto-approved or sandboxed by default: commands ask");
  settings.setParallelLimit(2); // the next save replaces the damaged file…
  assert.equal(JSON.parse(readFileSync("camp/settings.json", "utf8")).parallel, 2);
  const copies = damagedCopies("settings.json");
  assert.equal(copies.length, 1, "…but what you had written is still there to recover");
  assert.match(readFileSync(`camp/${copies[0]}`, "utf8"), /rm -rf \*/);
  assert.equal(statSync("camp/settings.json").mode & 0o777, 0o600);
});

test("a log line torn by a crash doesn't swallow the next one", () => {
  writeFileSync("camp/log.jsonl", '{"n":1}\n{"n":2,"text":"cut off he');
  appendLine("camp/log.jsonl", '{"n":3}');
  appendLine("camp/log.jsonl", '{"n":4}');
  const lines = readFileSync("camp/log.jsonl", "utf8").split("\n").filter(Boolean);
  assert.deepEqual(lines.flatMap((l) => { try { return [JSON.parse(l).n]; } catch { return []; } }), [1, 3, 4]);
});

test("the feed is trimmed while the camp runs, to its newer half, in one step", () => {
  for (let i = 1; i <= 40; i++) saveToFeed({ type: "notice", who: "Camp", emoji: "🏕️", depth: 0, text: `line ${i} ${"x".repeat(200)}`, seq: i, time: "" } as any);
  assert.equal(trimFeed(), false, "well under the limit: left alone");
  assert.equal(trimFeed(2000), true);
  const kept = readFileSync(FEED_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).seq);
  assert.deepEqual(kept, Array.from({ length: 20 }, (_, i) => i + 21));
  assert.deepEqual(readdirSync("camp").filter((f) => f.includes(".tmp-")), []);
});

test("a stopped quest leaves the line, so the one behind it gets the next free slot", async () => {
  settings.setQuestLimit(1);
  assert.equal(await slots.take(), true);
  const stopA = new AbortController();
  const a = slots.take(stopA.signal); // waits behind the running quest
  const b = slots.take();             // waits behind a
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(slots.now(), { running: 1, waiting: 2 });
  stopA.abort();
  assert.equal(await a, false, "the stopped one isn't sent");
  assert.deepEqual(slots.now(), { running: 1, waiting: 1 });
  slots.release(); // the running quest finishes
  const got = await Promise.race([b, new Promise((ok) => setTimeout(() => ok("still waiting"), 500))]);
  assert.equal(got, true, "the quest behind it takes the slot instead of waiting forever");
  slots.release();
  assert.deepEqual(slots.now(), { running: 0, waiting: 0 });
  settings.setQuestLimit(settings.QUESTS_DEFAULT);
});

test("every Claude model has a cost, so a budget holds on the newest ones too", () => {
  const u = { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 };
  assert.equal(costOf("claude-fable-5-2", u), 8 + 4 + 0.2);
  assert.equal(costOf("claude-sonnet-5-5", u), 2 + 1 + 0.1);
  assert.ok(priceLabel("claude-fable-5-2"));
  // Not in the table yet: costed at its family's dearest listed rate, never as free.
  assert.equal(costOf("claude-opus-9-9", u), costOf("claude-opus-5", u));
  assert.ok(costOf("claude-fable-7", u) >= costOf("claude-fable-5-2", u));
  assert.equal(priceLabel("claude-opus-9-9"), undefined, "no price is shown for a model whose price isn't known");
  assert.equal(costOf("groq:llama-3.3-70b-versatile", u), 0);
});

test("which failures are worth asking again for", () => {
  assert.equal(isPassingFailure(new Anthropic.APIConnectionError({ message: "terminated" })), true);
  assert.equal(isPassingFailure(new Anthropic.APIUserAbortError()), false, "Stop is not a failure to retry");
  assert.equal(isPassingFailure(Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers())), true);
  assert.equal(isPassingFailure(Anthropic.APIError.generate(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers())), true, "an overload reported part-way through a stream has no status");
  assert.equal(isPassingFailure(Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }, "bad", new Headers())), false);
  assert.equal(isPassingFailure(Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "no" } }, "no", new Headers())), false);
  assert.equal(isPassingFailure(new Error("something else")), false);
  // A connection cut part-way through a stream comes up from the network layer, wrapped.
  assert.equal(isPassingFailure(new Anthropic.AnthropicError("terminated", { cause: new TypeError("terminated") } as any)), true);
  assert.equal(isPassingFailure(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
});

test("a reply cut off mid-stream is asked for again, and the run finishes", async () => {
  setRetryWaitsForTests([5, 5]);
  let calls = 0;
  script = () => (++calls === 1 ? { drop: true } : { text: "Here it is." });
  const r = await runDirect("scribe", "Write one line.");
  assert.equal(r?.status, "done");
  assert.equal(r?.text, "Here it is.");
  assert.equal(calls, 2);
  assert.ok(events.some((e) => e.type === "notice" && /cut off/.test(e.text) && /Asking again/.test(e.text)), "the feed says what happened");
  // It doesn't go on forever: past the retries, the run fails as it used to.
  calls = 0;
  script = () => { calls++; return { drop: true }; };
  await assert.rejects(runDirect("scribe", "Write one line."));
  assert.equal(calls, 3, "the first try and two more");
  setRetryWaitsForTests(null);
});

test("one turn's tool calls: reads run together, writes and commands one at a time, failures are marked", async () => {
  const log: string[] = [];
  const tool = (name: string, ms: number, fail = false) => ({
    def: { name, description: name, input_schema: { type: "object" as const, properties: {} } },
    run: async () => {
      log.push(`${name}:start`);
      await new Promise((ok) => setTimeout(ok, ms));
      log.push(`${name}:end`);
      if (fail) throw new Error("it broke");
      return `${name} done`;
    },
  });
  let turn = 0;
  script = () => (++turn === 1
    ? { tools: [{ name: "grep", input: {} }, { name: "glob", input: {} }, { name: "bash", input: {} }, { name: "write_file", input: {} }, { name: "nope", input: {} }] }
    : { text: "Finished." });
  const r = await runAgent({ id: "scribe", name: "Scribe", emoji: "🪶", role: "r", persona: "p", skillDirs: [],
    tools: [tool("grep", 30), tool("glob", 30), tool("bash", 20, true), tool("write_file", 5)] }, "go");
  assert.equal(r.status, "done");
  // The two reads overlap; the command and the write don't overlap each other.
  assert.ok(log.indexOf("glob:start") < log.indexOf("grep:end"), "reads start together");
  assert.ok(log.indexOf("bash:end") < log.indexOf("write_file:start"), "the write waits for the command before it");
  const results = api.seen.at(-1)!.body.messages.at(-1).content.filter((c: any) => c.type === "tool_result");
  assert.deepEqual(results.map((c: any) => c.content), ["grep done", "glob done", "Error: it broke", "write_file done", "Unknown tool: nope"], "results come back in the order the calls were made");
  assert.deepEqual(results.map((c: any) => !!c.is_error), [false, false, true, false, true]);
});

// ---------- When a model declines ----------
const { afterFallback, replyCost, fallsBack } = await import("../src/agent.ts");
const { readFileSync: read, writeFileSync: write } = await import("node:fs");

test("a declined request is carried on by another model: asked for where it exists, and off when you say so", async () => {
  await runDirect("scribe", "One line."); // the Scribe runs on Sonnet 5.5, which has it
  let sent = api.seen.at(-1)!;
  assert.equal(sent.body.fallbacks, "default");
  assert.match(String(sent.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.match(String(sent.headers["anthropic-beta"]), /context-management/, "alongside what was already asked for");
  // Haiku has no fallback: sending the parameter would be refused, so it isn't sent.
  settings.setAgentSettings("scribe", { model: "claude-haiku-5-5" });
  await runDirect("scribe", "One line.");
  sent = api.seen.at(-1)!;
  assert.equal(sent.body.fallbacks, undefined);
  assert.doesNotMatch(String(sent.headers["anthropic-beta"]), /server-side-fallback/);
  settings.setAgentSettings("scribe", { model: null });
  // Your switch.
  assert.equal(fallsBack("claude-opus-5-5"), true);
  const s = JSON.parse(read("camp/settings.json", "utf8"));
  write("camp/settings.json", JSON.stringify({ ...s, refusalFallback: false }));
  assert.equal(fallsBack("claude-opus-5-5"), false);
  await runDirect("scribe", "One line.");
  assert.equal(api.seen.at(-1)!.body.fallbacks, undefined);
  write("camp/settings.json", JSON.stringify(s));
});

test("a reply that fell back: the feed says who took over, a tool call from the declined attempt never runs, and the cost counts each model", async () => {
  const ran: string[] = [];
  const tool = (name: string) => ({ def: { name, description: name, input_schema: { type: "object" as const, properties: {} } }, run: async (input: any) => { ran.push(`${name}:${input.which}`); return "done"; } });
  let turn = 0;
  script = () => (++turn === 1 ? {
    model: "claude-opus-4-8",
    blocks: [
      { type: "thinking", thinking: "", signature: "sig-declined" },
      { type: "text", text: "Let me look at that. " },
      { type: "tool_use", id: "tu_declined", name: "grep", input: { which: "declined" } },
      { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: "cyber" } },
    ],
    text: "Carrying on.",
    tools: [{ name: "grep", input: { which: "after" } }],
    usage: { input_tokens: 1000, output_tokens: 100 },
    iterations: [
      { type: "message", model: "claude-sonnet-5-5", input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ],
  } : { text: "All done." });
  const r = await runAgent({ id: "scribe", name: "Scribe", emoji: "🪶", role: "r", persona: "p", skillDirs: [], model: "claude-sonnet-5-5", tools: [tool("grep")] }, "go");
  assert.equal(r.status, "done");
  assert.deepEqual(ran, ["grep:after"], "only the call made after the switch runs");
  assert.ok(events.some((e) => e.type === "notice" && e.text === "↪️ claude-sonnet-5-5 declined this request (cyber); claude-opus-4-8 carried on."));
  // What goes back to the API: the declined attempt's words and the switch mark, not its thinking or its tool call.
  const echoed = api.seen.at(-1)!.body.messages[1].content;
  assert.deepEqual(echoed.map((b: any) => b.type), ["text", "fallback", "text", "tool_use"]);
  assert.equal(echoed[3].input.which, "after");
  const results = api.seen.at(-1)!.body.messages[2].content.filter((b: any) => b.type === "tool_result");
  assert.equal(results.length, 1, "one result, for the one call that stands");
  // Sonnet's attempt at Sonnet's rate ($2 in), Opus 4.8's at its own ($5 in, $25 out), then the second reply on Sonnet.
  const second = costOf("claude-sonnet-5-5", { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 });
  assert.ok(Math.abs(r.costUsd! - (2 + 5 + 2.5 + second)) < 1e-9, `cost was ${r.costUsd}`);
});

test("what carries over a switch, and what a reply cost", () => {
  const plain = [{ type: "text", text: "hi" }, { type: "tool_use", id: "a", name: "grep", input: {} }];
  assert.deepEqual(afterFallback(plain), { content: plain, live: plain }, "no switch: nothing changes");
  const content = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
    { type: "server_tool_use", id: "s2", name: "web_search", input: {} }, // never answered: it goes
    { type: "redacted_thinking", data: "x" },
    { type: "fallback", from: { model: "a" }, to: { model: "b" }, trigger: { type: "refusal", category: null } },
    { type: "thinking", thinking: "", signature: "after" },
    { type: "text", text: "after" },
  ];
  const out = afterFallback(content);
  assert.deepEqual(out.content.map((b: any) => b.id ?? b.type), ["s1", "web_search_tool_result", "fallback", "thinking", "text"]);
  assert.deepEqual(out.live.map((b: any) => b.type), ["thinking", "text"]);
  const u = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  assert.equal(replyCost("claude-sonnet-5-5", u, null), 2);
  assert.equal(replyCost("claude-sonnet-5-5", u, [{ type: "message", model: "claude-opus-5", input_tokens: 1_000_000, output_tokens: 0 }]), 2, "no fallback entry: the usual sum");
});
