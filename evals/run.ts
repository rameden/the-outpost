// The eval runner. Runs each case in its own process and throwaway camp, against the real API.
//   npm run eval                                  every case, with your current model settings
//   npm run eval -- scout-local-lookup            just these cases
//   npm run eval -- --set scout=claude-haiku-5-5:low --set artificer=claude-sonnet-5-5
//                                                 try other models without changing your settings
//   npm run eval -- --list                        show the cases
//   npm run eval -- --no-judge                    skip the Claude-judged checks
// Results are printed and saved to evals/results/<time>.json (local, gitignored).
// This spends real usage (your subscription, or API tokens): each case is capped at $2 (EVAL_CASE_BUDGET).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CASES } from "./cases.ts";

const REPO = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

if (args.includes("--list")) {
  for (const c of CASES) console.log(`${c.id.padEnd(24)} ${c.agent ? `@${c.agent}` : "expedition"}  ${c.about}`);
  process.exit(0);
}

const set: Record<string, { model: string; effort?: string }> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--set") {
    const [agent, spec] = (args[++i] ?? "").split("=");
    const [model, effort] = (spec ?? "").split(":");
    if (!agent || !model) throw new Error("Use --set agent=model[:effort], e.g. --set scout=claude-haiku-5-5:low");
    set[agent] = { model, ...(effort ? { effort } : {}) };
  }
}
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--set");
const cases = wanted.length ? CASES.filter((c) => wanted.includes(c.id)) : CASES;
if (!cases.length) throw new Error(`No matching cases. Try --list.`);
// On the API runtime evals need a key; on the subscription runtime they use Claude Code's login.
const { campRuntime } = await import("../src/settings.ts");
if (campRuntime() === "api" && !process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY (or put it in .env) to run evals on the API runtime.");

function runCase(id: string): Promise<any> {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [join(REPO, "node_modules/.bin/tsx"), join(REPO, "evals/case.ts"), id], {
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
console.log(`Running ${cases.length} eval case${cases.length === 1 ? "" : "s"}${Object.keys(set).length ? ` with ${JSON.stringify(set)}` : ""}…\n`);
const results = [];
for (const c of cases) {
  process.stdout.write(`  ${c.id.padEnd(24)} `);
  const r = await runCase(c.id);
  results.push(r);
  const passed = r.checks.filter((x: any) => x.pass).length;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${String(passed).padStart(1)}/${r.checks.length} checks  ${money(r.cost).padStart(6)}  ${r.seconds}s`);
  for (const x of r.checks) if (!x.pass) console.log(`      ${x.required ? "✗" : "·"} ${x.name}${x.detail ? `: ${x.detail}` : ""}`);
  if (r.status === "crashed" || r.status === "error") console.log(`      ${r.reply.split("\n").slice(-3).join("\n      ")}`);
}

const total = results.reduce((s, r) => s + r.cost, 0);
const passed = results.filter((r) => r.pass).length;
const models = [...new Set(results.flatMap((r) => r.models ?? []))].sort();
console.log(`\n${passed}/${results.length} passed · ${money(total)} · models: ${models.join(", ") || "n/a"}`);
mkdirSync(join(REPO, "evals/results"), { recursive: true });
const file = join(REPO, "evals/results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), set, passed, total: results.length, cost: total, results }, null, 2));
console.log(`Saved ${file.replace(REPO + "/", "")}`);
