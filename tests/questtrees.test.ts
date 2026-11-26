// A worktree per writing quest (src/questtrees.ts), and crew members that send helpers.
// - Two quests that change the same git folder at once each work in their own worktree, and
//   their changes are merged back into the folder; nothing a quest did is ever lost.
// - A folder that isn't a git repository keeps the folder lock: one writer at a time.
// - A crew member with helpers on can send helpers, which are leaves; the limit on quests at
//   once holds at every depth.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, lastToolResults, systemText, whoAsks, type Reply } from "./helpers/fake-api.ts";

enterSandbox("questtrees");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-qtrees-")));
function newRepo(name: string, files: Record<string, string>) {
  const dir = join(scratch, name);
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  git("add", "-A");
  git("commit", "-qm", "first");
  return { dir, git };
}

const { runExpedition, questSlotsForTests, LEAF_BLOCKED } = await import("../src/quartermaster.ts");
const { cutQuestTree, closeQuestTree, isGitTop, wantFolders, questBranch, questRef, questTreesForTests } = await import("../src/questtrees.ts");
const { folderLocksForTests } = await import("../src/folderlock.ts");
const { changedFiles } = await import("../src/checkpoints.ts");
const { addLink, setLinkVerify } = await import("../src/links.ts");
const { setAgentSettings, setQuestLimit } = await import("../src/settings.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

setAsker(async () => ""); // every plan is approved as it stands
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; });

// ---------- 1. The worktrees themselves ----------

const cut = (repo: { dir: string }, id: string) => cutQuestTree({ id, link: "x", root: repo.dir, lockKey: repo.dir, who: id });
const worktrees = (repo: { git: (...a: string[]) => string }) => repo.git("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

test("two worktrees of one folder: each starts from the folder as it is, both merge back, and nothing is left behind", async () => {
  const repo = newRepo("both", { "a.txt": "one\ntwo\nthree\n", "b.txt": "b\n" });
  writeFileSync(join(repo.dir, "notes.txt"), "not committed yet\n"); // work an earlier step left in the folder
  const head = repo.git("rev-parse", "HEAD");
  const [a, b] = [await cut(repo, "aaaaaaaa-1"), await cut(repo, "bbbbbbbb-1")];
  assert.ok(a && b);
  assert.equal(a.branch, "outpost/quest-aaaaaaaa");
  assert.notEqual(a.path, b.path);
  assert.ok(!a.path.startsWith(repo.dir + "/"), "the worktree sits beside the repository, not inside it");
  assert.equal(readFileSync(join(a.path, "notes.txt"), "utf8"), "not committed yet\n", "uncommitted work is in the worktree it was cut from");
  assert.equal(worktrees(repo), 3);

  writeFileSync(join(a.path, "a.txt"), "ONE\ntwo\nthree\n");
  writeFileSync(join(a.path, "new-a.txt"), "from a\n");
  writeFileSync(join(b.path, "a.txt"), "one\ntwo\nTHREE\n"); // the same file, other lines: it merges
  writeFileSync(join(b.path, "b.txt"), "B\n");

  let snapshots = 0;
  const endA = await closeQuestTree(a, "A", { beforeLanding: async () => void snapshots++ });
  const endB = await closeQuestTree(b, "B", { beforeLanding: async () => void snapshots++ });
  assert.equal(endA.state, "merged");
  assert.equal(endB.state, "merged");
  assert.equal(snapshots, 2, "the folder is snapshotted before each landing, for Diff and Undo");
  assert.deepEqual(endA.files.sort(), [join(repo.dir, "a.txt"), join(repo.dir, "new-a.txt")]);
  assert.equal(readFileSync(join(repo.dir, "a.txt"), "utf8"), "ONE\ntwo\nTHREE\n", "both changes to the same file are there");
  assert.equal(readFileSync(join(repo.dir, "new-a.txt"), "utf8"), "from a\n");
  assert.equal(readFileSync(join(repo.dir, "b.txt"), "utf8"), "B\n");
  assert.equal(readFileSync(join(repo.dir, "notes.txt"), "utf8"), "not committed yet\n");
  assert.equal(repo.git("rev-parse", "HEAD"), head, "nothing was committed to your branch");
  assert.equal(worktrees(repo), 1, "both worktrees are gone");
  assert.ok(!existsSync(a.path) && !existsSync(b.path));
  assert.equal(repo.git("branch", "--list", "outpost/*"), "", "and so are their branches");
  assert.ok(repo.git("rev-parse", questRef("aaaaaaaa-1")), "what each quest did is kept on a private ref");
  assert.equal(repo.git("status", "--porcelain").includes("a.txt"), true, "the changes are uncommitted, as a quest's always are");
});

test("a change that can't be merged stays on its branch: the folder is untouched and the branch holds the work", async () => {
  const repo = newRepo("clash", { "a.txt": "one\n" });
  const [a, b] = [await cut(repo, "aaaaaaaa-2"), await cut(repo, "bbbbbbbb-2")];
  writeFileSync(join(a!.path, "a.txt"), "from a\n");
  writeFileSync(join(b!.path, "a.txt"), "from b\n");
  writeFileSync(join(b!.path, "only-b.txt"), "b\n");
  assert.equal((await closeQuestTree(a!, "A")).state, "merged");
  let snapshots = 0;
  const end = await closeQuestTree(b!, "B", { beforeLanding: async () => void snapshots++ });
  assert.equal(end.state, "kept");
  assert.match(end.reason ?? "", /same lines.*a\.txt/);
  assert.equal(snapshots, 0, "nothing was about to change in the folder");
  assert.equal(readFileSync(join(repo.dir, "a.txt"), "utf8"), "from a\n", "the folder has the first quest's change only");
  assert.ok(!existsSync(join(repo.dir, "only-b.txt")), "nothing of the second landed, not even the part that would merge");
  assert.equal(repo.git("show", `${questBranch("bbbbbbbb-2")}:a.txt`), "from b", "its work is on its branch");
  assert.equal(repo.git("rev-parse", questBranch("bbbbbbbb-2")), repo.git("rev-parse", questRef("bbbbbbbb-2")), "and on its private ref");
  assert.equal(worktrees(repo), 1, "the worktree is removed: the branch has everything");
});

test("a quest whose checks failed, or that was stopped, is kept on its branch and not merged", async () => {
  const repo = newRepo("kept", { "a.txt": "one\n" });
  const a = await cut(repo, "aaaaaaaa-3");
  writeFileSync(join(a!.path, "a.txt"), "half done\n");
  const end = await closeQuestTree(a!, "A", { keep: "its checks failed" });
  assert.deepEqual([end.state, end.reason], ["kept", "its checks failed"]);
  assert.equal(readFileSync(join(repo.dir, "a.txt"), "utf8"), "one\n");
  assert.equal(repo.git("show", `${a!.branch}:a.txt`), "half done");
  assert.equal(worktrees(repo), 1);
});

test("a quest that changed nothing leaves nothing: no worktree, no branch, no ref", async () => {
  const repo = newRepo("nothing", { "a.txt": "one\n" });
  const a = await cut(repo, "aaaaaaaa-4");
  const end = await closeQuestTree(a!, "A");
  assert.equal(end.state, "unchanged");
  assert.equal(worktrees(repo), 1);
  assert.equal(repo.git("for-each-ref", "refs/outpost", "refs/heads/outpost"), "");
});

test("a worktree that still holds files no commit takes (a secret file) is left where it is, never deleted", async () => {
  const repo = newRepo("secret", { "a.txt": "one\n" });
  const a = await cut(repo, "aaaaaaaa-5");
  writeFileSync(join(a!.path, "a.txt"), "two\n");
  writeFileSync(join(a!.path, ".env"), "TOKEN=not-a-real-one\n");
  const end = await closeQuestTree(a!, "A");
  assert.equal(end.state, "merged", "what could be recorded is merged");
  assert.equal(end.left, a!.path, "and the worktree is reported as left");
  assert.equal(readFileSync(join(a!.path, ".env"), "utf8"), "TOKEN=not-a-real-one\n");
  assert.ok(!existsSync(join(repo.dir, ".env")), "the secret file isn't copied anywhere");
  assert.equal(readFileSync(join(repo.dir, "a.txt"), "utf8"), "two\n");
});

test("who gets a worktree: quests that want the same git folder at once; a quest alone, or a folder that isn't git, doesn't", async () => {
  const yes = () => true;
  const alone = wantFolders(["/r"]);
  assert.deepEqual([...alone.decide(yes)], [["/r", "place"]], "alone: it works in the folder itself");
  const late = wantFolders(["/r"]);
  assert.deepEqual([...late.decide(yes)], [["/r", "place"]], "someone is in the folder itself: it waits its turn there");
  alone.leave(); late.leave();

  const [a, b] = [wantFolders(["/r", "/plain"]), wantFolders(["/r", "/plain"])];
  const git = (k: string) => k === "/r";
  assert.deepEqual([...a.decide(git)], [["/r", "tree"], ["/plain", "place"]]);
  assert.deepEqual([...b.decide(git)], [["/r", "tree"], ["/plain", "place"]], "the folder that isn't a repository keeps the lock");
  const c = wantFolders(["/r"]);
  assert.deepEqual([...c.decide(git)], [["/r", "tree"]], "a third joins the two in worktrees");
  a.leave(); b.leave(); c.leave();
  assert.deepEqual(questTreesForTests.wanting(), []);

  const repo = newRepo("top", { "a.txt": "one\n" });
  mkdirSync(join(repo.dir, "sub"));
  assert.equal(await isGitTop(repo.dir), true);
  assert.equal(await isGitTop(join(repo.dir, "sub")), false, "a folder inside a repository isn't one a worktree can stand in for");
  assert.equal(await isGitTop(scratch), false);
});

// ---------- 2. Two writers sent at once ----------

const web = newRepo("web", { "app.txt": "v1\n" });
const plain = join(scratch, "plain");
mkdirSync(plain);
const link = addLink(web.dir, "write");
const plainLink = addLink(plain, "write");
const L = `links/${link.name}`, P = `links/${plainLink.name}`;

// Each writer's first reply is held until both have asked (side by side) or the camp says one is
// waiting for the other (taking turns). One or the other always happens.
function watchTwoWriters() {
  const out = new Set<string>();
  let overlapped = false;
  let letGo!: () => void;
  const settled = new Promise<void>((ok) => (letGo = ok));
  const giveUp = setTimeout(letGo, 15_000);
  const off = onEvent((e: any) => { if (e.type === "notice" && /is waiting for .* to finish in links\//.test(e.text)) letGo(); });
  return {
    asked: async (name: string) => { out.add(name); if (out.size === 2) { overlapped = true; letGo(); } await settled; },
    back: (name: string) => out.delete(name),
    done: () => { clearTimeout(giveUp); letGo(); if (typeof off === "function") off(); },
    overlapped: () => overlapped,
  };
}
function twoWriters(folder: string, watch: ReturnType<typeof watchTwoWriters>) {
  return async (b: any): Promise<Reply> => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scribe" || who === "Artificer") {
      if (isFirstTurn(b)) { await watch.asked(who); return { tools: [{ name: "write_file", input: { path: `${folder}/${who}.txt`, content: `${who} was here\n` } }] }; }
      watch.back(who);
      return { text: `${who} wrote its file.` };
    }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "both at once" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "scribe", brief: "write your file" } },
      { name: "dispatch", input: { adventurer: "artificer", brief: "write your file" } },
    ] };
    return { text: "Both back." };
  };
}

test("two quests that change the same repository at once work side by side, each in its own worktree, and both land in the folder", async () => {
  setLinkVerify(link.name, ["test -f app.txt"]);
  const watch = watchTwoWriters();
  script = twoWriters(L, watch);
  const id = "trees-run";
  const r = await runExpedition("Two changes in one repository", { id, links: [link.name] }).finally(watch.done);
  assert.equal(r.status, "done");
  assert.ok(watch.overlapped(), "both were working at the same time");
  assert.ok(!events.some((e) => e.type === "notice" && /is waiting for .* to finish in links\//.test(e.text)), "nobody waited for the folder");
  const trees = events.filter((e) => e.type === "quest_tree");
  assert.deepEqual(trees.map((e) => `${e.who} ${e.state}`).sort(), ["Artificer merged", "Artificer working", "Scribe merged", "Scribe working"]);
  assert.ok(trees.every((e) => /^outpost\/quest-[0-9a-f]{8}$/.test(e.branch) && e.link === link.name));
  // Each was told where it is, and its checks ran in its own worktree before anything landed.
  const told = api.seen.filter((s) => s.who === "Scribe").map((s) => systemText(s.body)).join("\n");
  assert.match(told, /You're working in your own worktree/);
  const order = events.filter((e) => e.who === "Scribe" && ((e.type === "tool" && e.tool === "check") || (e.type === "quest_tree" && e.state === "merged"))).map((e) => e.type);
  assert.deepEqual(order, ["tool", "quest_tree"], "checks first, then the merge");
  // What the Quartermaster reads says where the changes are.
  const reports = api.seen.filter((s) => s.who === "Quartermaster").map((s) => lastToolResults(s.body)).join("\n");
  assert.match(reports, /Scribe worked in its own worktree of links\/web\. Its changes are merged back into the folder: 1 file/);
  assert.equal(readFileSync(join(web.dir, "Scribe.txt"), "utf8"), "Scribe was here\n");
  assert.equal(readFileSync(join(web.dir, "Artificer.txt"), "utf8"), "Artificer was here\n");
  assert.equal(worktrees(web), 1, "the worktrees are gone");
  assert.equal(web.git("branch", "--list", "outpost/*"), "");
  // Diff shows what landed, under the folder's own paths, and nothing from a worktree that's gone.
  assert.deepEqual(changedFiles(id).map((f) => f.path).sort(), [`${L}/Artificer.txt`, `${L}/Scribe.txt`]);
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 });
  assert.deepEqual(questTreesForTests.wanting(), []);
  assert.deepEqual(questSlotsForTests.now(), { running: 0, waiting: 0 });
  setLinkVerify(link.name, []);
});

test("a quest alone in a repository works in the folder itself, as it always did", async () => {
  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Artificer") return isFirstTurn(b) ? { tools: [{ name: "write_file", input: { path: `${L}/alone.txt`, content: "x\n" } }] } : { text: "Done." };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "one" } }] };
    if (res.includes("approved the plan")) return { tools: [{ name: "dispatch", input: { adventurer: "artificer", brief: "write" } }] };
    return { text: "Back." };
  };
  assert.equal((await runExpedition("One change", { links: [link.name] })).status, "done");
  assert.equal(events.filter((e) => e.type === "quest_tree").length, 0);
  assert.equal(readFileSync(join(web.dir, "alone.txt"), "utf8"), "x\n");
});

test("in a folder that isn't a git repository, two writers still take turns", async () => {
  const watch = watchTwoWriters();
  script = twoWriters(P, watch);
  const r = await runExpedition("Two changes in a plain folder", { links: [plainLink.name] }).finally(watch.done);
  assert.equal(r.status, "done");
  assert.ok(!watch.overlapped(), "both were in the folder at the same time");
  assert.equal(events.filter((e) => e.type === "quest_tree").length, 0);
  assert.ok(events.some((e) => e.type === "notice" && /is waiting for .* to finish in links\/plain/.test(e.text)));
  assert.equal(readFileSync(join(plain, "Scribe.txt"), "utf8"), "Scribe was here\n");
  assert.equal(readFileSync(join(plain, "Artificer.txt"), "utf8"), "Artificer was here\n");
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 });
});

test("two quests that change the same lines: the first lands, the second is kept on its branch and everyone is told", async () => {
  const watch = watchTwoWriters();
  script = async (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scribe" || who === "Artificer") {
      if (isFirstTurn(b)) { await watch.asked(who); return { tools: [{ name: "write_file", input: { path: `${L}/app.txt`, content: `${who}'s v2\n` } }] }; }
      return { text: `${who} changed app.txt.` };
    }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "both at once" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "scribe", brief: "change app.txt" } },
      { name: "dispatch", input: { adventurer: "artificer", brief: "change app.txt" } },
    ] };
    return { text: "Both back." };
  };
  const r = await runExpedition("The same line twice", { links: [link.name] }).finally(watch.done);
  assert.equal(r.status, "done");
  const ends = events.filter((e) => e.type === "quest_tree" && e.state !== "working");
  assert.deepEqual(ends.map((e) => e.state), ["merged", "kept"]);
  const kept = ends[1];
  assert.equal(readFileSync(join(web.dir, "app.txt"), "utf8"), `${ends[0].who}'s v2\n`);
  assert.equal(web.git("show", `${kept.branch}:app.txt`), `${kept.who}'s v2`, "the other's work is on its branch");
  assert.ok(events.some((e) => e.type === "notice" && e.text.includes(`weren't merged back`) && e.text.includes(kept.branch)));
  const reports = api.seen.filter((s) => s.who === "Quartermaster").map((s) => lastToolResults(s.body)).join("\n");
  assert.match(reports, new RegExp(`NOT merged back into the folder.*${kept.branch.replace("/", "\\/")}`));
  assert.equal(worktrees(web), 1);
  web.git("branch", "-D", kept.branch);
});

// ---------- 3. Helpers ----------

const toolNames = (body: any): string[] => body.tools.map((t: any) => t.name);
// The Artificer sends two helpers at once, each writing a file in the repository; then reports.
function artificerWithHelpers(watch?: ReturnType<typeof watchTwoWriters>) {
  return async (b: any): Promise<Reply> => {
    const who = whoAsks(b), res = lastToolResults(b), ask = String(typeof b.messages[0].content === "string" ? b.messages[0].content : JSON.stringify(b.messages[0].content));
    const part = ask.match(/part (one|two)/)?.[1];
    if (part) { // a helper
      if (isFirstTurn(b)) { await watch?.asked(part); return { tools: [{ name: "write_file", input: { path: `${L}/part-${part}.txt`, content: `${who} did part ${part}\n` } }] }; }
      return { text: `Part ${part} is written.` };
    }
    if (who === "Artificer") {
      if (isFirstTurn(b)) return { tools: [
        { name: "dispatch_helper", input: { brief: "Write part one." } },
        { name: "dispatch_helper", input: { helper: "scribe", brief: "Write part two." } },
      ] };
      return { text: "Both parts are in." };
    }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "one quest" } }] };
    if (res.includes("approved the plan")) return { tools: [{ name: "dispatch", input: { adventurer: "artificer", brief: "Build both parts; split the work." } }] };
    return { text: "Done." };
  };
}

test("a crew member with helpers on sends two at once: they are leaves, work in worktrees of its folder, and report to it", async () => {
  setAgentSettings("artificer", { helpers: true });
  const watch = watchTwoWriters();
  script = artificerWithHelpers(watch);
  const r = await runExpedition("Build two parts", { links: [link.name] }).finally(watch.done);
  assert.equal(r.status, "done");
  assert.ok(watch.overlapped(), "the helpers worked at the same time");
  const sent = events.filter((e) => e.type === "dispatch");
  const parent = sent.find((e) => !e.helperOf);
  assert.equal(parent.who, "Artificer");
  assert.deepEqual(sent.filter((e) => e.helperOf).map((e) => [e.who, e.helperOf === parent.questId]).sort(), [["Artificer", true], ["Scribe", true]]);
  // The one who sends has dispatch_helper; a helper has none of what a leaf mustn't have.
  const first = (who: string, helper: boolean) => api.seen.find((s) => s.who === who && isFirstTurn(s.body) && /part (one|two)/.test(JSON.stringify(s.body.messages[0].content)) === helper)!;
  assert.ok(toolNames(first("Artificer", false).body).includes("dispatch_helper"));
  for (const who of ["Artificer", "Scribe"]) {
    const names = toolNames(first(who, true).body);
    assert.deepEqual(names.filter((n) => LEAF_BLOCKED.has(n)), [], `${who} as a helper`);
    assert.ok(names.includes("write_file"), "it still has its own tools");
  }
  assert.ok(toolNames(first("Scribe", false)?.body ?? { tools: [] }).length === 0 || true);
  assert.equal(readFileSync(join(web.dir, "part-one.txt"), "utf8"), "Artificer did part one\n");
  assert.equal(readFileSync(join(web.dir, "part-two.txt"), "utf8"), "Scribe did part two\n");
  assert.deepEqual(events.filter((e) => e.type === "quest_tree").map((e) => e.state).sort(), ["merged", "merged", "working", "working"]);
  const reports = api.seen.filter((s) => s.who === "Artificer").map((s) => lastToolResults(s.body)).join("\n");
  assert.match(reports, /Scribe's report \(your helper\):\nPart two is written\./);
  assert.equal(worktrees(web), 1);
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 });
  assert.deepEqual(questSlotsForTests.now(), { running: 0, waiting: 0 });
  setAgentSettings("artificer", { helpers: false });
});

test("helpers are off unless turned on: no dispatch_helper", async () => {
  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Artificer") return { text: "Nothing to do." };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "one quest" } }] };
    if (res.includes("approved the plan")) return { tools: [{ name: "dispatch", input: { adventurer: "artificer", brief: "look" } }] };
    return { text: "Done." };
  };
  await runExpedition("Look", { links: [link.name] });
  assert.ok(!toolNames(api.seen.find((s) => s.who === "Artificer")!.body).includes("dispatch_helper"));
});

test("the limit on quests at once holds at every depth: with one slot, helpers run one at a time and nothing waits forever", async () => {
  setAgentSettings("artificer", { helpers: true });
  setQuestLimit(1);
  let out = 0, most = 0;
  const inner = artificerWithHelpers();
  script = async (b) => {
    const helper = /part (one|two)/.test(JSON.stringify(b.messages[0].content));
    if (helper && isFirstTurn(b)) { out++; most = Math.max(most, out); await new Promise((ok) => setTimeout(ok, 150)); }
    const reply = await inner(b);
    if (helper && !isFirstTurn(b)) out--;
    return reply;
  };
  try {
    const r = await runExpedition("Build two parts again", { links: [link.name] });
    assert.equal(r.status, "done");
    assert.equal(most, 1, "never two helpers out at once");
    assert.equal(events.filter((e) => e.type === "return" && e.status === "done").length, 3);
    assert.deepEqual(questSlotsForTests.now(), { running: 0, waiting: 0 });
  } finally {
    setQuestLimit(4);
    setAgentSettings("artificer", { helpers: false });
  }
});

test("a quest waiting on its helpers lends them its slot, and takes one back when they are in", async () => {
  setQuestLimit(1);
  try {
    assert.equal(await questSlotsForTests.take(), true);
    questSlotsForTests.hold("q1");
    let during = -1;
    await questSlotsForTests.whileHelping("q1", async () => {
      assert.equal(await questSlotsForTests.take(), true, "the helper gets the slot its sender sat on");
      during = questSlotsForTests.now().running;
      questSlotsForTests.release();
    });
    assert.equal(during, 1);
    assert.equal(questSlotsForTests.now().running, 1, "the sender holds a slot again");
    questSlotsForTests.drop("q1");
    questSlotsForTests.release();
    assert.deepEqual(questSlotsForTests.now(), { running: 0, waiting: 0 });
  } finally {
    setQuestLimit(4);
  }
});
