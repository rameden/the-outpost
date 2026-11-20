// What the camp does for itself, unasked: a job approved late doesn't undo what happened while it
// waited, the settings are read from the file once and not on every question, journals nothing
// can be picked up from are cleared away, and the routing log keeps to a size.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

const home = enterSandbox("upkeep");

const { scheduleJob, loadJobs, saveJobs, JOBS_PATH } = await import("../src/jobs.ts");
const { setAsker } = await import("../src/ask.ts");
const settings = await import("../src/settings.ts");
const { OpJournal, pruneJournals, OPS_DIR, JOURNAL_KEEP_DAYS } = await import("../src/oplog.ts");
const auto = await import("../src/autoroute.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const DAY = 86_400_000;
// Make a file look as if it was last written this many days ago.
const aged = (path: string, days: number) => { const t = new Date(Date.now() - days * DAY); utimesSync(path, t, t); };
// Another camp folder, for as long as fn runs.
function elsewhere<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mae-upkeep-other-"));
  mkdirSync(join(dir, "camp"), { recursive: true });
  process.chdir(dir);
  try { return fn(dir); } finally { process.chdir(home); }
}

// ---------- A job approved late ----------

const job = (name: string, more: object = {}) => ({ name, schedule: "every 1h", task: `do ${name}`, created: "2026-01-01T00:00:00.000Z", enabled: true, ...more });
const schedule = (name: string, task = "the new task") => scheduleJob.run!({ name, schedule: "daily 08:00", task });

test("schedule_job: what happened to the jobs while the approval waited is kept", async () => {
  saveJobs([job("brief"), job("sweep")]);
  setAsker(async () => {
    // Meanwhile: the watcher marks a run, and another job is added.
    saveJobs([...loadJobs().map((j) => (j.name === "brief" ? { ...j, lastRun: "2026-11-19T08:00:00.000Z", lastReport: "all quiet" } : j)), job("digest")]);
    return "y";
  });
  assert.match(String(await schedule("standup")), /^Scheduled "standup"/);
  const jobs = loadJobs();
  assert.deepEqual(jobs.map((j) => j.name), ["brief", "sweep", "digest", "standup"]);
  assert.deepEqual([jobs[0].lastRun, jobs[0].lastReport], ["2026-11-19T08:00:00.000Z", "all quiet"]);
  assert.deepEqual([jobs[3].schedule, jobs[3].task, jobs[3].enabled], ["daily 08:00", "the new task", true]);
});

test("schedule_job: replacing a job that was cancelled meanwhile adds it; one that appeared meanwhile is replaced, not doubled", async () => {
  saveJobs([job("brief"), job("sweep", { lastRun: "2026-11-18T08:00:00.000Z" })]);
  let title = "";
  setAsker(async (q) => { title = q.title; saveJobs(loadJobs().filter((j) => j.name !== "sweep")); return "y"; });
  await schedule("sweep", "sweep again");
  assert.match(title, /Replace scheduled job "sweep"/);
  assert.deepEqual(loadJobs().map((j) => [j.name, j.task, j.lastRun]), [["brief", "do brief", undefined], ["sweep", "sweep again", undefined]]);

  saveJobs([job("brief")]);
  setAsker(async (q) => { title = q.title; saveJobs([job("digest", { task: "someone else's" }), ...loadJobs()]); return "y"; });
  await schedule("digest", "mine");
  assert.match(title, /New scheduled job "digest"/);
  assert.deepEqual(loadJobs().map((j) => [j.name, j.task]), [["digest", "mine"], ["brief", "do brief"]]); // in the place the name had
});

test("schedule_job: declined, the jobs are left exactly as they were", async () => {
  saveJobs([job("brief")]);
  const before = readFileSync(JOBS_PATH, "utf8");
  setAsker(async () => "n");
  assert.equal(await schedule("standup"), "The user declined this job.");
  assert.equal(readFileSync(JOBS_PATH, "utf8"), before);
});

// ---------- Settings, read once ----------

const writeSettings = (s: object) => writeFileSync(settings.SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n");

test("settings: the file is read once, and again only when it has changed", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  writeSettings({ agents: {}, budgetUsd: 11 });
  utimesSync(settings.SETTINGS_PATH, at, at);
  assert.equal(settings.budgetUsd(), 11);
  // Written in place, same length, same time: nothing about the file says it changed, so it isn't
  // read. (No real edit looks like this; it's here to show the answer comes from what's kept.)
  writeSettings({ agents: {}, budgetUsd: 22 });
  utimesSync(settings.SETTINGS_PATH, at, at);
  assert.equal(settings.budgetUsd(), 11);
  // An edit by hand, or by another camp process: picked up on the next question.
  writeSettings({ agents: {}, budgetUsd: 333 });
  assert.equal(settings.budgetUsd(), 333);
  // A different time alone is enough.
  writeSettings({ agents: {}, budgetUsd: 444 });
  utimesSync(settings.SETTINGS_PATH, at, at);
  assert.equal(settings.budgetUsd(), 444);
  // And a file that can't be read is the defaults again.
  writeFileSync(settings.SETTINGS_PATH, "{ not json");
  assert.equal(settings.budgetUsd(), undefined);
  assert.equal(settings.parallelLimit(), settings.PARALLEL_DEFAULT);
});

test("settings: a save is what the next question gets, from this process or the file", () => {
  writeSettings({ agents: {} });
  settings.setBudgetUsd(5);
  assert.equal(settings.budgetUsd(), 5);
  settings.setParallelLimit(2);
  settings.setAgentSettings("scout", { maxTurns: 40 });
  assert.deepEqual([settings.budgetUsd(), settings.parallelLimit(), settings.agentSettings("scout").maxTurns], [5, 2, 40]);
  const onDisk = JSON.parse(readFileSync(settings.SETTINGS_PATH, "utf8"));
  assert.deepEqual([onDisk.budgetUsd, onDisk.parallel, onDisk.agents.scout.maxTurns], [5, 2, 40]);
});

test("settings: nothing a caller does to what it's handed changes what the next caller reads", () => {
  writeSettings({ agents: { scout: { model: "claude-sonnet-5-5" } }, shell: { allow: ["git status"], exact: ["ls"] }, providersApproved: ["openai"], alwaysSkills: { scout: ["a"] } });
  const shell = settings.shellSettings();
  shell.allow!.push("rm -rf /");
  shell.god = true;
  (settings.agentSettings("scout") as any).model = "something-else";
  settings.providersApproved().push("nobody");
  settings.alwaysSkills().scout.push("b");
  assert.deepEqual(settings.shellSettings(), { allow: ["git status"], exact: ["ls"] });
  assert.equal(settings.agentSettings("scout").model, "claude-sonnet-5-5");
  assert.deepEqual(settings.providersApproved(), ["openai"]);
  assert.deepEqual(settings.alwaysSkills(), { scout: ["a"] });
  // A setter builds on what's in the file, not on anything changed above.
  settings.allowShellCommand("npm test");
  assert.deepEqual(settings.shellSettings(), { allow: ["git status"], exact: ["ls", "npm test"] });
  assert.deepEqual(JSON.parse(readFileSync(settings.SETTINGS_PATH, "utf8")).shell, { allow: ["git status"], exact: ["ls", "npm test"] });
});

test("settings: a camp somewhere else has its own", () => {
  writeSettings({ agents: {}, budgetUsd: 7, parallel: 5 });
  assert.deepEqual([settings.budgetUsd(), settings.parallelLimit()], [7, 5]);
  elsewhere(() => {
    assert.deepEqual([settings.budgetUsd(), settings.parallelLimit()], [undefined, settings.PARALLEL_DEFAULT]);
    settings.setBudgetUsd(99);
    assert.equal(settings.budgetUsd(), 99);
  });
  assert.deepEqual([settings.budgetUsd(), settings.parallelLimit()], [7, 5]);
});

// ---------- Old journals ----------

const journalOf = (task: string) => `${OPS_DIR}/${task.replace(/[^\w.-]+/g, "_")}.jsonl`;
const OLD = JOURNAL_KEEP_DAYS + 1;
// A run of a task that made one change, and then ended, broke off, or is still going.
function ran(task: string, run: string, how: "ended" | "broke off" | "going", change = true) {
  const j = new OpJournal(task, run);
  j.begin();
  if (change) { const op = j.opId("bash", { command: "git push" }); j.started(op, "bash"); j.done(op, "bash", "pushed"); }
  if (how === "ended") j.end();
  if (how === "broke off") j.abandon();
  return j;
}

test("journals: one whose latest run ended goes after a week untouched, and not before", () => {
  ran("t1:scout", "exp1:1", "ended");
  ran("t2:scout", "exp2:1", "ended");
  aged(journalOf("t1:scout"), OLD);
  aged(journalOf("t2:scout"), JOURNAL_KEEP_DAYS - 1);
  const size = statSync(journalOf("t1:scout")).size;
  assert.deepEqual(pruneJournals(), { files: 1, bytes: size });
  assert.deepEqual([existsSync(journalOf("t1:scout")), existsSync(journalOf("t2:scout"))], [false, true]);
  // The same journal, a few days on.
  assert.equal(pruneJournals(Date.now() + 3 * DAY).files, 1);
  assert.equal(existsSync(journalOf("t2:scout")), false);
});

test("journals: one whose latest run broke off part-way is kept however old, and is still picked up from", () => {
  ran("t3:artificer", "exp3:1", "ended");
  ran("t3:artificer", "exp4:1", "broke off"); // an earlier run that ended doesn't make it removable
  aged(journalOf("t3:artificer"), 400);
  assert.equal(pruneJournals().files, 0);
  const next = new OpJournal("t3:artificer", "exp5:1", "exp4");
  assert.equal(next.priorOf(next.opId("bash", { command: "git push" }))?.done?.result, "pushed");
  // Once the run that picked it up has ended, there's nothing left to pick up.
  next.begin(); next.end();
  aged(journalOf("t3:artificer"), OLD);
  assert.equal(pruneJournals().files, 1);
});

test("journals: a run that broke off before changing anything leaves nothing to keep; a run still going is never touched", () => {
  ran("t4:scribe", "exp6:1", "broke off", false);
  const going = ran("t5:scribe", "exp7:1", "going", false);
  mkdirSync(OPS_DIR, { recursive: true });
  writeFileSync(`${OPS_DIR}/notes.txt`, "not a journal");
  writeFileSync(journalOf("t6:warden"), '{"kind":"run_start","run":"exp8:1","at":1}\n{"kind":"started","run":"exp8:1","op":"op_1","tool":"bash","at":2}\n{"kind":"do'); // died mid-line, mid-change
  for (const f of readdirSync(OPS_DIR)) aged(`${OPS_DIR}/${f}`, OLD);
  assert.equal(pruneJournals().files, 1);
  assert.deepEqual(readdirSync(OPS_DIR).sort(), ["notes.txt", "t5_scribe.jsonl", "t6_warden.jsonl"]);
  going.end();
  aged(journalOf("t5:scribe"), OLD);
  assert.equal(pruneJournals().files, 1);
  assert.equal(existsSync(journalOf("t6:warden")), true);
});

test("journals: they're looked for as a run begins, without being asked", () => {
  elsewhere(() => {
    assert.deepEqual(pruneJournals(), { files: 0, bytes: 0 }); // no camp/ops yet
    mkdirSync(OPS_DIR, { recursive: true });
    writeFileSync(journalOf("old:scout"), '{"kind":"run_start","run":"e1:1","at":1}\n{"kind":"run_end","run":"e1:1","at":2}\n');
    writeFileSync(journalOf("open:scout"), '{"kind":"run_start","run":"e2:1","at":1}\n{"kind":"done","run":"e2:1","op":"op_1","tool":"bash","at":2,"result":"x"}\n');
    aged(journalOf("old:scout"), OLD);
    aged(journalOf("open:scout"), OLD);
    ran("new:scout", "e3:1", "ended");
    assert.deepEqual(readdirSync(OPS_DIR).sort(), ["new_scout.jsonl", "open_scout.jsonl"]);
  });
});

// ---------- The routing log ----------

const outcome = (n: number | string, more: object = {}) => ({ task: `task-${n}`, run: `run-${n}`, agent: "scout", mode: "auto:balanced", status: "done", ok: true, seconds: 1, usd: 0.01, switches: 0, routes: [], ...more });
const decision = (task: string, selected?: string, agent = "scout") => JSON.stringify({ kind: "decision", at: "2026-11-19T00:00:00.000Z", task, run: `${task}:1`, agent, mode: "auto:balanced", ...(selected ? { selected } : { unavailable: "none" }) });
const logLines = () => readFileSync(auto.ROUTING_LOG, "utf8").split("\n").filter(Boolean);

test("routing log: a line torn by a crash is closed off, and what's kept follows the file", () => {
  // (First, so this is the first line this process adds to the log: that's when a torn end is looked for.)
  writeFileSync(auto.ROUTING_LOG, JSON.stringify({ kind: "outcome", at: "x", ...outcome(0) }) + '\n{"kind":"outc');
  assert.deepEqual(auto.routingLog().map((r) => r.run), ["run-0"]);
  auto.logOutcome(outcome(1));
  assert.deepEqual(auto.routingLog().map((r) => r.run), ["run-0", "run-1"]);
  const ino = statSync(auto.ROUTING_LOG).ino;
  auto.logOutcome(outcome(2));
  assert.deepEqual(auto.routingLog().map((r) => r.run), ["run-0", "run-1", "run-2"]);
  assert.equal(statSync(auto.ROUTING_LOG).ino, ino, "added to, not written afresh");
  assert.equal(logLines().length, 4);
  // What a caller is handed is its own list.
  auto.routingLog().length = 0;
  assert.equal(auto.routingLog().length, 3);
  // A line from another camp process is seen, and so is the next one from here.
  appendFileSync(auto.ROUTING_LOG, JSON.stringify({ kind: "outcome", at: "x", ...outcome("other") }) + "\n");
  assert.equal(auto.routingLog().at(-1)!.run, "run-other");
  auto.logOutcome(outcome(3));
  assert.deepEqual(auto.routingLog().slice(-2).map((r) => r.run), ["run-other", "run-3"]);
});

test("routing log: read once, and again only when the file has changed", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const one = (run: string) => JSON.stringify({ kind: "outcome", at: "x", ...outcome(1, { run }) }) + "\n";
  writeFileSync(auto.ROUTING_LOG, one("aaa"));
  utimesSync(auto.ROUTING_LOG, at, at);
  assert.equal(auto.routingLog()[0].run, "aaa");
  writeFileSync(auto.ROUTING_LOG, one("bbb")); // in place, same length, same time: not read (see the settings test)
  utimesSync(auto.ROUTING_LOG, at, at);
  assert.equal(auto.routingLog()[0].run, "aaa");
  writeFileSync(auto.ROUTING_LOG, one("cccc"));
  assert.equal(auto.routingLog()[0].run, "cccc");
  elsewhere(() => assert.deepEqual(auto.routingLog(), [])); // another camp's log is another log
  assert.equal(auto.routingLog()[0].run, "cccc");
});

test("routing log: the route a task was last on", () => {
  writeFileSync(auto.ROUTING_LOG, [decision("t:scout", "sonnet@medium"), decision("t:scout", "opus@high"), decision("t:scout"), decision("t:scout", "haiku@low", "scribe"), decision("u:scout", "sonnet@low")].join("\n") + "\n");
  assert.equal(auto.lastRouteOf("t:scout", "scout"), "opus@high"); // the last one that chose a route
  assert.equal(auto.lastRouteOf("t:scout", "scribe"), "haiku@low");
  assert.equal(auto.lastRouteOf("v:scout", "scout"), undefined);
  auto.logOutcome(outcome(9));
  appendFileSync(auto.ROUTING_LOG, decision("t:scout", "sonnet@high") + "\n");
  assert.equal(auto.lastRouteOf("t:scout", "scout"), "sonnet@high");
});

test("routing log: it keeps its newest records, cut back in one go and not on every line", () => {
  const full = auto.ROUTING_MAX + 500;
  writeFileSync(auto.ROUTING_LOG, Array.from({ length: full - 1 }, (_, i) => JSON.stringify({ kind: "outcome", at: "x", ...outcome(i) })).join("\n") + "\n");
  const ino = statSync(auto.ROUTING_LOG).ino;
  auto.logOutcome(outcome("brim"));
  assert.equal(logLines().length, full);
  assert.equal(statSync(auto.ROUTING_LOG).ino, ino, "not yet: there's slack");
  auto.logOutcome(outcome("over", { mode: "manual" }));
  const lines = logLines().map((l) => JSON.parse(l));
  assert.equal(lines.length, auto.ROUTING_MAX);
  assert.deepEqual([lines[0].run, lines.at(-2).run, lines.at(-1).run], ["run-501", "run-brim", "run-over"]);
  assert.deepEqual(auto.routingLog().map((r) => r.run), lines.map((r) => r.run));
  // The comparison is over what's kept.
  const report = auto.routingReport();
  assert.equal(report.arms.reduce((n, a) => n + a.tasks, 0), auto.ROUTING_MAX);
  // And it goes on being added to from there.
  auto.logOutcome(outcome("after"));
  assert.equal(logLines().length, auto.ROUTING_MAX + 1);
  assert.equal(auto.routingLog().at(-1)!.run, "run-after");
});
