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
const { setBudgetUsd, setAgentSettings } = await import("../src/settings.ts");
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

test("each run links to its transcript in the quest log", async () => {
  script = () => ({ text: "Here's my report." });
  const r = await runDirect("scout", "quick question");
  assert.ok(r?.session && existsSync(r.session), "the transcript file exists");
  const { recentQuests } = await import("../src/questlog.ts");
  assert.equal(recentQuests(1)[0].session, r!.session);
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

// The first thing the user asked in this conversation (to tell concurrent expeditions apart).
const firstAsk = (b: any): string => {
  const c = b.messages[0].content;
  return typeof c === "string" ? c : c.map((x: any) => x.text ?? "").join("");
};

test("several expeditions at once: they overlap and keep their events apart", async () => {
  script = (b) => ({ text: `${whoAsks(b)} on ${/Alpha/.test(firstAsk(b)) ? "Alpha" : "Beta"}`, delayMs: 300 });
  const t0 = Date.now();
  const [a, d] = await Promise.all([
    runExpedition("Alpha", { id: "exp-alpha" }),
    runDirect("scout", "Beta", "direct", undefined, undefined, "exp-beta"),
  ]);
  assert.equal(a.status, "done");
  assert.equal(d?.status, "done");
  assert.ok(Date.now() - t0 < 550, "the two 300ms runs overlapped");
  const texts = events.filter((e) => e.type === "text");
  assert.ok(texts.length >= 2);
  for (const e of texts) assert.equal(e.expeditionId, /Alpha/.test(e.text) ? "exp-alpha" : "exp-beta", `"${e.text}" is tagged with its own expedition`);
  assert.equal(events.find((e) => e.type === "dispatch")?.expeditionId, "exp-beta");
});

test("a scheduled job's unattended mode stays with the job, not the expedition beside it", async () => {
  script = (b) => {
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. one step" } }], delayMs: 150 };
    return { text: "Done." };
  };
  const [job, mine] = await Promise.all([
    runExpedition("Job task", { id: "exp-job", unattended: true, job: "nightly" }),
    runExpedition("My task", { id: "exp-mine" }),
  ]);
  assert.equal(job.status, "done");
  assert.equal(mine.status, "done");
  const planAsks = events.filter((e) => e.type === "ask" && e.kind === "plan");
  assert.deepEqual(planAsks.map((e) => e.expeditionId), ["exp-mine"], "only your own expedition waits for your OK on its plan");
});

test("turn limit: your setting caps the run, and the note says how to continue", async () => {
  setAgentSettings("scout", { maxTurns: 5 });
  try {
    script = () => ({ text: "Still looking.", tools: [{ name: "list_dir", input: { path: "." } }] });
    const r = await runDirect("scout", "Keep going forever");
    assert.equal(r?.status, "out_of_turns");
    assert.equal(api.seen.filter((s) => s.who === "Scout").length, 5, "exactly 5 turns");
    assert.match(r!.text, /used all 5 turns.*Send Scout back to continue, or raise the turn limit/);
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});

test("steering: what you say mid-run reaches the agent on its next step", async () => {
  const { newSteering, steer } = await import("../src/context.ts");
  const steering = newSteering();
  const bodies: any[] = [];
  script = (b) => {
    bodies.push(b);
    if (bodies.length === 1) { steer(steering, "Only look in the docs folder"); return { tools: [{ name: "list_dir", input: { path: "." } }] }; }
    if (bodies.length === 2) { steer(steering, "And keep it to one paragraph"); return { text: "Draft done." }; }
    return { text: "One paragraph, from docs." };
  };
  const r = await runDirect("scout", "Summarize the project", "direct", undefined, undefined, undefined, undefined, { steering });
  assert.equal(r?.status, "done");
  assert.equal(r?.text, "One paragraph, from docs.", "a message that arrives as it finishes gets one more turn");
  assert.match(JSON.stringify(bodies[1].messages.at(-1)), /The user sent this while you were working[^"]*Only look in the docs folder/);
  assert.match(JSON.stringify(bodies[2].messages.at(-1)), /And keep it to one paragraph/);
});

test("out of turns: the agent is warned near the limit, and the report carries a handoff", async () => {
  setAgentSettings("scout", { maxTurns: 6 });
  try {
    const bodies: any[] = [];
    script = (b) => { bodies.push(b); return { text: "Looking.", tools: [{ name: "list_dir", input: { path: "." } }] }; };
    const r = await runDirect("scout", "Keep going");
    assert.equal(r?.status, "out_of_turns");
    assert.match(JSON.stringify(bodies[3].messages.at(-1)), /you have 3 turns left/);
    assert.match(JSON.stringify(bodies[5].messages.at(-1)), /this is your last turn/);
    assert.match(r!.text, /Handoff for whoever continues[\s\S]*Its last steps:\n- list_dir/);
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});
