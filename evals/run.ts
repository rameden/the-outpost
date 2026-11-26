// The eval runner. Runs each case in its own process and throwaway camp, against the real API.
//   npm run eval                                  every case, with your current model settings
//   npm run eval -- scout-local-lookup            just these cases
//   npm run eval -- --set scout=claude-haiku-5-5:low --set artificer=claude-sonnet-5-5
//                                                 try other models without changing your settings
//   npm run eval -- --set scout=auto:economy      or let Auto pick, with a preference
//   npm run eval -- --list                        show the cases
//   npm run eval -- --dry                         check every case is well formed and rehearse the loop cases' rules, calling no model (CI runs this)
//   npm run eval -- --no-judge                    skip the Claude-judged checks
//   npm run eval -- --trials 3                    run each case this many times (pass rate, and the middle cost)
//   npm run eval -- --compare                     then compare with evals/baseline.json, and exit 1 only on a clear regression
//   npm run eval -- --compare other.json          compare with another baseline file
//   npm run eval -- --write-baseline              then save this run as evals/baseline.json (commit it)
//   npm run eval -- --compare-only <results.json> compare a saved run with the baseline, running nothing (no model, no key)
// Results are printed and saved to evals/results/<time>.json (local, gitignored). See evals/README.md.
// This spends real usage (your subscription, or API tokens): each case is capped at $2 (EVAL_CASE_BUDGET).

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { CASES, LOOP, caseProblems, loopGaps, rehearsalProblems } from "./cases.ts";
import { RECHECK, baselineFrom, baselineProblems, compare, emptyBaseline, formatComparison, markdownComparison, needsRecheck, summarise, summaryOf, type Baseline, type Comparison } from "./compare.ts";

const REPO = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

if (args.includes("--list")) {
  for (const c of CASES) console.log(`${c.id.padEnd(24)} ${c.agent ? `@${c.agent}` : "expedition"}  ${c.about}`);
  process.exit(0);
}

// A model can have colons of its own ("auto:economy", "<provider>:<model>"), so only a known
// effort at the very end is read as the effort.
const EFFORT = /:(low|medium|high|xhigh|max)$/;
const set: Record<string, { model: string; effort?: string }> = {};
const taken = new Set<number>(); // the arguments that are a flag's value, not a case id
const value = (i: number) => { taken.add(i + 1); return args[i + 1] ?? ""; };
// --compare and --write-baseline take a file only when the next argument is one (a .json name).
const fileAfter = (i: number, fallback: string) => resolve(args[i + 1]?.endsWith(".json") ? value(i) : fallback);
const BASELINE = join(REPO, "evals/baseline.json");
let trials = 1, compareWith = "", writeTo = "", compareOnly = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--set") {
    const [agent, spec = ""] = value(i).split(/=(.*)/s);
    const effort = spec.match(EFFORT)?.[1];
    const model = effort ? spec.slice(0, -effort.length - 1) : spec;
    if (!agent || !model) throw new Error("Use --set agent=model[:effort], e.g. --set scout=claude-haiku-5-5:low");
    set[agent] = { model, ...(effort ? { effort } : {}) };
  }
  if (args[i] === "--trials") {
    trials = Number(value(i));
    if (!Number.isInteger(trials) || trials < 1 || trials > 20) throw new Error("Use --trials with a whole number from 1 to 20, e.g. --trials 3");
  }
  if (args[i] === "--compare") compareWith = fileAfter(i, BASELINE);
  if (args[i] === "--write-baseline") writeTo = fileAfter(i, BASELINE);
  if (args[i] === "--compare-only") {
    compareOnly = value(i);
    if (!compareOnly.endsWith(".json")) throw new Error("Use --compare-only with a saved run, e.g. --compare-only evals/results/<time>.json");
    compareWith ||= BASELINE;
  }
}
const wanted = args.filter((a, i) => !a.startsWith("--") && !taken.has(i));
const unknown = wanted.filter((id) => !CASES.some((c) => c.id === id));
const cases = wanted.length ? CASES.filter((c) => wanted.includes(c.id)) : CASES;
// A file's name as shown: from the repo's top with forward slashes (on Windows too), or in full when it's elsewhere.
const shown = (file: string) => {
  const within = relative(REPO, file);
  return within.startsWith("..") || isAbsolute(within) ? file : within.replaceAll("\\", "/");
};

/** The baseline in a file, and what's wrong with it. A file that isn't there is an empty baseline. */
function readBaseline(file: string): { baseline: Baseline; problems: string[] } {
  if (!existsSync(file)) return { baseline: emptyBaseline(), problems: [] };
  let b: any;
  try { b = JSON.parse(readFileSync(file, "utf8")); } catch (e: any) { return { baseline: emptyBaseline(), problems: [`${shown(file)} is not JSON: ${e.message}`] }; }
  const problems = baselineProblems(b, CASES.map((c) => c.id));
  return { baseline: problems.length ? emptyBaseline() : b, problems };
}

// Offline: load every case and check it's well formed, with no model, key or camp needed. The
// loop cases are also rehearsed: each one's rules are run over a made-up good run (which must
// pass) and made-up bad runs (which must not), so a rule that can't fail, or can't pass, shows here.
// The baseline is read too, so a line for a case that's gone, or a hand-edit gone wrong, shows.
if (args.includes("--dry")) {
  const shape = caseProblems(CASES);
  const base = readBaseline(compareWith || BASELINE);
  const problems = [...shape, ...loopGaps(CASES).map((part) => `no case covers this part of the loop: ${part}`),
    ...(shape.length ? [] : await rehearsalProblems(CASES)), ...base.problems, ...unknown.map((id) => `${id}: no such case`)];
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (problems.length) console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"} in the eval cases.`);
  else {
    const loop = CASES.filter((c) => c.rehearsal);
    const recorded = Object.keys(base.baseline.cases).length;
    console.log(`${cases.length} eval case${cases.length === 1 ? "" : "s"} well formed${Object.keys(set).length ? `, with ${JSON.stringify(set)}` : ""}. Nothing was run.`);
    console.log(`${loop.length} loop cases rehearsed (${loop.reduce((n, c) => n + 1 + c.rehearsal!.bad.length, 0)} made-up runs), covering ${LOOP.length} of ${LOOP.length} parts of the loop: ${LOOP.join(", ")}.`);
    console.log(recorded ? `Baseline: ${recorded} of ${CASES.length} cases, recorded ${base.baseline.at!.slice(0, 10)}.` : "Baseline: nothing recorded yet.");
  }
  process.exit(problems.length ? 1 : 0);
}
if (unknown.length) throw new Error(`No case called ${unknown.join(", ")}. Try --list.`);
if (!cases.length) throw new Error(`No matching cases. Try --list.`);

/** Print the comparison, put it in the job summary when there is one (GitHub Actions), and say
 * whether the run should fail: only a clear regression does. */
function report(c: Comparison, file: string): boolean {
  console.log(`\n${formatComparison(c, shown(file))}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownComparison(c) + "\n");
  return c.regressions.length > 0;
}
function baselineOrStop(file: string): Baseline {
  const { baseline, problems } = readBaseline(file);
  if (problems.length) throw new Error(`${shown(file)} can't be used:\n  ${problems.join("\n  ")}`);
  return baseline;
}

// Compare a run that was already made: nothing is run, so no model, key or camp is needed.
if (compareOnly) {
  const saved = JSON.parse(readFileSync(resolve(compareOnly), "utf8"));
  const c = compare(baselineOrStop(compareWith), summaryOf(saved));
  process.exit(report(c, compareWith) ? 1 : 0);
}
const baseline = compareWith ? baselineOrStop(compareWith) : null;

// On the API runtime evals need a key; on the subscription runtime they use Claude Code's login.
const { campRuntime } = await import("../src/settings.ts");
if (campRuntime() === "api" && !process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY (or put it in .env) to run evals on the API runtime.");

function runCase(id: string): Promise<any> {
  return new Promise((ok) => {
    // tsx's own entry file, not node_modules/.bin/tsx: on Windows that one is a shell script node can't run.
    const child = spawn(process.execPath, [join(REPO, "node_modules/tsx/dist/cli.mjs"), join(REPO, "evals/case.ts"), id], {
      cwd: REPO,
      env: { ...process.env, EVAL_SET: JSON.stringify(set), ...(args.includes("--no-judge") ? { EVAL_NO_JUDGE: "1" } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      const line = out.split("\n").find((l) => l.startsWith("@@RESULT@@"));
      ok(line ? JSON.parse(line.slice(10)) : { id, pass: false, status: "crashed", seconds: 0, cost: 0, checks: [], reply: (err || out).slice(-800) });
    });
  });
}

const money = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const wide = Math.max(24, ...cases.map((c) => c.id.length));
console.log(`Running ${cases.length} eval case${cases.length === 1 ? "" : "s"}${trials > 1 ? `, ${trials} times each,` : ""}${Object.keys(set).length ? ` with ${JSON.stringify(set)}` : ""}…\n`);
const results: any[] = [];
async function trial(id: string, n: number, label = n === 1 ? id : `  (${n})`) {
  process.stdout.write(`  ${label.padEnd(wide)} `);
  const r = { ...(await runCase(id)), trial: n };
  results.push(r);
  const passed = r.checks.filter((x: any) => x.pass).length;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${String(passed).padStart(1)}/${r.checks.length} checks  ${money(r.cost).padStart(6)}  ${r.seconds}s`);
  for (const x of r.checks) if (!x.pass) console.log(`      ${x.required ? "✗" : "·"} ${x.name}${x.detail ? `: ${x.detail}` : ""}`);
  if (r.status === "crashed" || r.status === "error") console.log(`      ${r.reply.split("\n").slice(-3).join("\n      ")}`);
}
for (const c of cases) {
  for (let n = 1; n <= trials; n++) await trial(c.id, n);
  // One bad run isn't a regression. A case that failed, and passes in the baseline, is run again
  // (up to RECHECK trials in all) before anything is said about it.
  if (baseline) for (let n = trials + 1; n <= RECHECK && needsRecheck(baseline.cases[c.id], summarise(results.filter((r) => r.id === c.id))[c.id]); n++) await trial(c.id, n, `  (${n}, checking again)`);
}

const at = new Date().toISOString();
const summary = summarise(results);
const total = results.reduce((s, r) => s + r.cost, 0);
const passed = Object.values(summary).filter((s) => s.passRate === 1).length;
const models = [...new Set(results.flatMap((r) => r.models ?? []))].sort();
console.log(`\n${passed}/${cases.length} passed${results.length > cases.length ? " every time" : ""} · ${money(total)} · models: ${models.join(", ") || "n/a"}`);
const dir = process.env.EVAL_RESULTS_DIR ? resolve(process.env.EVAL_RESULTS_DIR) : join(REPO, "evals/results");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${at.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ at, set, trials, passed, total: cases.length, cost: total, cases: summary, results }, null, 2));
console.log(`Saved ${shown(file)}`);

// A failed case shows as a failed run (in CI too), unless there is a baseline to compare with:
// then only a clear regression against it does.
let failed = passed !== cases.length;
if (baseline) {
  const c = compare(baseline, summary);
  const regressed = report(c, compareWith);
  if (!c.empty) failed = regressed;
}
if (writeTo) {
  const crashed = [...new Set(results.filter((r) => r.status === "crashed").map((r) => r.id))];
  if (crashed.length) {
    console.log(`\nNo baseline written: ${crashed.join(", ")} crashed, which says nothing about the crew. Fix that and run again.`);
    failed = true;
  } else {
    // Some of the cases: the others keep the lines they had.
    const keep = wanted.length ? readBaseline(writeTo).baseline : undefined;
    const commit = (process.env.GITHUB_SHA ?? spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout ?? "").trim().slice(0, 7);
    writeFileSync(writeTo, JSON.stringify(baselineFrom(summary, { at, commit, runtime: campRuntime(), set }, keep), null, 2) + "\n");
    console.log(`\nWrote ${shown(writeTo)}: ${Object.keys(summary).length} case${Object.keys(summary).length === 1 ? "" : "s"}${keep ? " (the others are as they were)" : ""}. Commit it to make it the baseline.`);
  }
}
process.exitCode = failed ? 1 : 0;
