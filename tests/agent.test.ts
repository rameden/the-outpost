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

// Proves two runs were out at the same time by the order things happen in, not by the clock: a
// slow CI runner stretches any number of milliseconds. The script calls asked(name) when a run's
// request arrives, and that reply is held until two different names are waiting on one.
// Side by side, the second asks while the first is still out, and that lets both replies go.
// One after the other, the second can't ask until the first is answered, so nothing lets the
// first reply go: the hold gives up after a long wait, the runs finish, and `together` is false.
function holdUntilBothAsk(giveUpMs = 10_000) {
  const out = new Set<string>(); // who has asked and not been answered yet
  let together = false;
  let letGo!: () => void;
  const held = new Promise<void>((ok) => (letGo = ok));
  const giveUp = setTimeout(letGo, giveUpMs);
  return {
    asked: async (name: string) => {
      out.add(name);
      if (out.size === 2) { together = true; letGo(); }
      await held;
      out.delete(name);
    },
    done: () => { clearTimeout(giveUp); letGo(); }, // the runs are over, however they ended
    together: () => together,
  };
}

test("parallel: two dispatches in one turn run at the same time", async () => {
  const hold = holdUntilBothAsk();
  script = async (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scout" || who === "Scribe") { await hold.asked(who); return { text: `${who} report` }; }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "both at once" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "scout", brief: "a" } },
      { name: "dispatch", input: { adventurer: "scribe", brief: "b" } },
    ] };
    return { text: "Both back." };
  };
  const r = await runExpedition("Do two things").finally(hold.done);
  assert.equal(r.status, "done");
  const crew = api.seen.filter((s) => s.who === "Scout" || s.who === "Scribe");
  assert.deepEqual(crew.map((s) => s.who).sort(), ["Scout", "Scribe"], "each went once");
  assert.ok(hold.together(), "the second quest set out only after the first was back: they ran one after the other");
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

test("a file written whole is announced to the feed, once it's there; a refused write and an edit are not", async () => {
  let turn = 0;
  const out = "camp/agents/scribe/outputs/brief.md";
  script = () => {
    turn++;
    if (turn === 1) return { tools: [{ name: "write_file", input: { path: out, content: "# Brief\n" } }] };
    if (turn === 2) return { tools: [{ name: "write_file", input: { path: out, content: "# Brief\nMore.\n" } }] };
    if (turn === 3) return { tools: [{ name: "write_file", input: { path: "camp/settings.json", content: "{}" } }, { name: "edit_file", input: { path: out, old_string: "More.", new_string: "Most." } }] };
    return { text: "Wrote the brief." };
  };
  const r = await runDirect("scribe", "write a brief");
  assert.equal(r?.status, "done");
  const files = events.filter((e) => e.type === "file").map((e) => ({ who: e.who, path: e.path, change: e.change, bytes: e.bytes }));
  assert.deepEqual(files, [
    { who: "Scribe", path: out, change: "created", bytes: 8 },
    { who: "Scribe", path: out, change: "updated", bytes: 14 },
  ]);
  // It comes after the tool call it belongs to, so the page can put the card where that call was.
  const order = events.filter((e) => e.type === "tool" || e.type === "file").map((e) => e.type);
  assert.deepEqual(order.slice(0, 4), ["tool", "file", "tool", "file"]);
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
  const system = second.body.system.map((b: any) => b.text).join("\n\n") as string;
  // Two blocks, each a cache breakpoint: what stays the same between runs, then what moves.
  assert.equal(second.body.system.length, 2);
  assert.match(second.body.system[0].text, /You are the Scribe[\s\S]*## Your skills/);
  assert.doesNotMatch(second.body.system[0].text, /## Your memory|Who are you\?/, "nothing that changes between runs sits in the cached part");
  assert.equal(second.body.system[0].text, api.seen.at(-2)!.body.system[0].text, "the fixed part is byte-for-byte the same as the run before, so it's read from the cache");
  assert.ok(second.body.system.every((b: any) => b.cache_control?.type === "ephemeral"));
  assert.match(system, /You are the Scribe/);
  assert.match(system, /## Your crew/);
  // It's told which model it's running on and which ones the camp can run, so a model you name is never news to it.
  // Models block is last in the moving part so an Auto route switch only invalidates that trailing piece.
  assert.match(second.body.system[1].text, new RegExp(`## The models here\\nYou are running on Claude [\\w. ]+ \\(${second.body.model}\\)\\. The Claude models this camp can run: Claude Fable 5\\.2 \\(claude-fable-5-2\\), `));
  assert.match(second.body.system[1].text, /## The models here[\s\S]*$/, "models trail the rest of the moving block");
  assert.match(system, /whether or not you've heard of them/);
  assert.match(system, /## Your memory/);
  assert.match(system, /Who are you\?/, "the previous session is in the prompt");
  assert.equal(second.body.stream, true);
  assert.ok(second.body.context_management, "context editing is on");
  assert.equal(second.body.context_management.edits[0].clear_at_least?.value, 20_000, "clears enough to avoid cache thrash");
  assert.ok(!second.body.context_management.edits[0].exclude_tools?.includes("dispatch"), "old dispatch reports may be cleared");
  assert.match(String(second.headers["anthropic-beta"]), /context-management/);
  assert.ok(recentSessions("scribe").length >= 2);
});

// The first thing the user asked in this conversation (to tell concurrent expeditions apart).
const firstAsk = (b: any): string => {
  const c = b.messages[0].content;
  return typeof c === "string" ? c : c.map((x: any) => x.text ?? "").join("");
};

test("several expeditions at once: they overlap and keep their events apart", async () => {
  const hold = holdUntilBothAsk();
  script = async (b) => {
    const which = /Alpha/.test(firstAsk(b)) ? "Alpha" : "Beta";
    await hold.asked(which);
    return { text: `${whoAsks(b)} on ${which}` };
  };
  const [a, d] = await Promise.all([
    runExpedition("Alpha", { id: "exp-alpha" }),
    runDirect("scout", "Beta", "direct", undefined, undefined, "exp-beta"),
  ]).finally(hold.done);
  assert.equal(a.status, "done");
  assert.equal(d?.status, "done");
  assert.ok(hold.together(), "one run was answered before the other had asked: they ran one after the other");
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

test("turn limit: your setting caps each allowance, and after the last one the note says how to continue", async () => {
  setAgentSettings("scout", { maxTurns: 5 });
  try {
    script = () => ({ text: "Still looking.", tools: [{ name: "list_dir", input: { path: "." } }] });
    const r = await runDirect("scout", "Keep going forever");
    assert.equal(r?.status, "out_of_turns");
    assert.equal(api.seen.filter((s) => s.who === "Scout").length, 15, "5 turns, then 2 more allowances of 5");
    assert.equal(r!.turns, 15);
    assert.match(r!.text, /used all 15 turns \(5, then 2 more allowances of 5 in the same run\).*Send Scout back to continue, or raise the turn limit/);
    assert.match(r!.text, /Handoff for whoever continues/);
    const notices = events.filter((e) => e.type === "notice" && /carrying on/.test(e.text)).map((e) => e.text);
    assert.deepEqual(notices, ["🔁 Scout used its 5 turns and is carrying on, 1 of 2.", "🔁 Scout used its 5 turns and is carrying on, 2 of 2."]);
    assert.equal(events.filter((e) => e.type === "return").length, 1, "one return for the whole run");
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});

test("roster: the Quartermaster is told each crew member's real model, effort, turns and tools", async () => {
  setAgentSettings("artificer", { model: "claude-opus-5-5", effort: "low", maxTurns: 77 });
  try {
    let tools: any[] = [];
    script = (b) => { if (whoAsks(b) === "Quartermaster") tools = b.tools ?? []; return { text: "Nothing to do." }; };
    await runExpedition("Just say hi");
    const roster = tools.find((t) => t.name === "dispatch")?.description ?? "";
    const artificer = roster.split("\n- ").find((l: string) => l.startsWith("artificer")) ?? "";
    assert.match(artificer, /Setup: runs on Claude Opus 5\.5, low effort; 77 turns per run; tools: [^;]*\bedit_file\b[^;]*\bbash\b/);
    assert.match(roster, /scout[^\n]*\n  Setup: [^\n]*turns per run; tools: [^;]*web_search/, "everyone gets a setup line");
  } finally {
    setAgentSettings("artificer", { model: null, effort: null, maxTurns: null });
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
    assert.equal(bodies.length, 18);
    // No wrap-up while it still has allowances left: it's told to carry on instead.
    assert.doesNotMatch(JSON.stringify(bodies.slice(0, 12).map((b) => b.messages.at(-1))), /turns left|your last turn/);
    assert.match(JSON.stringify(bodies[6].messages.at(-1)), /you have 6 more to carry on \(1 of 2\)/);
    assert.match(JSON.stringify(bodies[12].messages.at(-1)), /\(2 of 2\)[^\]]*This is the last allowance/);
    assert.match(JSON.stringify(bodies[15].messages.at(-1)), /you have 3 turns left/);
    assert.match(JSON.stringify(bodies[17].messages.at(-1)), /this is your last turn/);
    assert.match(r!.text, /Handoff for whoever continues[\s\S]*Its last steps:\n- list_dir/);
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});

test("out of turns: the run carries on with its messages intact and finishes, as one run", async () => {
  setAgentSettings("scout", { maxTurns: 5 });
  try {
    const bodies: any[] = [];
    script = (b) => { bodies.push(b); return bodies.length < 8 ? { text: "Looking.", tools: [{ name: "list_dir", input: { path: "." } }] } : { text: "Found it." }; };
    const r = await runDirect("scout", "Find the thing");
    assert.equal(r?.status, "done");
    assert.equal(r?.text, "Found it.");
    assert.equal(r?.turns, 8, "turns summed across allowances");
    assert.equal(bodies.length, 8);
    assert.ok(bodies[5].messages.length > bodies[4].messages.length, "the conversation goes on, not a fresh brief");
    assert.equal(JSON.stringify(bodies[5].messages[0]), JSON.stringify(bodies[0].messages[0]), "same first message");
    assert.match(JSON.stringify(bodies[5].messages.at(-1)), /tool_result[\s\S]*you used this run's 5 turns without finishing/);
    assert.deepEqual(events.filter((e) => e.type === "notice" && /carrying on/.test(e.text)).map((e) => e.text), ["🔁 Scout used its 5 turns and is carrying on, 1 of 2."]);
    assert.equal(events.filter((e) => e.type === "return").length, 1);
    const { recentQuests } = await import("../src/questlog.ts");
    const q = recentQuests(1)[0];
    assert.equal(q.turns, 8, "one quest-log record with every turn");
    assert.equal(q.session, r!.session);
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});

test("out of turns: Stop during an extension stops the run at once", async () => {
  setAgentSettings("scout", { maxTurns: 5 });
  try {
    const controller = new AbortController();
    let n = 0;
    script = () => {
      n++;
      if (n === 7) { setTimeout(() => controller.abort(), 100); return { text: "slow", tools: [{ name: "list_dir", input: { path: "." } }], delayMs: 3000 }; }
      return { text: "Looking.", tools: [{ name: "list_dir", input: { path: "." } }] };
    };
    const t0 = Date.now();
    const r = await runDirect("scout", "Keep going", "direct", undefined, controller.signal);
    assert.equal(r?.status, "stopped");
    assert.ok(Date.now() - t0 < 2000, "stopped without waiting for the reply");
    assert.equal(n, 7, "no turn after Stop");
    assert.equal(events.filter((e) => e.type === "notice" && /carrying on, 1 of 2/.test(e.text)).length, 1, "it was in its first extension");
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});

test("out of turns: a scheduled job's crew don't carry on; they stop at the limit as before", async () => {
  setAgentSettings("scout", { maxTurns: 5 });
  try {
    script = (b) => {
      if (whoAsks(b) === "Scout") return { text: "Looking.", tools: [{ name: "list_dir", input: { path: "." } }] };
      if (isFirstTurn(b)) return { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "look around" } }] };
      return { text: "Done." };
    };
    await runExpedition("Nightly look", { id: "exp-nightly", unattended: true, job: "nightly" });
    assert.equal(api.seen.filter((s) => s.who === "Scout").length, 5, "exactly its 5 turns");
    assert.equal(events.filter((e) => e.type === "notice" && /carrying on/.test(e.text)).length, 0);
    const back = events.filter((e) => e.type === "return" && e.who === "Scout");
    assert.deepEqual(back.map((e) => e.status), ["out_of_turns"]);
  } finally {
    setAgentSettings("scout", { maxTurns: null });
  }
});

test("an approved plan goes out as its numbered steps, and each dispatch says which step it carries out", async () => {
  const { planSteps } = await import("../src/quartermaster.ts");
  assert.deepEqual(planSteps("Here's the plan:\n1. Artificer, backend: add thread links\n   Done = specs and build.\n2) Artificer, Studio UI\n\n3. I read the diffs\n\nAssumptions you can correct now:\n- Expiry is 30 days\n3. a repeat is ignored"), [
    { n: 1, text: "Artificer, backend: add thread links Done = specs and build." }, { n: 2, text: "Artificer, Studio UI" }, { n: 3, text: "I read the diffs" }]);
  assert.deepEqual(planSteps("Just ask the Scout and report back."), []);
  // A step says what it waits for with "(after …)", at the start of its line or the end of it. The marker comes off the text.
  assert.deepEqual(planSteps("1. Scout reads the code\n2. Artificer builds it\n3. (after 1, 2) Scribe writes the summary\n4. (After step 3): Warden reviews\n5. I wrap up (after steps 3 and 4)."), [
    { n: 1, text: "Scout reads the code" }, { n: 2, text: "Artificer builds it" }, { n: 3, text: "Scribe writes the summary", after: [1, 2] },
    { n: 4, text: "Warden reviews", after: [3] }, { n: 5, text: "I wrap up", after: [3, 4] }]);
  // Only steps listed above it count: not itself, not a later step, not one that isn't there. One named twice counts once.
  assert.deepEqual(planSteps("1. (after 1) First\n2. (after 3, 9) Second\n3. (after 2, 1, 2) Third\n   and its second line"), [
    { n: 1, text: "First" }, { n: 2, text: "Second" }, { n: 3, text: "Third and its second line", after: [1, 2] }]);
  // "after" in the middle of a step is just a word, and a line that is nothing but a marker keeps it as its text.
  assert.deepEqual(planSteps("1. Read it\n2. Tidy up (after 1) the notes\n3. (after 1)"), [
    { n: 1, text: "Read it" }, { n: 2, text: "Tidy up (after 1) the notes" }, { n: 3, text: "(after 1)" }]);

  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scout" || who === "Scribe") return { text: `${who} report` };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks it up\n2. Scribe writes it up\n3. I check both" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "scout", brief: "Look it up", step: 1 } },
      { name: "dispatch", input: { adventurer: "scribe", brief: "Write it up", step: 2 } },
      { name: "dispatch", input: { adventurer: "scout", brief: "No step given" } },
      { name: "dispatch", input: { adventurer: "scout", brief: "A step that isn't a number", step: "two" } },
    ] };
    return { text: "All back." };
  };
  await runExpedition("Research and write");
  const plan = events.find((e) => e.type === "plan");
  assert.deepEqual(plan.steps, [{ n: 1, text: "Scout looks it up" }, { n: 2, text: "Scribe writes it up" }, { n: 3, text: "I check both" }]);
  assert.ok(plan.expeditionId, "it belongs to its run");
  assert.ok(events.findIndex((e) => e.type === "answered") < events.indexOf(plan), "it's sent once you've approved, not before");
  assert.deepEqual(events.filter((e) => e.type === "dispatch").map((e) => [e.who, e.brief, e.step]), [
    ["Scout", "Look it up", 1], ["Scribe", "Write it up", 2], ["Scout", "No step given", undefined], ["Scout", "A step that isn't a number", undefined]]);
  // The Quartermaster is told to number its dispatches, in its rules and again on approval.
  const qm = api.seen.filter((x) => x.who === "Quartermaster");
  assert.match(qm[0].body.system.map((x: any) => x.text).join("\n"), /Give each dispatch the number of the plan step it carries out \(step\)/);
  assert.match(JSON.stringify(qm[1].body.messages.at(-1)), /Give each dispatch the number of the plan step it carries out/);

  // A plan that isn't a numbered list is approved as before, with no list to keep.
  events.length = 0;
  script = (b) => (whoAsks(b) === "Scout" ? { text: "report" } : isFirstTurn(b) ? { tools: [{ name: "submit_plan", input: { plan: "Ask the Scout, then report." } }] }
    : lastToolResults(b).includes("approved the plan") ? { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "Go" } }] } : { text: "Done." });
  await runExpedition("Something small");
  assert.equal(events.some((e) => e.type === "plan"), false);
  // A plan you stopped never becomes a list.
  events.length = 0; answer = "n";
  script = (b) => (isFirstTurn(b) ? { tools: [{ name: "submit_plan", input: { plan: "1. One\n2. Two" } }] } : { text: "Stopped." });
  await runExpedition("Stop me");
  assert.equal(events.some((e) => e.type === "plan"), false);
});

test("a plan approved to start later sends nobody, is kept with the conversation, and starts already approved", async () => {
  const { allTurns } = await import("../src/threads.ts");
  const plan = "1. Scout looks it up\n2. I write it up";
  answer = "later";
  script = (b) => {
    const res = lastToolResults(b);
    if (whoAsks(b) === "Scout") return { text: "report" };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan } }] };
    if (res.includes("start it later")) return { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "go anyway" } }] }; // a disobedient model
    return { text: "The plan is ready." };
  };
  await runExpedition("Research it", { id: "held-1" });
  assert.equal(api.seen.filter((s) => s.who === "Scout").length, 0, "nobody left camp");
  assert.match(String(lastToolResults(api.seen.filter((s) => s.who === "Quartermaster").at(-1)!.body)), /Blocked: the user approved the plan to start later/);
  assert.equal(events.some((e) => e.type === "plan"), false, "no list to fill in yet");
  const asked = events.find((e) => e.type === "ask");
  assert.deepEqual(allTurns().find((t) => t.expedition === "held-1")?.parked, { text: plan, ask: asked.id });
  const { heldPlans } = await import("../src/quartermaster.ts");
  assert.deepEqual(heldPlans().map((h) => [h.ask, h.conversation, h.steps, h.plan]), [[asked.id, "held-1", 2, plan]], "Home lists it, ready to start");

  // Started later: no second approval, the steps go out as the list, and the plan is in the brief.
  events.length = 0; asks = []; api.seen.length = 0;
  script = (b) => (whoAsks(b) === "Scout" ? { text: "report" }
    : isFirstTurn(b) ? { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "Look it up", step: 1 } }] } : { text: "Done." });
  const r = await runExpedition("Start the plan.", { id: "held-2", replyTo: "held-1", approvedPlan: { text: plan, ask: asked.id } });
  assert.equal(r.status, "done");
  assert.deepEqual(asks, [], "it isn't asked about again");
  assert.equal(api.seen.filter((s) => s.who === "Scout").length, 1);
  assert.deepEqual(events.find((e) => e.type === "plan")?.steps, [{ n: 1, text: "Scout looks it up" }, { n: 2, text: "I write it up" }]);
  const system = api.seen.find((s) => s.who === "Quartermaster")!.body.system.map((x: any) => x.text).join("\n");
  assert.match(system, /## The approved plan, starting now[\s\S]*Scout looks it up/);
  const started = allTurns().find((t) => t.expedition === "held-2");
  assert.equal(started?.started, asked.id);
  assert.equal(started?.thread, "held-1", "it carries on the conversation it was planned in");
  assert.deepEqual(heldPlans(), [], "once started, it's no longer waiting");
});

test("a plan approved later in a conversation that has one waiting asks if it replaces it, and can", async () => {
  const { heldPlans } = await import("../src/quartermaster.ts");
  const { setPlanAside } = await import("../src/threads.ts");
  let seenWaiting: unknown;
  setAsker(async (q) => { asks.push({ kind: q.kind, body: q.body }); seenWaiting = q.waiting; return answer; });
  const planning = (plan: string) => (b: any) => (isFirstTurn(b) ? { tools: [{ name: "submit_plan", input: { plan } }] } : { text: "The plan is ready." });
  try {
    answer = "later";
    script = planning("1. Scout looks\n2. I write");
    await runExpedition("Research it", { id: "swap-1" });
    assert.equal(seenWaiting, undefined, "nothing was waiting the first time");
    const first = heldPlans().find((h) => h.conversation === "swap-1")!;

    // Revised in the same conversation: the card is told about the waiting plan, and replaces it.
    events.length = 0;
    answer = "later+replace";
    script = planning("1. Scout looks harder\n2. I write");
    await runExpedition("Change step 1", { id: "swap-2", replyTo: "swap-1" });
    assert.deepEqual(seenWaiting, [{ ask: first.ask, held: first.held }]);
    assert.deepEqual(events.filter((e) => e.type === "plan_aside").map((e) => [e.ask, typeof e.by]), [[first.ask, "string"]]);
    const now = heldPlans().filter((h) => h.conversation === "swap-1");
    assert.deepEqual(now.map((h) => h.plan), ["1. Scout looks harder\n2. I write"], "only the revised plan waits");
    assert.equal(api.seen.filter((s) => s.who === "Scout").length, 0, "still nobody left camp");

    // Removed from Home: it stops waiting, and can't be set aside twice.
    assert.ok(setPlanAside(now[0].ask));
    assert.equal(setPlanAside(now[0].ask), undefined);
    assert.deepEqual(heldPlans().filter((h) => h.conversation === "swap-1"), []);
  } finally {
    setAsker(async (q) => { asks.push({ kind: q.kind, body: q.body }); return answer; });
  }
});
