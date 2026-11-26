// Scores Auto's model choices against the labelled set in routing-cases.ts. Nothing is sent to a
// model: the decision is src/routing.ts, which is pure, over a fixed list of Claude routes at
// today's prices. So this costs nothing and gives the same answer every time.
//
//   npm run eval:routing              the table, the misses and the cost against the biggest model
//   npm run eval:routing -- --check   the same, and exit 1 if it is below evals/routing-floor.json
//   npm run eval:routing -- --json    the score as JSON
//
// The cost figures are the policy's own estimates of each task (turns, tokens, the odds of needing
// a rescue), not measured spend: they say what the choices are expected to cost, relative to
// sending every task to the biggest model.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rateOf } from "../src/costs.ts";
import { POLICY, profileTask, routeId, selectRoute, type CandidateSnapshot, type Policy, type Route, type SessionState, type Tier } from "../src/routing.ts";
import { ROUTING_CASES, SIZE_TOKENS, type RoutingCase, type RoutingKind, type Stakes } from "./routing-cases.ts";

// The models a camp on Claude alone offers, newest of each tier.
const MODELS: [string, Tier][] = [["claude-fable-5-2", "frontier"], ["claude-opus-5-5", "opus"], ["claude-sonnet-5-5", "sonnet"], ["claude-haiku-5-5", "haiku"]];
export const BIGGEST = routeId("claude-fable-5-2", "high");
const RANK: Partial<Record<Tier, number>> = { haiku: 0, sonnet: 1, opus: 2, frontier: 3 };

export function evalRoutes(policy: Policy = POLICY): Route[] {
  return MODELS.flatMap(([model, tier]) => (policy.effortsByTier[tier] ?? [undefined]).map((effort): Route => ({
    id: routeId(model, effort), model, provider: "anthropic", effort, tier, price: rateOf(model) ?? null,
    caps: { images: true, tools: true, serverTools: true, contextTokens: 200_000, maxOutput: 32_000, managesContext: true },
  })));
}

export type RoutingRow = {
  id: string; kind: RoutingKind; stakes: Stakes; mode: string;
  picked: string | null;   // the route id, or null when nothing could take it
  tier: Tier | null;
  expect: Tier[];
  verdict: "ok" | "under" | "over" | "unavailable";
  usd: number;             // what the pick is expected to cost
  biggestUsd: number;      // what the biggest model is expected to cost for the same task
  family: string; consequence: string; difficulty: number; // how Auto read the task
  why: string;
};
type Tally = { total: number; correct: number; accuracy: number };
export type RoutingScore = {
  policyVersion: string;
  total: number; correct: number; accuracy: number;
  under: number; over: number; unavailable: number;
  riskyUnder: number;      // under-routed where a mistake is costly (high or critical stakes)
  byKind: Record<string, Tally>;
  byStakes: Record<string, Tally>;
  byMode: Record<string, Tally>;
  usd: number; biggestUsd: number; savedUsd: number; savedPct: number;
  rows: RoutingRow[];
};

const tally = (rows: RoutingRow[], key: (r: RoutingRow) => string): Record<string, Tally> => {
  const out: Record<string, Tally> = {};
  for (const r of rows) {
    const t = (out[key(r)] ??= { total: 0, correct: 0, accuracy: 0 });
    t.total++;
    if (r.verdict === "ok") t.correct++;
  }
  for (const t of Object.values(out)) t.accuracy = t.correct / t.total;
  return out;
};

export function decide(c: RoutingCase, policy: Policy = POLICY, routes: Route[] = evalRoutes(policy)) {
  const profile = profileTask({ text: c.text, context: c.context, role: c.role, hasImages: c.images, serverTools: c.web, evidence: c.evidence,
    requestTokens: SIZE_TOKENS[c.size ?? "small"], repeatedFailures: c.session?.repeatedFailures });
  const session: SessionState = { trigger: "new_task", historyTokens: 0, repeatedFailures: 0, ...c.session };
  const snapshot: CandidateSnapshot = { routes, now: 1_000_000, health: {}, credentials: { anthropic: true },
    workspace: { confidential: false, approvedProviders: [] }, ...(c.budgetLeftUsd != null ? { budgetLeftUsd: c.budgetLeftUsd } : {}) };
  // What the biggest model would cost is read from a decision with no budget, so a tight budget
  // (which removes it from the candidates) doesn't hide the comparison.
  const open = selectRoute(profile, session, { ...snapshot, budgetLeftUsd: undefined }, policy, c.mode ?? "balanced");
  return { profile, decision: selectRoute(profile, session, snapshot, policy, c.mode ?? "balanced"), open };
}

export function scoreRouting(cases: RoutingCase[] = ROUTING_CASES, policy: Policy = POLICY): RoutingScore {
  const routes = evalRoutes(policy);
  const rows = cases.map((c): RoutingRow => {
    const { profile, decision, open } = decide(c, policy, routes);
    const base = { id: c.id, kind: c.kind, stakes: c.stakes, mode: c.mode ?? "balanced", expect: c.expect, why: c.why,
      family: profile.family, consequence: profile.consequence, difficulty: profile.difficulty };
    const biggestUsd = open.kind === "selected" ? open.estimates.find((e) => e.routeId === BIGGEST)?.expectedUsd ?? 0 : 0;
    if (decision.kind !== "selected") return { ...base, picked: null, tier: null, verdict: "unavailable", usd: 0, biggestUsd };
    const tier = decision.primary.tier;
    const rank = RANK[tier] ?? 0;
    const ranks = c.expect.map((t) => RANK[t] ?? 0);
    const verdict = c.expect.includes(tier) ? "ok" : rank < Math.min(...ranks) ? "under" : "over";
    const usd = decision.estimates.find((e) => e.routeId === decision.primary.id)?.expectedUsd ?? 0;
    return { ...base, picked: decision.primary.id, tier, verdict, usd, biggestUsd };
  });
  const correct = rows.filter((r) => r.verdict === "ok").length;
  // Spend is compared over the tasks something could take.
  const priced = rows.filter((r) => r.verdict !== "unavailable");
  const usd = priced.reduce((s, r) => s + r.usd, 0);
  const biggestUsd = priced.reduce((s, r) => s + r.biggestUsd, 0);
  return {
    policyVersion: policy.version,
    total: rows.length, correct, accuracy: rows.length ? correct / rows.length : 0,
    under: rows.filter((r) => r.verdict === "under").length,
    over: rows.filter((r) => r.verdict === "over").length,
    unavailable: rows.filter((r) => r.verdict === "unavailable").length,
    riskyUnder: rows.filter((r) => r.verdict === "under" && (r.stakes === "high" || r.stakes === "critical")).length,
    byKind: tally(rows, (r) => r.kind), byStakes: tally(rows, (r) => r.stakes), byMode: tally(rows, (r) => r.mode),
    usd, biggestUsd, savedUsd: biggestUsd - usd, savedPct: biggestUsd ? (biggestUsd - usd) / biggestUsd : 0,
    rows,
  };
}

// ---------- The committed floor ----------
// evals/routing-floor.json: the least this set may score. `npm test` fails below it, so a routing
// change that makes choices worse is caught; a change that makes them better should raise it.
export type RoutingFloor = {
  accuracy: number;                    // overall, 0–1
  byKind: Record<string, number>;      // each kind of work, 0–1
  maxUnder: number;                    // picks weaker than any sensible choice
  maxRiskyUnder: number;               // of those, on high or critical stakes
  savedPct: number;                    // expected spend saved against always the biggest model, 0–1
  accepted: string[];                  // the misses known when the floor was set: a new one is listed first
};
export const FLOOR_PATH = fileURLToPath(new URL("./routing-floor.json", import.meta.url));
export const readFloor = (path = FLOOR_PATH): RoutingFloor => JSON.parse(readFileSync(path, "utf8"));

export function belowFloor(s: RoutingScore, f: RoutingFloor): string[] {
  const out: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fresh = s.rows.filter((r) => r.verdict !== "ok" && !f.accepted.includes(r.id));
  const missLine = (r: RoutingRow) => `${r.id}: picked ${r.picked ?? "nothing"} (${r.verdict}), expected ${r.expect.join(" or ")}`;
  if (s.accuracy < f.accuracy) out.push(`accuracy ${pct(s.accuracy)} is below the floor of ${pct(f.accuracy)}${fresh.length ? `; new misses: ${fresh.map(missLine).join("; ")}` : ""}`);
  for (const [kind, min] of Object.entries(f.byKind)) {
    const t = s.byKind[kind];
    if (!t) out.push(`no ${kind} cases left in the set (the floor names them)`);
    else if (t.accuracy < min) out.push(`${kind}: ${pct(t.accuracy)} is below its floor of ${pct(min)}`);
  }
  if (s.under > f.maxUnder) out.push(`${s.under} picks are weaker than any sensible choice (at most ${f.maxUnder}): ${s.rows.filter((r) => r.verdict === "under").map((r) => r.id).join(", ")}`);
  if (s.riskyUnder > f.maxRiskyUnder) out.push(`${s.riskyUnder} high-stakes tasks went to too weak a model (at most ${f.maxRiskyUnder})`);
  if (s.savedPct < f.savedPct) out.push(`expected saving against always the biggest model is ${pct(s.savedPct)}, below the floor of ${pct(f.savedPct)}`);
  return out;
}

// ---------- The report ----------
export function formatScore(s: RoutingScore): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const line = (name: string, t: Tally) => `  ${name.padEnd(12)} ${String(t.correct).padStart(3)}/${String(t.total).padEnd(3)} ${pct(t.accuracy).padStart(6)}`;
  const out = [
    `Auto routing against ${s.total} labelled tasks (policy ${s.policyVersion})`,
    ``,
    `Accuracy: ${s.correct}/${s.total} (${pct(s.accuracy)}).  Too weak: ${s.under} (${s.riskyUnder} on high stakes).  Stronger than needed: ${s.over}.${s.unavailable ? `  Nothing could take it: ${s.unavailable}.` : ""}`,
    ``,
    `By kind of work`, ...Object.entries(s.byKind).map(([k, t]) => line(k, t)),
    ``,
    `By what a mistake costs`, ...Object.entries(s.byStakes).map(([k, t]) => line(k, t)),
    ``,
    `By preference`, ...Object.entries(s.byMode).map(([k, t]) => line(k, t)),
    ``,
    `Expected spend (the policy's estimates, not measured): Auto $${s.usd.toFixed(2)}, always ${BIGGEST} $${s.biggestUsd.toFixed(2)}: ${pct(s.savedPct)} less.`,
  ];
  const misses = s.rows.filter((r) => r.verdict !== "ok");
  if (misses.length) {
    out.push(``, `Misses`);
    for (const r of misses) {
      out.push(`  ${r.verdict === "under" ? "too weak  " : r.verdict === "over" ? "too strong" : "no route  "} ${r.id}: picked ${r.picked ?? "nothing"}, expected ${r.expect.join(" or ")}`,
        `             read as ${r.family}, ${r.consequence} stakes, difficulty ${r.difficulty}. ${r.why}`);
    }
  }
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const score = scoreRouting();
  if (args.includes("--json")) console.log(JSON.stringify(score, null, 2));
  else console.log(formatScore(score));
  if (args.includes("--check")) {
    const problems = belowFloor(score, readFloor());
    if (problems.length) { console.error(`\nBelow the committed floor (evals/routing-floor.json):\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`); process.exit(1); }
    if (!args.includes("--json")) console.log(`\nAt or above the committed floor.`);
  }
}
