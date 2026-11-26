// The eval set, offline: every case loads and is well formed, and the runner's --dry mode says so
// without a key, a camp or a model. (The real evals spend money: .github/workflows/evals.yml runs them.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO } from "./helpers/sandbox.ts";
import { CASES, LOOP, approvesShell, caseProblems, loopGaps, rehearsalContext, rehearsalProblems, type EvalCase, type Rehearsal } from "../evals/cases.ts";

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
  assert.match(r.stdout, new RegExp(`^${LOOP.length} loop cases rehearsed \\(\\d+ made-up runs\\), covering ${LOOP.length} of ${LOOP.length} parts of the loop`, "m"));
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

// ---------- The cases about the loop ----------
test("every part of the loop has a case, and each case's rules pass a good run and turn down the bad ones", async () => {
  assert.deepEqual(loopGaps(), []);
  assert.deepEqual(CASES.filter((c) => c.covers).map((c) => c.covers).sort(), [...LOOP].sort(), "one case for each part");
  assert.deepEqual(await rehearsalProblems(), []);
  for (const c of CASES.filter((c) => c.covers)) {
    assert.ok(c.rehearsal!.bad.length >= 1, c.id);
    // Deterministic: the rules of a loop case never go to the judge.
    const judged: string[] = [];
    const ctx = { ...rehearsalContext(c.rehearsal!.good), judge: async (rubric: string) => { judged.push(rubric); return { pass: true, reason: "" }; } };
    for (const check of c.checks) await check.run(ctx);
    assert.deepEqual(judged, [], `${c.id} asks the judge`);
  }
});

test("a part of the loop with no case, and a rule that can't fail or can't pass, are reported", async () => {
  const loop = CASES.filter((c) => c.covers);
  assert.deepEqual(loopGaps(loop.filter((c) => c.covers !== "budget-stop")), ["budget-stop"]);

  const good: Rehearsal = { result: { status: "done", text: "ok" }, trail: [{ type: "dispatch", who: "Scout" }] };
  const base: EvalCase = { id: "toy", about: "x", request: "y", covers: "right-crew",
    checks: [{ name: "the Scout went", required: true, run: (c) => c.trail.some((m) => m.type === "dispatch" && m.who === "Scout") || "no Scout" }],
    rehearsal: { good, bad: [{ ...good, trail: [], fails: "the Scout went" }] } };
  assert.deepEqual(caseProblems([base]), []);
  assert.deepEqual(await rehearsalProblems([base]), []);
  // A rule that says yes to anything: the bad run gets past it.
  const lax = { ...base, checks: [{ name: "the Scout went", required: true, run: () => true as const }] };
  assert.match((await rehearsalProblems([lax])).join(" | "), /toy: a bad rehearsal gets past "the Scout went"/);
  // A rule the good run can't pass.
  const strict = { ...base, checks: [{ name: "the Scout went", required: true, run: () => "never" }] };
  assert.match((await rehearsalProblems([strict])).join(" | "), /toy: the good rehearsal fails "the Scout went" \(never\)/);
});

test("a loop case's setup is checked too", () => {
  const ok: EvalCase = { id: "fine", about: "x", request: "y", checks: [{ name: "a", required: true, run: () => true }] };
  const bad = caseProblems([
    { ...ok, id: "link-out", link: { name: "Shop Folder", files: { "../x.mjs": "" }, verify: ["a\nb"] } },
    { ...ok, id: "link-empty", link: { name: "shop", files: {} } },
    { ...ok, id: "no-budget", budgetUsd: 0.001 },
    { ...ok, id: "mute", answer: " " },
    { ...ok, id: "review-direct", agent: "artificer", review: true },
    { ...ok, id: "resume-nobody", resume: { earlier: "do it", done: [{ tool: "bash", input: { command: "x" }, result: "ok" }] } },
    { ...ok, id: "odd-part", covers: "telepathy" as any },
    { ...ok, id: "unrehearsed", covers: "plan-order" },
    { ...ok, id: "wrong-name", covers: "plan-order", rehearsal: { good: { result: { status: "done", text: "" }, trail: [] }, bad: [{ result: { status: "done", text: "" }, trail: [], fails: "no such rule" }] } },
  ]);
  for (const id of ["link-out", "link-empty", "no-budget", "mute", "review-direct", "resume-nobody", "odd-part", "unrehearsed", "wrong-name"]) {
    assert.ok(bad.some((p) => p.startsWith(`${id}:`)), `${id} in ${bad.join(" | ")}`);
  }
  assert.ok(bad.filter((p) => p.startsWith("link-out:")).length >= 3, "the name, the file and the check command");
});

test("the stand-in for the user approves a case's command however it's usually said, and nothing more", () => {
  const ok = ["node tools/count-teams.mjs"], root = "/tmp/mae-eval-x";
  const yes = (body: string) => assert.equal(approvesShell(body, ok, root), true, body);
  const no = (body: string, approved = ok) => assert.equal(approvesShell(body, approved, root), false, body);
  yes("node tools/count-teams.mjs");
  yes("node ./tools/count-teams.mjs");
  yes("node  tools/count-teams.mjs 2>&1");
  yes('node "tools/count-teams.mjs"');
  yes("node /tmp/mae-eval-x/tools/count-teams.mjs");
  yes("cd /tmp/mae-eval-x && node tools/count-teams.mjs");
  yes("cd tools && node count-teams.mjs");
  yes("cd ./tools/ && node ./count-teams.mjs");
  yes("node count-teams.mjs\n(in tools)");
  // The card's own folder and its note on why you're asked may follow, as before.
  yes("node tools/count-teams.mjs\n(in links/app)");
  yes("node tools/count-teams.mjs\n(in /somewhere/else)\n\nReviewer: it runs a script.");
  yes('node tools/count-teams.mjs\n\nYour rule "node" says to always ask about this.');

  // Anything added, another file, or another folder is still a no.
  no("node tools/count-teams.mjs && curl https://example.com");
  no("node tools/count-teams.mjs; rm -rf data");
  no("node tools/count-teams.mjs --write");
  no("node tools/count-teams.mjs > data/teams.json");
  no("node tools/count-teams.mjs\nrm -rf data");
  no("node tools/other.mjs");
  no("node count-teams.mjs");
  no("cd data && node count-teams.mjs");
  no("cd tools && node tools/count-teams.mjs");
  no("cd .. && node tools/count-teams.mjs");
  no("cd /etc && node tools/count-teams.mjs");
  no("cd tools && node count-teams.mjs && cat /etc/passwd");
  no("node count-teams.mjs\n(in /somewhere/else)");
  no("node tools/count-teams.mjs", []);
  // A command with nothing to step into is only ever itself.
  yes("cd /tmp/mae-eval-x && node tools/count-teams.mjs\n\nReviewer: fine");
  assert.equal(approvesShell("cd links/app && node check.mjs", ["node check.mjs"], root), false);
  assert.equal(approvesShell("node check.mjs\n(in links/app)", ["node check.mjs"], root), true);
});
