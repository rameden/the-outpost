// The eval set, offline: every case loads and is well formed, and the runner's --dry mode says so
// without a key, a camp or a model. (The real evals spend money: .github/workflows/evals.yml runs them.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO } from "./helpers/sandbox.ts";
import { CASES, caseProblems, type EvalCase } from "../evals/cases.ts";

const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
// No key and a runtime that would need one: if --dry reached for a model, it would fail.
const offline = { ...process.env, ANTHROPIC_API_KEY: "", CAMP_RUNTIME: "api" };
const dry = (...args: string[]) => spawnSync(process.execPath, [TSX, join(REPO, "evals/run.ts"), "--dry", ...args], { cwd: REPO, env: offline, encoding: "utf8" });

test("every eval case is well formed", () => {
  assert.deepEqual(caseProblems(), []);
  assert.ok(CASES.length >= 10);
});

test("--dry checks the cases and runs nothing", () => {
  const r = dry();
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, new RegExp(`^${CASES.length} eval cases well formed\\. Nothing was run\\.`, "m"));
});

test("--dry fails on a case name that doesn't exist, and reads a model's own colons right", () => {
  const r = dry("no-such-case");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-such-case: no such case/);
  const set = dry("--set", "scout=auto:economy", "--set", "wizard=deepseek:chat:low", "warden-review");
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /"scout":\{"model":"auto:economy"\}/);
  assert.match(set.stdout, /"wizard":\{"model":"deepseek:chat","effort":"low"\}/);
});

test("--list names every case", () => {
  const out = execFileSync(process.execPath, [TSX, join(REPO, "evals/run.ts"), "--list"], { cwd: REPO, env: offline, encoding: "utf8" });
  for (const c of CASES) assert.match(out, new RegExp(`^${c.id} `, "m"));
});

test("a malformed case is caught", () => {
  const ok: EvalCase = { id: "fine", about: "x", request: "y", checks: [{ name: "a", required: true, run: () => true }] };
  assert.deepEqual(caseProblems([ok]), []);
  const bad = caseProblems([
    ok, { ...ok },
    { id: "Bad Id", about: "", request: " ", checks: [] },
    { ...ok, id: "no-required", checks: [{ name: "a", run: () => true }, { name: "a", run: () => true }] },
    { ...ok, id: "escapes", files: { "../outside.txt": "" } },
    { ...ok, id: "stranger", agent: "quartermaster" as any },
  ]);
  for (const want of [/fine: the id is used twice/, /Bad Id: the id should be/, /Bad Id:.*no request/, /Bad Id: has no checks/, /no-required: has no required check/,
    /no-required: two checks are called "a"/, /escapes: the file \.\.\/outside\.txt would land outside/, /stranger: "quartermaster" isn't one of the crew/]) {
    assert.ok(bad.some((p) => want.test(p)), `${want} in ${bad.join(" | ")}`);
  }
});
