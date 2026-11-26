// The routing-log report, on a made-up log (tests/fixtures/routing-log.jsonl). Nothing here reads
// a real camp: the fixture's runs are invented, and the command is pointed at the fixture file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rateOf } from "../src/costs.ts";
import { formatRoutingSummary, parseRoutingLog, repriced, summariseRouting } from "../src/routing-summary.ts";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(REPO, "tests/fixtures/routing-log.jsonl");
const TSX = join(REPO, "node_modules/tsx/dist/cli.mjs");
const records = () => parseRoutingLog(readFileSync(FIXTURE, "utf8"));
const near = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test("the log is read line by line, and a line cut short is skipped", () => {
  const text = readFileSync(FIXTURE, "utf8");
  const lines = text.split("\n").filter((l) => l.trim());
  assert.throws(() => JSON.parse(lines.at(-1)!), "the fixture ends on a torn line");
  assert.equal(records().length, lines.length - 1);
  assert.deepEqual(parseRoutingLog('{"kind":"other","run":"x"}\nnot json\n\n{"kind":"decision"}'), []);
});

test("how often each model was picked, and what followed", () => {
  const s = summariseRouting(records());
  assert.equal(s.runs, 13, "the scripted run and the torn line are left out");
  assert.equal(s.autoRuns, 12);
  assert.equal(s.manualRuns, 1);
  assert.equal(s.decisions, 15);
  assert.equal(s.kept, 1, "looking again and staying put is not a new pick");
  assert.equal(s.unavailable, 1);
  assert.equal(s.picks, 13);
  assert.deepEqual(s.followed, { held: 7, failure: 2, retry: 1, escalation: 1, moved: 0, stopped: 1, unfinished: 1 });

  const by = Object.fromEntries(s.models.map((m) => [m.model, m]));
  assert.equal(s.models[0].model, "claude-sonnet-5-5", "most picked first");
  // Sonnet: two held (one carried over from an earlier run), one moved up after repeated failures,
  // one retried elsewhere when its provider was down, one whose check failed, one you stopped.
  assert.deepEqual([by["claude-sonnet-5-5"].picks, by["claude-sonnet-5-5"].held, by["claude-sonnet-5-5"].escalation, by["claude-sonnet-5-5"].retry, by["claude-sonnet-5-5"].failure, by["claude-sonnet-5-5"].stopped], [6, 2, 1, 1, 1, 1]);
  assert.deepEqual([by["claude-opus-5-5"].picks, by["claude-opus-5-5"].held, by["claude-opus-5-5"].failure], [3, 2, 1]);
  assert.deepEqual([by["claude-haiku-5-5"].picks, by["claude-haiku-5-5"].held, by["claude-haiku-5-5"].unfinished], [2, 1, 1]);
  assert.deepEqual([by["claude-fable-5-2"].picks, by["claude-fable-5-2"].held], [1, 1], "a model you chose yourself is not a pick");
  near(by["claude-sonnet-5-5"].share, 6 / 13);
  near(s.models.reduce((n, m) => n + m.share, 0), 1);

  // Rates are over the picks whose ending is known (the unfinished one says nothing yet).
  near(s.rates.failure, 2 / 12);
  near(s.rates.retry, 1 / 12);
  near(s.rates.escalation, 1 / 12);
  assert.deepEqual(s.byTrigger, { new_task: 11, repeated_failure: 1, provider_unavailable: 1, scope_change: 1, resume: 1 });
  assert.deepEqual(s.byMode, { "auto:balanced": 10, "auto:economy": 1, "auto:quality": 1 });
  assert.equal(s.from, "2026-10-05T09:07:00.000Z");
});

test("estimated spend saved against always the biggest model", () => {
  const s = summariseRouting(records()).spend;
  assert.equal(s.pricedRuns, 9);
  assert.equal(s.unpricedRuns, 3, "no ending, no model used, and a model with no listed price");
  near(s.usd, 1.53);
  near(s.autoUsd, 1.53);
  near(s.biggestUsd, 3.54);       // the fixture's own tokens at the biggest model's prices
  near(s.savedUsd, 2.01);
  near(s.savedPct, 2.01 / 3.54);
  // A run already on the biggest model saves nothing.
  const quality = summariseRouting(records().filter((r) => r.run === "r10")).spend;
  near(quality.usd, quality.biggestUsd);
  near(quality.savedPct, 0);
});

test("re-pricing works the fresh and cached input back from the logged cost", () => {
  const sonnet = rateOf("claude-sonnet-5-5")!, fable = rateOf("claude-fable-5-2")!;
  // 20k fresh and 180k cached in, 6k out, on Sonnet.
  const usd = (20_000 * sonnet.input + 180_000 * sonnet.cacheRead! + 6_000 * sonnet.output) / 1e6;
  near(repriced({ route: "claude-sonnet-5-5@medium", usd, input: 200_000, output: 6_000 }, fable)!, (20_000 * fable.input + 180_000 * fable.cacheRead! + 6_000 * fable.output) / 1e6);
  // A cost that doesn't fit the tokens is kept within what the tokens allow.
  near(repriced({ route: "claude-sonnet-5-5@medium", usd: 99, input: 1000, output: 0 }, fable)!, (1000 * fable.input) / 1e6);
  near(repriced({ route: "claude-sonnet-5-5@medium", usd: 0, input: 1000, output: 0 }, fable)!, (1000 * fable.cacheRead!) / 1e6);
  assert.equal(repriced({ route: "localhost:mystery-1", usd: 0, input: 1000, output: 10 }, fable), null);
});

test("scripted runs count only when asked for; an empty log says so", () => {
  const all = summariseRouting(records(), { includeFixtures: true });
  assert.equal(all.runs, 14);
  assert.equal(all.models.find((m) => m.model === "claude-haiku-5-5")!.picks, 3);
  const empty = summariseRouting([]);
  assert.equal(empty.runs, 0);
  assert.equal(empty.rates.failure, 0);
  assert.match(formatRoutingSummary(empty), /empty/);
});

test("the report reads as a short table, with the saving marked as an estimate", () => {
  const text = formatRoutingSummary(summariseRouting(records()));
  assert.match(text, /13 runs: 12 on Auto \(balanced 10, economy 1, quality 1\), 1 on a model you chose\./);
  assert.match(text, /claude-sonnet-5-5\s+6\s+46\.2%\s+2\s+1\s+1\s+1\s+1\s+\$/);
  assert.match(text, /16\.7% were followed by a failure, 8\.3% by a retry on another model, 8\.3% by a move/);
  assert.match(text, /Spend: \$1\.53 over 9 Auto runs\..*about \$3\.54.*\$2\.01 \(56\.8%\)/);
  assert.match(text, /3 Auto runs are left out/);
  assert.match(text, /estimate/);
  assert.doesNotMatch(text, /task-r\d+/, "no task ids or task text in the report");
});

test("the command reads the file it is given, and says when there is none", () => {
  const run = (...args: string[]) => execFileSync(process.execPath, [TSX, "scripts/routing-report.ts", ...args], { cwd: REPO, encoding: "utf8" });
  assert.match(run(FIXTURE), /What was picked, and what followed/);
  const json = JSON.parse(run(FIXTURE, "--json"));
  assert.equal(json.picks, 13);
  assert.equal(JSON.parse(run(FIXTURE, "--json", "--fixtures")).runs, 14);
  const missing = spawnSync(process.execPath, [TSX, "scripts/routing-report.ts", join(REPO, "tests/fixtures/no-such-log.jsonl")], { cwd: REPO, encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No routing log at/);
});
