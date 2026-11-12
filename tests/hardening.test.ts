// The safety and reliability pieces: secrets and the camp's own code stay protected, long files
// read in pieces, shell commands don't block and can be stopped, every expedition can be diffed
// and undone, parallel quests can't overwrite each other, the camp pauses at a plan limit,
// follow-ups carry the conversation, the feed survives a restart, and only one process runs jobs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { enterSandbox, REPO } from "./helpers/sandbox.ts";

enterSandbox("hardening");
mkdirSync("sub", { recursive: true });
mkdirSync("camp", { recursive: true });
writeFileSync("sub/.env", "SECRET=1\n");
writeFileSync("sub/id_rsa", "key\n");
writeFileSync("camp/mcp.json", '{"servers":{}}\n');
writeFileSync("notes.txt", "one\ntwo\nthree\n");

const { campPath, pageOf, runShell, writeFileFor, readFileFor, clipOutput, MAX_TOOL_OUTPUT, rl } = await import("../src/tools.ts");
const { editFileFor } = await import("../src/codetools.ts");
const { isAutoApproved } = await import("../src/shell.ts");
const { allowShellCommand } = await import("../src/settings.ts");
const { addLink } = await import("../src/links.ts");
const { withExpedition, withQuest } = await import("../src/context.ts");
const { changedFiles, checkpointDiff, undoCheckpoint } = await import("../src/checkpoints.ts");
const limits = await import("../src/limits.ts");
const { recordTurn, threadFor, latestDirect } = await import("../src/threads.ts");
const { loadFeed, FEED_PATH } = await import("../src/feed.ts");
const { parseReply } = await import("../src/phone.ts");
const { claimScheduler, releaseScheduler, SCHEDULER_LOCK, dueJobs } = await import("../src/scheduler.ts");
const { saveJobs } = await import("../src/jobs.ts");
after(() => rl.close());

const allowed = (path: string, mode: "read" | "write", self = "artificer") => {
  try { campPath(path, mode, self); return true; } catch { return false; }
};

test("secrets are off limits at any depth, and so is the camp's private configuration", () => {
  assert.ok(!allowed("sub/.env", "read"));
  assert.ok(!allowed("sub/id_rsa", "read"));
  assert.ok(!allowed("camp/mcp.json", "read"), "connector tokens live here");
  assert.ok(!allowed("camp/settings.json", "read"));
  assert.ok(allowed("notes.txt", "read"));
});

test("the camp's own code can't be edited, even through an editable link", () => {
  const link = addLink(REPO, "write");
  assert.ok(!allowed(`links/${link.name}/src/shell.ts`, "write"), "the shell rules");
  assert.ok(!allowed(`links/${link.name}/package.json`, "write"));
  assert.ok(allowed(`links/${link.name}/src/shell.ts`, "read"), "reading it is fine");
  assert.ok(allowed(`links/${link.name}/docs/new.md`, "write"), "the rest of an editable link still is");
  assert.ok(allowed("src/x.ts", "write"), "a project's own src/ is not the camp's code");
});

test("the Scout writes only to its own outputs folder", async () => {
  const write = writeFileFor("scout", { outputsOnly: true }).run!;
  assert.match(String(await write({ path: "planted.js", content: "x" })), /only write inside camp\/agents\/scout\/outputs/);
  assert.ok(!existsSync("planted.js"));
  assert.match(String(await write({ path: "camp/agents/scout/outputs/findings.md", content: "ok" })), /^Wrote/);
});

test("long files come back in pieces that can be continued", async () => {
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join("\n");
  const first = pageOf(big);
  assert.match(first, /\[Lines 1–2000 of 5000\. Continue with offset=2001\.\]$/);
  const last = pageOf(big, 4001);
  assert.ok(last.startsWith("line 4001\n"));
  assert.match(last, /That's the end of the file\.\]$/);
  assert.equal(pageOf("one\ntwo"), "one\ntwo", "short files come back as they are");
  assert.ok(pageOf("x".repeat(200_000)).length < MAX_TOOL_OUTPUT, "one enormous line is cut, not dropped");
  assert.equal(await readFileFor("scribe").run!({ path: "notes.txt", offset: 2, limit: 1 }), "two\n\n[Lines 2–2 of 4. Continue with offset=3.]");
  assert.ok(String(clipOutput("y".repeat(MAX_TOOL_OUTPUT + 10))).includes("[cut at"));
});

test("shell commands don't block the camp, and Stop ends them", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  assert.equal(await runShell("sleep 0.3; echo done"), "done");
  clearInterval(timer);
  assert.ok(ticks >= 5, `the event loop kept running (${ticks} ticks)`);
  assert.match(await runShell("echo out; exit 3"), /^Exit code 3\nout$/);
  const stop = new AbortController();
  const t0 = Date.now();
  setTimeout(() => stop.abort(), 100);
  assert.match(await runShell("sleep 30", stop.signal), /^Stopped by the user/);
  assert.ok(Date.now() - t0 < 5000);
  assert.match(await runShell("sleep 30", undefined, 150), /^Stopped after/);
});

test("\"always allow\" covers that exact command only", () => {
  assert.ok(!isAutoApproved("npm test -- --grep x | tail"));
  allowShellCommand("npm test -- --grep x | tail");
  assert.ok(isAutoApproved("npm test -- --grep x | tail"));
  assert.ok(!isAutoApproved("npm test -- --grep x | tail; rm -rf ."));
});

test("checkpoints: an expedition's changes can be listed, diffed, and undone", async () => {
  writeFileSync("app.txt", "hello\nworld\n");
  const id = "exp-checkpoint-1";
  await withExpedition({ id }, async () => {
    await editFileFor("artificer").run!({ path: "app.txt", old_string: "world", new_string: "camp" });
    await writeFileFor("artificer").run!({ path: "fresh.txt", content: "new file\n" });
    await editFileFor("artificer").run!({ path: "app.txt", old_string: "hello", new_string: "goodbye" });
  });
  assert.deepEqual(changedFiles(id).sort((a, b) => a.path.localeCompare(b.path)), [{ path: "app.txt", change: "modified" }, { path: "fresh.txt", change: "created" }]);
  const d = checkpointDiff(id);
  assert.match(d.diff, /^--- app\.txt$/m);
  assert.match(d.diff, /^-hello$/m);
  assert.match(d.diff, /^\+goodbye$/m);
  assert.match(d.diff, /^\+new file$/m);
  const r = undoCheckpoint(id);
  assert.equal(r.restored.length, 2);
  assert.equal(readFileSync("app.txt", "utf8"), "hello\nworld\n", "back to how it was before the first change");
  assert.ok(!existsSync("fresh.txt"));
  assert.deepEqual(changedFiles(id), []);
});

test("parallel quests can't overwrite each other's edits", async (t) => {
  // The clock stands still, so every read and write here lands in the same millisecond:
  // the guard has to go by the order things happened in, not by when.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  writeFileSync("shared.txt", "a\n");
  await withExpedition({ id: "exp-collide" }, async () => {
    await withQuest("q1", async () => { await readFileFor("artificer").run!({ path: "shared.txt" }); });
    await withQuest("q2", async () => { await writeFileFor("artificer").run!({ path: "shared.txt", content: "from q2\n" }); });
    await withQuest("q1", async () => {
      await assert.rejects(() => writeFileFor("artificer").run!({ path: "shared.txt", content: "from q1\n" }) as Promise<unknown>, /changed by another quest/);
      await readFileFor("artificer").run!({ path: "shared.txt" });
      assert.match(String(await editFileFor("artificer").run!({ path: "shared.txt", old_string: "from q2", new_string: "from both" })), /^Edited/);
    });
    // And the other way round: q2 wrote the file itself, but q1 has changed it since.
    await withQuest("q2", async () => {
      await assert.rejects(() => writeFileFor("artificer").run!({ path: "shared.txt", content: "q2 again\n" }) as Promise<unknown>, /changed by another quest/);
    });
  });
  assert.equal(readFileSync("shared.txt", "utf8"), "from both\n");
});

test("plan limits: a used-up window pauses the camp until it resets", () => {
  limits.resetLimitsForTests();
  limits.noteRateLimit({ status: "allowed", rateLimitType: "five_hour", utilization: 42, resetsAt: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(limits.pausedUntil(), null);
  assert.equal(limits.planLimits()[0].utilization, 0.42, "percentages and seconds are normalized");
  saveJobs([{ name: "tick", schedule: "every 5m", task: "x", created: new Date(0).toISOString(), enabled: true }]);
  assert.equal(dueJobs().length, 1);
  const reset = Date.now() + 3_600_000;
  limits.noteRateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: reset });
  assert.equal(limits.pausedUntil(), reset);
  assert.match(limits.pauseMessage(reset), /5-hour limit is used up/);
  assert.equal(dueJobs().length, 0, "scheduled jobs wait");
  limits.resumeNow();
  assert.equal(limits.pausedUntil(), null, "\"try anyway\" lifts the pause");
  limits.noteRateLimit({ status: "rejected", rateLimitType: "seven_day", isUsingOverage: true });
  assert.equal(limits.pausedUntil(), null, "running on extra usage isn't a pause");
  limits.resetLimitsForTests();
});

test("plan limits: a window that reset isn't shown as still full, and the plan's own figures are what the meter shows", async () => {
  limits.resetLimitsForTests();
  const five = () => limits.planLimits().find((l) => l.type === "five_hour")!;
  const sec = (ms: number) => Math.floor(ms / 1000);
  const first = Date.now() + 3_600_000, next = first + 5 * 3_600_000;
  // Used up, then the window resets. Later runs say only "allowed", with no figure: the 100% must not be carried over.
  limits.noteRateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: sec(first) });
  assert.equal(five().utilization, 1);
  limits.noteRateLimit({ status: "allowed", rateLimitType: "five_hour", resetsAt: sec(next) });
  assert.deepEqual([five().status, five().utilization], ["allowed", undefined], "a new window: nothing is known about how full it is");
  // Allowed again in the same window (you chose "try anyway", or extra usage kicked in): still not "100% used".
  limits.noteRateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: sec(next) });
  limits.noteRateLimit({ status: "allowed", rateLimitType: "five_hour", resetsAt: sec(next) });
  assert.equal(five().utilization, undefined);
  // A figure that came with an event is kept while the window is the same, and dropped when it isn't.
  limits.noteRateLimit({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.83, resetsAt: sec(next) });
  limits.noteRateLimit({ status: "allowed", rateLimitType: "five_hour", resetsAt: sec(next) });
  assert.equal(five().utilization, 0.83);
  limits.noteRateLimit({ status: "allowed", rateLimitType: "five_hour", resetsAt: sec(next) + 18_000 });
  assert.equal(five().utilization, undefined);

  // The plan's own figures: every window, 0 to 100 as Claude Code gives them, with a weekly limit for one model.
  const { usageWindows } = await import("../src/claude-code.ts");
  const windows = usageWindows({
    five_hour: { utilization: 94, resets_at: "2026-11-12T01:10:00.073671+00:00" },
    seven_day: { utilization: 24, resets_at: "2026-11-12T02:00:00+00:00" },
    seven_day_opus: null, seven_day_sonnet: { utilization: null, resets_at: null },
    model_scoped: [{ display_name: "Fable", utilization: 41, resets_at: "2026-11-12T02:00:00+00:00" }, { display_name: "", utilization: 5 }],
    extra_usage: { utilization: null },
  });
  assert.deepEqual(windows, [
    { type: "five_hour", utilization: 0.94, resetsAt: Date.parse("2026-11-12T01:10:00.073671+00:00") },
    { type: "seven_day", utilization: 0.24, resetsAt: Date.parse("2026-11-12T02:00:00+00:00") },
    { type: "model:Fable", utilization: 0.41, resetsAt: Date.parse("2026-11-12T02:00:00+00:00") }]);
  assert.deepEqual(usageWindows(null), []);
  assert.equal(usageWindows({ five_hour: { utilization: 1, resets_at: null } })[0].utilization, 0.01, "1 means one percent here, not full");

  assert.equal(limits.usageMeasuredAt(), 0);
  const soon = Date.now() + 3_600_000;
  limits.noteUsage(windows.map((w) => ({ ...w, resetsAt: soon })), 5_000);
  const by = Object.fromEntries(limits.planLimits().map((l) => [l.type, [l.status, l.utilization]]));
  assert.deepEqual(by, { five_hour: ["allowed_warning", 0.94], seven_day: ["allowed", 0.24], "model:Fable": ["allowed", 0.41] });
  assert.equal(limits.usageMeasuredAt(), 5_000);
  assert.equal(limits.limitLabel("model:Fable"), "weekly Fable limit");
  assert.equal(limits.pausedUntil(), null, "94% is a warning, not a pause");
  // A run says "allowed" with no figure: the measured one stays, and stays marked as measured.
  limits.noteRateLimit({ status: "allowed", rateLimitType: "five_hour", resetsAt: sec(soon) });
  assert.deepEqual([five().utilization, five().measured], [0.94, 5_000]);
  // Told it's used up, the figures agreeing doesn't lift the pause; figures showing room again does.
  limits.noteRateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: sec(soon) });
  limits.noteUsage([{ type: "five_hour", utilization: 1, resetsAt: five().resetsAt }]);
  assert.equal(five().status, "rejected");
  limits.noteUsage([{ type: "five_hour", utilization: 0.02, resetsAt: soon + 18_000_000 }]);
  assert.deepEqual([five().status, five().utilization], ["allowed", 0.02]);
  assert.equal(limits.pausedUntil(), null);
  limits.resetLimitsForTests();
});

test("follow-ups carry the whole conversation", () => {
  recordTurn({ thread: "e1", expedition: "e1", agent: "scribe", direct: true, task: "Draft a post about tents", reply: "Here is the full draft: " + "tent ".repeat(600), status: "done" });
  recordTurn({ thread: "e1", expedition: "e2", agent: "scribe", direct: true, task: "Make it shorter", reply: "Shorter version.", status: "done" });
  recordTurn({ thread: "e9", expedition: "e9", agent: "quartermaster", direct: false, task: "Unrelated", reply: "Other.", status: "done" });
  const t = threadFor("e2")!;
  assert.equal(t.thread, "e1");
  assert.equal(t.agent, "scribe");
  assert.equal(t.turns, 2);
  assert.ok(t.history.includes("tent ".repeat(600).trim()), "the full earlier answer, not a clipped digest");
  assert.ok(t.history.indexOf("Draft a post") < t.history.indexOf("Make it shorter"));
  assert.ok(!t.history.includes("Unrelated"));
  assert.equal(threadFor("nope"), null);
  assert.equal(latestDirect("scribe"), "e2");
  assert.equal(latestDirect("scout"), undefined);
});

test("the saved feed reloads, with anything left open closed off", () => {
  const ev = (seq: number, body: object) => JSON.stringify({ time: new Date().toISOString(), seq, ...body });
  writeFileSync(FEED_PATH, [
    ev(1, { type: "expedition_start", id: "x1", task: "old", source: "user", expeditionId: "x1" }),
    ev(2, { type: "expedition_end", id: "x1", status: "done", text: "ok", expeditionId: "x1" }),
    ev(3, { type: "expedition_start", id: "x2", task: "cut short", source: "user", expeditionId: "x2" }),
    ev(4, { type: "dispatch", who: "Scout", emoji: "🏹", questId: "q", expeditionId: "x2" }),
    ev(5, { type: "ask", id: "ask_5", kind: "plan", title: "t", body: "b", expeditionId: "x2" }),
    "{ half a line",
  ].join("\n") + "\n");
  const events = loadFeed(800);
  assert.equal(events.length, 8);
  const closing = events.slice(5) as any[];
  assert.deepEqual(closing.map((e) => e.type), ["answered", "return", "expedition_end"]);
  assert.ok(closing[0].lapsed);
  assert.equal(closing[2].status, "interrupted");
  assert.deepEqual(closing.map((e) => e.seq), [6, 7, 8]);
  assert.equal(loadFeed(800).length, 8, "loading again adds nothing");
});

test("phone replies only count with this launch's code", () => {
  assert.deepEqual(parseReply("ab12:ask_7 y", "ab12"), { askId: "ask_7", answer: "y" });
  assert.equal(parseReply("ffff:ask_7 y", "ab12"), null);
  assert.equal(parseReply("ab12:ask_7 rm -rf", "ab12"), null);
});

test("only one process runs scheduled jobs", () => {
  assert.ok(claimScheduler("ui"));
  assert.ok(claimScheduler("ui"), "claiming again is fine");
  writeFileSync(SCHEDULER_LOCK, JSON.stringify({ pid: process.ppid, owner: "watch" }));
  assert.ok(!claimScheduler("ui"), "a live owner keeps it");
  writeFileSync(SCHEDULER_LOCK, JSON.stringify({ pid: 2 ** 22 + 12345, owner: "watch" }));
  assert.ok(claimScheduler("ui"), "a dead owner's lock is taken over");
  releaseScheduler();
  assert.ok(!existsSync(SCHEDULER_LOCK));
});
