// Auto's decisions, on their own: the same inputs always give the same route, each preference
// follows its rule, recovery cost counts, hard requirements come first, and attempts are counted
// by distinct fixes rather than log lines. Nothing here calls a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AttemptTracker, POLICY, autoLabel, carried, exclusionOf, expectedTaskCost, failureSignature, isAutoChoice, materialChange, measurePart, parseChoice, priorSuccess, profileTask,
  repeatedFailureEvidence, replayUsd, RequestSizer, requestTokens, routeId, routeName, selectRoute, showsRisk,
  type CandidateSnapshot, type Route, type SessionState, type TaskProfile,
} from "../src/routing.ts";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("routing");
const { routingReport } = await import("../src/autoroute.ts");

const claude = (model: string, tier: Route["tier"], effort?: Route["effort"], price = { input: 3, output: 15 }): Route => ({
  id: routeId(model, effort), model, provider: "anthropic", effort, tier, price,
  caps: { images: true, tools: true, serverTools: true, contextTokens: 200_000, maxOutput: 32_000 },
});
const open = (model: string, o: Partial<Route["caps"]> = {}, price: Route["price"] = null): Route => ({
  id: routeId(model), model, provider: model.split(":")[0], tier: "open-fast", price,
  caps: { images: false, tools: true, serverTools: false, contextTokens: 128_000, maxOutput: 8_192, ...o },
});
const snap = (routes: Route[], o: Partial<CandidateSnapshot> = {}): CandidateSnapshot => ({
  routes, now: 1_000_000, health: {}, credentials: { anthropic: true, deepseek: true, groq: true },
  workspace: { confidential: false, approvedProviders: [] }, ...o,
});
const fresh: SessionState = { trigger: "new_task", historyTokens: 0, repeatedFailures: 0 };
const task = (text: string, more: Partial<Parameters<typeof profileTask>[0]> = {}) => profileTask({ text, requestTokens: 8_000, ...more });

test("a choice is a model, or Auto with a preference; Balanced is what Auto means, and old model ids load as they were", () => {
  assert.deepEqual(parseChoice("auto"), { kind: "auto", preference: "balanced" });
  assert.deepEqual(parseChoice("auto:economy"), { kind: "auto", preference: "economy" });
  assert.deepEqual(parseChoice("claude-sonnet-5-5"), { kind: "manual", model: "claude-sonnet-5-5" });
  assert.deepEqual(parseChoice("groq:llama-fast"), { kind: "manual", model: "groq:llama-fast" });
  assert.equal(isAutoChoice("auto:cheap"), false);
  assert.equal(isAutoChoice("automatic-model"), false);
});

test("the recovery fixture: $0.04 with a 35% chance of a $0.20 rescue costs $0.11, and Economy takes the $0.09 route that needs none", () => {
  assert.equal(Math.round(expectedTaskCost(0.04, 0.35, 0.2) * 100) / 100, 0.11);
  const a = claude("claude-haiku-5-5", "haiku"), b = claude("claude-sonnet-5-5", "sonnet", "low");
  const p = task("Fix the typo in the helper's comment"); // cosmetic: a 65% attempt clears its bar on its own
  assert.equal(p.consequence, "cosmetic");
  const estimates = {
    [a.id]: { attemptSuccess: 0.65, attemptUsd: 0.04, attemptSeconds: 20, fallbackProbability: 0.35, recoveryUsd: 0.2, recoverySuccess: 0.95 },
    [b.id]: { attemptSuccess: 0.97, attemptUsd: 0.09, attemptSeconds: 25, fallbackProbability: 0 },
  };
  const d = selectRoute(p, fresh, snap([a, b], { estimates }), POLICY, "economy");
  assert.equal(d.kind, "selected");
  if (d.kind !== "selected") return;
  assert.equal(d.primary.id, b.id);
  const ea = d.estimates.find((e) => e.routeId === a.id)!;
  assert.equal(ea.expectedUsd, 0.11);
  assert.ok(Math.abs(ea.completion - d.estimates.find((e) => e.routeId === b.id)!.completion) < 0.02, "comparable odds of finishing");
  // Without the rescue counted, the cheap attempt would have won: recovery cost changes the winner.
  const naive = selectRoute(p, fresh, snap([a, b], { estimates: { ...estimates, [a.id]: { ...estimates[a.id], recoveryUsd: 0 } } }), POLICY, "economy");
  assert.equal(naive.kind === "selected" && naive.primary.id, a.id);
});

test("each preference follows its rule on controlled estimates, deterministically", () => {
  const cheap = claude("claude-haiku-5-5", "haiku"), mid = claude("claude-sonnet-5-5", "sonnet", "medium"), top = claude("claude-opus-5-5", "opus", "high");
  const estimates = {
    [cheap.id]: { attemptSuccess: 0.8, attemptUsd: 0.01, attemptSeconds: 10, fallbackProbability: 0, recoverySuccess: 0 },
    [mid.id]: { attemptSuccess: 0.9, attemptUsd: 0.05, attemptSeconds: 30, fallbackProbability: 0, recoverySuccess: 0 },
    [top.id]: { attemptSuccess: 0.96, attemptUsd: 0.4, attemptSeconds: 90, fallbackProbability: 0, recoverySuccess: 0 },
  };
  const s = snap([top, cheap, mid], { estimates });
  const p = task("Explain how the cache works"); // normal consequence: floor 0.75
  const pick = (mode: "economy" | "balanced" | "quality") => { const d = selectRoute(p, fresh, s, POLICY, mode); return d.kind === "selected" ? d.primary.id : d.reason; };
  assert.equal(pick("economy"), cheap.id, "cheapest that meets the floor");
  assert.equal(pick("balanced"), mid.id, "0.9 − 0.6×0.05 − 0.0004×30 beats both neighbours");
  assert.equal(pick("quality"), top.id, "most likely to finish");
  // A near tie on quality goes to the faster route.
  const tie = snap([top, mid], { estimates: { ...estimates, [mid.id]: { ...estimates[mid.id], attemptSuccess: 0.955 } } });
  const q = selectRoute(p, fresh, tie, POLICY, "quality");
  assert.equal(q.kind === "selected" && q.primary.id, mid.id);
  // Identical inputs, identical decision.
  assert.deepEqual(selectRoute(p, fresh, s, POLICY, "balanced"), selectRoute(p, fresh, s, POLICY, "balanced"));
  // A floor nobody reaches: the strongest is taken and the shortfall recorded.
  const low = snap([cheap, mid], { estimates: { [cheap.id]: { ...estimates[cheap.id], attemptSuccess: 0.5 }, [mid.id]: { ...estimates[mid.id], attemptSuccess: 0.6 } } });
  const short = selectRoute(task("Drop the users table in production"), fresh, low, POLICY, "economy");
  assert.ok(short.kind === "selected" && short.primary.id === mid.id && short.shortfall === 0.3, "critical floor 0.9 − 0.6");
});

test("one eligible route is chosen; none gives a reason the page can show", () => {
  const shot = claude("claude-sonnet-5-5", "sonnet", "medium");
  const p = task("Fix the button in this screenshot", { hasImages: true });
  const one = selectRoute(p, fresh, snap([shot, open("deepseek:deepseek-flash")]), POLICY, "balanced");
  assert.equal(one.kind, "selected");
  if (one.kind === "selected") {
    assert.equal(one.primary.id, shot.id);
    assert.match(one.reason, /only model that can take this task/);
    assert.deepEqual(one.exclusions, [{ routeId: "deepseek:deepseek-flash@default", reason: "can't be shown images" }]);
  }
  const both = [shot, claude("claude-opus-5-5", "opus", "high")];
  const cooling = snap(both, { health: { "provider:anthropic": { cooldownUntil: 1_030_000 } } });
  const none = selectRoute(p, fresh, cooling, POLICY, "balanced");
  assert.equal(none.kind, "unavailable");
  if (none.kind === "unavailable") {
    assert.equal(none.reason, "Both models that support this screenshot and the edit tools are cooling down. Try again in 30s, or pick a model.");
    assert.equal(none.retryAfterMs, 30_000);
  }
  const unplugged = selectRoute(task("hello"), fresh, snap([open("groq:llama-fast")], { credentials: { anthropic: true } }), POLICY, "balanced");
  assert.ok(unplugged.kind === "unavailable" && /not connected/.test(unplugged.reason));
});

test("a screenshot with edit tools: the route and every fallback can take the image, the tools and the whole request", () => {
  const routes = [
    claude("claude-sonnet-5-5", "sonnet", "medium"), claude("claude-opus-5-5", "opus", "high"), claude("claude-haiku-5-5", "haiku"),
    open("gemini:gemini-flash", { images: true, contextTokens: 1_000_000 }), open("deepseek:deepseek-flash"),
    open("groq:llama-vision", { images: true, contextTokens: 16_000 }),
  ];
  const p = task("Fix the layout bug in this screenshot", { hasImages: true, requestTokens: 20_000 });
  const d = selectRoute(p, fresh, snap(routes, { credentials: { anthropic: true, gemini: true, deepseek: true, groq: true } }), POLICY, "balanced");
  assert.equal(d.kind, "selected");
  if (d.kind !== "selected") return;
  for (const r of [d.primary, ...d.fallbacks]) {
    assert.ok(r.caps.images && r.caps.tools, `${r.id} takes images and tools`);
    assert.ok(p.needs.requestTokens + r.caps.maxOutput <= r.caps.contextTokens, `${r.id} holds the request`);
  }
  assert.ok(d.fallbacks.length >= 1);
  const out = Object.fromEntries(d.exclusions.map((e) => [e.routeId, e.reason]));
  assert.equal(out["deepseek:deepseek-flash@default"], "can't be shown images");
  assert.match(out["groq:llama-vision@default"], /more than its 16k context/);
  // A confidential project keeps unapproved providers out; a model you've excluded stays out.
  const c = selectRoute(p, fresh, snap(routes, { credentials: { anthropic: true, gemini: true }, workspace: { confidential: true, approvedProviders: [], exclude: ["claude-opus-5-5"] } }), POLICY, "balanced");
  const cx = c.kind === "selected" ? Object.fromEntries(c.exclusions.map((e) => [e.routeId, e.reason])) : {};
  assert.match(cx["gemini:gemini-flash@default"], /confidential/);
  assert.equal(cx["claude-opus-5-5@high"], "excluded by your model policy");
});

test("unknown prices are said to be unknown, and sparse evidence leans on the route's wider record", () => {
  const known = claude("claude-haiku-5-5", "haiku", undefined, { input: 0.1, output: 0.5 });
  const unknown = open("groq:llama-fast");
  const p = task("Find where the config is loaded");
  const d = selectRoute(p, fresh, snap([known, unknown]), POLICY, "economy");
  assert.ok(d.kind === "selected");
  if (d.kind !== "selected") return;
  assert.equal(d.estimates.find((e) => e.routeId === unknown.id)!.priceKnown, false);
  assert.equal(d.primary.id, known.id, "an unknown price can't be shown to be cheapest");
  // Two observed failures at search barely move a route with 40 good tasks elsewhere.
  const r = claude("claude-sonnet-5-5", "sonnet", "medium");
  const base = selectRoute(p, fresh, snap([r]), POLICY, "balanced");
  const seen = selectRoute(p, fresh, snap([r], { evidence: { [r.id]: { search: { n: 2, ok: 0 }, editing: { n: 40, ok: 40 } } } }), POLICY, "balanced");
  const before = base.kind === "selected" ? base.estimates[0] : null, after = seen.kind === "selected" ? seen.estimates[0] : null;
  assert.ok(before && after && after.attemptSuccess < before.attemptSuccess && after.attemptSuccess > 0.75, `${before?.attemptSuccess} → ${after?.attemptSuccess}`);
  assert.equal(after?.samples, 2);
});

test("a task is read from what the harness sees: the role is a hint, a short follow-up is read against the plan", () => {
  const plan = "Plan: add an idempotency key to the notification write so a worker retry can't send twice.";
  const f = profileTask({ text: "implement it", context: plan, role: "scribe", requestTokens: 1000 });
  assert.equal(f.followUp, true);
  assert.equal(f.consequence, "high");
  assert.ok(["editing", "debugging"].includes(f.family), f.family);
  assert.equal(profileTask({ text: "Hi there", role: "scribe", requestTokens: 10 }).family, "summarization");
  assert.equal(profileTask({ text: "Summarise this diff", role: "scribe", requestTokens: 10 }).family, "summarization");
  assert.equal(profileTask({ text: "Reconstruct what broke in last night's incident and why it failed", role: "scribe", requestTokens: 10 }).family, "debugging");
  // Evidence found while working can raise the stakes, which is a material change; a routine read isn't.
  const before = profileTask({ text: "Customers get the same email twice. Fix it.", requestTokens: 10 });
  const routine = profileTask({ text: "Customers get the same email twice. Fix it.", requestTokens: 10, evidence: ["const x = 1;"] });
  const found = profileTask({ text: "Customers get the same email twice. Fix it.", requestTokens: 10, evidence: ["// the api and worker both send; the worker retries on timeout"] });
  assert.equal(materialChange(before, routine), null);
  assert.match(materialChange(before, found) ?? "", /concurrency or correctness risk/);
});

test("attempts are distinct fixes, not log lines: the same failure twice in one log is one, a rerun with nothing changed is none", () => {
  const t = new AttemptTracker();
  const fail = "Exit code 1\nFAIL: worker retry sent 2 notifications (12ms)\nFAIL: worker retry sent 2 notifications (14ms)";
  assert.deepEqual(t.noteFailure(fail), { distinct: 0, excerpt: "FAIL: worker retry sent 2 notifications (12ms)" });
  assert.equal(t.noteFailure(fail)!.distinct, 0, "nothing changed in between");
  t.noteChange("edit_file:a"); t.noteChange("edit_file:a");
  assert.equal(t.noteFailure(fail.replace("12ms", "99ms"))!.distinct, 1);
  t.noteChange("edit_file:a");
  assert.equal(t.noteFailure(fail)!.distinct, 1, "the same patch again isn't a new attempt");
  t.noteChange("edit_file:b");
  assert.equal(t.noteFailure(fail)!.distinct, 2);
  assert.equal(t.noteFailure("Exit code 1\nError: something else entirely")!.distinct, 0, "a different failure starts its own count");
});

test("switching between healthy routes has to clear the margin after paying to replay the conversation", () => {
  const inc = claude("claude-sonnet-5-5", "sonnet", "medium"), ch = claude("claude-opus-5-5", "opus", "high", { input: 5, output: 25 });
  const p: TaskProfile = task("Fix the flaky test");
  const est = (chSuccess: number) => ({ [inc.id]: { attemptSuccess: 0.9, attemptUsd: 0.05, attemptSeconds: 60, fallbackProbability: 0 }, [ch.id]: { attemptSuccess: chSuccess, attemptUsd: 0.05, attemptSeconds: 60, fallbackProbability: 0 } });
  const sess: SessionState = { trigger: "scope_change", incumbent: inc.id, historyTokens: 40_000, repeatedFailures: 0, evidence: "the change turned out to span more than one service" };
  const small = selectRoute(p, sess, snap([inc, ch], { estimates: est(0.95) }), POLICY, "balanced");
  assert.ok(small.kind === "selected" && small.primary.id === inc.id && small.kept, "0.05 better, minus 0.6×$0.20 replay, is under the 0.04 margin");
  assert.match(small.kind === "selected" ? small.reason : "", /^Stayed on the current model: the change turned out to span more than one service, but/);
  const big = selectRoute(p, { ...sess, historyTokens: 1_000 }, snap([inc, ch], { estimates: est(0.99) }), POLICY, "balanced");
  assert.ok(big.kind === "selected" && big.primary.id === ch.id && !big.kept);
  assert.equal(big.kind === "selected" && big.reason, "Switched: the change turned out to span more than one service.");
  // Repeated failure on the incumbent counts against it.
  const failing = selectRoute(p, { ...sess, trigger: "repeated_failure", repeatedFailures: 2, evidence: "after two distinct patches reproduced the same failure (“x”)" }, snap([inc, ch], { estimates: est(0.95) }), POLICY, "balanced");
  assert.ok(failing.kind === "selected" && failing.primary.id === ch.id);
  // Once moved off, the failures stay with the route they happened on: a later look doesn't send the task back there.
  const later = selectRoute(p, { trigger: "scope_change", incumbent: ch.id, historyTokens: 1_000, repeatedFailures: 0, penalties: { [inc.id]: 2 }, evidence: "the change turned out to span more than one service" },
    snap([inc, ch], { estimates: est(0.93) }), POLICY, "balanced");
  assert.ok(later.kind === "selected" && later.primary.id === ch.id && later.kept, "0.9 × 0.36 on the route that failed");
});

test("the comparison with fixed models counts every attempt and keeps scripted fixtures apart from observed runs", () => {
  const out = (task: string, mode: string, ok: boolean, usd: number, seconds: number, source: "observed" | "fixture", route = "claude-sonnet-5-5@high") =>
    ({ kind: "outcome" as const, at: "", task, run: task, agent: "artificer", mode, status: ok ? "done" : "error", ok, seconds, usd, switches: 0, routes: [{ route, usd, input: 0, output: 0, turns: 1 }], source });
  const r = routingReport([
    out("t1", "auto:balanced", true, 0.1, 30, "fixture"), out("t1", "manual", true, 0.3, 50, "fixture"),
    out("t2", "auto:balanced", false, 0.05, 10, "fixture"), out("t2", "manual", true, 0.3, 60, "fixture"),
    out("t3", "auto:balanced", true, 0.2, 40, "observed"),
  ]);
  assert.equal(r.matchedTasks, 2);
  const auto = r.arms.find((a) => a.arm === "auto:balanced" && a.source === "fixture")!;
  assert.deepEqual([auto.tasks, auto.completed, auto.completionRate], [2, 1, 0.5]);
  assert.ok(Math.abs(auto.usdPerSuccess! - 0.15) < 1e-9, "the failed attempt's spend is counted against the success");
  assert.equal(r.arms.find((a) => a.arm === "manual:claude-sonnet-5-5@high")!.usdPerSuccess, 0.3);
  assert.ok(r.arms.some((a) => a.arm === "auto:balanced" && a.source === "observed" && a.tasks === 1));
});

test("the bar is cleared on a route's own odds: a rescue doesn't lift a weak route over it, and Quality ranks on them", () => {
  const a = claude("claude-haiku-5-5", "haiku"), b = claude("claude-sonnet-5-5", "sonnet", "low"), c = claude("claude-opus-5-5", "opus", "high");
  const p = task("Rename the helper in utils");
  assert.equal(POLICY.qualityFloor[p.consequence], 0.75);
  // 65% alone, 98% with a rescue that costs nothing: still under a 75% bar, so the dearer route that clears it is taken.
  const rescued = { attemptSuccess: 0.65, attemptUsd: 0.04, attemptSeconds: 20, fallbackProbability: 0.35, recoveryUsd: 0, recoverySuccess: 0.95 };
  const sure = { attemptSuccess: 0.97, attemptUsd: 0.09, attemptSeconds: 25, fallbackProbability: 0 };
  for (const mode of ["economy", "balanced"] as const) {
    const d = selectRoute(p, fresh, snap([a, b], { estimates: { [a.id]: rescued, [b.id]: sure } }), POLICY, mode);
    assert.ok(d.kind === "selected" && d.primary.id === b.id && d.shortfall == null, mode);
  }
  // Quality: a 30% route that a rescue would nearly always save isn't "most likely to finish".
  const weak = { attemptSuccess: 0.3, attemptUsd: 0.01, attemptSeconds: 5, fallbackProbability: 0.7, recoverySuccess: 0.99, recoveryUsd: 0.2 };
  const q = selectRoute(p, fresh, snap([a, b], { estimates: { [a.id]: weak, [b.id]: sure } }), POLICY, "quality");
  assert.ok(q.kind === "selected" && q.primary.id === b.id);
  assert.match(q.kind === "selected" ? q.reason : "", /most likely to finish \(97% on its own\)/);
  // Nothing clears the bar alone: the shortfall is measured on the route's own odds too.
  const short = selectRoute(task("Run the production migration"), fresh, snap([a], { estimates: { [a.id]: { ...rescued, attemptSuccess: 0.6, fallbackProbability: 0.4 } } }), POLICY, "balanced");
  assert.ok(short.kind === "selected" && short.shortfall === 0.3);
  // A tie is "within the threshold of the strongest", so it doesn't depend on the order routes come in:
  // 96% and 95.2% tie (the faster wins); 94.4% is close to 95.2% but not to the strongest, however fast it is.
  const three = { [c.id]: { attemptSuccess: 0.96, attemptUsd: 0.4, attemptSeconds: 90 }, [b.id]: { attemptSuccess: 0.952, attemptUsd: 0.1, attemptSeconds: 60 }, [a.id]: { attemptSuccess: 0.944, attemptUsd: 0.01, attemptSeconds: 30 } };
  for (const routes of [[a, b, c], [c, b, a], [b, a, c]]) {
    const d = selectRoute(p, fresh, snap(routes, { estimates: three }), POLICY, "quality");
    assert.ok(d.kind === "selected" && d.primary.id === b.id);
    assert.deepEqual(d.kind === "selected" && d.fallbacks.map((r) => r.id), [c.id, a.id]);
  }
});

test("what a run happens to read can't raise the stakes: only the request, or a failing check that names the risk", () => {
  const words = "Rename the helper in utils";
  const p = task(words);
  const noisy = task(words, { evidence: ["package-lock.json", "Author: someone", "deploys to production across several services", "DROP TABLE users; rm -rf /", "secrets and credentials"] });
  assert.deepEqual([noisy.scope, noisy.consequence, noisy.difficulty], [p.scope, p.consequence, p.difficulty]);
  assert.equal(materialChange(p, noisy), null);
  for (const w of ["Update package-lock.json", "Regenerate the lockfile", "Add the author's name to the header"]) assert.equal(task(w).consequence, "normal", w);
  for (const w of ["Fix the deadlock in the queue", "The lock is never released.", "Tighten the auth check", "Add OAuth login", "Fix authentication for guests"]) assert.equal(task(w).consequence, "high", w);
  // A failing check that names a correctness risk raises the stakes to high, and never further.
  const found = task(words, { evidence: ["FAIL: duplicate notification: worker retry sent 2 notifications for order 42", "FAIL: would drop table in production"] });
  assert.equal(found.consequence, "high");
  assert.ok(found.signals.includes("consequence:high (found while working)"));
  assert.equal(found.scope, p.scope);
  assert.match(materialChange(p, found) ?? "", /concurrency or correctness risk/);
});

test("what's learned is how far a route ran ahead of what was expected of it, within a limit: easy wins don't make it look good at hard tasks", () => {
  const r = claude("claude-haiku-5-5", "haiku");
  const hard = task("Fix the race condition between the api and the worker across services, end to end");
  const est = (p: TaskProfile, evidence?: CandidateSnapshot["evidence"]) => {
    const d = selectRoute(p, fresh, snap([r], evidence ? { evidence } : {}), POLICY, "balanced");
    return d.kind === "selected" ? d.estimates[0] : assert.fail("no route");
  };
  const prior = priorSuccess(r, hard);
  assert.ok(Math.abs(est(hard).attemptSuccess - prior) < 1e-3);
  // Thirty easy tasks in this family, every one checked and passing, when 28.5 were expected to: a
  // little ahead, so a little better than the prior on a hard task. Not the 30/30 record itself.
  const easyWins = { [r.id]: { [hard.family]: { n: 30, ok: 30, expected: 28.5 } } };
  const lifted = est(hard, easyWins);
  assert.equal(lifted.samples, 30);
  assert.ok(lifted.attemptSuccess > prior && lifted.attemptSuccess - prior < 0.06, `${prior} → ${lifted.attemptSuccess}`);
  // However lopsided the record, the estimate moves at most evidenceMaxShift from the prior.
  const dismal = est(hard, { [r.id]: { [hard.family]: { n: 500, ok: 0, expected: 450 } } }).attemptSuccess;
  assert.ok(Math.abs(dismal - Math.max(0.01, prior - POLICY.evidenceMaxShift)) < 1e-3, `${prior} → ${dismal}`);
  const stellar = est(hard, { [r.id]: { [hard.family]: { n: 500, ok: 500, expected: 50 } } }).attemptSuccess;
  assert.ok(Math.abs(stellar - Math.min(0.995, prior + POLICY.evidenceMaxShift)) < 1e-3, `${prior} → ${stellar}`);
});

test("RequestSizer matches a full requestTokens walk as messages grow", () => {
  const system = "You are the Quartermaster.";
  const tools = [{ name: "read_file", input_schema: { type: "object" } }];
  const messages: unknown[] = [{ role: "user", content: "Check the build." }];
  const sizer = new RequestSizer();
  sizer.setFixed(system, tools);
  sizer.setMessages(messages);
  assert.equal(sizer.tokens(), requestTokens({ system, tools, messages }));
  const reply = { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "1", name: "read_file", input: { path: "a.ts" } }] };
  messages.push(reply);
  sizer.addMessage(reply);
  assert.equal(sizer.tokens(), requestTokens({ system, tools, messages }));
  const result = { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "ok".repeat(200) }] };
  messages.push(result);
  sizer.addMessage(result);
  assert.equal(sizer.tokens(), requestTokens({ system, tools, messages }));
  // A longer system (route switch) refreshes the fixed part without re-walking messages.
  const longer = system + "\n## Models\nSonnet.";
  sizer.setFixed(longer, tools);
  assert.equal(sizer.tokens(), requestTokens({ system: longer, tools, messages }));
});

test("a route whose provider trims the conversation itself is sized by what it last counted, not by the whole transcript", () => {
  const sonnet = claude("claude-sonnet-5-5", "sonnet", "medium");
  const trims: Route = { ...sonnet, caps: { ...sonnet.caps, managesContext: true } };
  const plain = open("deepseek:deepseek-chat");
  // Nothing measured yet: the estimate of the whole transcript stands, for every route.
  const whole = selectRoute(task("Carry on with the refactor", { requestTokens: 190_000 }), fresh, snap([trims, plain]), POLICY, "balanced");
  assert.equal(whole.kind, "unavailable");
  // The provider counted 90k for it: the route that trims can take it; the one that doesn't still can't.
  const measured = selectRoute(task("Carry on with the refactor", { requestTokens: 190_000, managedTokens: 90_000 }), fresh, snap([trims, plain]), POLICY, "balanced");
  assert.ok(measured.kind === "selected" && measured.primary.id === trims.id);
  assert.match(measured.exclusions.find((e) => e.routeId === plain.id)?.reason ?? "", /~190k tokens/);
  // And a route that doesn't trim is never sized by someone else's count.
  const untrimmed = selectRoute(task("Carry on with the refactor", { requestTokens: 190_000, managedTokens: 90_000 }), fresh, snap([sonnet, plain]), POLICY, "balanced");
  assert.equal(untrimmed.kind, "unavailable");
});

test("hard requirements, one at a time: each rule names its own reason, in the order they're checked", () => {
  const p = task("Tidy the wording in the README");
  const sonnet = claude("claude-sonnet-5-5", "sonnet");
  assert.equal(exclusionOf(sonnet, p, snap([sonnet])), null);
  assert.equal(exclusionOf(sonnet, p, snap([sonnet], { workspace: { confidential: false, approvedProviders: [], exclude: ["claude-sonnet"] } })), "excluded by your model policy");
  const deep = open("deepseek:chat");
  assert.match(exclusionOf(deep, p, snap([deep], { workspace: { confidential: true, approvedProviders: [] } }))!, /confidential/);
  assert.equal(exclusionOf(deep, p, snap([deep], { workspace: { confidential: true, approvedProviders: ["deepseek"] } })), null);
  assert.equal(exclusionOf(sonnet, p, snap([sonnet], { credentials: {} })), "not connected");
  assert.equal(exclusionOf(deep, { ...p, needs: { ...p.needs, images: true } }, snap([deep])), "can't be shown images");
  assert.equal(exclusionOf(open("groq:x", { tools: false }), p, snap([])), "can't call tools");
  assert.equal(exclusionOf(deep, { ...p, needs: { ...p.needs, serverTools: true } }, snap([deep])), "doesn't have the web tools");
  assert.match(exclusionOf(deep, { ...p, needs: { ...p.needs, requestTokens: 125_000 } }, snap([deep]))!, /~125k tokens.*128k context/);
  // A cooldown on the route itself, or on its whole provider; one that's run out doesn't count.
  assert.equal(exclusionOf(sonnet, p, snap([sonnet], { health: { [sonnet.id]: { cooldownUntil: 1_030_000 } } })), "cooling down for 30s");
  assert.equal(exclusionOf(sonnet, p, snap([sonnet], { health: { "provider:anthropic": { cooldownUntil: 1_000_500 } } })), "cooling down for 1s");
  assert.equal(exclusionOf(sonnet, p, snap([sonnet], { health: { [sonnet.id]: { cooldownUntil: 999_000 } } })), null);
});

test("a route that manages its own context carries what the provider last counted, when it has counted", () => {
  const plain = claude("claude-sonnet-5-5", "sonnet");
  const managed: Route = { ...plain, caps: { ...plain.caps, managesContext: true } };
  assert.equal(carried(plain, { requestTokens: 180_000, managedTokens: 40_000 }), 180_000);
  assert.equal(carried(managed, { requestTokens: 180_000, managedTokens: 40_000 }), 40_000);
  assert.equal(carried(managed, { requestTokens: 180_000 }), 180_000);
});

test("names and small sums: labels, replay cost, and a free route replays for nothing", () => {
  assert.deepEqual((["economy", "balanced", "quality"] as const).map(autoLabel), ["Auto · Economy", "Auto · Balanced", "Auto · Quality"]);
  assert.equal(routeName(claude("claude-opus-5-5", "opus", "high")), "claude-opus-5-5 (high effort)");
  assert.equal(routeName(claude("claude-opus-5-5", "opus")), "claude-opus-5-5");
  assert.equal(replayUsd(claude("m", "sonnet"), 100_000), 0.3); // 100k tokens at $3 a million
  assert.equal(replayUsd({ ...open("groq:x"), free: true }, 100_000), 0);
  assert.equal(replayUsd(open("groq:x"), 1_000_000), POLICY.unknownRate.input); // an unknown price is priced at the policy's guess
  assert.equal(repeatedFailureEvidence(1, "boom"), "after one distinct patch reproduced the same failure (“boom”)");
});

test("a risk is read from a log only in plain words for it, not from look-alikes", () => {
  for (const line of ["WARNING: DATA RACE", "retried 3 times", "duplicate key value", "the order was double-charged"]) assert.ok(showsRisk(line), line);
  for (const line of ["ran 12 tests", "package-lock.json updated", "security.txt not found"]) assert.ok(!showsRisk(line), line);
});

test("a failure's signature ignores numbers, paths and timings, and a log with no failure has none", () => {
  const a = failureSignature("ok 1\nError: expected 3 to equal 5 at /home/a/src/x.ts:12\ndone in 40ms");
  const b = failureSignature("Error: expected 4 to equal 6 at /Users/b/src/x.ts:99\ndone in 900ms");
  assert.ok(a && b);
  assert.equal(a.signature, b.signature);
  assert.equal(a.excerpt, "Error: expected 3 to equal 5 at /home/a/src/x.ts:12");
  assert.equal(failureSignature("all 12 passed\nexit code 1"), null);
  assert.notEqual(failureSignature("Error: cannot find module")!.signature, a.signature);
});

test("a request is sized by its string values: an image or a document counts as one picture, key names count for nothing", () => {
  assert.deepEqual(measurePart({ role: "user", content: [{ type: "text", text: "abcd" }, { type: "image", source: { data: "x".repeat(9_999) } }] }), { chars: 4 + 4 + 4, images: 1 });
  assert.deepEqual(measurePart([{ type: "document" }, "hi", 42, null]), { chars: 2, images: 1 });
});

test("Claude wins a close call in every preference, and says so; a clear win elsewhere still goes elsewhere", () => {
  const p = task("Explain how the cache works");
  const haiku = claude("claude-haiku-5-5", "haiku", undefined, { input: 1, output: 5 });
  const luna = open("openai:gpt-6-luna", {}, { input: 0.1, output: 0.5 });
  const est = (claudeUsd: number, otherUsd: number, otherSuccess = 0.9) => ({
    [haiku.id]: { attemptSuccess: 0.9, attemptUsd: claudeUsd, attemptSeconds: 10, fallbackProbability: 0, recoverySuccess: 0 },
    [luna.id]: { attemptSuccess: otherSuccess, attemptUsd: otherUsd, attemptSeconds: 10, fallbackProbability: 0, recoverySuccess: 0 },
  });
  const pick = (mode: "economy" | "balanced" | "quality", e: ReturnType<typeof est>, policy = POLICY) => {
    const d = selectRoute(p, fresh, snap([haiku, luna], { estimates: e, credentials: { anthropic: true, openai: true } }), policy, mode);
    assert.equal(d.kind, "selected");
    return d.kind === "selected" ? { id: d.primary.id, reason: d.reason } : { id: "", reason: "" };
  };
  // Economy: up to a quarter dearer is a close call; ten times dearer isn't.
  const close = pick("economy", est(0.012, 0.01));
  assert.equal(close.id, haiku.id);
  assert.match(close.reason, /Claude is preferred on a close call/);
  assert.equal(pick("economy", est(0.1, 0.01)).id, luna.id);
  // Balanced: a few points of utility.
  assert.equal(pick("balanced", est(0.05, 0.01)).id, haiku.id, "$0.04 cheaper elsewhere is 0.024 of utility, under the lean");
  assert.equal(pick("balanced", est(0.2, 0.01)).id, luna.id);
  // Quality: among the tied strongest, Claude first; a clearly stronger route still wins.
  assert.equal(pick("quality", est(0.01, 0.01, 0.905)).id, haiku.id);
  assert.equal(pick("quality", est(0.01, 0.01, 0.95)).id, luna.id);
  // Turned off, the cheaper route wins the close call, and nothing is said about Claude.
  const off = pick("economy", est(0.012, 0.01), { ...POLICY, preferClaude: { economy: 0, balanced: 0, quality: false } });
  assert.equal(off.id, luna.id);
  assert.doesNotMatch(off.reason, /preferred/);
  assert.doesNotMatch(pick("economy", est(0.009, 0.01)).reason, /preferred/, "Claude winning outright isn't put down to the lean");
});
