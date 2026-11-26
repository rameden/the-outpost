// The baseline and the comparison with it, on made-up runs (tests/fixtures/eval-baseline.json and
// eval-run.json): no model is called and no camp is read. The last test drives the runner itself,
// trials and all, against a scripted stand-in for the API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./helpers/sandbox.ts";
import { startFakeApi, whoAsks, type Reply } from "./helpers/fake-api.ts";
import { CASES } from "../evals/cases.ts";
import { baselineFrom, baselineProblems, compare, emptyBaseline, formatComparison, markdownComparison, needsRecheck, summarise, summaryOf, verdictLine, type Baseline, type CaseSummary } from "../evals/compare.ts";

const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const BASE = join(REPO, "tests/fixtures/eval-baseline.json");
const RUN = join(REPO, "tests/fixtures/eval-run.json");
const baseline = (): Baseline => JSON.parse(readFileSync(BASE, "utf8"));
const saved = () => JSON.parse(readFileSync(RUN, "utf8"));
const line = (trials: number, passes: number, more: Partial<CaseSummary> = {}): CaseSummary => ({ trials, passRate: Math.round((passes / trials) * 1000) / 1000, cost: 0.05, tokens: { in: 1000, out: 100 }, models: ["Scout: haiku-5-5 · low"], seconds: 5, ...more });

test("trials become one line per case: pass rate, and the middle cost, tokens and time", () => {
  const s = summarise(saved().results);
  assert.deepEqual(Object.keys(s), ["scout-local-lookup", "loop-plan-order", "scribe-summary", "artificer-bugfix", "memory-old-line", "expedition-parallel", "loop-budget-stop"]);
  assert.deepEqual(s["loop-plan-order"], { trials: 3, passRate: 0.333, cost: 0.17, tokens: { in: 139000, out: 2500 }, models: ["Quartermaster: opus-5-5 · medium", "Scout: haiku-5-5 · low"], seconds: 11 });
  assert.equal(s["artificer-bugfix"].cost, 0.3, "the middle of 0.28, 0.31 and 0.30, not the mean");
  assert.equal(s["scout-local-lookup"].tokens.in, 30200);
  assert.equal(s["expedition-parallel"].trials, 1);
  // An older saved run has no tokens or models; two trials take the point between them.
  assert.deepEqual(summarise([{ id: "x", pass: true, cost: 0.1 }, { id: "x", pass: false, cost: 0.2 }]).x, { trials: 2, passRate: 0.5, cost: 0.15, tokens: { in: 0, out: 0 }, models: [], seconds: 0 });
  // A saved run is read either way: by its own summary, or from its trials.
  assert.deepEqual(summaryOf(saved()), s);
  assert.deepEqual(summaryOf({ cases: { x: line(3, 3) }, results: [] }), { x: line(3, 3) });
  assert.throws(() => summaryOf({ nothing: true }), /not a saved eval run/);
});

test("only a pass rate down by half or more, over two failed trials, is a clear regression", () => {
  const c = compare(baseline(), summaryOf(saved()));
  assert.deepEqual(c.regressions, ["loop-plan-order"]);
  assert.deepEqual(c.slipped, ["scribe-summary", "expedition-parallel"], "a third lower, and one failed trial");
  assert.deepEqual(c.better, ["memory-old-line"]);
  assert.deepEqual(c.costly, ["artificer-bugfix"]);
  assert.deepEqual(c.added, ["loop-budget-stop"]);
  assert.deepEqual(c.notRun, ["warden-review"]);
  assert.equal(c.empty, false);
  assert.equal(c.otherModels, false);
  const row = (id: string) => c.rows.find((r) => r.id === id)!;
  assert.equal(row("scout-local-lookup").verdict, "same");
  assert.deepEqual(row("artificer-bugfix").notes, ["costs 2.5× the baseline", "uses 2.7× the tokens"]);
  assert.match(row("expedition-parallel").notes.join(), /one trial/);

  // The edges of the rule.
  const verdict = (before: CaseSummary, now: CaseSummary) => compare({ ...emptyBaseline(), at: "2026-11-02T00:00:00Z", cases: { x: before } }, { x: now }).rows[0].verdict;
  assert.equal(verdict(line(3, 3), line(3, 0)), "regression");
  assert.equal(verdict(line(3, 3), line(3, 1)), "regression");
  assert.equal(verdict(line(3, 3), line(3, 2)), "slipped");
  assert.equal(verdict(line(3, 2), line(3, 0)), "regression");
  assert.equal(verdict(line(3, 2), line(3, 1)), "slipped");
  assert.equal(verdict(line(3, 3), line(1, 0)), "slipped", "one failed run is never a clear regression");
  assert.equal(verdict(line(2, 2), line(2, 1)), "slipped", "half down, but over one failed trial");
  assert.equal(verdict(line(4, 4), line(4, 2)), "regression");
  assert.equal(verdict(line(3, 1), line(3, 0)), "slipped", "it mostly failed already");
  assert.equal(verdict(line(3, 0), line(3, 0)), "same");
  assert.equal(verdict(line(3, 1), line(3, 3)), "better");
  // Cost and tokens are pointed out, never a regression; a few cents more on a cheap case is not.
  const dear = compare({ ...emptyBaseline(), at: "2026-11-02T00:00:00Z", cases: { x: line(3, 3, { cost: 0.01 }), y: line(3, 3, { cost: 1 }) } }, { x: line(3, 3, { cost: 0.025 }), y: line(3, 3, { cost: 4 }) });
  assert.deepEqual([dear.regressions, dear.costly], [[], ["y"]]);
  // Other models: said, so a change of model isn't read as a change in the code.
  const other = compare(baseline(), { "scout-local-lookup": line(3, 3, { models: ["Scout: sonnet-5-5 · low"] }) });
  assert.equal(other.otherModels, true);
});

test("a case that failed, and passes in the baseline, is run again up to three trials", () => {
  assert.equal(needsRecheck(line(3, 3), line(1, 0)), true);
  assert.equal(needsRecheck(line(3, 3), line(2, 1)), true);
  assert.equal(needsRecheck(line(3, 3), line(3, 1)), false, "three trials are enough");
  assert.equal(needsRecheck(line(3, 3), line(1, 1)), false, "it passed");
  assert.equal(needsRecheck(line(3, 1), line(1, 0)), false, "it mostly fails in the baseline: no regression to find");
  assert.equal(needsRecheck(undefined, line(1, 0)), false, "a new case has nothing to fall from");
});

test("the comparison reads as a short list in the terminal and a table in the job summary", () => {
  const c = compare(baseline(), summaryOf(saved()));
  assert.equal(verdictLine(c), "1 clear regression, 2 slipped, 1 better, 1 case well above the baseline's cost or tokens, 1 new.");
  const text = formatComparison(c);
  assert.match(text, /^Compared with evals\/baseline\.json \(recorded 2026-11-02\):/);
  assert.match(text, /✗ loop-plan-order\s+3\/3 → 1\/3\s+\$0\.18 → \$0\.17\s+clear regression/);
  assert.match(text, /! scribe-summary\s+2\/3 → 1\/3\s+\$0\.04 → \$0\.04\s+slipped/);
  assert.match(text, /↑ memory-old-line\s+1\/3 → 3\/3/);
  assert.match(text, /artificer-bugfix\s+3\/3 → 3\/3\s+\$0\.12 → \$0\.30\s+costs 2\.5× the baseline; uses 2\.7× the tokens/);
  assert.match(text, /\+ loop-budget-stop\s+1\/1\s+\$0\.01\s+new; not in the baseline/);
  assert.match(text, /1 case unchanged\./);
  assert.match(text, /1 case in the baseline was not run: warden-review\./);
  assert.doesNotMatch(text, /scout-local-lookup/, "what didn't change is counted, not listed");

  const md = markdownComparison(c);
  assert.match(md, /^## Evals against the baseline\n\n\*\*1 clear regression,/);
  assert.match(md, /\| `loop-plan-order` \| 3\/3 → 1\/3 \| \$0\.18 → \$0\.17 \| 139,000 \/ 2,500 \| ❌ clear regression \|/);
  assert.match(md, /\| `scout-local-lookup` \| 3\/3 → 3\/3 \| \$0\.03 → \$0\.03 \| 30,200 \/ 400 \|  \|/);
  assert.match(md, /only that fails the run/);

  // Nothing recorded yet: said plainly, with how to record one.
  const none = compare(emptyBaseline(), summaryOf(saved()));
  assert.equal(none.empty, true);
  assert.deepEqual(none.regressions, []);
  assert.match(formatComparison(none), /No baseline is recorded yet.*\n.*--write-baseline/);
  assert.match(markdownComparison(none), /No baseline is recorded yet/);
});

test("a baseline is written from a run, keeps the cases a part-run left out, and is checked", () => {
  const whole = baselineFrom(summaryOf(saved()), { at: "2026-11-23T06:21:00.000Z", commit: "def5678", runtime: "api", set: {} });
  assert.equal(whole.version, 1);
  assert.equal(whole.commit, "def5678");
  assert.equal("set" in whole, false, "no overrides, nothing to say");
  assert.deepEqual(Object.keys(whole.cases), [...Object.keys(whole.cases)].sort(), "in a steady order, so the file diffs cleanly");
  assert.equal("warden-review" in whole.cases, false, "a whole run replaces the baseline");
  assert.deepEqual(baselineProblems(whole, CASES.map((c) => c.id)), []);

  const part = baselineFrom({ "warden-review": line(3, 2) }, { at: "2026-11-24T00:00:00.000Z", set: { warden: { model: "claude-opus-5-5" } } }, baseline());
  assert.equal(part.cases["warden-review"].passRate, 0.667);
  assert.deepEqual(part.cases["scout-local-lookup"], baseline().cases["scout-local-lookup"]);
  assert.deepEqual(part.set, { warden: { model: "claude-opus-5-5" } });

  // The committed baseline, the fixture and an empty one are all well formed.
  const known = CASES.map((c) => c.id);
  assert.deepEqual(baselineProblems(JSON.parse(readFileSync(join(REPO, "evals/baseline.json"), "utf8")), known), []);
  assert.deepEqual(baselineProblems(baseline(), known), []);
  assert.deepEqual(baselineProblems(emptyBaseline(), known), []);
  // And what's wrong with one is said in words.
  const bad = baselineProblems({ version: 2, at: "soon", cases: { "scout-local-lookup": { trials: 0, passRate: 1.5, cost: "free", tokens: {}, models: "haiku" }, "long-gone": line(3, 3) } }, known).join(" | ");
  for (const part of ["version must be 1", "`at` must be a date", "trials must be a whole number", "passRate must be between 0 and 1", "cost must be a number", "tokens must be { in, out }", "models must be a list", "long-gone: there is no such case any more"]) assert.ok(bad.includes(part), `${part} in ${bad}`);
  assert.deepEqual(baselineProblems([]), ["the baseline is not an object"]);
  assert.match(baselineProblems({ version: 1, at: null, cases: { x: line(1, 1) } }).join(), /cases but no date/);
});

// ---------- The command ----------
const cli = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [TSX, "evals/run.ts", ...args], { cwd: REPO, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env } });

test("--compare-only compares a saved run, runs nothing, and fails only on a clear regression", () => {
  const dir = mkdtempSync(join(tmpdir(), "mae-eval-compare-"));
  const summary = join(dir, "summary.md");
  // No key, and an API address nothing listens on: it can't have called a model.
  const offline = { ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", GITHUB_STEP_SUMMARY: summary };
  const r = cli(["--compare-only", RUN, "--compare", BASE], offline);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Compared with tests\/fixtures\/eval-baseline\.json \(recorded 2026-11-02\):/);
  assert.match(r.stdout, /1 clear regression, 2 slipped/);
  assert.doesNotMatch(r.stdout, /Running \d+ eval/);
  assert.match(readFileSync(summary, "utf8"), /## Evals against the baseline[\s\S]*`loop-plan-order`[\s\S]*clear regression/);

  // The same run with the regression taken out: slips and a higher cost alone don't fail it.
  const run = saved();
  run.results = run.results.filter((t: any) => t.id !== "loop-plan-order");
  const calmer = join(dir, "run.json");
  writeFileSync(calmer, JSON.stringify(run));
  const ok = cli(["--compare-only", calmer, "--compare", BASE], offline);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /No clear regression, 2 slipped/);

  // Against a baseline with nothing recorded there is nothing to fail on.
  const none = join(dir, "none.json");
  writeFileSync(none, JSON.stringify(emptyBaseline()));
  const first = cli(["--compare-only", RUN, "--compare", none], offline);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /No baseline is recorded yet/);
});

test("--dry reads the baseline too, and the flags' values aren't taken for case names", () => {
  const ok = cli(["--dry", "--trials", "3", "--compare", BASE, "--write-baseline", "scout-local-lookup"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^1 eval case well formed\. Nothing was run\./);
  assert.match(ok.stdout, new RegExp(`^Baseline: 7 of ${CASES.length} cases, recorded 2026-11-02\\.$`, "m"));
  // The committed baseline is read by a plain --dry, whatever is recorded in it.
  const committed = cli(["--dry"]);
  assert.equal(committed.status, 0, committed.stdout + committed.stderr);
  assert.match(committed.stdout, /^Baseline: (nothing recorded yet|\d+ of \d+ cases, recorded \d{4}-\d\d-\d\d)\.$/m);

  const dir = mkdtempSync(join(tmpdir(), "mae-eval-compare-"));
  const none = join(dir, "none.json");
  writeFileSync(none, JSON.stringify(emptyBaseline()));
  assert.match(cli(["--dry", "--compare", none]).stdout, /^Baseline: nothing recorded yet\.$/m);
  const stale = join(dir, "stale.json");
  writeFileSync(stale, JSON.stringify({ ...baseline(), cases: { ...baseline().cases, "long-gone": line(3, 3) } }));
  const bad = cli(["--dry", "--compare", stale]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /long-gone: there is no such case any more/);
  const torn = join(dir, "torn.json");
  writeFileSync(torn, "{ not json");
  assert.match(cli(["--dry", "--compare", torn]).stdout, /is not JSON/);
  assert.match(cli(["--trials", "lots", "--dry"]).stderr, /whole number from 1 to 20/);
});

// The runner, run for real against a scripted stand-in for the API (no paid model, none of your camp).
function runner(args: string[], script: (body: any) => Reply, env: Record<string, string>): Promise<{ status: number | null; out: string; calls: number }> {
  return startFakeApi(script).then((api) => new Promise((ok) => {
    const child = spawn(process.execPath, [TSX, "evals/run.ts", ...args], {
      cwd: REPO, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
      env: { ...process.env, ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: "test-key-not-real", CAMP_RUNTIME: "api", EVAL_PLAIN: "1", GITHUB_STEP_SUMMARY: "", GITHUB_SHA: "", ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", async (status) => { const calls = api.seen.length; await api.close(); ok({ status, out, calls }); });
  }));
}

test("the runner: trials, a baseline written, then a regression found against it (after checking again)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mae-eval-run-"));
  const base = join(dir, "baseline.json"), results = join(dir, "results"), summary = join(dir, "summary.md");
  const env = { EVAL_RESULTS_DIR: results, GITHUB_STEP_SUMMARY: summary };
  // A Quartermaster that spends the one-cent budget on its first turn: the case passes.
  const stops = (b: any): Reply => (whoAsks(b) === "Quartermaster"
    ? { text: "Sending the Scout first.", tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "Do your part." } }], usage: { input_tokens: 2_000_000, output_tokens: 10 } }
    : { text: "should not run" });
  const first = await runner(["loop-budget-stop", "--trials", "2", "--no-judge", "--write-baseline", base], stops, env);
  assert.equal(first.status, 0, first.out);
  assert.match(first.out, /Running 1 eval case, 2 times each,…/);
  assert.match(first.out, /1\/1 passed every time/);
  assert.match(first.out, /Wrote .*baseline\.json: 1 case \(the others are as they were\)\. Commit it/);
  const written: Baseline = JSON.parse(readFileSync(base, "utf8"));
  assert.deepEqual(baselineProblems(written, CASES.map((c) => c.id)), []);
  const recorded = written.cases["loop-budget-stop"];
  assert.deepEqual([recorded.trials, recorded.passRate], [2, 1]);
  assert.ok(recorded.cost > 0.01 && recorded.tokens.in >= 2_000_000 && recorded.models.length >= 1, JSON.stringify(recorded));
  assert.equal(written.runtime, "api");
  const savedRun = JSON.parse(readFileSync(join(results, readdirSync(results)[0]), "utf8"));
  assert.deepEqual([savedRun.trials, savedRun.results.length, savedRun.cases["loop-budget-stop"].passRate], [2, 2, 1]);

  // Now the budget is ignored: the work is "finished" for next to nothing. One trial is asked for;
  // the failure is checked twice more before it is called a regression.
  const runsOn = (): Reply => ({ text: "All three steps are done." });
  const second = await runner(["loop-budget-stop", "--no-judge", "--compare", base], runsOn, env);
  assert.equal(second.status, 1, second.out);
  assert.equal((second.out.match(/FAIL/g) ?? []).length, 3, second.out);
  assert.match(second.out, /\(3, checking again\)/);
  assert.match(second.out, /✗ loop-budget-stop\s+2\/2 → 0\/3.*clear regression/);
  assert.match(readFileSync(summary, "utf8"), /`loop-budget-stop` \| 2\/2 → 0\/3[^\n]*❌ clear regression/);

  // And when it passes, one trial is all that's run, and the run is green.
  const third = await runner(["loop-budget-stop", "--no-judge", "--compare", base], stops, env);
  assert.equal(third.status, 0, third.out);
  assert.equal((third.out.match(/PASS/g) ?? []).length, 1, third.out);
  assert.match(third.out, /No clear regression\./);
});
