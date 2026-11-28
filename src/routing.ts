// Auto model selection: which model (and how hard it thinks) handles a task, and when to change.
//
// Everything here is pure and deterministic: the same task profile, session state, candidate
// snapshot and policy always give the same decision. Health, prices, evidence and the clock come in
// as a snapshot (autoroute.ts builds it from the real registry), so a test can reproduce any
// decision. The agent loop (agent.ts) calls this right before each provider dispatch.
//
// A choice is what you picked: a model, or Auto with a preference. A route is what a choice
// resolves to: a provider, a model version and an effort level. Two efforts on one model are two
// routes, with their own cost, speed and odds of finishing the task.

import type { Effort } from "./settings.js";
import type { Rate } from "./costs.js";

// ---------- What you picked ----------
export type AutoPreference = "economy" | "balanced" | "quality";
export type ModelChoice = { kind: "manual"; model: string } | { kind: "auto"; preference: AutoPreference };
// Stored as a plain string wherever a model is stored, so old sessions load as they were:
// "auto" (Balanced), "auto:economy", "auto:balanced", "auto:quality"; anything else is a model.
const AUTO_RE = /^auto(?::(economy|balanced|quality))?$/;
export const isAutoChoice = (s: string | undefined | null): s is string => !!s && AUTO_RE.test(s);
export function parseChoice(s: string): ModelChoice {
  const m = s.match(AUTO_RE);
  return m ? { kind: "auto", preference: (m[1] as AutoPreference | undefined) ?? "balanced" } : { kind: "manual", model: s };
}
export const autoLabel = (p: AutoPreference) => `Auto · ${p[0].toUpperCase()}${p.slice(1)}`;

// ---------- Routes ----------
// tier: which row of the priors a route's estimates start from (see POLICY.priors).
export type Tier = "frontier" | "opus" | "sonnet" | "haiku" | "open-strong" | "open-fast" | "open-unknown";
export type Route = {
  id: string;            // "<model>@<effort|default>"
  model: string;         // a Claude model id, or "<provider>:<model>"
  provider: string;      // "anthropic", or the provider's id
  effort?: Effort;
  tier: Tier;
  // managesContext: the provider clears old tool results on its side once a prompt is long (Claude's
  // context management), so what such a route carries is what it last reported, not the whole transcript.
  caps: { images: boolean; tools: boolean; serverTools: boolean; contextTokens: number; maxOutput: number; managesContext?: boolean };
  price: Rate | null;    // per million tokens; null: not known (said so in every estimate that uses it)
  free?: boolean;
};
export const routeId = (model: string, effort?: Effort) => `${model}@${effort ?? "default"}`;

// ---------- The task ----------
// build: leading a new, many-part piece of work (a new app, a phased plan) that will take many crew
// runs. It is its own family so its turns, cost and observed record aren't mixed with one edit's.
export type TaskFamily = "search" | "explanation" | "editing" | "debugging" | "review" | "planning" | "summarization" | "chat" | "build";
export type Scope = "symbol" | "package" | "multi" | "unknown";
export type Consequence = "cosmetic" | "normal" | "high" | "critical";
export type TaskProfile = {
  family: TaskFamily;
  scope: Scope;
  consequence: Consequence;
  difficulty: number;    // 0–1
  // requestTokens: the whole transcript, estimated. managedTokens: what a route that manages its
  // context is really carrying, from the provider's own count of the last request (when there is one).
  needs: { images: boolean; tools: boolean; serverTools: boolean; structured: boolean; requestTokens: number; managedTokens?: number };
  followUp: boolean;     // a short "implement it", read against the accepted plan or the turn before
  signals: string[];     // which evidence set the profile (labels, never the prompt itself)
  parts?: number;        // a build: the phases, milestones or workstreams its plan names (each is more turns for the lead)
};

export type ProfileInput = {
  text: string;          // the current instruction
  context?: string;      // the accepted plan / preceding turns, if any
  role?: string;         // the crew member: a hint, not the answer
  hasImages?: boolean;
  tools?: boolean;       // the run offers client tools (function calling)
  serverTools?: boolean; // the task needs Claude's own web tools
  structured?: boolean;
  requestTokens: number; // the serialized request: system, tools, messages, attachments
  managedTokens?: number; // the same request as a context-managing route would carry it (measured, not estimated)
  evidence?: string[];   // what the run's failing checks have said since (their failure lines), in order
  repeatedFailures?: number; // distinct fixes that reproduced the same failure
};

const FAMILY_RULES: [TaskFamily, RegExp][] = [
  ["debugging", /\b(bug|fix|debug|error|fail(s|ed|ing)?|crash\w*|broke(n)?|regress\w*|stack ?trace|duplicate\w*|not working|flaky|incident|outage|root cause|post-?mortem)\b/i],
  ["review", /\b(review|audit|second opinion|look over)\b/i],
  ["summarization", /\b(summar\w+|tl;?dr|recap|changelog|release notes|digest)\b/i],
  ["planning", /\b(plan|design|architect\w*|approach|propos\w+|roadmap|strategy)\b/i],
  ["editing", /\b(implement|add|refactor|change|update|write|create|rename|migrate|remove|delete|build)\b/i],
  ["search", /\b(find|where is|where are|search|look up|grep|which files?|locate|list)\b/i],
  ["explanation", /\b(explain|what is|what are|how does|how do|why does|why do|walk me through|describe)\b/i],
];
const ROLE_FAMILY: Record<string, TaskFamily> = { scout: "search", scribe: "summarization", artificer: "editing", warden: "review", quartermaster: "planning", wizard: "debugging" };
const FOLLOW_UP = /^(ok(ay)?|yes|yep|sure|go( ahead)?|do it|implement it|build it|ship it|continue|proceed|carry on|sounds good|lgtm|please do|approved?)\b[\s\S]{0,40}$/i;
const CRITICAL = /\b(drop (table|database)|destructive|migrations?|rm -rf|force[- ]push|production|prod\b|permissions?|secrets?|credentials?|iam\b|chmod|delete all|data loss)\b/i;
// "lock" on its own, not package-lock.json or a lockfile; "auth", not "author".
const HIGH = /\b(race( condition)?|concurren\w*|deadlock|retr(y|ies)|idempoten\w*|duplicate\w*|(?<![-.])lock(s|ing)?(?![-.]?\w)|transactions?|security|o?auth(n|z|enticat\w*|ori[sz]\w*)?|payments?)\b/i;
// What a run finds while working can show a correctness risk the words didn't mention. It's read
// from narrower wording than the task is, because it's somebody else's text: a log, not the request.
const RISK_FOUND = /\b(race( condition)?|data race|concurren\w*|deadlock\w*|retr(y|ies|ied)|idempoten\w*|duplicate\w*|double[- ](send|sent|charge|charged|write|spend))\b/i;
export const showsRisk = (line: string) => RISK_FOUND.test(line);
const COSMETIC = /\b(typo|wording|comment|format(ting)?|css|colou?r|spacing|whitespace|indent\w*|copy ?edit)\b/i;
const MULTI = /\b(across|end[- ]to[- ]end|multiple|several|services|microservices|monorepo|worker and (the )?api|api and (the )?worker|everywhere|whole (repo|codebase))\b/i;
const PACKAGE = /\b(package|module|component|folder|directory|crate|library)\b/i;
const SYMBOL = /(`[\w.]+`|\b\w+\(\)|\b(function|method|class|variable|constant) \w+)/i;

const BASE_DIFFICULTY: Record<TaskFamily, number> = { chat: 0.1, search: 0.2, summarization: 0.25, explanation: 0.3, editing: 0.45, review: 0.5, planning: 0.5, debugging: 0.6, build: 0.6 };
const SCOPE_DIFFICULTY: Record<Scope, number> = { symbol: 0, package: 0.1, unknown: 0.1, multi: 0.2 };
const CONSEQUENCE_DIFFICULTY: Record<Consequence, number> = { cosmetic: -0.1, normal: 0, high: 0.15, critical: 0.25 };
const RANK: Record<Consequence, number> = { cosmetic: 0, normal: 1, high: 2, critical: 3 };

// ---------- Long requests ----------
// A short request is read whole, as it always was. A long one is usually a line or two of the
// user's own words with a document pasted under it (a plan, a spec, a log), and one word deep in
// two hundred lines ("error handling", "polish the colours") says little about what was asked. So
// a long request is read in two parts: the opening words decide when they say something, and the
// rest only counts when a word comes up more than once.
const LONG = 1_200;          // characters; every request in the routing evals is far below this
const ASK_MAX = 400;         // the most of a long request's first paragraph taken as the ask
const BODY_HITS = 2;         // how often a word must come up in the rest before it counts
const PLAN_MIN = 500;         // characters; a shorter text that names three or more phases or milestones is a plan too
// Phrases a spec uses that only look like a bug, a risk or a destructive change.
const BENIGN = /\b(error[- ](handling|handler|states?|messages?|boundar(y|ies)|codes?|toasts?|pages?|screens?)|fail[- ]?(safe|over|fast)|fixed[- ](timestep|time ?step|steps?|size|width|height|rate|point|position|camera|update)|production[- ](build|ready|grade|quality|bundle|mode)|for production|(microphone|mic|camera|notification|location|clipboard) permissions?)\b/gi;
const hits = (re: RegExp, text: string) => text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

// The user's own words: the first paragraph, up to the first pasted block, at most ASK_MAX characters.
// The harness's note that the user sent it directly isn't part of what they asked.
export function splitRequest(text: string): { ask: string; body: string } {
  const t = text.replace(/^\s*\(Sent directly by the user[^)]*\)\s*/, "");
  const end = t.search(/\n\s*\n|```|<pasted_content|\n-{3,}\s*\n/);
  const cut = Math.min(end < 0 ? t.length : end, ASK_MAX);
  return { ask: t.slice(0, cut), body: t.slice(cut) };
}

// What says a request is a new, many-part build rather than one change. Each is weak alone; a long
// request with a phased plan, words like "monorepo" or "from scratch", and a verb asking for it
// built is the shape of a job that runs for hours across many crew runs.
// A part is a named phase or milestone ("Phase 2", "M3"), or a lettered workstream heading ("B. Simulation core").
const PART = /\b([Pp]hase|[Mm]ilestone|[Ww]orkstream|[Ss]tage|[Ss]print|[Ee]pic)\s+(\d{1,2}|[A-Z])\b|\bM([1-9]\d?)\b|^[ \t]*(?:#{1,6}[ \t]*)?([A-Z])[.)][ \t]+[A-Z][a-z]/gm;
const GREENFIELD = /\b(new (app|application|project|repo|service|site|game|product)|from scratch|greenfield|mono-?repo|(pnpm|npm|yarn) workspaces?|(several|multiple|separate) packages|scaffold\w*|mvp|full[- ]stack|boilerplate)\b/gi;
const BUILD_ASK = /\b(build|create|make|develop|scaffold|implement|set up|bootstrap|ship|code up|start on)\b/i;
// Only planning when the user says so: "just plan it", "don't build yet".
const PLAN_ONLY = /\b(just|only)\s+(plan|design|outline|spec)\b|\b(don'?t|do not)\s+(build|implement|code|start)\b/i;
export function buildSignals(ask: string, all: string): { parts: number; greenfield: number; score: number } {
  const parts = new Set([...all.matchAll(PART)].map((m) => (m[3] ? `m${m[3]}` : m[4] ? `workstream ${m[4]}` : `${m[1].toLowerCase()} ${m[2]}`))).size;
  const greenfield = new Set((all.match(GREENFIELD) ?? []).map((w) => w.toLowerCase())).size;
  const score = (parts >= 3 ? 2 : parts >= 1 ? 1 : 0) + Math.min(2, greenfield) + (all.length >= 4_000 ? 1 : 0) + (BUILD_ASK.test(ask) ? 1 : 0);
  return { parts, greenfield, score };
}
// The lead of a build plans it and directs the crew; a crew member handed part of it is editing.
const LEADS = new Set(["quartermaster"]);

// A deterministic read of the task from what the harness can see. The role is only used when the
// words themselves say nothing; a short follow-up is read against the plan it accepts.
export function profileTask(i: ProfileInput): TaskProfile {
  const signals: string[] = [];
  const followUp = i.text.trim().length <= 80 && FOLLOW_UP.test(i.text.trim()) && !!i.context;
  if (followUp) signals.push("follow-up read against the accepted plan");
  const words = followUp ? `${i.text}\n${i.context}` : i.text;
  // A long follow-up's ask is the reply; the plan it accepts is the rest.
  // A compact plan (a few lines naming several phases or milestones) is read the same way.
  const long = words.length > LONG || (words.length > PLAN_MIN && buildSignals("", words).parts >= 3);
  const { ask, body } = !long ? { ask: words, body: "" } : followUp ? { ask: i.text, body: `\n${i.context}` } : splitRequest(words);
  if (long) signals.push("long request: read from its opening words");
  const inBody = (re: RegExp) => hits(re, body.replace(BENIGN, " ")) >= BODY_HITS;
  const said = (re: RegExp) => re.test(ask) || inBody(re);

  const askFamily = FAMILY_RULES.find(([, re]) => re.test(ask))?.[0];
  // The family of the rest: the one whose words come up most, if any come up more than once.
  const bodyFamily = () => {
    const clean = body.replace(BENIGN, " ");
    const counted = FAMILY_RULES.map(([f, re]) => [f, hits(re, clean)] as const).filter(([, n]) => n >= BODY_HITS);
    return counted.sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const size = long ? buildSignals(ask, words) : null;
  const isBuild = !!size && (!i.role || LEADS.has(i.role)) && (!askFamily || askFamily === "editing" || askFamily === "planning") &&
    size.score >= 3 && (size.parts >= 2 || size.greenfield >= 1) && !PLAN_ONLY.test(ask);
  let family: TaskFamily | undefined;
  if (isBuild) { family = "build"; signals.push(`family:build (${size!.parts} parts, ${size!.greenfield} new-project words)`); }
  else if (askFamily) { family = askFamily; signals.push(`family:${family} (words)`); }
  else if ((family = long ? bodyFamily() : undefined)) signals.push(`family:${family} (words repeated in the rest)`);
  else if (i.role && ROLE_FAMILY[i.role]) { family = ROLE_FAMILY[i.role]; signals.push(`family:${family} (role hint)`); }
  else family = "chat";
  // A follow-up that accepts a plan is the work the plan describes.
  if (followUp && family === "planning") { family = "editing"; signals.push("family:editing (carrying out a plan)"); }

  // Scope and what's at stake are read from the request (and the plan it accepts). What the run
  // turns up can raise the stakes to high, never to critical and never the scope: a file listing or
  // a README that happens to say "production" or "several" says nothing about this task.
  let scope: Scope = said(MULTI) ? "multi" : said(PACKAGE) ? "package" : SYMBOL.test(ask) ? "symbol" : "unknown";
  // A build of several parts spans more than one package whatever words it uses.
  if (isBuild && (scope === "unknown" || scope === "symbol")) scope = size!.parts >= 3 ? "multi" : "package";
  if (scope !== "unknown") signals.push(`scope:${scope}`);
  // Cosmetic is the user's own word for it, never one found in a pasted document.
  let consequence: Consequence = said(CRITICAL) ? "critical" : said(HIGH) ? "high" : COSMETIC.test(ask) && !isBuild ? "cosmetic" : "normal";
  // A mistake in a build's plan is carried into every run that follows it, so the lead is held to
  // the high-stakes bar.
  const lead = isBuild && RANK[consequence] < RANK.high;
  if (lead) consequence = "high";
  // A concurrency or correctness finding is never cosmetic, whatever the words said.
  const found = RANK[consequence] < RANK.high && (i.evidence ?? []).some(showsRisk);
  if (found) consequence = "high";
  if (consequence !== "normal") signals.push(`consequence:${consequence}${found ? " (found while working)" : lead ? " (leading a build)" : ""}`);

  const failures = i.repeatedFailures ?? 0;
  if (failures) signals.push(`progress:${failures} distinct fixes reproduced the same failure`);
  const difficulty = clamp(BASE_DIFFICULTY[family] + SCOPE_DIFFICULTY[scope] + CONSEQUENCE_DIFFICULTY[consequence] + 0.15 * failures, 0, 1);
  return {
    family, scope, consequence, difficulty: round(difficulty, 3), followUp, signals, ...(isBuild ? { parts: size!.parts } : {}),
    needs: { images: !!i.hasImages, tools: i.tools ?? true, serverTools: !!i.serverTools, structured: !!i.structured, requestTokens: Math.max(0, Math.round(i.requestTokens)),
      ...(i.managedTokens != null ? { managedTokens: Math.max(0, Math.round(i.managedTokens)) } : {}) },
  };
}

// Has new evidence changed the task enough to look again? (Scope wider, consequence higher, or
// noticeably harder.) Routine reads, edits and tests don't.
export function materialChange(before: TaskProfile, after: TaskProfile, policy: Policy = POLICY): string | null {
  if (RANK[after.consequence] > RANK[before.consequence]) return `the work turned out to involve a ${after.consequence === "critical" ? "destructive or high-stakes change" : "concurrency or correctness risk"}`;
  if (after.scope === "multi" && before.scope !== "multi") return "the change turned out to span more than one service";
  if (after.difficulty - before.difficulty >= policy.materialDifficultyDelta) return "the task turned out harder than it first looked";
  return null;
}

// ---------- Policy (versioned configuration) ----------
export type ModeWeights = { costWeight: number; timeWeight: number; switchMargin: number };
export type TierPrior = { cap: number; slope: number; tokensPerSecond: number; secondsPerTurn: number };
export type Policy = {
  version: string;
  modes: Record<AutoPreference, ModeWeights>; // utility = completion − costWeight×USD − timeWeight×seconds
  qualityFloor: Record<Consequence, number>;  // the odds of finishing a route must reach on its own, before any rescue
  tieThreshold: number;           // Quality: routes this close to the strongest are a tie
  materialDifficultyDelta: number;
  repeatFailureThreshold: number; // distinct fixes reproducing one failure before the route is reconsidered
  repeatFailureDecay: number;     // the incumbent's odds, multiplied once per distinct failed fix
  maxRetriesPerTask: number;      // passing failures retried across the whole task, whichever route
  retriesPerRoute: number;        // before a route is set aside and the next one is tried
  cooldownMs: number;             // how long a failing route is set aside when the provider gives no time
  deadlineMs: number;             // a task's default deadline for waiting on a provider
  maxFallbacks: number;
  unknownRate: Rate;              // assumed for a route whose price isn't known (and marked as assumed)
  // A lean towards Claude on a close call, in ranking only (the estimates shown are untouched).
  // economy: a Claude route may cost this share more and still count as the cheaper; balanced: this
  // much utility (about percentage points of finishing) is added to a Claude route; quality: among
  // the tied strongest, Claude goes first. 0 turns it off.
  preferClaude: { economy: number; balanced: number; quality: boolean };
  effortsByTier: Partial<Record<Tier, (Effort | undefined)[]>>;
  effort: Record<Effort, { success: number; cost: number; time: number }>;
  turns: Record<TaskFamily, number>;            // typical turns at difficulty 0 (doubles by difficulty 1)
  turnsPerPart: number;                         // a build's lead: more turns for each phase or milestone its plan names
  outputPerTurn: Record<TaskFamily, number>;    // tokens
  growthPerTurn: number;                        // tokens the transcript grows by each turn
  toolSecondsPerTurn: number;
  priors: Record<Tier, TierPrior>;
  evidenceWeight: number;         // how many observed tasks the prior counts as
  evidenceMaxShift: number;       // the most observed outcomes can move an estimate from its prior, either way
  unverifiedCredit: number;       // a run that ended "done" with no passing check: this much of the way from what was expected to a success
};

// Seeded from configuration priors, not measurements: each tier's estimated completion rate at
// difficulty 0 (cap) and how fast it falls as tasks get harder (slope). Observed outcomes
// (camp/routing-evidence.json) are blended in as they accumulate. Change the numbers, change the version.
export const POLICY: Policy = {
  version: "auto-2026-11-28.1",
  modes: {
    economy: { costWeight: 4, timeWeight: 0.0001, switchMargin: 0.03 },
    balanced: { costWeight: 0.6, timeWeight: 0.0004, switchMargin: 0.04 },
    quality: { costWeight: 0.05, timeWeight: 0.00005, switchMargin: 0.02 },
  },
  qualityFloor: { cosmetic: 0.6, normal: 0.75, high: 0.85, critical: 0.9 },
  tieThreshold: 0.01,
  materialDifficultyDelta: 0.15,
  repeatFailureThreshold: 2,
  repeatFailureDecay: 0.6,
  maxRetriesPerTask: 6,
  retriesPerRoute: 2,
  cooldownMs: 60_000,
  deadlineMs: 10 * 60_000,
  maxFallbacks: 2,
  unknownRate: { input: 3, output: 15 },
  preferClaude: { economy: 0.25, balanced: 0.03, quality: true },
  effortsByTier: { frontier: ["high"], opus: ["medium", "high"], sonnet: ["low", "medium", "high"], haiku: [undefined] },
  effort: {
    low: { success: -0.08, cost: 0.6, time: 0.6 },
    medium: { success: 0, cost: 1, time: 1 },
    high: { success: 0.05, cost: 1.5, time: 1.5 },
    xhigh: { success: 0.07, cost: 2, time: 2 },
    max: { success: 0.08, cost: 2.5, time: 2.5 },
  },
  // A build's lead plans the whole job, briefs each crew run and reads back what it did: dozens of
  // turns over hours, not the half-dozen of one edit.
  turns: { chat: 1, explanation: 2, summarization: 2, search: 4, planning: 3, review: 4, editing: 6, debugging: 8, build: 16 },
  turnsPerPart: 2,
  outputPerTurn: { chat: 400, explanation: 800, summarization: 700, search: 300, planning: 900, review: 700, editing: 900, debugging: 700, build: 1_000 },
  growthPerTurn: 2_500,
  toolSecondsPerTurn: 3,
  priors: {
    frontier: { cap: 0.97, slope: 0.12, tokensPerSecond: 45, secondsPerTurn: 4 },
    opus: { cap: 0.96, slope: 0.18, tokensPerSecond: 55, secondsPerTurn: 3 },
    sonnet: { cap: 0.95, slope: 0.3, tokensPerSecond: 80, secondsPerTurn: 2 },
    haiku: { cap: 0.93, slope: 0.55, tokensPerSecond: 150, secondsPerTurn: 1 },
    "open-strong": { cap: 0.9, slope: 0.4, tokensPerSecond: 60, secondsPerTurn: 3 },
    "open-fast": { cap: 0.88, slope: 0.6, tokensPerSecond: 120, secondsPerTurn: 1.5 },
    "open-unknown": { cap: 0.8, slope: 0.6, tokensPerSecond: 60, secondsPerTurn: 2 },
  },
  evidenceWeight: 8,
  evidenceMaxShift: 0.2,
  unverifiedCredit: 0.25,
};

// ---------- What's known about each route right now ----------
export type Health = { cooldownUntil?: number; reason?: string };
// route id → family → outcomes. n: tasks; ok: how many succeeded (a part for a run nobody checked);
// expected: how many the prior said would, at each task's own difficulty. A record from before
// `expected` was kept is read as if its tasks were as hard as the one being estimated.
export type Evidence = Record<string, Record<string, { n: number; ok: number; expected?: number }>>;
// Deterministic estimates supplied from outside (tests, an evaluation): any field given wins.
export type EstimateOverride = Partial<Pick<Estimate, "attemptSuccess" | "attemptUsd" | "attemptSeconds" | "fallbackProbability" | "recoveryUsd" | "recoverySeconds" | "recoverySuccess">>;
export type CandidateSnapshot = {
  routes: Route[];
  now: number;
  health: Record<string, Health>;             // by route id, or by provider ("provider:<id>")
  credentials: Record<string, boolean>;       // provider → usable
  workspace: { confidential: boolean; approvedProviders: string[]; exclude?: string[] };
  budgetLeftUsd?: number;
  evidence?: Evidence;
  estimates?: Record<string, EstimateOverride | ((profile: TaskProfile) => EstimateOverride)>;
};

export type Trigger = "new_task" | "resume" | "objective_change" | "scope_change" | "repeated_failure" | "capability_change" | "capacity" | "provider_unavailable";
export type SessionState = {
  trigger: Trigger;
  incumbent?: string;             // the route in use, if any
  historyTokens: number;          // what a new route would have to read again (no cache)
  repeatedFailures: number;       // distinct fixes that reproduced the same failure on the incumbent
  penalties?: Record<string, number>; // routes set aside earlier in this task for the same reason, and how many fixes failed on them
  evidence?: string;              // what set the trigger off, in a sentence
  deadlineAt?: number;
};

export type Estimate = {
  routeId: string;
  attemptSuccess: number;
  attemptUsd: number;
  attemptSeconds: number;
  fallbackProbability: number;
  recoveryUsd: number;
  recoverySeconds: number;
  recoverySuccess: number;
  completion: number;             // attemptSuccess + fallbackProbability × recoverySuccess: finishing at all, rescue included (weighed in utility; the floor uses attemptSuccess)
  expectedUsd: number;            // attemptUsd + fallbackProbability × recoveryUsd
  expectedSeconds: number;
  priceKnown: boolean;
  samples: number;                // observed tasks behind the estimate (route × family)
  utility: number;
};

export type Exclusion = { routeId: string; reason: string };
export type Decision =
  | { kind: "selected"; primary: Route; fallbacks: Route[]; trigger: Trigger; reason: string; policyVersion: string;
      estimates: Estimate[]; exclusions: Exclusion[]; shortfall?: number; kept?: boolean }
  | { kind: "unavailable"; reason: string; retryAfterMs?: number; trigger: Trigger; policyVersion: string; exclusions: Exclusion[] };

// ---------- Hard requirements ----------
const providerOf = (r: Route) => r.provider;
function coolingUntil(r: Route, s: CandidateSnapshot): number | undefined {
  const t = Math.max(s.health[r.id]?.cooldownUntil ?? 0, s.health[`provider:${providerOf(r)}`]?.cooldownUntil ?? 0);
  return t > s.now ? t : undefined;
}
// What a route would have to hold for the next request: the whole transcript, or, for a route
// whose provider clears old tool results itself, what the provider last counted plus what's new.
export const carried = (r: Pick<Route, "caps">, needs: Pick<TaskProfile["needs"], "requestTokens" | "managedTokens">) =>
  (r.caps.managesContext && needs.managedTokens != null ? needs.managedTokens : needs.requestTokens);
export function exclusionOf(r: Route, p: TaskProfile, s: CandidateSnapshot): string | null {
  if (s.workspace.exclude?.some((x) => r.model === x || r.model.startsWith(`${x}`))) return "excluded by your model policy";
  if (r.provider !== "anthropic" && s.workspace.confidential && !s.workspace.approvedProviders.includes(r.provider)) return "this project is confidential and the provider isn't approved for it";
  if (!s.credentials[r.provider]) return "not connected";
  if (p.needs.images && !r.caps.images) return "can't be shown images";
  if (p.needs.tools && !r.caps.tools) return "can't call tools";
  if (p.needs.serverTools && !r.caps.serverTools) return "doesn't have the web tools";
  const size = carried(r, p.needs);
  if (size + r.caps.maxOutput > r.caps.contextTokens) return `the request (~${Math.round(size / 1000)}k tokens) plus room to answer is more than its ${Math.round(r.caps.contextTokens / 1000)}k context`;
  const cool = coolingUntil(r, s);
  if (cool) return `cooling down for ${Math.ceil((cool - s.now) / 1000)}s`;
  return null;
}

// ---------- Estimates ----------
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

export function priorSuccess(r: Pick<Route, "tier" | "effort">, p: Pick<TaskProfile, "difficulty">, policy: Policy = POLICY): number {
  const t = policy.priors[r.tier];
  const e = r.effort ? policy.effort[r.effort].success : 0;
  return clamp(t.cap - t.slope * p.difficulty + e * p.difficulty, 0.01, 0.995);
}
// What's been observed moves the estimate by how far the route has run ahead of (or behind) what
// was expected of it on the tasks it was given, so a record of easy tasks doesn't flatten the
// difference between an easy task and a hard one. Sparse evidence leans on the route's broader
// record, which leans on the prior; and outcomes can only move an estimate so far.
function blended(r: Route, p: TaskProfile, s: CandidateSnapshot, policy: Policy): { p: number; samples: number } {
  const prior = priorSuccess(r, p, policy);
  const byFamily = s.evidence?.[r.id];
  if (!byFamily) return { p: prior, samples: 0 };
  const ahead = (x: { n: number; ok: number; expected?: number }) => x.ok - (x.expected ?? x.n * prior);
  const all = Object.values(byFamily).reduce((a, x) => ({ n: a.n + x.n, ahead: a.ahead + ahead(x) }), { n: 0, ahead: 0 });
  const k = policy.evidenceWeight;
  const broad = all.ahead / (all.n + k);
  const fam = byFamily[p.family];
  const shift = fam ? (ahead(fam) + k * broad) / (fam.n + k) : broad;
  return { p: clamp(prior + clamp(shift, -policy.evidenceMaxShift, policy.evidenceMaxShift), 0.01, 0.995), samples: fam?.n ?? 0 };
}
function rateFor(r: Route, policy: Policy): { rate: Rate; known: boolean } {
  if (r.free) return { rate: { input: 0, output: 0, cacheRead: 0 }, known: true };
  return r.price ? { rate: r.price, known: true } : { rate: policy.unknownRate, known: false };
}
// Past this many parts a plan is just more of the same to the lead, not more turns each.
const MAX_PARTS = 20;
// One attempt at the task on this route: turns × (new input at full price, the rest from cache, output).
function attempt(r: Route, p: TaskProfile, policy: Policy): { usd: number; seconds: number; known: boolean } {
  const { rate, known } = rateFor(r, policy);
  const eff = r.effort ? policy.effort[r.effort] : policy.effort.medium;
  const turns = Math.max(1, Math.round(policy.turns[p.family] * (1 + p.difficulty) + (policy.turnsPerPart ?? 0) * Math.min(MAX_PARTS, p.parts ?? 0)));
  const out = policy.outputPerTurn[p.family] * eff.cost;
  const cacheRead = rate.cacheRead ?? rate.input * 0.1;
  let usd = 0;
  for (let t = 0; t < turns; t++) {
    const cached = t === 0 ? 0 : p.needs.requestTokens + policy.growthPerTurn * (t - 1);
    const fresh = t === 0 ? p.needs.requestTokens : policy.growthPerTurn;
    usd += (fresh * rate.input * (t === 0 ? 1.25 : 1) + cached * cacheRead + out * rate.output) / 1_000_000;
  }
  const tier = policy.priors[r.tier];
  const seconds = turns * ((out / tier.tokensPerSecond) * eff.time + tier.secondsPerTurn + policy.toolSecondsPerTurn);
  return { usd, seconds, known };
}
// Reading the transcript so far again on another route: no cache to start from.
export function replayUsd(r: Route, tokens: number, policy: Policy = POLICY): number {
  return (tokens * rateFor(r, policy).rate.input) / 1_000_000;
}

// The expected cost of a task on one route, counting the chance it needs rescuing.
export const expectedTaskCost = (attemptUsd: number, fallbackProbability: number, recoveryUsd: number) => attemptUsd + fallbackProbability * recoveryUsd;

function utilityOf(e: Pick<Estimate, "completion" | "expectedUsd" | "expectedSeconds">, w: ModeWeights) {
  return e.completion - w.costWeight * e.expectedUsd - w.timeWeight * e.expectedSeconds;
}

// Every eligible route over the same unit of work: this task, including a rescue by the strongest
// other eligible route if this one fails, and the cost of replaying history to it.
export function estimateRoutes(eligible: Route[], p: TaskProfile, sess: SessionState, s: CandidateSnapshot, policy: Policy, mode: AutoPreference): Estimate[] {
  const base = new Map(eligible.map((r) => {
    const a = attempt(r, p, policy);
    const b = blended(r, p, s, policy);
    const o = s.estimates?.[r.id];
    const over = typeof o === "function" ? o(p) : o ?? {};
    let success = over.attemptSuccess ?? b.p;
    // Distinct fixes that keep reproducing one failure are evidence against the route they failed on,
    // whether it's the one in use or one this task already moved off.
    const failed = Math.max(sess.incumbent === r.id ? sess.repeatedFailures : 0, sess.penalties?.[r.id] ?? 0);
    if (failed >= policy.repeatFailureThreshold) success *= policy.repeatFailureDecay ** failed;
    return [r.id, { r, success, usd: over.attemptUsd ?? a.usd, seconds: over.attemptSeconds ?? a.seconds, known: a.known || over.attemptUsd != null, samples: b.samples, over }] as const;
  }));
  return eligible.map((r) => {
    const me = base.get(r.id)!;
    // The rescuer: the most likely other route to finish, stable by id.
    const others = [...base.values()].filter((x) => x.r.id !== r.id).sort((a, b) => b.success - a.success || a.r.id.localeCompare(b.r.id));
    const rescuer = others[0];
    const replay = rescuer ? replayUsd(rescuer.r, p.needs.requestTokens + policy.growthPerTurn * Math.max(1, policy.turns[p.family]) / 2, policy) : 0;
    const fallbackProbability = clamp(me.over.fallbackProbability ?? (rescuer ? 1 - me.success : 0), 0, 1);
    const recoveryUsd = me.over.recoveryUsd ?? (rescuer ? replay + rescuer.usd : 0);
    const recoverySeconds = me.over.recoverySeconds ?? (rescuer ? rescuer.seconds : 0);
    const recoverySuccess = me.over.recoverySuccess ?? (rescuer ? rescuer.success : 0);
    const completion = clamp(me.success + fallbackProbability * recoverySuccess, 0, 1);
    const est = {
      routeId: r.id,
      attemptSuccess: round(me.success),
      attemptUsd: round(me.usd),
      attemptSeconds: round(me.seconds, 3),
      fallbackProbability: round(fallbackProbability),
      recoveryUsd: round(recoveryUsd),
      recoverySeconds: round(recoverySeconds, 3),
      recoverySuccess: round(recoverySuccess),
      completion: round(Math.min(1, completion)),
      expectedUsd: round(expectedTaskCost(me.usd, fallbackProbability, recoveryUsd)),
      expectedSeconds: round(me.seconds + fallbackProbability * recoverySeconds, 3),
      priceKnown: me.known,
      samples: me.samples,
      utility: 0,
    };
    est.utility = round(utilityOf(est, policy.modes[mode]));
    return est;
  });
}

// ---------- Choosing ----------
// The quality floor is the route's own odds: a weak route doesn't clear it by standing next to a
// strong one that would rescue it (the rescue is counted in its cost, time and utility instead).
// claude: the ids of Claude's routes, which policy.preferClaude leans towards on a close call.
function order(mode: AutoPreference, ests: Estimate[], floor: number, policy: Policy, claude: Set<string> = new Set()): Estimate[] {
  const byId = (a: Estimate, b: Estimate) => a.routeId.localeCompare(b.routeId);
  const meets = (e: Estimate) => e.attemptSuccess >= floor;
  const lean = policy.preferClaude;
  const mine = (e: Estimate) => claude.has(e.routeId);
  if (mode === "economy") {
    // Known prices first: an unknown price can't be shown to be the cheapest.
    const usd = (e: Estimate) => (mine(e) ? e.expectedUsd / (1 + lean.economy) : e.expectedUsd);
    return [...ests].sort((a, b) => Number(meets(b)) - Number(meets(a)) || Number(b.priceKnown) - Number(a.priceKnown) ||
      usd(a) - usd(b) || b.completion - a.completion || a.expectedSeconds - b.expectedSeconds || byId(a, b));
  }
  if (mode === "quality") {
    // Strongest on its own first. Everything within the threshold of the strongest is one tie,
    // settled by time, then cost (a pairwise "close enough" isn't an ordering: a, b and c can each
    // be close to the next while a and c aren't).
    const top = Math.max(...ests.map((e) => e.attemptSuccess));
    const tied = (e: Estimate) => top - e.attemptSuccess <= policy.tieThreshold;
    return [...ests].sort((a, b) => Number(tied(b)) - Number(tied(a)) ||
      (tied(a) ? (lean.quality ? Number(mine(b)) - Number(mine(a)) : 0) : b.attemptSuccess - a.attemptSuccess) || a.expectedSeconds - b.expectedSeconds || a.expectedUsd - b.expectedUsd || byId(a, b));
  }
  const utility = (e: Estimate) => e.utility + (mine(e) ? lean.balanced : 0);
  return [...ests].sort((a, b) => Number(meets(b)) - Number(meets(a)) || utility(b) - utility(a) || byId(a, b));
}

const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUM[n] ?? String(n);
export const routeName = (r: Pick<Route, "model" | "effort">) => `${r.model}${r.effort ? ` (${r.effort} effort)` : ""}`;

function needsPhrase(p: TaskProfile): string {
  const parts = [p.needs.images && "this screenshot", p.needs.serverTools && "the web tools", p.needs.tools && (p.family === "editing" || p.family === "debugging" || p.family === "build" ? "the edit tools" : "tool calls")].filter(Boolean) as string[];
  return parts.length ? parts.join(" and ") : "this task";
}

function unavailableReason(p: TaskProfile, s: CandidateSnapshot, exclusions: Exclusion[]): { reason: string; retryAfterMs?: number } {
  if (!s.routes.length) return { reason: "No models are available: connect Anthropic or another provider under Settings → Models." };
  const capable = s.routes.filter((r) => {
    const why = exclusionOf(r, p, s);
    return !why || why.startsWith("cooling down");
  });
  const cooling = capable.filter((r) => coolingUntil(r, s));
  if (capable.length && cooling.length === capable.length) {
    const models = [...new Set(cooling.map((r) => r.model))];
    const n = models.length;
    const who = n === 1 ? "The only model" : n === 2 ? "Both models" : `All ${n} models`;
    const wait = Math.min(...cooling.map((r) => coolingUntil(r, s)! - s.now));
    return { reason: `${who} that support ${needsPhrase(p)} ${n === 1 ? "is" : "are"} cooling down. Try again in ${Math.ceil(wait / 1000)}s, or pick a model.`, retryAfterMs: wait };
  }
  const reasons = [...new Set(exclusions.map((e) => e.reason.replace(/ for \d+s$/, "")))];
  if (exclusions.every((e) => /context/.test(e.reason))) return { reason: `The request is larger than any available model's context. Start a new conversation or attach less.` };
  if (s.budgetLeftUsd != null && s.budgetLeftUsd <= 0) return { reason: "The budget for this run is spent." };
  return { reason: `No model can take ${needsPhrase(p)} right now (${reasons.join("; ")}).` };
}

export function selectRoute(profile: TaskProfile, session: SessionState, snapshot: CandidateSnapshot, policy: Policy = POLICY, mode: AutoPreference = "balanced"): Decision {
  const exclusions: Exclusion[] = [];
  const eligible: Route[] = [];
  for (const r of [...snapshot.routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const why = exclusionOf(r, profile, snapshot);
    if (why) exclusions.push({ routeId: r.id, reason: why }); else eligible.push(r);
  }
  const base = { trigger: session.trigger, policyVersion: policy.version, exclusions };
  if (!eligible.length) return { kind: "unavailable", ...unavailableReason(profile, snapshot, exclusions), ...base };

  let ests = estimateRoutes(eligible, profile, session, snapshot, policy, mode);
  // The budget is a hard limit: a route whose expected cost is more than what's left is out.
  if (snapshot.budgetLeftUsd != null) {
    const over = ests.filter((e) => e.attemptUsd > snapshot.budgetLeftUsd!);
    if (over.length === ests.length) {
      for (const e of over) exclusions.push({ routeId: e.routeId, reason: "expected to cost more than the budget left" });
      return { kind: "unavailable", reason: `Every model that can do this is expected to cost more than the $${snapshot.budgetLeftUsd.toFixed(2)} left in the budget.`, ...base };
    }
    for (const e of over) exclusions.push({ routeId: e.routeId, reason: "expected to cost more than the budget left" });
    ests = ests.filter((e) => !over.includes(e));
  }
  const floor = policy.qualityFloor[profile.consequence];
  const claude = new Set(eligible.filter((r) => r.provider === "anthropic").map((r) => r.id));
  const ranked = order(mode, ests, floor, policy, claude);
  // Whether the lean towards Claude decided it: without it, another provider's route would be first.
  const leaned = claude.has(ranked[0]?.routeId) && !claude.has(order(mode, ests, floor, policy)[0]?.routeId) ? ranked[0].routeId : undefined;
  const route = (id: string) => eligible.find((r) => r.id === id)!;
  let best = ranked[0];
  let shortfall: number | undefined;
  if (!ests.some((e) => e.attemptSuccess >= floor)) {
    // Nothing reaches the floor: take the strongest, and say by how much it falls short.
    best = [...ests].sort((a, b) => b.attemptSuccess - a.attemptSuccess || a.routeId.localeCompare(b.routeId))[0];
    shortfall = round(floor - best.attemptSuccess, 4);
  }
  const w = policy.modes[mode];

  // A healthy incumbent is kept unless the challenger beats it by the margin, after paying to
  // replay the conversation so far.
  const inc = session.incumbent ? ests.find((e) => e.routeId === session.incumbent) : undefined;
  if (inc && best.routeId === inc.routeId && session.trigger !== "new_task") {
    return { kind: "selected", primary: route(inc.routeId), fallbacks: fallbacksOf(ranked, inc.routeId, policy).map((e) => route(e.routeId)), reason: keepReason(session, inc, true), estimates: ests, ...base, kept: true, ...(shortfall != null ? { shortfall } : {}) };
  }
  if (inc && best.routeId !== inc.routeId && session.trigger !== "new_task") {
    const replay = replayUsd(route(best.routeId), session.historyTokens, policy);
    const gain = best.utility - w.costWeight * replay - inc.utility;
    const incMeets = inc.attemptSuccess >= floor;
    if (gain < w.switchMargin && (incMeets || !(best.attemptSuccess > inc.attemptSuccess))) {
      return { kind: "selected", primary: route(inc.routeId), fallbacks: fallbacksOf(ranked, inc.routeId, policy).map((e) => route(e.routeId)), reason: keepReason(session, inc), estimates: ests, ...base, kept: true, ...(shortfall != null ? { shortfall } : {}) };
    }
  }
  const primary = route(best.routeId);
  return { kind: "selected", primary, fallbacks: fallbacksOf(ranked, best.routeId, policy).map((e) => route(e.routeId)),
    reason: chooseReason(mode, profile, session, best, ests, primary, inc, shortfall, leaned === best.routeId), estimates: ests, ...base, ...(shortfall != null ? { shortfall } : {}) };
}

const fallbacksOf = (ranked: Estimate[], primary: string, policy: Policy) => ranked.filter((e) => e.routeId !== primary).slice(0, policy.maxFallbacks);

function keepReason(sess: SessionState, inc: Estimate, best = false): string {
  const why = best ? `it's still the best fit (${pct(inc.completion)} expected to finish)` : `no other model was enough better to be worth replaying the conversation (${pct(inc.completion)} expected to finish)`;
  return `Stayed on the current model: ${sess.evidence ? `${sess.evidence}, but ` : ""}${why}.`;
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

function chooseReason(mode: AutoPreference, p: TaskProfile, sess: SessionState, best: Estimate, ests: Estimate[], primary: Route, inc: Estimate | undefined, shortfall?: number, leaned = false): string {
  if (sess.incumbent && inc && sess.evidence) return `Switched: ${sess.evidence}.`;
  if (sess.incumbent && !inc && sess.evidence) return `Switched: ${sess.evidence}.`;
  const what = `${p.family}${p.consequence === "normal" ? "" : `, ${p.consequence === "high" ? "high-stakes" : p.consequence}`}${p.scope === "unknown" ? "" : `, ${p.scope === "multi" ? "multi-service" : p.scope} scope`}`;
  const sole = ests.length === 1 ? "the only model that can take this task" : "";
  const why = sole || (mode === "economy" ? `cheapest expected total (${money(best.expectedUsd)}${best.priceKnown ? "" : ", price assumed"}) that meets the quality bar`
    : mode === "quality" ? `most likely to finish (${pct(best.attemptSuccess)} on its own)`
    : `best balance of odds (${pct(best.completion)}), cost (${money(best.expectedUsd)}${best.priceKnown ? "" : ", price assumed"}) and time`);
  const short = shortfall != null ? `; no model reaches the ${pct(best.attemptSuccess + shortfall)} bar for this task, so the strongest was taken` : "";
  const lean = leaned ? "; another provider's model came out about even, and Claude is preferred on a close call" : "";
  return `${routeName(primary)} for a ${what} task: ${why}${short}${lean}.`;
}

// ---------- Counting attempts ----------
// A failure is the same failure if its error lines are the same once numbers, paths and timings
// are taken out. An attempt is a distinct set of changes between two runs of the check: running
// the same failing command twice with nothing changed in between is one attempt, and the same
// error repeated in one log is one failure.
const FAILURE_LINE = /(error|fail|assert|expected|exception|traceback|panic|not ok|✗|✖|duplicate)/i;
export const failureLines = (output: string): string[] => output.split("\n").map((l) => l.trim()).filter((l) => FAILURE_LINE.test(l) && !/^exit code \d+/i.test(l));
export function failureSignature(output: string): { signature: string; excerpt: string } | null {
  const lines = failureLines(output);
  if (!lines.length) return null;
  const norm = [...new Set(lines.map((l) => l.replace(/0x[0-9a-f]+/gi, "#").replace(/\d+(\.\d+)?(ms|s)?/g, "#").replace(/(\/[\w.-]+)+/g, "<path>").replace(/\s+/g, " ").toLowerCase()))].sort();
  return { signature: norm.slice(0, 6).join(" | "), excerpt: lines[0].slice(0, 120) };
}

export class AttemptTracker {
  private changes: string[] = [];
  private seen = new Map<string, { excerpt: string; fixes: string[] }>();
  // A change to the code (a write, an edit, a command that isn't the check itself).
  noteChange(key: string) { this.changes.push(key); }
  // The result of a check (a command that came back failing). Returns how many distinct fixes have
  // now reproduced this failure.
  noteFailure(output: string): { distinct: number; excerpt: string } | null {
    const sig = failureSignature(output);
    if (!sig) return null;
    const changeSet = [...new Set(this.changes)].sort().join("\n");
    this.changes = [];
    const rec = this.seen.get(sig.signature);
    if (!rec) { this.seen.set(sig.signature, { excerpt: sig.excerpt, fixes: [] }); return { distinct: 0, excerpt: sig.excerpt }; }
    if (changeSet && !rec.fixes.includes(changeSet)) rec.fixes.push(changeSet);
    return { distinct: rec.fixes.length, excerpt: rec.excerpt };
  }
  noteSuccess() { this.changes = []; }
  reset() { this.seen.clear(); this.changes = []; }
}
export const repeatedFailureEvidence = (n: number, excerpt: string) => `after ${count(n)} distinct ${n === 1 ? "patch" : "patches"} reproduced the same failure (“${excerpt}”)`;

// ---------- Rough size of a request ----------
// About four characters a token; an image is counted at what the API charges for a large one.
const IMAGE_TOKENS = 1_600;
// String values only (not JSON key names): matches how messages were counted before.
export function measurePart(v: unknown): { chars: number; images: number } {
  let chars = 0, images = 0;
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o.type === "image" || o.type === "document") { images++; return; }
      for (const k of Object.keys(o)) walk(o[k]);
      return;
    }
    if (typeof x === "string") chars += x.length;
  };
  walk(v);
  return { chars, images };
}
export function requestTokens(parts: { system: string; tools: unknown[]; messages: unknown[] }): number {
  let chars = parts.system.length + JSON.stringify(parts.tools).length;
  let images = 0;
  for (const m of parts.messages) {
    const p = measurePart(m);
    chars += p.chars;
    images += p.images;
  }
  return Math.ceil(chars / 4) + images * IMAGE_TOKENS;
}

// Running size: system+tools refreshed when they change; each new message counted once.
// decide/check/observe share one estimate instead of re-walking the whole transcript.
export class RequestSizer {
  private systemChars = 0;
  private toolsChars = 0;
  private toolsKey = "";
  private msgChars = 0;
  private images = 0;

  setFixed(system: string, tools: unknown[]) {
    this.systemChars = system.length;
    const key = JSON.stringify(tools);
    if (key !== this.toolsKey) {
      this.toolsKey = key;
      this.toolsChars = key.length;
    }
  }
  setMessages(messages: unknown[]) {
    this.msgChars = 0;
    this.images = 0;
    for (const m of messages) this.addMessage(m);
  }
  addMessage(msg: unknown) {
    const { chars, images } = measurePart(msg);
    this.msgChars += chars;
    this.images += images;
  }
  tokens() {
    return Math.ceil((this.systemChars + this.toolsChars + this.msgChars) / 4) + this.images * IMAGE_TOKENS;
  }
}
