// Auto in practice: a summary of the routing log (camp/routing.jsonl, written by autoroute.ts).
// How often each model was picked, what followed each pick (it held, the run failed, the work
// was retried on another model, or it was moved up to a stronger one), and what the same work
// would have cost if every run had gone to the biggest model.
//
// Pure: it takes the records and returns numbers, so tests run it on made-up records and it never
// reads the camp itself. scripts/routing-report.ts is the command that reads the file.

import { rateOf, type Rate } from "./costs.js";
import type { DecisionRecord, OutcomeRecord } from "./autoroute.js";

type Logged = DecisionRecord | OutcomeRecord;

// What followed a pick.
//   held:       the run finished on it, and nothing says the work was bad
//   failure:    the run ended on it without finishing, or finished with its last check failing
//   retry:      the provider couldn't serve it (unavailable, or the conversation outgrew it), so the work moved to another model
//   escalation: the work turned out harder (the same failure kept coming back, or the scope grew), so it moved to another model
//   moved:      it moved for another reason (the objective or what the task needs changed)
//   stopped:    you stopped the run, or its budget did
//   unfinished: the log has no ending for the run (still running, or the record was cut off)
export type Followed = "held" | "failure" | "retry" | "escalation" | "moved" | "stopped" | "unfinished";
const FOLLOWED: Followed[] = ["held", "failure", "retry", "escalation", "moved", "stopped", "unfinished"];

export type ModelPicks = { model: string; picks: number; share: number; usd: number } & Record<Followed, number>;
export type RoutingSummary = {
  from: string | null; to: string | null;   // the first and last record's time
  runs: number;                // runs with anything in the log
  autoRuns: number;            // of those, routed by Auto
  manualRuns: number;          // on a model you chose
  decisions: number;           // every time Auto looked
  kept: number;                // looked again mid-run and stayed where it was
  unavailable: number;         // looked and found nothing that could take the task
  picks: number;               // a model chosen: each run's first choice, and each change after it
  models: ModelPicks[];        // most picked first
  followed: Record<Followed, number>;       // over every pick
  rates: { failure: number; retry: number; escalation: number }; // share of picks whose ending is known
  byTrigger: Record<string, number>;        // why Auto looked
  byMode: Record<string, number>;           // Auto runs by preference
  spend: {
    autoUsd: number;           // what Auto runs cost, as logged
    pricedRuns: number;        // Auto runs the comparison covers
    unpricedRuns: number;      // left out: no ending yet, or a model whose price isn't listed
    usd: number;               // what the covered runs cost
    biggestUsd: number;        // the same tokens at the biggest model's prices (an estimate)
    savedUsd: number; savedPct: number;
  };
};

const modelOf = (route: string) => route.slice(0, route.lastIndexOf("@") < 0 ? undefined : route.lastIndexOf("@"));
const isDecision = (r: Logged): r is DecisionRecord => r?.kind === "decision";
const isOutcome = (r: Logged): r is OutcomeRecord => r?.kind === "outcome";

const RETRY = new Set(["provider_unavailable", "capacity"]);
const ESCALATION = new Set(["repeated_failure", "scope_change"]);

// The same work at another model's prices. The log has each route's cost, its output tokens and
// its input tokens (fresh and cached together), so the fresh/cached split is worked back from the
// cost; then the three are priced again. Null when either price isn't listed.
export function repriced(use: { route: string; usd: number; input: number; output: number }, to: Rate, from: Rate | undefined = rateOf(modelOf(use.route))): number | null {
  if (!from) return null;
  const cacheFrom = from.cacheRead ?? from.input * 0.1;
  const cacheTo = to.cacheRead ?? to.input * 0.1;
  const inputUsd = use.usd - (use.output * from.output) / 1e6;
  const fresh = from.input === cacheFrom ? use.input : Math.min(use.input, Math.max(0, (inputUsd * 1e6 - use.input * cacheFrom) / (from.input - cacheFrom)));
  return (use.output * to.output + fresh * to.input + (use.input - fresh) * cacheTo) / 1e6;
}

// The biggest model a run could have had: the dearest of its candidates with a listed price.
function biggestOf(candidates: string[]): Rate | null {
  let best: Rate | null = null;
  for (const c of candidates) {
    const r = rateOf(modelOf(c));
    if (r && (!best || r.output > best.output || (r.output === best.output && r.input > best.input))) best = r;
  }
  return best;
}

export type SummaryOptions = { includeFixtures?: boolean };

export function summariseRouting(records: Logged[], opts: SummaryOptions = {}): RoutingSummary {
  const list = records.filter((r) => r && typeof r === "object" && (isDecision(r) || isOutcome(r)));
  // Scripted runs (an evaluation's stand-ins) say nothing about practice.
  const scripted = new Set(opts.includeFixtures ? [] : list.filter((r) => isOutcome(r) && r.source === "fixture").map((r) => r.run));
  const runs = new Map<string, { decisions: DecisionRecord[]; outcome?: OutcomeRecord }>();
  for (const r of list) {
    if (scripted.has(r.run)) continue;
    const run = runs.get(r.run) ?? { decisions: [] };
    if (isDecision(r)) run.decisions.push(r); else run.outcome = r; // a run's last ending is the one that stands
    runs.set(r.run, run);
  }

  const models = new Map<string, ModelPicks>();
  const model = (name: string) => {
    let m = models.get(name);
    if (!m) models.set(name, (m = { model: name, picks: 0, share: 0, usd: 0, held: 0, failure: 0, retry: 0, escalation: 0, moved: 0, stopped: 0, unfinished: 0 }));
    return m;
  };
  const followed = Object.fromEntries(FOLLOWED.map((f) => [f, 0])) as Record<Followed, number>;
  const byTrigger: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  let autoRuns = 0, manualRuns = 0, decisions = 0, kept = 0, unavailable = 0, picks = 0;
  const spend = { autoUsd: 0, pricedRuns: 0, unpricedRuns: 0, usd: 0, biggestUsd: 0, savedUsd: 0, savedPct: 0 };

  for (const run of runs.values()) {
    const auto = run.decisions.length > 0 || !!run.outcome?.mode.startsWith("auto");
    if (!auto) { manualRuns++; continue; }
    autoRuns++;
    const mode = run.outcome?.mode ?? run.decisions[0]?.mode ?? "auto";
    byMode[mode] = (byMode[mode] ?? 0) + 1;

    // The run's picks, in order: its first choice (kept from an earlier run or not), then each change.
    const chosen: { route: string; next?: string }[] = [];
    for (const d of run.decisions) {
      decisions++;
      byTrigger[d.trigger] = (byTrigger[d.trigger] ?? 0) + 1;
      if (!d.selected) { unavailable++; continue; }
      const last = chosen.at(-1);
      if (last && last.route === d.selected) { kept++; continue; }
      if (last) last.next = d.trigger;
      chosen.push({ route: d.selected });
    }
    const o = run.outcome;
    for (const c of chosen) {
      const what: Followed = c.next
        ? RETRY.has(c.next) ? "retry" : ESCALATION.has(c.next) ? "escalation" : "moved"
        : !o ? "unfinished" : o.status === "stopped" || o.status === "over_budget" ? "stopped" : !o.ok || o.grade === "failed" ? "failure" : "held";
      const m = model(modelOf(c.route));
      m.picks++; m[what]++; followed[what]++; picks++;
    }
    if (!o) { spend.unpricedRuns++; continue; }
    spend.autoUsd += o.usd;
    for (const u of o.routes) model(modelOf(u.route)).usd += u.usd;

    // Against always the biggest model: the run's own tokens, priced again.
    const biggest = biggestOf(run.decisions.flatMap((d) => d.candidates));
    const again = biggest ? o.routes.map((u) => repriced(u, biggest)) : [null];
    if (!biggest || !o.routes.length || again.some((x) => x == null)) { spend.unpricedRuns++; continue; }
    spend.pricedRuns++;
    spend.usd += o.routes.reduce((s, u) => s + u.usd, 0);
    spend.biggestUsd += again.reduce<number>((s, x) => s + (x ?? 0), 0);
  }
  spend.savedUsd = spend.biggestUsd - spend.usd;
  spend.savedPct = spend.biggestUsd > 0 ? spend.savedUsd / spend.biggestUsd : 0;
  for (const m of models.values()) m.share = picks ? m.picks / picks : 0;
  const known = picks - followed.unfinished;
  const rate = (n: number) => (known > 0 ? n / known : 0);
  const times = list.map((r) => r.at).filter((t) => typeof t === "string").sort();
  return {
    from: times[0] ?? null, to: times.at(-1) ?? null,
    runs: runs.size, autoRuns, manualRuns, decisions, kept, unavailable, picks,
    models: [...models.values()].sort((a, b) => b.picks - a.picks || b.usd - a.usd || a.model.localeCompare(b.model)),
    followed, rates: { failure: rate(followed.failure), retry: rate(followed.retry), escalation: rate(followed.escalation) },
    byTrigger, byMode, spend,
  };
}

// Lines of a routing log, as records. A line that isn't a whole record (a write cut short) is skipped.
export function parseRoutingLog(text: string): Logged[] {
  const out: Logged[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === "object" && (r.kind === "decision" || r.kind === "outcome") && typeof r.run === "string") out.push(r);
    } catch { /* a torn line */ }
  }
  return out;
}

export function formatRoutingSummary(s: RoutingSummary): string {
  if (!s.runs) return "The routing log is empty: nothing has been routed yet.";
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const day = (t: string | null) => (t ? t.slice(0, 10) : "?");
  const cols: [string, (m: ModelPicks) => string][] = [
    ["model", (m) => m.model], ["picks", (m) => String(m.picks)], ["share", (m) => pct(m.share)], ["held", (m) => String(m.held)],
    ["failed", (m) => String(m.failure)], ["retried", (m) => String(m.retry)], ["escalated", (m) => String(m.escalation)],
    ["other", (m) => String(m.moved + m.stopped + m.unfinished)], ["spent", (m) => usd(m.usd)],
  ];
  const rows = [cols.map(([h]) => h), ...s.models.map((m) => cols.map(([, f]) => f(m)))];
  const width = cols.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const table = rows.map((r) => `  ${r.map((c, i) => (i === 0 ? c.padEnd(width[i]) : c.padStart(width[i]))).join("  ")}`);
  const out = [
    `Auto routing, ${day(s.from)} to ${day(s.to)}`,
    ``,
    `${s.runs} runs: ${s.autoRuns} on Auto${Object.keys(s.byMode).length ? ` (${Object.entries(s.byMode).map(([k, n]) => `${k.replace(/^auto:/, "")} ${n}`).join(", ")})` : ""}, ${s.manualRuns} on a model you chose.`,
    `Auto looked ${s.decisions} times: ${s.picks} picks, ${s.kept} kept where it was, ${s.unavailable} with nothing that could take the task.`,
    ``,
    `What was picked, and what followed`, ...table,
    ``,
    `Of picks whose ending is known: ${pct(s.rates.failure)} were followed by a failure, ${pct(s.rates.retry)} by a retry on another model, ${pct(s.rates.escalation)} by a move to another model because the work turned out harder.`,
    ``,
    s.spend.pricedRuns
      ? `Spend: ${usd(s.spend.usd)} over ${s.spend.pricedRuns} Auto runs. The same tokens at the biggest model's prices: about ${usd(s.spend.biggestUsd)}, so Auto saved an estimated ${usd(s.spend.savedUsd)} (${pct(s.spend.savedPct)}).`
      : `Spend: ${usd(s.spend.autoUsd)} on Auto runs. Nothing to compare against the biggest model yet.`,
    ...(s.spend.unpricedRuns ? [`(${s.spend.unpricedRuns} Auto runs are left out of the comparison: no ending in the log yet, or a model whose price isn't listed.)`] : []),
    `The saving is an estimate: it assumes the biggest model would have used the same tokens, with no fewer turns and no fewer retries.`,
  ];
  return out.join("\n");
}
