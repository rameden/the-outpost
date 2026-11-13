// Cleaning up the camp: what's found, that nothing goes without your yes, and what's never touched.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("housekeeping");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const repo = join(realpathSync.native(mkdtempSync(join(tmpdir(), "satchel-hk-"))), "webapp");
mkdirSync(repo);
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "test@example.com");
git(repo, "config", "user.name", "Test");
writeFileSync(join(repo, "README.md"), "# Web app\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "first");

const { addLink } = await import("../src/links.ts");
const repos = await import("../src/repos.ts");
const hk = await import("../src/housekeeping.ts");
const { saveUpload } = await import("../src/attachments.ts");
const { recordTurn, allTurns } = await import("../src/threads.ts");
const { saveToFeed, FEED_PATH } = await import("../src/feed.ts");
const { writeMemory, fullMemory } = await import("../src/memory.ts");
const { withExpedition } = await import("../src/context.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { quartermasterSpec } = await import("../src/quartermaster.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const link = addLink(repo, "write");
let asks: { kind: string; title: string; body: string }[] = [];
let answer = "y";
setAsker(async (q) => { asks.push({ kind: q.kind, title: q.title, body: q.body }); return answer; });
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { asks = []; answer = "y"; events.length = 0; });

const tool = (input: object) => hk.housekeeping.run!(input).then(String);
const DAY = 86_400_000;
const aged = (path: string, days: number) => { const t = new Date(Date.now() - days * DAY); utimesSync(path, t, t); };

test("a clean camp has nothing to clean, and the Quartermaster carries the tool", async () => {
  assert.deepEqual(await hk.findings(), []);
  assert.match(await tool({ action: "report" }), /^Nothing to clean up/);
  assert.match(await tool({ action: "clean", step: "uploads" }), /Nothing to clean for "uploads"/);
  assert.equal(asks.length, 0, "nothing to approve, so nothing is asked");
  assert.ok(quartermasterSpec().tools.some((t) => "name" in t.def && t.def.name === "housekeeping"));
});

// Everything the camp piles up, set up once for the tests below.
let landed: string, landedBranch: string, dirty: string, unmerged: string, inUse: string;
test("the report lists every step with something to clean, with what's given up, and changes nothing", async () => {
  // An unused upload from last month.
  const up = saveUpload({ name: "old-shot.png", data: Buffer.alloc(5000, 1).toString("base64"), batch: "2026-01-02-bbbbbb" });
  aged(up.path, 40); aged(join("camp", "uploads", "2026-01-02-bbbbbb"), 40);
  // Worktrees the camp made: one merged, one with unmerged commits, one with uncommitted work, one a run is still in.
  const made = async (task: string) => Object.values(await repos.prepareWorkspaces({ [link.name]: { mode: "new" } }, task, task))[0];
  const a = await made("landed work"), b = await made("unmerged work"), c = await made("dirty work"), d = await made("busy work");
  [landed, unmerged, dirty, inUse] = [a.path, b.path, c.path, d.path];
  landedBranch = a.branch;
  writeFileSync(join(a.path, "a.txt"), "a"); git(a.path, "add", "-A"); git(a.path, "commit", "-qm", "a"); git(repo, "merge", "-q", a.branch);
  writeFileSync(join(b.path, "b.txt"), "b"); git(b.path, "add", "-A"); git(b.path, "commit", "-qm", "b");
  writeFileSync(join(c.path, "c.txt"), "not committed");
  recordTurn({ thread: "t-busy", expedition: "run-busy", agent: "artificer", direct: true, task: "busy", reply: "", status: "running", workspaces: { [link.name]: d } });
  // A damaged copy, a leftover from a crash (old) and one from a write that's happening now (fresh).
  writeFileSync("camp/settings.json.damaged-2026-01-05T10-00-00-000Z", '{"shell": {"deny": [');
  writeFileSync("camp/jobs.json.tmp-4242-ab12cd", "half"); aged("camp/jobs.json.tmp-4242-ab12cd", 2);
  writeFileSync("camp/settings.json.tmp-4243-ef34ab", "being written now");
  // A conversation record with dead lines: each run's "started" line, superseded by its ending.
  for (let i = 0; i < 25; i++) {
    recordTurn({ thread: `t${i}`, expedition: `r${i}`, agent: "scout", direct: true, task: `ask ${i}`, reply: "", status: "running" });
    recordTurn({ thread: `t${i}`, expedition: `r${i}`, agent: "scout", direct: true, task: `ask ${i}`, reply: `answer ${i}`, status: "done" });
  }
  // A memory that's nearly full: mentioned, never cleaned here.
  writeMemory("scribe", Array.from({ length: 50 }, (_, i) => `- 2026-02-01 Lesson ${i} ${"x".repeat(80)}`).join("\n"));

  const before = { threads: readFileSync("camp/threads.jsonl", "utf8"), memory: fullMemory("scribe") };
  const found = await hk.findings();
  assert.deepEqual(found.map((f) => f.step), ["uploads", "worktrees", "damaged", "leftovers", "threads"]);
  const by = Object.fromEntries(found.map((f) => [f.step, f]));
  assert.equal(by.uploads.count, 1); assert.equal(by.uploads.bytes, 5000);
  assert.equal(by.worktrees.count, 1, "only the worktree whose work has landed and that's clean and idle");
  assert.match(by.worktrees.items[0], /already in main/);
  assert.equal(by.damaged.count, 1);
  assert.equal(by.leftovers.count, 1, "a temp file from a write happening now is left alone");
  assert.equal(by.threads.count, 25);

  const report = await tool({ action: "report" });
  assert.match(report, /^5 things could be cleaned up \(nothing has been changed\)/);
  assert.match(report, /uploads: delete 1 uploaded file nothing uses any more \(frees about 5 KB\)/);
  assert.match(report, /What's given up: Deleted for good/);
  assert.match(report, /Worth knowing[\s\S]*Memory nearly full: Scribe/);
  // Looking changed nothing.
  assert.equal(asks.length, 0);
  assert.ok(existsSync(up.path) && existsSync(landed) && existsSync("camp/jobs.json.tmp-4242-ab12cd"));
  assert.equal(readFileSync("camp/threads.jsonl", "utf8"), before.threads);
});

test("each step waits for your yes, shows exactly what goes, and a no leaves everything as it was", async () => {
  answer = "n";
  assert.match(await tool({ action: "clean", step: "uploads" }), /The user declined to delete 1 uploaded file/);
  assert.ok(existsSync("camp/uploads/2026-01-02-bbbbbb/old-shot.png"));
  assert.deepEqual(asks.map((a) => a.kind), ["tool"]);
  assert.match(asks[0].title, /^🧹 Clean up: delete 1 uploaded file nothing uses any more\?$/);
  assert.match(asks[0].body, /camp\/uploads\/2026-01-02-bbbbbb\/ \(1 file, 5 KB/);
  assert.match(asks[0].body, /Deleted for good/);
  answer = ""; // an empty answer isn't a yes either
  assert.match(await tool({ action: "clean", step: "damaged" }), /declined/);
  assert.ok(existsSync("camp/settings.json.damaged-2026-01-05T10-00-00-000Z"));

  // A scheduled job has nobody to approve: it can look, not clean.
  asks = [];
  await withExpedition({ id: "job-run", unattended: true }, async () => {
    assert.match(await tool({ action: "clean", step: "uploads" }), /Not done: this is a scheduled job/);
    assert.match(await tool({ action: "report" }), /5 things could be cleaned up/);
  });
  assert.equal(asks.length, 0);
  assert.match(await tool({ action: "clean", step: "everything" }), /Give the step to clean: one of uploads, worktrees/);
  assert.match(await tool({ action: "purge" }), /Unknown action/);
});

test("with your yes each step does its one thing: what's in use, unmerged, uncommitted or being written stays", async () => {
  answer = "y";
  assert.equal(await tool({ action: "clean", step: "uploads" }), "Deleted 1 uploaded file (5 KB).");
  assert.ok(!existsSync("camp/uploads/2026-01-02-bbbbbb"));

  assert.equal(await tool({ action: "clean", step: "worktrees" }), `Removed 1 worktree: ${landedBranch} (links/webapp). Their branches are still there.`);
  assert.ok(!existsSync(landed), "the finished one is gone");
  assert.ok(existsSync(unmerged) && existsSync(dirty) && existsSync(inUse), "work that hasn't landed, isn't committed, or is still going is left alone");
  assert.ok(git(repo, "branch", "--list", landedBranch).includes(landedBranch), "the branch stays");
  assert.ok(existsSync(repo) && existsSync(join(repo, "a.txt")), "the linked folder itself is never touched");

  assert.equal(await tool({ action: "clean", step: "damaged" }), "Deleted 1 file (20 B).");
  assert.equal(await tool({ action: "clean", step: "leftovers" }), "Deleted 1 file (4 B).");
  assert.ok(existsSync("camp/settings.json.tmp-4243-ef34ab"), "the fresh temp file was left");

  const turns = allTurns().map((t) => `${t.expedition}:${t.status}:${t.reply}`);
  assert.equal(await tool({ action: "clean", step: "threads" }), "Dropped 25 lines from the conversation record.");
  assert.deepEqual(allTurns().map((t) => `${t.expedition}:${t.status}:${t.reply}`), turns, "every conversation reads exactly as it did");
  assert.ok(allTurns().some((t) => t.expedition === "run-busy" && t.status === "running"), "a run still going keeps its line");

  assert.equal(asks.length, 5, "one approval per step");
  assert.equal(events.filter((e) => e.type === "notice" && e.who === "Housekeeping").length, 5, "and the feed says what was done");
  // Nothing left, and what it never touches is as it was.
  assert.deepEqual(await hk.findings(), []);
  assert.ok(fullMemory("scribe").length > 4000);
});

test("a large feed is offered for trimming, with where the cut falls; a small one never is", async () => {
  assert.equal((await hk.findings("feed")).length, 0);
  for (let i = 1; i <= 60; i++) saveToFeed({ type: "notice", who: "Camp", emoji: "🏕️", depth: 0, text: "x".repeat(200_000), seq: i, time: `2026-0${i <= 30 ? 1 : 2}-10T00:00:00Z` } as any);
  const [f] = await hk.findings("feed");
  assert.match(f.title, /trim the feed file to its newer half \(it's 1\d\.\d MB\)/);
  assert.match(f.lost, /Conversations from before 2026-02-10 keep their question and final answer/);
  answer = "n";
  await tool({ action: "clean", step: "feed" });
  assert.equal(readFileSync(FEED_PATH, "utf8").split("\n").filter(Boolean).length, 60);
  answer = "y";
  assert.match(await tool({ action: "clean", step: "feed" }), /^Trimmed the feed file from 1\d\.\d MB to \d\.\d MB\.$/);
  assert.deepEqual(readFileSync(FEED_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).seq), Array.from({ length: 30 }, (_, i) => i + 31));
});
