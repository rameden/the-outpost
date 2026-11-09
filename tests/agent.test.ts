// End to end against a fake, streaming API: expeditions, the plan gate, parallel quests,
// budgets, Stop, cut-off replies, refusals, and what goes into every prompt.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, lastToolResults, whoAsks, type Reply } from "./helpers/fake-api.ts";

enterSandbox("agent");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

const { runExpedition, runDirect } = await import("../src/quartermaster.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { setBudgetUsd } = await import("../src/settings.ts");
const { recentSessions } = await import("../src/memory.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

let asks: { kind: string; body: string }[] = [];
let answer = "";
setAsker(async (q) => { asks.push({ kind: q.kind, body: q.body }); return answer; });
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { asks = []; answer = ""; events.length = 0; api.seen.length = 0; setBudgetUsd(null); });

test("plan gate: nothing is dispatched until you approve the plan", async () => {
  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scout") return { text: "REPORT: found it." };
    if (isFirstTurn(b)) return { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "go" } }] };
    if (res.includes("Blocked")) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout researches" } }] };
    if (res.includes("approved the plan")) return { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "go" } }] };
    return { text: "Done." };
  };
  const r = await runExpedition("Research something");
  assert.equal(r.status, "done");
  assert.deepEqual(asks.map((a) => a.kind), ["plan"]);
  assert.equal(api.seen.filter((s) => s.who === "Scout").length, 1, "the Scout went exactly once, after approval");
});

test("parallel: two dispatches in one turn run at the same time", async () => {
  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scout" || who === "Scribe") return { text: `${who} report`, delayMs: 300 };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "both at once" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "scout", brief: "a" } },
      { name: "dispatch", input: { adventurer: "scribe", brief: "b" } },
    ] };
    return { text: "Both back." };
  };
  const t0 = Date.now();
  const r = await runExpedition("Do two things");
  assert.equal(r.status, "done");
  const starts = api.seen.filter((s) => s.who === "Scout" || s.who === "Scribe").map((s) => s.at);
  assert.equal(starts.length, 2);
  assert.ok(Math.abs(starts[0] - starts[1]) < 150, `started ${Math.abs(starts[0] - starts[1])}ms apart`);
  assert.ok(Date.now() - t0 < 1200, "the two 300ms quests overlapped");
  const questIds = new Set(events.filter((e) => e.type === "dispatch").map((e) => e.questId));
  assert.equal(questIds.size, 2, "each quest has its own id");
});

test("budget: an expedition stops once it has spent its budget", async () => {
  setBudgetUsd(1);
  // 2M input tokens on Sonnet 5.5 = $4, over the $1 budget, and it asks to dispatch.
  script = (b) => whoAsks(b) === "Scout" ? { text: "should not run" } : { text: "Big quest.", tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "x" } }], usage: { input_tokens: 2_000_000, output_tokens: 10 } };
  answer = "";
  const r = await runExpedition("Expensive");
  assert.equal(r.status, "over_budget");
  assert.equal(api.seen.filter((s) => s.who === "Scout").length, 0);
});

test("stop: cancels a running quest", async () => {
  script = (b) => ({ text: "slow reply", delayMs: 3000 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const t0 = Date.now();
  const r = await runDirect("scout", "take your time", "direct", undefined, controller.signal);
  assert.equal(r?.status, "stopped");
  assert.ok(Date.now() - t0 < 1500, "stopped quickly, without waiting for the reply");
});

test("cut-off replies: tool calls in a truncated reply are never run", async () => {
  let calls = 0;
  script = () => (++calls === 1
    ? { tools: [{ name: "write_file", input: { path: "half-written.txt", content: "trunc" } }], stop: "max_tokens" }
    : { text: "Retried and finished." });
  const r = await runDirect("artificer", "write a file");
  assert.equal(r?.status, "done");
  assert.ok(!existsSync("half-written.txt"));
  assert.match(lastToolResults(api.seen[1].body), /hit the output token limit/);
});

test("refusals stop the run without running tools", async () => {
  script = () => ({ tools: [{ name: "write_file", input: { path: "nope.txt", content: "x" } }], stop: "refusal" });
  const r = await runDirect("scribe", "something");
  assert.equal(r?.status, "refused");
  assert.ok(!existsSync("nope.txt"));
});

test("every prompt: identity, crew, memory, recent sessions; streamed with context editing", async () => {
  script = () => ({ text: "I'm the Scribe." });
  await runDirect("scribe", "Who are you?");
  await runDirect("writer", "And what did I just ask?");
  const second = api.seen.at(-1)!;
  const system = second.body.system[0].text as string;
  assert.match(system, /You are the Scribe/);
  assert.match(system, /## Your crew/);
  assert.match(system, /## Your memory/);
  assert.match(system, /Who are you\?/, "the previous session is in the prompt");
  assert.equal(second.body.stream, true);
  assert.ok(second.body.context_management, "context editing is on");
  assert.match(String(second.headers["anthropic-beta"]), /context-management/);
  assert.ok(recentSessions("scribe").length >= 2);
});
