// The real-world side of Auto (routing.ts holds the decisions): which routes this camp can run,
// from the model registry and what's connected; their prices, credentials and cooldowns; what's
// been observed of each; the routing log; and the comparison of Auto with fixed models.
//
// The routing log (camp/routing.jsonl) holds decisions and outcomes: task, trigger, candidates,
// exclusions, the route chosen, the policy version, estimates, usage, latency, switches and how it
// ended. Never a prompt, never a key. It keeps its newest ROUTING_MAX records.

import { statSync } from "node:fs";
import { appendLine, readJsonFile, readJsonl, writeAtomic, writeJsonAtomic } from "./atomic.js";
import { rateOf } from "./costs.js";
import { anthropicKey, openaiTools, providersState } from "./providers.js";
import { autoExcluded, campRuntime, type Effort } from "./settings.js";
import { pausedUntil } from "./limits.js";
import { verifies } from "./oplog.js";
import { AttemptTracker, carried, failureLines, materialChange, priorSuccess, profileTask, repeatedFailureEvidence, selectRoute, showsRisk, type AutoPreference, type ProfileInput } from "./routing.js";
import { POLICY, routeId, type CandidateSnapshot, type Decision, type Estimate, type EstimateOverride, type Evidence, type Health, type Policy, type Route, type TaskFamily, type TaskProfile, type Tier, type Trigger } from "./routing.js";
import type { ModelInfo } from "./agent.js";

export const ROUTING_LOG = "camp/routing.jsonl";
export const EVIDENCE_PATH = "camp/routing-evidence.json";
const MAX_OUTPUT = 32_000; // what the agent loop asks a Claude model for (agent.ts MAX_TOKENS)

// ---------- Routes from the registry ----------
// The tier a model you picked yourself would have as a route (null: not one Auto knows how to place).
export function tierOf(model: string): Tier | null {
  const colon = model.indexOf(":");
  return colon < 0 ? claudeTier(model) : openTier(model.slice(colon + 1));
}
function claudeTier(id: string): Tier | null {
  if (/^claude-(fable|mythos)-/.test(id)) return "frontier";
  if (/^claude-opus-/.test(id)) return "opus";
  if (/^claude-sonnet-/.test(id)) return "sonnet";
  if (/^claude-haiku-/.test(id)) return "haiku";
  return null;
}
function openTier(id: string): Tier {
  if (/^gpt-\d+(\.\d+)?-luna/.test(id)) return "open-fast"; // OpenAI's: Luna is its small one, Terra its middle
  if (/^gpt-\d+(\.\d+)?-terra/.test(id)) return "open-unknown";
  if (/^(gpt-([5-9]|\d{2})|o[3-9])/.test(id) && !/mini|nano/.test(id)) return "open-strong"; // its larger reasoning models
  if (/deepseek-v\d+-pro|deepseek-reasoner|gemini-[\d.]+-pro|qwen.*(235b|max)|llama.*(405b|maverick)/i.test(id)) return "open-strong";
  if (/flash|fast|mini|instant|lite|8b|scout|nano/i.test(id)) return "open-fast";
  return "open-unknown";
}
// What each provider's models can take, as far as is known. Anything unknown is assumed missing.
export const PROVIDER_CAPS: Record<string, { images: (id: string) => boolean; context: number; maxOutput: number; tools?: (id: string) => boolean }> = {
  deepseek: { images: () => false, context: 128_000, maxOutput: 8_192 },
  gemini: { images: () => true, context: 1_000_000, maxOutput: 8_192 },
  groq: { images: (id) => /vision|vl\b|scout|maverick/i.test(id), context: 128_000, maxOutput: 8_192 },
  // OpenAI: the 4o models write at most 16k; o1-mini and o3-mini can't be shown images; GPT-6.1 Terra can't call tools here.
  openai: { images: (id) => !/^o[13]-mini/.test(id), context: 128_000, maxOutput: 16_384, tools: (id) => openaiTools(id) !== "no" },
  openrouter: { images: (id) => /vision|vl\b|gpt-4o|gemini|claude/i.test(id), context: 32_000, maxOutput: 8_192 },
};

// Every model you can pick, at each effort Auto considers for it.
export function routesFrom(models: ModelInfo[], policy: Policy = POLICY): Route[] {
  const out: Route[] = [];
  for (const m of models) {
    if (!m.provider) {
      const tier = claudeTier(m.id);
      if (!tier) continue;
      const efforts = (policy.effortsByTier[tier] ?? [undefined]).filter((e) => !e || m.efforts.includes(e));
      for (const effort of efforts.length ? efforts : [undefined]) {
        out.push({ id: routeId(m.id, effort), model: m.id, provider: "anthropic", effort: effort as Effort | undefined, tier,
          caps: { images: true, tools: true, serverTools: true, contextTokens: 200_000, maxOutput: MAX_OUTPUT, managesContext: true }, price: rateOf(m.id) ?? null });
      }
      continue;
    }
    const provider = m.id.slice(0, m.id.indexOf(":"));
    const caps = PROVIDER_CAPS[provider] ?? { images: () => false, context: 32_000, maxOutput: 8_192 };
    const bare = m.id.slice(provider.length + 1);
    out.push({ id: routeId(m.id), model: m.id, provider, tier: openTier(bare), free: !!m.free,
      caps: { images: caps.images(bare), tools: caps.tools?.(bare) ?? true, serverTools: false, contextTokens: caps.context, maxOutput: caps.maxOutput }, price: rateOf(m.id) ?? null });
  }
  return out;
}

// ---------- Health ----------
// Process-wide, so a route that's cooling down is skipped by every task until it's ready.
const health = new Map<string, Health>();
export function coolDown(key: string, ms: number, reason: string, now = clock()) {
  const until = now + Math.max(0, ms);
  const was = health.get(key)?.cooldownUntil ?? 0;
  health.set(key, { cooldownUntil: Math.max(was, until), reason });
}
function healthNow(): Record<string, Health> {
  const out: Record<string, Health> = Object.fromEntries(health);
  // On your subscription the plan's limit is the provider's cooldown.
  if (campRuntime() === "claude-code") {
    const until = pausedUntil(clock());
    if (until) out["provider:anthropic"] = { cooldownUntil: until, reason: "your plan's limit" };
  }
  return out;
}

// ---------- Evidence ----------
// An outcome is graded before it counts. A run that ended "done" is a success only if the last
// check it ran (tests, a build, a linter) passed and nothing was changed after; with no check it's
// worth a little more than what was expected of the route anyway; with its last check failing, or
// out of turns, it's a failure. Stopped, over budget, refused, cut off and errored runs say nothing
// about the route's ability, and aren't counted.
export type Grade = "verified" | "unverified" | "failed";
export function gradeOf(status: string, checked: boolean | null): Grade | null {
  if (status === "done") return checked === true ? "verified" : checked === false ? "failed" : "unverified";
  return status === "out_of_turns" ? "failed" : null;
}
const storedEvidence = (): Evidence => {
  const e = readJsonFile(EVIDENCE_PATH, {});
  return e && typeof e === "object" && !Array.isArray(e) ? (e as Evidence) : {};
};
const graded = (x: { expected?: number } | undefined): x is { n: number; ok: number; expected: number } => typeof x?.expected === "number";
// Records from before outcomes were graded (any "done" counted as a success, on a task of any
// difficulty) can't be compared with what was expected of the route, so they aren't used.
export function loadEvidence(): Evidence {
  return Object.fromEntries(Object.entries(storedEvidence()).map(([route, families]) =>
    [route, Object.fromEntries(Object.entries(families ?? {}).filter(([, x]) => graded(x)))]));
}
// difficulty: the task's, as profiled when the route was chosen, so the outcome is weighed against
// what was expected of this route on a task that hard.
export function noteOutcome(route: Pick<Route, "id" | "tier" | "effort">, family: TaskFamily, difficulty: number, grade: Grade) {
  const policy = routingPolicy();
  const expected = priorSuccess(route, { difficulty }, policy);
  const e = storedEvidence();
  const families = (e[route.id] ??= {});
  const was = families[family];
  const slot = graded(was) ? was : { n: 0, ok: 0, expected: 0 };
  const worth = grade === "verified" ? 1 : grade === "failed" ? 0 : expected + policy.unverifiedCredit * (1 - expected);
  families[family] = { n: slot.n + 1, ok: Math.round((slot.ok + worth) * 1e4) / 1e4, expected: Math.round((slot.expected + expected) * 1e4) / 1e4 };
  writeJsonAtomic(EVIDENCE_PATH, e);
}

// ---------- Test hooks ----------
// Tests supply the clock, the estimates, and (if they like) the policy, so a decision can be reproduced.
let testHooks: { now?: () => number; estimates?: CandidateSnapshot["estimates"]; policy?: Policy; deadlineMs?: number } = {};
export function setRoutingForTests(h: typeof testHooks | null) { testHooks = h ?? {}; if (!h) health.clear(); }
export const clock = () => testHooks.now?.() ?? Date.now();
export const routingPolicy = (): Policy => testHooks.policy ?? POLICY;
export const taskDeadlineMs = () => testHooks.deadlineMs ?? routingPolicy().deadlineMs;
export const resetHealthForTests = () => health.clear();

// ---------- The snapshot ----------
export function snapshot(models: ModelInfo[], o: { confidential: boolean; budgetLeftUsd?: number }): CandidateSnapshot {
  const credentials: Record<string, boolean> = { anthropic: campRuntime() === "claude-code" || !!anthropicKey() };
  let approved: string[] = [];
  try {
    for (const p of providersState()) { credentials[p.id] = p.connected; if (p.approved) approved.push(p.id); }
  } catch { approved = []; }
  return {
    routes: routesFrom(models, routingPolicy()),
    now: clock(),
    health: healthNow(),
    credentials,
    workspace: { confidential: o.confidential, approvedProviders: approved, exclude: autoExcluded() },
    ...(o.budgetLeftUsd != null ? { budgetLeftUsd: o.budgetLeftUsd } : {}),
    evidence: loadEvidence(),
    ...(testHooks.estimates ? { estimates: testHooks.estimates } : {}),
  };
}

// ---------- The log ----------
export type RouteStep = { at: number; route: string; model: string; effort?: Effort; trigger: Trigger; reason: string; evidence?: string };
export type DecisionRecord = {
  kind: "decision"; at: string; task: string; run: string; agent: string; mode: string; trigger: Trigger; policyVersion: string;
  candidates: string[]; exclusions: { routeId: string; reason: string }[]; selected?: string; fallbacks?: string[]; kept?: boolean;
  estimates?: Pick<Estimate, "routeId" | "attemptSuccess" | "completion" | "expectedUsd" | "expectedSeconds" | "priceKnown" | "samples">[];
  shortfall?: number; unavailable?: string; profile: Pick<TaskProfile, "family" | "scope" | "consequence" | "difficulty" | "signals">;
};
export type OutcomeRecord = {
  kind: "outcome"; at: string; task: string; run: string; agent: string; mode: string; // mode: "auto:<pref>" or "manual"
  status: string; ok: boolean; grade?: Grade; seconds: number; usd: number; switches: number; family?: TaskFamily;
  routes: { route: string; usd: number; input: number; output: number; turns: number }[];
  source?: "observed" | "fixture";
};
export function logDecision(d: Decision, ctx: { task: string; run: string; agent: string; mode: string; profile: TaskProfile; candidates: string[] }) {
  const rec: DecisionRecord = {
    kind: "decision", at: new Date(clock()).toISOString(), task: ctx.task, run: ctx.run, agent: ctx.agent, mode: ctx.mode, trigger: d.trigger, policyVersion: d.policyVersion,
    candidates: ctx.candidates, exclusions: d.exclusions,
    profile: { family: ctx.profile.family, scope: ctx.profile.scope, consequence: ctx.profile.consequence, difficulty: ctx.profile.difficulty, signals: ctx.profile.signals },
    ...(d.kind === "selected"
      ? { selected: d.primary.id, fallbacks: d.fallbacks.map((r) => r.id), ...(d.kept ? { kept: true } : {}), ...(d.shortfall != null ? { shortfall: d.shortfall } : {}),
          estimates: d.estimates.map((e) => ({ routeId: e.routeId, attemptSuccess: e.attemptSuccess, completion: e.completion, expectedUsd: e.expectedUsd, expectedSeconds: e.expectedSeconds, priceKnown: e.priceKnown, samples: e.samples })) }
      : { unavailable: d.reason }),
  };
  record(rec);
}
export function logOutcome(rec: Omit<OutcomeRecord, "kind" | "at">) {
  record({ kind: "outcome", at: new Date(clock()).toISOString(), ...rec });
}

// Both readers go through the whole log (the comparison adds up every outcome; a task picked up
// again wants its last decision, however far back), so what's kept is generous: a run writes two
// to four records, which makes this a thousand runs and more.
export const ROUTING_MAX = 5000;  // records kept: the oldest make way
const ROUTING_SLACK = 500;        // how far past that the file may grow before it's cut back (so it isn't rewritten on every run)

// Parsed once and kept until the file changes: it's read as every Auto-routed run begins, and it
// only changes when a run is written down. (The folder is in the stamp: each test file has its own camp.)
type Logged = DecisionRecord | OutcomeRecord;
let logCache: { stamp: string; size: number; list: Logged[] } | null = null;
function loadLog(): NonNullable<typeof logCache> {
  const st = statSync(ROUTING_LOG, { throwIfNoEntry: false });
  const stamp = `${process.cwd()}|${st ? `${st.mtimeMs}:${st.size}` : "none"}`;
  if (logCache?.stamp === stamp) return logCache;
  const list = st ? readJsonl<Logged>(ROUTING_LOG).filter((r) => r && typeof r === "object") : [];
  return (logCache = { stamp, size: st?.size ?? 0, list });
}
function record(rec: Logged) {
  try {
    const have = loadLog(); // as the file is now: another camp process may have written to it since
    const line = JSON.stringify(rec);
    if (have.list.length + 1 > ROUTING_MAX + ROUTING_SLACK) {
      writeAtomic(ROUTING_LOG, [...have.list, rec].slice(-ROUTING_MAX).map((r) => JSON.stringify(r)).join("\n") + "\n");
      logCache = null;
      return;
    }
    appendLine(ROUTING_LOG, line);
    // What's kept stays good only if the file grew by exactly this line. Otherwise (someone else
    // wrote in between, or a torn last line was closed off first) it's read again next time.
    const st = statSync(ROUTING_LOG);
    if (st.size !== have.size + Buffer.byteLength(line) + 1) { logCache = null; return; }
    have.list.push(rec);
    logCache = { stamp: `${process.cwd()}|${st.mtimeMs}:${st.size}`, size: st.size, list: have.list };
  } catch { logCache = null; /* the log is a record, never a reason to fail a run */ }
}
// Every record kept, oldest first (the caller's own list). Empty if there's no log, or it can't be read.
export function routingLog(): Logged[] {
  try { return [...loadLog().list]; } catch { return []; }
}
// The route a task was last on (so a resumed task carries on where it was, unless there's reason to change).
export function lastRouteOf(task: string, agent: string): string | undefined {
  let list: Logged[] = [];
  try { list = loadLog().list; } catch { /* no log to go by: a fresh start */ }
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r.kind === "decision" && r.task === task && r.agent === agent && r.selected) return r.selected;
  }
  return undefined;
}

// ---------- Auto against fixed models ----------
// Matched tasks (same task id) run under Auto and under a fixed model. Spend per success counts
// every attempt, failed ones and rescues included. Observed runs and scripted fixtures are kept apart.
export type ArmReport = { arm: string; source: "observed" | "fixture"; tasks: number; completed: number; completionRate: number; usdPerSuccess: number | null; medianSeconds: number | null };
export function routingReport(records: (DecisionRecord | OutcomeRecord)[] = routingLog()): { arms: ArmReport[]; matchedTasks: number } {
  const outcomes = records.filter((r): r is OutcomeRecord => r.kind === "outcome");
  const arms = new Map<string, OutcomeRecord[]>();
  const armOf = (o: OutcomeRecord) => (o.mode.startsWith("auto") ? o.mode : `manual:${o.routes[0]?.route ?? "?"}`);
  for (const o of outcomes) {
    const k = `${armOf(o)}|${o.source ?? "observed"}`;
    arms.set(k, [...(arms.get(k) ?? []), o]);
  }
  const byTask = new Map<string, Set<string>>();
  for (const o of outcomes) byTask.set(o.task, (byTask.get(o.task) ?? new Set()).add(armOf(o).startsWith("auto") ? "auto" : "fixed"));
  const matched = [...byTask.values()].filter((s) => s.size === 2).length;
  const report = [...arms.entries()].map(([k, list]): ArmReport => {
    const [arm, source] = k.split("|") as [string, "observed" | "fixture"];
    const done = list.filter((o) => o.ok);
    const spend = list.reduce((s, o) => s + o.usd, 0);
    const secs = done.map((o) => o.seconds).sort((a, b) => a - b);
    return { arm, source, tasks: list.length, completed: done.length, completionRate: done.length / list.length,
      usdPerSuccess: done.length ? spend / done.length : null, medianSeconds: secs.length ? secs[Math.floor((secs.length - 1) / 2)] : null };
  }).sort((a, b) => a.arm.localeCompare(b.arm) || a.source.localeCompare(b.source));
  return { arms: report, matchedTasks: matched };
}

export type { EstimateOverride };

// ---------- One task's routing ----------
// Each running agent has its own, so concurrent tasks in one conversation route independently.

const MUTATING = /(\bsed\s+-i|\bgit\s+(apply|commit|checkout\s+--|restore|am)\b|\bpatch\b|\bmv\b|\bcp\b|\brm\b|>\s*[\w./]|\btee\b|\bnpm\s+(i|install)\b|\bperl\s+-pi)/;
const CHANGE_TOOLS = new Set(["write_file", "edit_file"]);

export type RouteUse = { route: string; model: string; usd: number; input: number; output: number; turns: number };
type Call = { name: string; input: any; output: string; failed: boolean };
const bashFailed = (c: Call) => c.failed || /^Exit code [1-9]/.test(c.output);

// Did the run put its work to the test? The answer is the last check it ran (true: passed, false:
// failed), and null if it never ran one or changed something after the last one.
export class Verification {
  state: boolean | null = null;
  note(calls: Call[]) {
    for (const c of calls) {
      if (CHANGE_TOOLS.has(c.name)) { if (!c.failed) this.state = null; continue; }
      if (c.name !== "bash") continue;
      const command = String(c.input?.command ?? "");
      if (verifies(command)) this.state = !bashFailed(c);
      else if (!bashFailed(c) && MUTATING.test(command)) this.state = null;
    }
  }
}
const RISK_LINES = 5; // the failure lines kept as evidence of a risk: the first few, for the whole task

export class TaskRouter {
  readonly mode: AutoPreference;
  route: Route | null = null;
  fallbacks: Route[] = [];
  steps: RouteStep[] = [];
  profile: TaskProfile;
  private initial: TaskProfile;
  private attempts = new AttemptTracker();
  private evidence: string[] = [];
  private repeated = 0;
  private triggeredAt = 0;  // the repeated-failure count that last set off a switch
  private penalties: Record<string, number> = {}; // routes left after distinct fixes kept failing on them
  private hardest = 0;      // the most distinct failed fixes seen on any route: the task stays that hard
  private pending: { trigger: Trigger; evidence: string } | null = null;
  retriesUsed = 0;          // across the whole task, whichever route
  routeAttempts = 0;        // passing failures in a row on the current route
  // The deadline is for waiting, not for working: it runs from when replies stopped arriving, and
  // is over when one arrives. A task an hour in has the same patience for an outage as a new one.
  private waitingSince: number | null = null;
  private checks = new Verification();
  private chosen = new Map<string, { route: Route; difficulty: number }>(); // each route this task was on, and how hard the task looked when it was last chosen
  // What a provider that manages its context counted for the last request, next to our estimate of
  // that same request: the estimate counts the whole transcript, the provider only what it kept.
  private sent = 0;
  private counted: { tokens: number; estimate: number } | null = null;
  readonly started = clock();
  readonly use = new Map<string, RouteUse>();

  constructor(private o: { mode: AutoPreference; task: string; run: string; agent: string; models: ModelInfo[]; confidential: boolean;
    budgetLeft: () => number | undefined; profile: Omit<ProfileInput, "requestTokens" | "evidence" | "repeatedFailures">; requestTokens: number }) {
    this.mode = o.mode;
    this.profile = this.initial = profileTask({ ...o.profile, requestTokens: o.requestTokens });
  }

  get deadlineAt() { return (this.waitingSince ?? clock()) + taskDeadlineMs(); }
  // How much longer this task will wait for a route to come back (the wait starts now, if it hasn't).
  waitLeft(): number {
    this.waitingSince ??= clock();
    return this.waitingSince + taskDeadlineMs() - clock();
  }
  // The request as a context-managing route would carry it: what the provider last counted, plus
  // whatever has been added since. Unknown until such a route has answered once.
  private managed(requestTokens: number): number | undefined {
    return this.counted ? this.counted.tokens + Math.max(0, requestTokens - this.counted.estimate) : undefined;
  }

  private reprofile(requestTokens: number) {
    const n = Math.max(this.repeated, this.hardest);
    this.profile = profileTask({ ...this.o.profile, requestTokens, managedTokens: this.managed(requestTokens), evidence: this.evidence, repeatedFailures: n >= routingPolicy().repeatFailureThreshold ? n : 0 });
  }

  // Choose (or keep) a route. historyTokens: what a new route would have to read again.
  decide(trigger: Trigger, requestTokens: number, historyTokens: number, evidence?: string, incumbent = this.route?.id): Decision {
    this.sent = requestTokens;
    this.reprofile(requestTokens);
    const snap = snapshot(this.o.models, { confidential: this.o.confidential, budgetLeftUsd: this.o.budgetLeft() });
    const d = selectRoute(this.profile, { trigger, incumbent, historyTokens, repeatedFailures: incumbent === this.route?.id ? this.repeated : 0, penalties: this.penalties, evidence, deadlineAt: this.deadlineAt }, snap, routingPolicy(), this.mode);
    logDecision(d, { task: this.o.task, run: this.o.run, agent: this.o.agent, mode: autoMode(this.mode), profile: this.profile, candidates: snap.routes.map((r) => r.id) });
    if (d.kind === "selected") {
      this.chosen.set(d.primary.id, { route: d.primary, difficulty: this.profile.difficulty });
      const changed = d.primary.id !== this.route?.id;
      this.fallbacks = d.fallbacks;
      if (changed || !this.steps.length) {
        // The failures counted so far were the old route's: they stay with it, and the new route
        // starts its own count.
        if (changed && this.route && this.repeated) {
          this.penalties[this.route.id] = Math.max(this.penalties[this.route.id] ?? 0, this.repeated);
          this.hardest = Math.max(this.hardest, this.repeated);
          this.repeated = 0;
          this.triggeredAt = 0;
          this.attempts.reset();
        }
        this.route = d.primary;
        this.routeAttempts = 0;
        this.steps.push({ at: clock(), route: d.primary.id, model: d.primary.model, ...(d.primary.effort ? { effort: d.primary.effort } : {}), trigger, reason: d.reason, ...(evidence ? { evidence } : {}) });
      }
    }
    return d;
  }

  // Is the current route still fit to take the next request? (Cheap: no estimates.)
  check(requestTokens: number): { trigger: Trigger; evidence: string } | null {
    this.sent = requestTokens;
    if (this.pending) { const p = this.pending; this.pending = null; return p; }
    const r = this.route;
    if (!r) return null;
    const size = carried(r, { requestTokens, managedTokens: this.managed(requestTokens) });
    if (size + r.caps.maxOutput > r.caps.contextTokens) return { trigger: "capacity", evidence: `the conversation (~${Math.round(size / 1000)}k tokens) outgrew ${r.model}'s ${Math.round(r.caps.contextTokens / 1000)}k context` };
    const h = healthNow();
    const until = Math.max(h[r.id]?.cooldownUntil ?? 0, h[`provider:${r.provider}`]?.cooldownUntil ?? 0);
    if (until > clock()) return { trigger: "provider_unavailable", evidence: `${r.model} is cooling down` };
    return null;
  }

  // What this turn's tool calls turned up: progress, a reproduced failure, or a bigger task.
  observe(calls: Call[], requestTokens: number) {
    this.checks.note(calls);
    for (const c of calls) {
      if (CHANGE_TOOLS.has(c.name) && !c.failed) { this.attempts.noteChange(`${c.name}:${canonicalish(c.input)}`); continue; }
      if (c.name !== "bash") continue;
      const command = String(c.input?.command ?? "");
      if (!bashFailed(c)) { if (MUTATING.test(command)) this.attempts.noteChange(`bash:${command}`); else this.attempts.noteSuccess(); continue; }
      // The only thing a run's output can say about the stakes: a failing check whose own failure
      // lines name a concurrency or correctness risk. Not what a file, a listing or a web page says.
      if (verifies(command)) for (const line of failureLines(c.output)) {
        const kept = line.slice(0, 300);
        if (this.evidence.length < RISK_LINES && showsRisk(kept) && !this.evidence.includes(kept)) this.evidence.push(kept);
      }
      const f = this.attempts.noteFailure(c.output);
      if (f && f.distinct > this.repeated) {
        this.repeated = f.distinct;
        if (f.distinct >= routingPolicy().repeatFailureThreshold && f.distinct > this.triggeredAt) this.pending = { trigger: "repeated_failure", evidence: repeatedFailureEvidence(f.distinct, f.excerpt) };
      }
    }
    if (this.pending) return;
    const before = this.profile;
    this.reprofile(requestTokens);
    const why = materialChange(before, this.profile, routingPolicy()) ?? null;
    if (why) this.pending = { trigger: "scope_change", evidence: why };
  }

  // A passing failure on the current route. Returns what to do: wait and ask the same route again,
  // or set it aside and try the next one.
  failed(retryAfterMs: number | undefined, waits: number[]): { do: "wait"; ms: number } | { do: "switch"; evidence: string } | { do: "give_up"; why: string } {
    const policy = routingPolicy();
    this.retriesUsed++;
    this.routeAttempts++;
    if (this.retriesUsed > policy.maxRetriesPerTask) return { do: "give_up", why: `gave up after ${policy.maxRetriesPerTask} retries across ${this.steps.length} model${this.steps.length === 1 ? "" : "s"}` };
    const left = this.waitLeft();
    const r = this.route!;
    if (this.routeAttempts > policy.retriesPerRoute || (retryAfterMs != null && retryAfterMs > left) || (retryAfterMs != null && retryAfterMs > policy.cooldownMs)) {
      coolDown(r.id, retryAfterMs ?? policy.cooldownMs, "unavailable");
      return { do: "switch", evidence: `${r.model} was unavailable${retryAfterMs != null ? ` (asked to wait ${Math.ceil(retryAfterMs / 1000)}s)` : ` after ${this.routeAttempts} tries`}` };
    }
    const ms = retryAfterMs ?? waits[Math.min(this.routeAttempts - 1, waits.length - 1)] ?? 0;
    return ms > left ? { do: "give_up", why: "the provider asked for a wait longer than the task's deadline" } : { do: "wait", ms };
  }

  account(route: Route, usd: number, input: number, output: number) {
    const u = this.use.get(route.id) ?? { route: route.id, model: route.model, usd: 0, input: 0, output: 0, turns: 0 };
    u.usd += usd; u.input += input; u.output += output; u.turns++;
    this.use.set(route.id, u);
    // A reply arrived: whatever outage there was is over, and the route's failures were passing ones.
    this.waitingSince = null;
    this.routeAttempts = 0;
    if (route.caps.managesContext && input > 0) this.counted = { tokens: input, estimate: this.sent };
  }

  // The task ended: log it, and credit (or debit) the routes that worked on it.
  finish(status: string, totalUsd: number) {
    const ok = status === "done";
    const grade = gradeOf(status, this.checks.state);
    logOutcome({ task: this.o.task, run: this.o.run, agent: this.o.agent, mode: autoMode(this.mode), status, ok, ...(grade ? { grade } : {}), seconds: Math.round((clock() - this.started) / 1000),
      usd: totalUsd, switches: Math.max(0, this.steps.length - 1), family: this.initial.family, routes: [...this.use.values()].map(({ model: _m, ...u }) => u) });
    try {
      const note = (id: string, g: Grade) => { const c = this.chosen.get(id); if (c && this.use.has(id)) noteOutcome(c.route, this.initial.family, c.difficulty, g); };
      const final = this.route?.id;
      // A route left because distinct fixes kept failing on it failed the task, however it ended.
      const left = new Set(this.steps.flatMap((s, i) => (i > 0 && s.trigger === "repeated_failure" ? [this.steps[i - 1].route] : [])));
      for (const id of left) if (id !== final) note(id, "failed");
      if (final && grade) note(final, grade);
    } catch { /* evidence is a refinement, never a reason to fail */ }
  }
}
export const autoMode = (p: AutoPreference) => `auto:${p}`;
const canonicalish = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
