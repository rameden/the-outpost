// The baseline and the comparison with it. Nothing here runs a case or calls a model: it takes
// the results the runner collected and says what changed since the baseline was recorded.
//
// evals/baseline.json holds, per case: the pass rate over N trials, and the middle (median) cost,
// tokens and seconds of those trials, and the models the crew ran on.
//
// What counts:
//   clear regression  the pass rate fell by half or more, over at least two failed trials.
//                     This is the only thing that fails a run.
//   slipped           the pass rate fell, but not that far (or over one failed trial): a wobble
//                     can't be told from a regression, so it is shown and nothing fails.
//   costs more        the middle cost, or the tokens, are well above the baseline's. Shown only.

export type Tokens = { in: number; out: number };
/** One run of one case, as evals/case.ts prints it (older saved runs have no tokens). */
export type Trial = { id: string; pass: boolean; status?: string; seconds?: number; cost?: number; tokens?: Tokens; models?: string[] };
export type CaseSummary = { trials: number; passRate: number; cost: number; tokens: Tokens; models: string[]; seconds: number };
export type ModelSet = Record<string, { model: string; effort?: string }>;
export type Baseline = { version: 1; at: string | null; commit?: string; runtime?: string; set?: ModelSet; note?: string; cases: Record<string, CaseSummary> };

/** A pass rate has fallen clearly when it is down by this much, over at least FAILS failed trials. */
export const DROP = 0.5;
export const FAILS = 2;
/** A case that failed and passes in the baseline is run until it has this many trials, so one bad run isn't taken for a regression. */
export const RECHECK = 3;
/** Cost or tokens this many times the baseline's are pointed out (when the cost is also up by MORE_USD). */
export const MORE = 1.5;
export const MORE_USD = 0.02;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Every trial of every case, gathered into one line per case (in the order the cases first appear). */
export function summarise(trials: Trial[]): Record<string, CaseSummary> {
  const by = new Map<string, Trial[]>();
  for (const t of trials) by.set(t.id, [...(by.get(t.id) ?? []), t]);
  const out: Record<string, CaseSummary> = {};
  for (const [id, ts] of by) {
    out[id] = {
      trials: ts.length,
      passRate: round(ts.filter((t) => t.pass).length / ts.length, 3),
      cost: round(median(ts.map((t) => t.cost ?? 0)), 4),
      tokens: { in: Math.round(median(ts.map((t) => t.tokens?.in ?? 0))), out: Math.round(median(ts.map((t) => t.tokens?.out ?? 0))) },
      models: [...new Set(ts.flatMap((t) => t.models ?? []))].sort(),
      seconds: Math.round(median(ts.map((t) => t.seconds ?? 0))),
    };
  }
  return out;
}

/** A saved run (evals/results/<time>.json), old or new, as one line per case. */
export function summaryOf(saved: any): Record<string, CaseSummary> {
  if (saved && typeof saved.cases === "object" && saved.cases && !Array.isArray(saved.cases) && !problemsIn(saved.cases).length) return saved.cases;
  if (saved && Array.isArray(saved.results)) return summarise(saved.results);
  throw new Error("That file is not a saved eval run: it has neither cases nor results.");
}

export const emptyBaseline = (): Baseline => ({ version: 1, at: null, cases: {} });

/** A new baseline from this run. With `keep`, the cases this run didn't cover stay as they were
 * (re-baselining one case after a change you meant to make). */
export function baselineFrom(cases: Record<string, CaseSummary>, about: { at: string; commit?: string; runtime?: string; set?: ModelSet }, keep?: Baseline): Baseline {
  const merged = { ...(keep?.cases ?? {}), ...cases };
  return {
    version: 1, at: about.at,
    ...(about.commit ? { commit: about.commit } : {}), ...(about.runtime ? { runtime: about.runtime } : {}),
    ...(about.set && Object.keys(about.set).length ? { set: about.set } : {}),
    cases: Object.fromEntries(Object.keys(merged).sort().map((id) => [id, merged[id]])),
  };
}

const isCount = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
function problemsIn(cases: Record<string, any>): string[] {
  const out: string[] = [];
  for (const [id, c] of Object.entries(cases)) {
    if (!c || typeof c !== "object") { out.push(`${id}: not a case summary`); continue; }
    if (!Number.isInteger(c.trials) || c.trials < 1) out.push(`${id}: trials must be a whole number, 1 or more`);
    if (!isCount(c.passRate) || c.passRate > 1) out.push(`${id}: passRate must be between 0 and 1`);
    if (!isCount(c.cost)) out.push(`${id}: cost must be a number of dollars`);
    if (!c.tokens || !isCount(c.tokens.in) || !isCount(c.tokens.out)) out.push(`${id}: tokens must be { in, out }`);
    if (!Array.isArray(c.models) || c.models.some((m: unknown) => typeof m !== "string")) out.push(`${id}: models must be a list of names`);
  }
  return out;
}

/** What's wrong with a baseline file, in words (an empty list when it's fine). `known` is the
 * ids of the cases there are: a baseline line for a case that's gone is out of date. */
export function baselineProblems(b: any, known?: string[]): string[] {
  if (!b || typeof b !== "object" || Array.isArray(b)) return ["the baseline is not an object"];
  const out: string[] = [];
  if (b.version !== 1) out.push("the baseline's version must be 1");
  if (b.at !== null && (typeof b.at !== "string" || Number.isNaN(Date.parse(b.at)))) out.push("the baseline's `at` must be a date, or null when nothing is recorded");
  if (!b.cases || typeof b.cases !== "object" || Array.isArray(b.cases)) return [...out, "the baseline has no cases object"];
  out.push(...problemsIn(b.cases).map((p) => `baseline, ${p}`));
  if (known) for (const id of Object.keys(b.cases)) if (!known.includes(id)) out.push(`baseline, ${id}: there is no such case any more (take the line out, or re-baseline)`);
  if (Object.keys(b.cases).length && b.at === null) out.push("the baseline has cases but no date");
  return out;
}

export type Verdict = "regression" | "slipped" | "better" | "same" | "new";
export type Row = { id: string; verdict: Verdict; before?: CaseSummary; now: CaseSummary; notes: string[] };
export type Comparison = {
  rows: Row[];
  regressions: string[]; slipped: string[]; better: string[]; costly: string[]; added: string[];
  /** In the baseline, not in this run (you ran some of the cases, or a case is gone). */
  notRun: string[];
  /** The baseline has nothing in it yet: there is nothing to compare with. */
  empty: boolean;
  /** The crew ran on other models than the baseline's: the comparison is between models as much as between changes. */
  otherModels: boolean;
  at: string | null;
};

const fails = (c: CaseSummary) => Math.round(c.trials * (1 - c.passRate));
const passes = (c: CaseSummary) => c.trials - fails(c);
const sameModels = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((m, i) => m === [...b].sort()[i]);

/** Would more trials of this case still be worth running? Yes when it failed, passes at least half
 * the time in the baseline, and hasn't had RECHECK trials yet. */
export function needsRecheck(before: CaseSummary | undefined, now: CaseSummary): boolean {
  return !!before && now.passRate < before.passRate && before.passRate >= DROP && now.trials < RECHECK;
}

export function compare(baseline: Baseline, now: Record<string, CaseSummary>): Comparison {
  const rows: Row[] = [];
  let otherModels = false;
  for (const [id, cur] of Object.entries(now)) {
    const before = baseline.cases[id];
    if (!before) { rows.push({ id, verdict: "new", now: cur, notes: ["not in the baseline"] }); continue; }
    const notes: string[] = [];
    const drop = before.passRate - cur.passRate;
    let verdict: Verdict = "same";
    if (drop >= DROP - 1e-9 && fails(cur) >= FAILS) verdict = "regression";
    else if (drop > 1e-9) { verdict = "slipped"; if (cur.trials < FAILS) notes.push("one trial: run it again to tell a wobble from a regression"); }
    else if (drop < -1e-9) verdict = "better";
    if (before.cost > 0 && cur.cost > before.cost * MORE && cur.cost - before.cost >= MORE_USD) notes.push(`costs ${(cur.cost / before.cost).toFixed(1)}× the baseline`);
    const was = before.tokens.in + before.tokens.out, is = cur.tokens.in + cur.tokens.out;
    if (was > 0 && is > was * MORE) notes.push(`uses ${(is / was).toFixed(1)}× the tokens`);
    if (cur.models.length && before.models.length && !sameModels(cur.models, before.models)) { otherModels = true; notes.push("ran on other models"); }
    rows.push({ id, verdict, before, now: cur, notes });
  }
  const ids = (v: Verdict) => rows.filter((r) => r.verdict === v).map((r) => r.id);
  return {
    rows,
    regressions: ids("regression"), slipped: ids("slipped"), better: ids("better"), added: ids("new"),
    costly: rows.filter((r) => r.notes.some((n) => n.startsWith("costs ") || n.startsWith("uses "))).map((r) => r.id),
    notRun: Object.keys(baseline.cases).filter((id) => !(id in now)),
    empty: Object.keys(baseline.cases).length === 0,
    otherModels,
    at: baseline.at,
  };
}

const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const rate = (c: CaseSummary) => `${passes(c)}/${c.trials}`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const WORD: Record<Verdict, string> = { regression: "clear regression", slipped: "slipped", better: "better", same: "same", new: "new" };
const MARK: Record<Verdict, string> = { regression: "✗", slipped: "!", better: "↑", same: " ", new: "+" };
const day = (at: string | null) => (at ? at.slice(0, 10) : "no date");

/** The one-line verdict, the same in the terminal and in the job summary. */
export function verdictLine(c: Comparison): string {
  if (c.empty) return "No baseline is recorded yet, so there is nothing to compare with.";
  const parts = [
    c.regressions.length ? count(c.regressions.length, "clear regression") : "No clear regression",
    ...(c.slipped.length ? [`${c.slipped.length} slipped`] : []),
    ...(c.better.length ? [`${c.better.length} better`] : []),
    ...(c.costly.length ? [`${count(c.costly.length, "case")} well above the baseline's cost or tokens`] : []),
    ...(c.added.length ? [`${c.added.length} new`] : []),
  ];
  return `${parts.join(", ")}.`;
}

/** For the terminal: the cases that changed, then the verdict. */
export function formatComparison(c: Comparison, file = "evals/baseline.json"): string {
  if (c.empty) return `${verdictLine(c)}\nRecord one with: npm run eval -- --trials 3 --write-baseline   (see evals/README.md)`;
  const wide = Math.max(24, ...c.rows.map((r) => r.id.length));
  const lines = [`Compared with ${file} (recorded ${day(c.at)}):`];
  for (const r of c.rows) {
    if (r.verdict === "same" && !r.notes.length) continue;
    const was = r.before ? `${rate(r.before)} → ${rate(r.now)}` : `      ${rate(r.now)}`;
    const cost = r.before ? `${usd(r.before.cost)} → ${usd(r.now.cost)}` : usd(r.now.cost);
    lines.push(`  ${MARK[r.verdict]} ${r.id.padEnd(wide)} ${was.padEnd(11)}  ${cost.padEnd(15)}  ${[WORD[r.verdict], ...r.notes].filter((x) => x !== "same" || !r.notes.length).join("; ")}`);
  }
  const same = c.rows.filter((r) => r.verdict === "same" && !r.notes.length).length;
  if (same) lines.push(`  ${count(same, "case")} unchanged.`);
  if (c.notRun.length) lines.push(`  ${count(c.notRun.length, "case")} in the baseline ${c.notRun.length === 1 ? "was" : "were"} not run: ${c.notRun.join(", ")}.`);
  if (c.otherModels) lines.push("  The crew ran on other models than the baseline's, so this compares models as much as changes.");
  lines.push(verdictLine(c));
  return lines.join("\n");
}

/** For the job summary on GitHub: every case in a table. */
export function markdownComparison(c: Comparison, title = "Evals against the baseline"): string {
  const lines = [`## ${title}`, "", `**${verdictLine(c)}**`, ""];
  if (c.empty) {
    lines.push("Record one by running this workflow with **baseline** ticked (or `npm run eval -- --trials 3 --write-baseline`), then commit `evals/baseline.json`. Until then a failed case fails the run, as before.", "");
  } else {
    lines.push(`Baseline recorded ${day(c.at)}. A clear regression is a pass rate down by half or more over at least two failed trials; only that fails the run.`, "");
  }
  if (c.rows.length) {
    lines.push("| Case | Passed (baseline → now) | Cost | Tokens in / out | |", "| --- | --- | --- | --- | --- |");
    const tok = (t: Tokens) => `${t.in.toLocaleString("en-US")} / ${t.out.toLocaleString("en-US")}`;
    for (const r of c.rows) {
      const flag = r.verdict === "regression" ? "❌ " : r.verdict === "slipped" ? "⚠️ " : "";
      lines.push(`| \`${r.id}\` | ${r.before ? `${rate(r.before)} → ` : ""}${rate(r.now)} | ${r.before ? `${usd(r.before.cost)} → ` : ""}${usd(r.now.cost)} | ${tok(r.now.tokens)} | ${flag}${[...(r.verdict === "same" ? [] : [WORD[r.verdict]]), ...r.notes].join("; ")} |`);
    }
    lines.push("");
  }
  if (c.notRun.length) lines.push(`Not run this time: ${c.notRun.map((id) => `\`${id}\``).join(", ")}.`, "");
  if (c.otherModels) lines.push("The crew ran on other models than the baseline's, so this compares models as much as changes.", "");
  return lines.join("\n");
}
