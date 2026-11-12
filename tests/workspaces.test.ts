// Working in linked repositories: shell commands run there, an expedition can have its own
// worktree and branch that the file tools follow, the project's own instructions reach the
// prompt, your checks run after changes, the sandbox holds, and a cut-off run can be resumed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("workspaces");
// A project of its own, outside the camp, to link.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "satchel-repo-")));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "test@example.com");
git(repo, "config", "user.name", "Test");
writeFileSync(join(repo, "app.txt"), "v1\n");
writeFileSync(join(repo, "AGENTS.md"), "Use tabs, never spaces. Run `make check` before finishing.\n");
writeFileSync(join(repo, "CLAUDE.md"), "@AGENTS.md\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "first");

const { addLink, linksBlock, projectInstructions, setLinkVerify, setLinkSetup, findLink } = await import("../src/links.ts");
const { setUpWorkspaces } = await import("../src/setup.ts");
const { changedFiles, checkpointDiff, sealSnapshots, undoCheckpoint } = await import("../src/checkpoints.ts");
const { withExpedition, withQuest, newSteering, steer } = await import("../src/context.ts");
const { bashFor, readFileFor, writeFileFor, sandboxPlanFor, runShell, shellDir, wrapUpNote, rl } = await import("../src/tools.ts");
const { editFileFor } = await import("../src/codetools.ts");
const repos = await import("../src/repos.ts");
const { runChecks } = await import("../src/verify.ts");
const { sandboxAvailable } = await import("../src/sandbox.ts");
const { setShellSandbox } = await import("../src/settings.ts");
const { setAsker } = await import("../src/ask.ts");
const { recordTurn, threadFor } = await import("../src/threads.ts");
const { saveToFeed } = await import("../src/feed.ts");
after(() => rl.close());

const link = addLink(repo, "write");
const L = `links/${link.name}`;
const asked: string[] = [];
setAsker(async (q) => { asked.push(q.body); return "n"; });

test("shell commands run inside a linked repo, and read-only git there doesn't ask", async () => {
  const bash = bashFor("artificer").run!;
  assert.match(String(await bash({ command: "git log --oneline", cwd: L })), /first/);
  assert.equal(String(await bash({ command: "ls", cwd: L })).split("\n").sort().join(","), "AGENTS.md,CLAUDE.md,app.txt");
  assert.equal(asked.length, 0, "neither asked");
  assert.match(String(await bash({ command: "touch made.txt", cwd: L })), /declined/);
  assert.match(asked[0], new RegExp(`touch made\\.txt\\n\\(in ${L}\\)`), "the approval says where it would run");
  assert.throws(() => shellDir("/etc"), /outside the camp/);
});

test("an expedition can work in its own worktree and branch; file tools and the shell follow it", async () => {
  const ws = await repos.prepareWorkspaces({ [link.name]: { mode: "new" } }, "Fix the login button!", "abcd1234");
  const w = ws[link.name];
  assert.match(w.branch, /^camp\/fix-the-login-button-abcd$/);
  assert.ok(w.created && existsSync(join(w.path, "app.txt")));
  await withExpedition({ id: "exp-wt", workspaces: ws }, async () => {
    assert.equal(await readFileFor("artificer").run!({ path: `${L}/app.txt` }), "v1\n");
    await editFileFor("artificer").run!({ path: `${L}/app.txt`, old_string: "v1", new_string: "v2" });
    await writeFileFor("artificer").run!({ path: `${L}/new.txt`, content: "x\n" });
    assert.match(String(await bashFor("artificer").run!({ command: "git status --short", cwd: L })), /M app\.txt[\s\S]*\?\? new\.txt/);
    assert.match(linksBlock(), /a new git worktree on branch camp\/fix-the-login-button-abcd/);
  });
  assert.equal(readFileSync(join(repo, "app.txt"), "utf8"), "v1\n", "the linked checkout is untouched");
  assert.equal(readFileSync(join(w.path, "app.txt"), "utf8"), "v2\n");
  assert.equal(await readFileFor("artificer").run!({ path: `${L}/app.txt` }), "v1\n", "outside that expedition, the link is the checkout again");

  let st = await repos.workspaceStatus(w);
  assert.deepEqual([st.changed, st.commits], [2, 0]);
  assert.match(await repos.commitWorkspace(w, "Fix the login button"), /Fix the login button$/);
  st = await repos.workspaceStatus(w);
  assert.deepEqual([st.changed, st.commits], [0, 1]);

  const listed = (await repos.linkedRepos())[0];
  assert.equal(listed.branch, "main");
  assert.deepEqual(listed.worktrees.map((x) => x.branch), [w.branch], "it's now one you can pick again");
  const again = await repos.prepareWorkspaces({ [link.name]: { mode: "existing", path: w.path } }, "more", "ffff0000");
  assert.equal(again[link.name].path, w.path);
  await assert.rejects(() => repos.prepareWorkspaces({ [link.name]: { mode: "existing", path: homedir() } }, "x", "1"), /isn't a worktree/);
  await assert.rejects(() => repos.commitWorkspace({ link: link.name, path: tmpdir() }, "x"), /isn't a worktree/);
  await repos.removeWorkspace(w);
  assert.ok(!existsSync(w.path));
  assert.match(git(repo, "branch", "--list", w.branch), /camp\/fix-the-login-button-abcd/, "the branch is kept");
});

test("a project's own AGENTS.md reaches every prompt, once", () => {
  const text = projectInstructions();
  assert.match(text, new RegExp(`### ${L}/AGENTS\\.md\\nUse tabs, never spaces`));
  assert.equal(text.split("Use tabs").length, 2, "CLAUDE.md that only points at AGENTS.md isn't loaded again");
  assert.match(text, /don't change who you are/);
});

test("your checks run by themselves after a quest changes files in that folder", async () => {
  setLinkVerify(link.name, ["test -f app.txt", "grep -q NEVER app.txt"]);
  const out = await withExpedition({ id: "exp-checks" }, () => withQuest("q-checks", async () => {
    assert.equal(await runChecks("q-checks", { who: "Artificer", emoji: "🔨" }), "", "nothing changed there yet: nothing runs");
    await writeFileFor("artificer").run!({ path: `${L}/app.txt`, content: "v3\n" });
    return runChecks("q-checks", { who: "Artificer", emoji: "🔨" });
  }));
  assert.match(out, new RegExp(`Automatic checks in ${L}`));
  assert.match(out, /✓ test -f app\.txt/);
  assert.match(out, /✗ grep -q NEVER app\.txt\nExit code 1/);
  setLinkVerify(link.name, []);
  git(repo, "checkout", "-q", "app.txt");
});

test("a new worktree gets the folder's setup once, before work starts; your checkout and picked worktrees never do", async () => {
  setLinkSetup(link.name, ["echo installed > .setup-ran", "  ", "false", "echo never > .after-fail"]);
  assert.deepEqual(findLink(link.name)!.setup, ["echo installed > .setup-ran", "false", "echo never > .after-fail"], "blank lines are dropped");
  const ws = await repos.prepareWorkspaces({ [link.name]: { mode: "new" } }, "Set it up", "5e7up000");
  const w = ws[link.name];
  const note = await withExpedition({ id: "exp-setup", workspaces: ws }, () => setUpWorkspaces(ws, { who: "Artificer", emoji: "🔨" }));
  assert.equal(readFileSync(join(w.path, ".setup-ran"), "utf8"), "installed\n", "it ran in the new worktree");
  assert.ok(!existsSync(join(w.path, ".after-fail")), "a failing command stops the rest");
  assert.match(note, /✓ echo installed[\s\S]*✗ false/);
  assert.ok(w.ready, "marked as set up");
  assert.match(withExpeditionSync(ws), /ran this folder's setup/);

  rmSync(join(w.path, ".setup-ran"));
  assert.equal(await setUpWorkspaces(ws, { who: "Artificer", emoji: "🔨" }), "", "a follow-up in the same worktree doesn't run it again");
  assert.ok(!existsSync(join(w.path, ".setup-ran")));

  const picked = await repos.prepareWorkspaces({ [link.name]: { mode: "existing", path: w.path } }, "more", "5e7up001");
  assert.equal(await setUpWorkspaces(picked, { who: "Artificer", emoji: "🔨" }), "", "a worktree you picked isn't set up by the camp");
  assert.ok(!existsSync(join(repo, ".setup-ran")), "nor is the linked checkout");
  setLinkSetup(link.name, []);
  assert.equal(findLink(link.name)!.setup, undefined);
  await repos.removeWorkspace(w);
});
test("what shell commands change in a linked repo is in View changes, and Undo puts it back unless it was changed again", async () => {
  writeFileSync(join(repo, ".env"), "TOKEN=secret\n");
  const headBefore = git(repo, "rev-parse", "HEAD"), branchesBefore = git(repo, "branch", "--list");
  setAsker(async () => "y");
  try {
    await withExpedition({ id: "exp-shell" }, async () => {
      await bashFor("artificer").run!({ command: "printf 'v9\\n' > app.txt && echo new > made.txt && rm CLAUDE.md && printf 'TOKEN=other\\n' > .env", cwd: L });
      await writeFileFor("artificer").run!({ path: `${L}/notes.txt`, content: "by the file tool\n" });
    });
  } finally { setAsker(async (q) => { asked.push(q.body); return "n"; }); }
  sealSnapshots("exp-shell");
  const changed = changedFiles("exp-shell").map((f) => `${f.change} ${f.path}`).sort();
  assert.deepEqual(changed, [`created ${L}/made.txt`, `created ${L}/notes.txt`, `deleted ${L}/CLAUDE.md`, `modified ${L}/app.txt`], "shell changes and the file tool's, each once; .env is never in it");
  const { diff } = checkpointDiff("exp-shell");
  assert.match(diff, /Changed by shell commands in links\/[\w-]+[\s\S]*\+v9/);
  assert.doesNotMatch(diff, /TOKEN/);
  const refs = git(repo, "for-each-ref", "--format=%(refname)", "refs/satchel/checkpoints/exp-shell/").split("\n");
  assert.equal(refs.length, 2, "a before and an after snapshot");
  assert.doesNotMatch(git(repo, "ls-tree", "-r", "--name-only", refs[0]), /\.env/, "secret files aren't kept in a snapshot");
  assert.equal(git(repo, "rev-parse", "HEAD"), headBefore, "HEAD doesn't move");
  assert.equal(git(repo, "branch", "--list"), branchesBefore, "no branch is made");

  writeFileSync(join(repo, "made.txt"), "the user's own edit\n"); // changed again after the expedition
  const r = undoCheckpoint("exp-shell");
  assert.deepEqual(r.restored.sort(), [`${L}/CLAUDE.md`, `${L}/app.txt`, `${L}/notes.txt`]);
  assert.deepEqual(r.skipped, [`${L}/made.txt (changed again since)`]);
  assert.equal(readFileSync(join(repo, "app.txt"), "utf8"), "v1\n");
  assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(readFileSync(join(repo, "made.txt"), "utf8"), "the user's own edit\n", "someone else's later change is left alone");
  assert.equal(readFileSync(join(repo, ".env"), "utf8"), "TOKEN=other\n", "secrets are never touched by Undo");
  assert.equal(git(repo, "status", "--short"), "?? .env\n?? made.txt".replace(/\n/g, "\n"), "the index is untouched: only the leftovers show");
  rmSync(join(repo, "made.txt")); rmSync(join(repo, ".env"));
});

function withExpeditionSync(ws: Parameters<typeof setUpWorkspaces>[0]) {
  let out = "";
  withExpedition({ id: "exp-setup-block", workspaces: ws }, async () => { out = linksBlock(); });
  return out;
}

test("sandbox: no network, no writes outside the project, no reading secrets; commits still work", { skip: !sandboxAvailable() }, async () => {
  const sandbox = sandboxPlanFor(repo);
  const outside = join(homedir(), `.satchel-sandbox-probe-${process.pid}`);
  assert.match(await runShell(`echo x > ${outside}`, { cwd: repo, sandbox }), /Operation not permitted/);
  assert.ok(!existsSync(outside));
  assert.equal(await runShell("echo ok > inside.txt && cat inside.txt", { cwd: repo, sandbox }), "ok");
  writeFileSync(join(repo, ".env"), "SECRET=1\n");
  assert.match(await runShell("cat .env", { cwd: repo, sandbox }), /Operation not permitted/);
  assert.match(await runShell("curl -sS -m 5 https://example.com", { cwd: repo, sandbox }), /^Exit code/);
  assert.match(await runShell("echo x > .git/hooks/pre-commit", { cwd: repo, sandbox }), /Operation not permitted/);
  assert.match(await runShell("git add inside.txt && git commit -qm sandboxed && git log --oneline -1", { cwd: repo, sandbox }), /sandboxed/);

  // With the sandbox on, a command that would have asked runs without asking; "unsandboxed" asks.
  setShellSandbox(true);
  asked.length = 0;
  const bash = bashFor("artificer").run!;
  assert.equal(await bash({ command: "echo hi | tr a-z A-Z", cwd: L }), "HI");
  assert.equal(asked.length, 0);
  assert.match(String(await bash({ command: "false", cwd: L })), /Ran in the sandbox.*unsandboxed: true/s);
  assert.match(String(await bash({ command: "npm install", cwd: L, unsandboxed: true })), /declined/);
  assert.equal(asked.length, 1);
  setShellSandbox(false);
});

test("the camp's own rules hold inside the sandbox when it runs in the camp folder", { skip: !sandboxAvailable() }, async () => {
  mkdirSync("camp/agents/scout", { recursive: true });
  writeFileSync("camp/agents/scout/memory.md", "private\n");
  const sandbox = sandboxPlanFor(process.cwd());
  assert.match(await runShell("cat camp/agents/scout/memory.md", { sandbox }), /Operation not permitted/);
  assert.match(await runShell("echo x > camp/settings.json", { sandbox }), /Operation not permitted/);
  assert.match(await runShell("mkdir -p skills/shared/evil", { sandbox }), /Operation not permitted/);
});

test("near the turn limit the agent is told to land the work", () => {
  assert.match(wrapUpNote(3)!, /3 turns left/);
  assert.match(wrapUpNote(1)!, /last turn/);
  assert.equal(wrapUpNote(2), null);
});

test("steering: what you say reaches agents that are waiting for it", async () => {
  const s = newSteering();
  let woke = 0;
  s.waiters.add(() => woke++);
  steer(s, "Use the staging API instead");
  assert.equal(woke, 1);
  assert.equal(s.messages[0].text, "Use the staging API instead");
});

test("a run that was cut off can be resumed from what the feed recorded", () => {
  const id = "exp-cut-off";
  const ev = (seq: number, body: object) => saveToFeed({ time: new Date().toISOString(), seq, expeditionId: id, ...body } as any);
  recordTurn({ thread: id, expedition: id, agent: "quartermaster", direct: false, task: "Rename the widget", reply: "", status: "running",
    workspaces: { [link.name]: { link: link.name, path: "/somewhere/wt", branch: "camp/rename" } } });
  ev(1, { type: "ask", id: "ask_1", kind: "plan", title: "t", body: "1. Artificer renames it" });
  ev(2, { type: "answered", id: "ask_1", answer: "" });
  ev(3, { type: "dispatch", who: "Artificer", emoji: "🔨", questId: "q" });
  ev(4, { type: "tool", who: "Artificer", emoji: "🔨", depth: 1, tool: "edit_file", input: '{"path":"src/widget.ts"}' });
  const t = threadFor(id)!;
  assert.ok(t.unfinished);
  assert.match(t.history, /cut off before it finished/);
  assert.match(t.history, /Plan submitted:\n1\. Artificer renames it\nThe user approved that plan\./);
  assert.match(t.history, /Artificer used edit_file \{"path":"src\/widget\.ts"\}/);
  assert.equal(t.workspaces?.[link.name].branch, "camp/rename", "the resume keeps working in the same worktree");
  // Once it has an ending, that ending is what a reply sees.
  recordTurn({ thread: id, expedition: id, agent: "quartermaster", direct: false, task: "Rename the widget", reply: "Renamed.", status: "done" });
  const done = threadFor(id)!;
  assert.ok(!done.unfinished && done.turns === 1);
  assert.match(done.history, /You answered \(done\):\nRenamed\./);
});

test("your checkout can be switched to a branch, or a new one made, and git's refusals come back as they are", async () => {
  const start = git(repo, "rev-parse", "--abbrev-ref", "HEAD");
  assert.equal(await repos.switchBranch(link.name, "mp-601-new", true), "mp-601-new");
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), "mp-601-new");
  const listed = (await repos.linkedRepos()).find((r) => r.link === link.name)!;
  assert.equal(listed.branch, "mp-601-new");
  assert.ok(listed.branches.includes("mp-601-new") && listed.branches.includes(start), "the branches there are to switch to are listed");
  assert.equal(await repos.switchBranch(link.name, start, false), start);
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), start);

  await assert.rejects(repos.switchBranch(link.name, "mp-601-new", true), /already exists/);
  await assert.rejects(repos.switchBranch(link.name, "no-such-branch", false), /invalid reference|did not match|no-such-branch/);
  await assert.rejects(repos.switchBranch(link.name, "has space", true), /isn't a name git allows/);
  await assert.rejects(repos.switchBranch(link.name, "--force", true), /Give the branch a name/);
  await assert.rejects(repos.switchBranch(link.name, "  ", true), /Give the branch a name/);
  await assert.rejects(repos.switchBranch("nope", "x", true), /No linked folder/);

  // Work you haven't committed is never thrown away: git refuses, and says which file.
  git(repo, "switch", "-q", "mp-601-new");
  writeFileSync(join(repo, "app.txt"), "on the new branch\n");
  git(repo, "commit", "-qam", "diverge");
  git(repo, "switch", "-q", start);
  const before = readFileSync(join(repo, "app.txt"), "utf8");
  writeFileSync(join(repo, "app.txt"), "uncommitted work\n");
  await assert.rejects(repos.switchBranch(link.name, "mp-601-new", false), /app\.txt/);
  assert.equal(readFileSync(join(repo, "app.txt"), "utf8"), "uncommitted work\n");
  writeFileSync(join(repo, "app.txt"), before);
});
