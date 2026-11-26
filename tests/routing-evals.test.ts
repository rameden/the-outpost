// The offline routing eval, as a check: Auto's choices over the labelled set (evals/routing-cases.ts)
// may not fall below the committed floor (evals/routing-floor.json). No model is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { POLICY, type Policy } from "../src/routing.ts";
import { ROUTING_CASES } from "../evals/routing-cases.ts";
import { BIGGEST, belowFloor, evalRoutes, formatScore, readFloor, scoreRouting } from "../evals/routing.ts";

const REPO = resolve(import.meta.dirname, "..");
const TSX = resolve(REPO, "node_modules/tsx/dist/cli.mjs");
const floor = readFloor();

test("the labelled set is well formed, and covers every kind of work, level of stakes and preference", () => {
  const ids = ROUTING_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const c of ROUTING_CASES) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, c.id);
    assert.ok(c.text.trim() && c.why.trim(), `${c.id} has a request and a reason for its label`);
    assert.ok(c.expect.length >= 1 && c.expect.length <= 2, `${c.id} names one or two sensible tiers (more would pass anything)`);
  }
  assert.ok(ROUTING_CASES.length >= 60);
  const count = (key: (c: (typeof ROUTING_CASES)[number]) => string) => ROUTING_CASES.reduce<Record<string, number>>((m, c) => ({ ...m, [key(c)]: (m[key(c)] ?? 0) + 1 }), {});
  for (const kind of ["search", "explanation", "summary", "editing", "debugging", "review", "planning", "chat"]) assert.ok((count((c) => c.kind)[kind] ?? 0) >= 5, `at least five ${kind} tasks`);
  for (const stakes of ["low", "normal", "high", "critical"]) assert.ok((count((c) => c.stakes)[stakes] ?? 0) >= 5, `at least five ${stakes}-stakes tasks`);
  for (const mode of ["economy", "quality"]) assert.ok((count((c) => c.mode ?? "balanced")[mode] ?? 0) >= 2, `at least two ${mode} tasks`);
  for (const size of ["small", "medium", "large"]) assert.ok((count((c) => c.size ?? "small")[size] ?? 0) >= 5, `at least five ${size} requests`);
  // The floor names real kinds and real cases.
  for (const kind of Object.keys(floor.byKind)) assert.ok(ROUTING_CASES.some((c) => c.kind === kind), `the floor's "${kind}" is a kind in the set`);
  for (const id of floor.accepted) assert.ok(ids.includes(id), `the floor's accepted miss "${id}" is a case in the set`);
});

test("Auto's choices are at or above the committed floor", () => {
  const score = scoreRouting();
  assert.deepEqual(belowFloor(score, floor), [], `\n${formatScore(score)}\n`);
  // The same decisions twice: the score is a pure function of the set and the policy.
  assert.deepEqual(scoreRouting().rows, score.rows);
  assert.equal(score.total, ROUTING_CASES.length);
  assert.equal(score.correct + score.under + score.over + score.unavailable, score.total);
  assert.ok(score.usd > 0 && score.usd < score.biggestUsd, "Auto is expected to cost less than always the biggest model");
});

test("the candidates are Claude's four tiers at their listed prices, the biggest among them", () => {
  const routes = evalRoutes();
  assert.deepEqual([...new Set(routes.map((r) => r.tier))].sort(), ["frontier", "haiku", "opus", "sonnet"]);
  assert.ok(routes.every((r) => r.price), "every route has a known price");
  assert.ok(routes.some((r) => r.id === BIGGEST));
});

test("a routing change that makes choices worse falls below the floor", () => {
  // A policy that thinks the small model never fails sends everything to it.
  const rosy: Policy = { ...POLICY, version: "test-rosy", priors: { ...POLICY.priors, haiku: { ...POLICY.priors.haiku, cap: 0.995, slope: 0 } } };
  const worse = scoreRouting(ROUTING_CASES, rosy);
  const problems = belowFloor(worse, floor);
  assert.ok(worse.accuracy < floor.accuracy, `accuracy fell to ${worse.accuracy}`);
  assert.ok(problems.some((p) => /accuracy .* below the floor/.test(p)) && problems.some((p) => /high-stakes tasks went to too weak a model/.test(p)), problems.join("\n"));
  assert.match(problems[0], /new misses: /, "the new misses are named");

  // A policy that never trusts anything but the biggest model is safe but spends the saving.
  const timid: Policy = { ...POLICY, version: "test-timid", qualityFloor: { cosmetic: 0.99, normal: 0.99, high: 0.99, critical: 0.99 } };
  const dear = belowFloor(scoreRouting(ROUTING_CASES, timid), floor);
  assert.ok(dear.some((p) => /expected saving .* below the floor/.test(p)), dear.join("\n"));
});

test("the command prints the report, and --check exits 0 at the floor", () => {
  const out = execFileSync(process.execPath, [TSX, "evals/routing.ts", "--check"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, new RegExp(`^Auto routing against ${ROUTING_CASES.length} labelled tasks`));
  assert.match(out, /By kind of work[\s\S]+By what a mistake costs[\s\S]+Expected spend/);
  assert.match(out, /At or above the committed floor\.$/m);
  const json = JSON.parse(execFileSync(process.execPath, [TSX, "evals/routing.ts", "--json"], { cwd: REPO, encoding: "utf8" }));
  assert.equal(json.total, ROUTING_CASES.length);
});
