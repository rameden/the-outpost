// Auto, through the normal agent loop: a route is chosen before the first dispatch, kept through
// routine work, changed when the evidence says so (with the reason in the run's history), and
// recovered from cooldowns, dropped connections and Stop without losing context or doing anything
// twice. Scripted stand-ins play the providers, so every decision here is repeatable.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, type Reply } from "./helpers/fake-api.ts";

enterSandbox("auto");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url;

// A provider whose stream stops part-way through a tool call, without saying how it finished.
const cut = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url === "/models") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "llama-fast" }] })); }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_0", type: "function", function: { name: "bash", arguments: '{"command":"node app/notify.cjs"}' } }] } }] })}\n\n`);
    res.end(); // no finish_reason, no [DONE]
  });
});
await new Promise<void>((ok) => cut.listen(0, "127.0.0.1", ok));
process.env.PROVIDER_BASE_URL_GROQ = `http://127.0.0.1:${(cut.address() as AddressInfo).port}`;
delete process.env.GROQ_API_KEY; // connected only for the test that needs it, so the other tests' routes are Claude's alone

const { runDirect } = await import("../src/quartermaster.ts");
const { runAgent, setRetryWaitsForTests } = await import("../src/agent.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
const { withExpedition } = await import("../src/context.ts");
const { threadFor } = await import("../src/threads.ts");
const { recentQuests } = await import("../src/questlog.ts");
const { providerChat, ProviderError } = await import("../src/providers.ts");
const { OpJournal } = await import("../src/oplog.ts");
const auto = await import("../src/autoroute.ts");
const { POLICY, priorSuccess } = await import("../src/routing.ts");
after(async () => { rl.close(); await api.close(); cut.closeAllConnections(); cut.close(); });
setAsker(async () => "y");

const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; script = () => ({ text: "ok" }); setRetryWaitsForTests([10, 10, 10]); auto.setRoutingForTests(null); });

// ---------- Deterministic estimates ----------
// The fake API has no model list, so the camp offers its built-in one; these are its routes.
const ROUTES = ["claude-fable-5-2@high", "claude-fable-5-1@high", "claude-opus-5-5@medium", "claude-opus-5-5@high",
  "claude-sonnet-5-5@low", "claude-sonnet-5-5@medium", "claude-sonnet-5-5@high", "claude-haiku-5-5@default"];
const WEAK = { attemptSuccess: 0.3, attemptUsd: 0.05, attemptSeconds: 100, fallbackProbability: 0.7, recoverySuccess: 0.3, recoveryUsd: 0.1 };
const STRONG = { attemptSuccess: 0.97, attemptUsd: 0.2, attemptSeconds: 90 };
type Est = Record<string, any>;
const estimates = (over: Est): Est => Object.fromEntries(ROUTES.map((r) => [r, over[r] ?? WEAK]));
// The general coding route does well until distinct fixes keep reproducing one failure; the strong route is dearer and slower.
const CODING: Est = {
  "claude-sonnet-5-5@medium": (p: any) => (p.signals.some((s: string) => s.startsWith("progress:"))
    ? { attemptSuccess: 0.1, attemptUsd: 0.05, attemptSeconds: 200 }
    : { attemptSuccess: 0.9, attemptUsd: 0.05, attemptSeconds: 60 }),
  "claude-opus-5-5@high": STRONG,
};
const toolResults = (body: any): any[] => body.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "tool_result") : []));
const routeEvents = () => events.filter((e) => e.type === "route");
// runDirect's arguments for a message in a conversation: (source, attachments, signal, id, replyTo, more).
const chat = (id: string, more: Record<string, unknown> = {}): ["direct", [], undefined, string, undefined, Record<string, any>] =>
  ["direct", [], undefined, id, undefined, { project: "general", links: [], model: "auto:balanced", ...more }];

// ---------- The integration fixture: a duplicate notification ----------
const API_V0 = `// Order notifications. The api and worker both call notify(); the worker retries when the api write times out.
const sent = [];
function notify(order) { sent.push(order); }
module.exports = { notify, sent };
`;
const CHECK = `const { notify, sent } = require("./api.cjs");
notify({ id: 42, key: "order-42" });               // the API write
notify({ id: 42, key: "order-42", retry: true });  // the worker's retry after the write timed out
if (sent.length !== 1) { console.log("FAIL: duplicate notification: worker retry sent " + sent.length + " notifications for order 42"); process.exit(1); }
console.log("OK: exactly 1 notification under retry");
`;
const PATCH_1 = API_V0.replace("function notify(order) { sent.push(order); }", "function notify(order) { /* PATCH-1 */ if (order.retry && sent.length > 5) return; sent.push(order); }");
const PATCH_2 = API_V0.replace("function notify(order) { sent.push(order); }", "function notify(order) { /* PATCH-2 */ if (order.timeout) return; sent.push(order); }");
const FIXED = API_V0.replace("function notify(order) { sent.push(order); }", "const seen = new Set();\nfunction notify(order) { /* FIX: idempotency key */ if (seen.has(order.key)) return; seen.add(order.key); sent.push(order); }");

test("end to end: the general route inspects, two distinct patches reproduce the same retry failure, and the stronger route gets everything and fixes it", async (t) => {
  mkdirSync("app", { recursive: true });
  writeFileSync("app/api.cjs", API_V0);
  writeFileSync("app/check.cjs", CHECK);
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  const check = { name: "bash", input: { command: "node app/check.cjs" } };
  script = (body) => {
    const n = toolResults(body).length;
    if (body.model === "claude-sonnet-5-5") {
      return [
        { text: "Looking at the notifier.", tools: [{ name: "read_file", input: { path: "app/api.cjs" } }] },
        { text: "Reproducing it.", tools: [check] },
        { tools: [{ name: "write_file", input: { path: "app/api.cjs", content: PATCH_1 } }] },
        { tools: [check] },
        { tools: [{ name: "write_file", input: { path: "app/api.cjs", content: PATCH_2 } }] },
        { tools: [check] },
      ][n] ?? { text: "Still stuck." };
    }
    if (body.model === "claude-opus-5-5") {
      return n === 6 ? { text: "The write and the retry race: key the notification.", tools: [{ name: "write_file", input: { path: "app/api.cjs", content: FIXED } }] }
        : n === 7 ? { tools: [check] }
        : { text: "Fixed: notifications are keyed by order, so the worker's retry can't send a second one." };
    }
    return { text: `unexpected model ${body.model}` };
  };
  const r = await runDirect("artificer", "Customers sometimes get the same order notification twice. Find and fix it.", ...chat("dup1"));
  assert.equal(r?.status, "done");
  assert.equal(r!.model, "claude-opus-5-5");

  // Routine reads, edits and checks stayed on the general route; the switch came only with the repeated failure.
  const byModel = api.seen.map((s) => s.body.model);
  assert.deepEqual(byModel, [...Array(6).fill("claude-sonnet-5-5"), ...Array(3).fill("claude-opus-5-5")]);
  assert.ok(api.seen.slice(0, 6).every((s) => s.body.output_config?.effort === "medium"));
  assert.ok(api.seen.slice(6).every((s) => s.body.output_config?.effort === "high"));

  // The stronger route got the reproduction, both earlier patches and every tool result, in order.
  const first = api.seen[6].body;
  const sent = JSON.stringify(first.messages);
  for (const piece of ["The api and worker both call notify()", "FAIL: duplicate notification", "PATCH-1", "PATCH-2"]) assert.ok(sent.includes(piece), `carried over: ${piece}`);
  assert.equal(toolResults(first).length, 6);
  const uses = first.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "tool_use").map((c: any) => c.id) : []));
  assert.deepEqual(uses, toolResults(first).map((c: any) => c.tool_use_id), "every call is answered, in order");

  // The regression check: exactly one notification under retry.
  assert.match(execFileSync("node", ["app/check.cjs"], { encoding: "utf8" }), /OK: exactly 1 notification under retry/);

  // The run's history says what happened and why.
  const steps = r!.route!.steps;
  assert.deepEqual(steps.map((s) => [s.route, s.trigger]), [["claude-sonnet-5-5@medium", "new_task"], ["claude-opus-5-5@high", "repeated_failure"]]);
  assert.equal(steps[1].reason, "Switched: after two distinct patches reproduced the same failure (“FAIL: duplicate notification: worker retry sent 2 notifications for order 42”).");
  const shown = routeEvents().map((e) => [e.model, e.switched, e.trigger]);
  assert.deepEqual(shown, [["claude-sonnet-5-5", false, "new_task"], ["claude-sonnet-5-5", false, "scope_change"], ["claude-opus-5-5", true, "repeated_failure"]]);
  assert.match(routeEvents()[1].reason, /^Stayed on the current model: the work turned out to involve a concurrency or correctness risk, but/);

  // Both routes are in the task's accounting, and they add up to its cost.
  const use = Object.fromEntries(r!.route!.use.map((u) => [u.route, u]));
  assert.deepEqual([use["claude-sonnet-5-5@medium"].turns, use["claude-opus-5-5@high"].turns], [6, 3]);
  assert.ok(Math.abs(use["claude-sonnet-5-5@medium"].usd + use["claude-opus-5-5@high"].usd - r!.costUsd!) < 1e-12);
  const q = recentQuests(5).find((x) => x.route);
  assert.equal(q?.route?.steps.length, 2);

  // The routing log: decisions and the outcome, with the policy version and estimates; never the prompt.
  const log = auto.routingLog().filter((x) => x.run.includes("dup1"));
  const decisions = log.filter((x): x is any => x.kind === "decision");
  assert.deepEqual(decisions.map((d) => [d.trigger, d.selected, !!d.kept]), [["new_task", "claude-sonnet-5-5@medium", false], ["scope_change", "claude-sonnet-5-5@medium", true], ["repeated_failure", "claude-opus-5-5@high", false]]);
  assert.ok(decisions.every((d) => d.policyVersion === "auto-2026-11-26.1" && d.candidates.length === ROUTES.length && d.estimates.length));
  // The risk was found by the failing check (its own failure line), not by reading the file that mentions retries.
  assert.ok(!decisions[0].profile.signals.some((s: string) => s.startsWith("consequence:")));
  assert.ok(decisions[1].profile.signals.includes("consequence:high (found while working)"));
  const outcome = log.find((x): x is any => x.kind === "outcome");
  assert.deepEqual([outcome.mode, outcome.ok, outcome.switches, outcome.routes.length], ["auto:balanced", true, 1, 2]);
  // What's learned: the route whose fix passed its check gets a success; the one left after two failed fixes, a failure.
  assert.equal(outcome.grade, "verified");
  const learned = auto.loadEvidence();
  assert.deepEqual([learned["claude-opus-5-5@high"][outcome.family].n, learned["claude-opus-5-5@high"][outcome.family].ok], [1, 1]);
  assert.deepEqual([learned["claude-sonnet-5-5@medium"][outcome.family].n, learned["claude-sonnet-5-5@medium"][outcome.family].ok], [1, 0]);
  assert.ok(!readFileSync(auto.ROUTING_LOG, "utf8").includes("Customers sometimes"), "no prompt in the routing log");
  const switched = decisions[2];
  t.diagnostic(`decision: ${JSON.stringify({ trigger: switched.trigger, selected: switched.selected, profile: switched.profile, estimates: switched.estimates.filter((e: any) => /sonnet-5-5@medium|opus-5-5@high/.test(e.routeId)), reason: steps[1].reason })}`);
});

test("a cooling provider: Auto waits briefly, then falls back within the deadline; a pinned conversation keeps its pin", async () => {
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  script = (body) => (body.model === "claude-sonnet-5-5" ? { status: 529 } : { text: `answered by ${body.model}` });
  const r = await runDirect("scribe", "Summarise the release notes", ...chat("cool1"));
  assert.equal(r?.status, "done");
  assert.equal(r!.model, "claude-opus-5-5");
  assert.deepEqual(api.seen.map((s) => s.body.model), ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5", "claude-opus-5-5"], "two retries on the route, then the next one (the SDK doesn't retry on its own under Auto)");
  const sw = routeEvents().find((e) => e.switched)!;
  assert.equal(sw.trigger, "provider_unavailable");
  assert.match(sw.reason, /^Switched: claude-sonnet-5-5 was unavailable after 3 tries\.$/);

  // A wait longer than the deadline isn't waited out: the next route is asked straight away.
  auto.resetHealthForTests();
  auto.setRoutingForTests({ estimates: estimates(CODING), deadlineMs: 5_000 });
  api.seen.length = 0; events.length = 0;
  script = (body) => (body.model === "claude-sonnet-5-5" ? { status: 429, retryAfter: 120 } : { text: "ok" });
  const r2 = await runDirect("scribe", "Summarise the changelog", ...chat("cool2"));
  assert.equal(r2?.status, "done");
  assert.deepEqual(api.seen.map((s) => s.body.model), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.match(routeEvents().find((e) => e.switched)!.reason, /asked to wait 120s/);

  // A conversation pinned to Sonnet stays on Sonnet through the same failure, and says Auto could carry on.
  api.seen.length = 0;
  script = () => ({ status: 529, retryAfter: 0 });
  await assert.rejects(runDirect("scribe", "Summarise the roadmap", ...chat("pin1", { model: "claude-sonnet-5-5" })), /Pick Auto for this conversation/);
  assert.ok(api.seen.length > 1 && api.seen.every((s) => s.body.model === "claude-sonnet-5-5"), "never moved off the pin");
  assert.equal(threadFor("pin1")!.model, "claude-sonnet-5-5");
});

test("every route cooling down: a short wait is waited out (cancellably); otherwise the reason is given", async () => {
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  for (const r of ROUTES) auto.coolDown(r, 150, "test");
  script = () => ({ text: "back" });
  const r = await runDirect("scribe", "Summarise it", ...chat("wait1"));
  assert.equal(r?.status, "done");
  auto.setRoutingForTests({ estimates: estimates(CODING), deadlineMs: 1_000 });
  for (const r of ROUTES) auto.coolDown(r, 60_000, "test");
  await assert.rejects(runDirect("scribe", "Summarise it again", ...chat("wait2")), /Auto couldn't pick a model: All 5 models that support tool calls are cooling down\. Try again in 60s, or pick a model\./);
});

test("Stop during a backoff: no further provider or tool call starts", async () => {
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  setRetryWaitsForTests([5_000, 5_000, 5_000]);
  script = () => ({ status: 529 });
  const stop = new AbortController();
  const running = runDirect("artificer", "Fix the failing build", "direct", [], stop.signal, "stop1", undefined, { project: "general", links: [], model: "auto:balanced" });
  while (!api.seen.length) await new Promise((ok) => setTimeout(ok, 10));
  stop.abort();
  const r = await running;
  assert.equal(r?.status, "stopped");
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(api.seen.length, 1);
  assert.ok(!events.some((e) => e.type === "tool"));
});

test("a dropped connection after a write: picking the task up again reuses what was done, and never does it twice", async () => {
  mkdirSync("app", { recursive: true });
  writeFileSync("app/notify.cjs", `require("node:fs").appendFileSync("app/sent.log", "notified order 7\\n"); console.log("sent");\n`);
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  const notifyCall = { name: "bash", input: { command: "node app/notify.cjs" } };
  script = (body) => (toolResults(body).length === 0 ? { tools: [notifyCall] } : { drop: true });
  await assert.rejects(runDirect("artificer", "Send the order 7 notification", ...chat("drop1")));
  assert.equal(readFileSync("app/sent.log", "utf8"), "notified order 7\n");

  // Picked up again in the same conversation: the run's saved transcript is restored, so the model
  // is sent the command and its result, and has no need to ask for it again. (A call that was under
  // way when the run broke off is still the journal's to guard: tests/long-runs.test.ts.)
  events.length = 0; api.seen.length = 0;
  script = (body) => (toolResults(body).length === 0 ? { tools: [notifyCall] } : { text: "Sent." });
  const r = await runDirect("artificer", "Carry on.", "direct", [], undefined, "drop2", "drop1", { project: "general", links: [], model: "auto:balanced" });
  assert.equal(r?.status, "done");
  assert.equal(readFileSync("app/sent.log", "utf8"), "notified order 7\n", "exactly one notification");
  assert.match(toolResults(api.seen[0].body)[0].content, /sent/);
  assert.ok(events.some((e) => e.type === "notice" && /Picked up from the saved transcript/.test(e.text)));
  // The resumed task started from the route it was on.
  assert.equal(routeEvents()[0].trigger, "resume");

  // A run that finished cleanly isn't replayed: asking again later runs it again.
  script = (body) => (toolResults(body).length === 0 ? { tools: [notifyCall] } : { text: "Sent again." });
  await runDirect("artificer", "Send it again", "direct", [], undefined, "drop3", "drop2", { project: "general", links: [], model: "auto:balanced" });
  assert.equal(readFileSync("app/sent.log", "utf8"), "notified order 7\nnotified order 7\n");
});

test("an operation whose outcome was never recorded is reconciled before it's retried, or held back until checked", async () => {
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  let posted = 0, ran = 0;
  const review = { def: { name: "post_review", description: "post", input_schema: { type: "object" as const, properties: { body: { type: "string" } } } },
    run: async () => { posted++; return "posted"; }, reconcile: async () => ({ state: "done" as const, result: "review #9 is already there" }) };
  const shell = { def: { name: "bash", description: "run", input_schema: { type: "object" as const, properties: { command: { type: "string" } } } },
    run: async () => { ran++; return "ran"; } };
  // An earlier run of this task started both, then the camp went down before either was recorded.
  const before = new OpJournal("t-unc:scribe", "old:-:scribe:1");
  before.begin();
  before.started(before.opId("post_review", { body: "LGTM" }), "post_review");
  before.started(before.opId("bash", { command: "gh issue create" }), "bash");
  before.abandon();

  let turn = 0;
  script = () => [
    { tools: [{ name: "post_review", input: { body: "LGTM" } }, { name: "bash", input: { command: "gh issue create" } }] },
    { tools: [{ name: "bash", input: { command: "gh issue create" } }] },
    { text: "done" },
  ][turn++] ?? { text: "done" };
  const spec = { id: "scribe" as const, name: "Scribe", emoji: "📜", role: "test", persona: "test", tools: [review, shell], skillDirs: [] };
  const r = await withExpedition({ id: "unc", thread: "t-unc", replyTo: "old", model: "auto:balanced" }, () => runAgent(spec as any, "Post the review and file the issue", { plain: true }));
  assert.equal(r.status, "done");
  assert.equal(posted, 0, "the review was confirmed as posted, so it wasn't posted again");
  assert.equal(ran, 1, "the issue command was held back once, then run when asked again");
  const first = toolResults(api.seen[1].body);
  assert.match(first[0].content, /Confirmed already done[\s\S]*review #9/);
  assert.equal(first[1].is_error, true);
  assert.match(first[1].content, /outcome was never recorded/);

  // What's journaled: commands and writes that change something. Reads and checks always run afresh.
  const { journals } = await import("../src/oplog.ts");
  const journaledOnes = ["npm test", "node app/check.cjs", "git status", "npx tsc --noEmit", "cd web && npm run lint", "node app/notify.cjs", "gh pr create --fill", "echo hi > out.log", "git push"]
    .filter((command) => journals("bash", { command }));
  assert.deepEqual(journaledOnes, ["node app/notify.cjs", "gh pr create --fill", "echo hi > out.log", "git push"]);
  assert.equal(journals("read_file", { path: "x" }), false);
});

test("a later message in the conversation isn't a pick-up: only a reply to the run that broke off reuses what it did", async () => {
  auto.setRoutingForTests({ estimates: estimates(CODING) });
  let ran = 0;
  const shell = { def: { name: "bash", description: "run", input_schema: { type: "object" as const, properties: { command: { type: "string" } } } }, run: async () => { ran++; return "sent"; } };
  const spec = { id: "scribe" as const, name: "Scribe", emoji: "📜", role: "test", persona: "test", tools: [shell], skillDirs: [] };
  const prior = new OpJournal("t-later:scribe", "broke:-:scribe:1");
  prior.begin();
  const op = prior.opId("bash", { command: "gh issue create" });
  prior.started(op, "bash"); prior.done(op, "bash", "issue #4");
  prior.abandon();
  let turn = 0;
  script = () => (turn++ % 2 === 0 ? { tools: [{ name: "bash", input: { command: "gh issue create" } }] } : { text: "done" });
  await withExpedition({ id: "later", thread: "t-later", replyTo: "something-else", model: "auto:balanced" }, () => runAgent(spec as any, "File another issue", { plain: true }));
  assert.equal(ran, 1, "a new request in the same conversation runs its own commands");
});

test("an old session keeps its model; concurrent tasks route independently", async () => {
  // A conversation from before Auto: its model is a plain id, and it stays a pin.
  writeFileSync("camp/threads.jsonl", (existsSync("camp/threads.jsonl") ? readFileSync("camp/threads.jsonl", "utf8") : "") +
    JSON.stringify({ thread: "old1", expedition: "old1", agent: "scribe", direct: true, time: "2026-01-01T00:00:00.000Z", task: "hi", reply: "hello", status: "done", model: "claude-haiku-5-5" }) + "\n");
  assert.equal(threadFor("old1")!.model, "claude-haiku-5-5");
  script = () => ({ text: "still haiku" });
  const r = await runDirect("scribe", "And again", "direct", [], undefined, "old2", "old1", { project: "general", links: [], model: threadFor("old1")!.model });
  assert.equal(r!.model, "claude-haiku-5-5");
  assert.equal(r!.route, undefined);
  assert.equal(routeEvents().length, 0);

  // Two tasks at once in one conversation: a screenshot fix and a quick question. Each has its own route.
  auto.setRoutingForTests({ estimates: estimates({
    "claude-opus-5-5@high": (p: any) => (p.needs.images ? STRONG : WEAK),
    "claude-haiku-5-5@default": (p: any) => (p.needs.images ? WEAK : { attemptSuccess: 0.95, attemptUsd: 0.001, attemptSeconds: 3 }),
  }) });
  script = (body) => ({ text: `from ${body.model}`, delayMs: 30 });
  const spec = { id: "scribe" as const, name: "Scribe", emoji: "📜", role: "test", persona: "test", tools: [], skillDirs: [] };
  const png = { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "iVBORw0KGgo=" } };
  const [a, b] = await Promise.all([
    withExpedition({ id: "c1", thread: "conc", model: "auto:quality" }, () => runAgent(spec as any, [{ type: "text", text: "Fix the layout bug in this screenshot" }, png] as any, { plain: true })),
    withExpedition({ id: "c2", thread: "conc", model: "auto:balanced" }, () => runAgent(spec as any, "Hi, quick hello", { plain: true })),
  ]);
  assert.deepEqual([a.model, b.model], ["claude-opus-5-5", "claude-haiku-5-5"]);
  assert.deepEqual([a.route!.choice, b.route!.choice], ["auto:quality", "auto:balanced"]);
  assert.deepEqual([a.route!.steps.length, b.route!.steps.length], [1, 1]);
});

test("a reply cut off part-way through a tool call is never run", async () => {
  process.env.GROQ_API_KEY = "good-key-123456";
  const err = await providerChat({ provider: "groq", model: "llama-fast", system: "s", messages: [{ role: "user", content: "send it" }], tools: [{ name: "bash", description: "run", input_schema: { type: "object" } }] }).catch((e) => e);
  assert.ok(err instanceof ProviderError);
  assert.equal(err.passing, true, "a cut-off reply is a passing failure: Auto tries again or elsewhere");
  assert.match(err.message, /cut off part-way/);
  delete process.env.GROQ_API_KEY;
  assert.ok(!existsSync("app/sent.log") || readFileSync("app/sent.log", "utf8").split("\n").filter(Boolean).length === 2, "nothing more was sent");
});

// ---------- One task's router, on its own ----------
const MODELS = [
  { id: "claude-sonnet-5-5", name: "Sonnet", efforts: ["low", "medium", "high"] as any },
  { id: "claude-opus-5-5", name: "Opus", efforts: ["low", "medium", "high"] as any },
];
const routerFor = (run: string) => new auto.TaskRouter({ mode: "balanced", task: `unit:${run}`, run, agent: "artificer", models: MODELS, confidential: false,
  budgetLeft: () => undefined, profile: { text: "Rename the helper in utils", role: "artificer", tools: true }, requestTokens: 5_000 });

test("the wait deadline runs from when replies stopped arriving, not from when the task began", () => {
  let now = 1_000_000;
  auto.setRoutingForTests({ now: () => now, deadlineMs: 10_000 });
  const router = routerFor("deadline1");
  assert.equal(router.decide("new_task", 5_000, 0).kind, "selected");
  router.account(router.route!, 0.01, 5_000, 200);
  now += 60_000; // six deadlines' worth of work, with replies arriving
  assert.equal(router.waitLeft(), 10_000);
  router.account(router.route!, 0.01, 5_000, 200);
  now += 60_000;
  // The first passing failure, long after the task began: a short wait is still a short wait.
  assert.deepEqual(router.failed(4_000, [10]), { do: "wait", ms: 4_000 });
  // The same outage, 8s on: 2s of patience left, so a 4s wait means another route.
  now += 8_000;
  const next = router.failed(4_000, [10]);
  assert.equal(next.do, "switch");
  assert.match(next.do === "switch" ? next.evidence : "", /asked to wait 4s/);
  // A reply ends the outage; the next one starts its own clock, and its own count of tries.
  router.account(router.route!, 0.01, 5_000, 200);
  now += 60_000;
  assert.deepEqual(router.failed(undefined, [10, 20]), { do: "wait", ms: 10 });
  assert.equal(router.routeAttempts, 1);
});

test("a long Claude conversation is sized by what the API last counted, so cleared tool results don't force a switch", () => {
  const router = routerFor("context1");
  assert.equal(router.decide("new_task", 5_000, 0).kind, "selected");
  // Nothing counted yet: the estimate of the whole transcript is all there is.
  assert.equal(router.check(180_000)?.trigger, "capacity");
  // The API counted 60k for a request estimated at 100k (it had cleared old tool results).
  assert.equal(router.check(100_000), null);
  router.account(router.route!, 0.01, 60_000, 500);
  assert.equal(router.check(175_000), null, "60k counted + 75k added since, with room to answer");
  assert.equal(router.decide("scope_change", 175_000, 175_000).kind, "selected");
  const full = router.check(245_000);
  assert.equal(full?.trigger, "capacity");
  assert.match(full?.evidence ?? "", /~205k tokens/);
});

test("an outcome is graded before it's learned from: a passing check is a success, none is nearly neutral, and old ungraded records aren't used", () => {
  assert.deepEqual([auto.gradeOf("done", true), auto.gradeOf("done", null), auto.gradeOf("done", false), auto.gradeOf("out_of_turns", true)], ["verified", "unverified", "failed", "failed"]);
  for (const status of ["stopped", "over_budget", "error", "refused", "cut_off"]) assert.equal(auto.gradeOf(status, true), null, status);

  const v = new auto.Verification();
  const bash = (command: string, output = "ok") => ({ name: "bash", input: { command }, output, failed: false });
  v.note([bash("npm test")]);
  assert.equal(v.state, true);
  v.note([bash("git status"), bash("ls src")]);
  assert.equal(v.state, true, "looking around changes nothing");
  v.note([{ name: "edit_file", input: { path: "a.ts" }, output: "ok", failed: false }]);
  assert.equal(v.state, null, "a change after the last check: not checked");
  v.note([bash("npx tsc --noEmit", "Exit code 2\nsrc/a.ts(1,1): error TS1005")]);
  assert.equal(v.state, false);

  const before = existsSync(auto.EVIDENCE_PATH) ? readFileSync(auto.EVIDENCE_PATH, "utf8") : null;
  try {
    const route = { id: "claude-sonnet-5-5@medium", tier: "sonnet" as const, effort: "medium" as const };
    // Records from before outcomes were graded stay on disk, but aren't read.
    writeFileSync(auto.EVIDENCE_PATH, JSON.stringify({ [route.id]: { editing: { n: 9, ok: 9 }, search: { n: 3, ok: 3 } } }));
    assert.deepEqual(auto.loadEvidence(), { [route.id]: {} });
    const expected = priorSuccess(route, { difficulty: 0.5 });
    auto.noteOutcome(route, "editing", 0.5, "verified");
    auto.noteOutcome(route, "editing", 0.5, "unverified");
    auto.noteOutcome(route, "editing", 0.5, "failed");
    const slot = auto.loadEvidence()[route.id].editing;
    assert.equal(slot.n, 3);
    assert.ok(Math.abs(slot.expected! - 3 * expected) < 1e-3);
    assert.ok(Math.abs(slot.ok - (1 + expected + POLICY.unverifiedCredit * (1 - expected))) < 1e-3, "1 for the checked one, a little over par for the unchecked one, 0 for the failed one");
    assert.deepEqual(JSON.parse(readFileSync(auto.EVIDENCE_PATH, "utf8"))[route.id].search, { n: 3, ok: 3 });
  } finally {
    if (before != null) writeFileSync(auto.EVIDENCE_PATH, before);
  }
});

test("a model taken out of Auto's choices in settings is excluded from its snapshot, and comes back when allowed", async () => {
  const { setAutoExcluded, autoExcluded } = await import("../src/settings.ts");
  const { snapshot } = await import("../src/autoroute.ts");
  const { selectRoute, profileTask } = await import("../src/routing.ts");
  const models = [
    { id: "claude-fable-5-2", name: "Claude Fable 5.2", efforts: ["low", "medium", "high"] as any },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", efforts: [] },
  ];
  setAutoExcluded("claude-fable-5-2", false);
  assert.deepEqual(autoExcluded(), ["claude-fable-5-2"]);
  const snap = snapshot(models, { confidential: false });
  assert.deepEqual(snap.workspace.exclude, ["claude-fable-5-2"]);
  const p = profileTask({ text: "rename a variable", requestTokens: 500 } as any);
  const d = selectRoute(p, { trigger: "new_task", historyTokens: 0, repeatedFailures: 0 }, snap, undefined, "quality");
  assert.ok(d.exclusions.some((x) => x.routeId.startsWith("claude-fable-5-2") && x.reason === "excluded by your model policy"));
  if (d.kind === "selected") assert.ok(!d.primary.model.startsWith("claude-fable"));
  setAutoExcluded("claude-fable-5-2", true);
  assert.deepEqual(autoExcluded(), []);
});
