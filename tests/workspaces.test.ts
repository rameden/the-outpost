// Working in linked repositories: shell commands run there, an expedition can have its own
// worktree and branch that the file tools follow, the project's own instructions reach the
// prompt, your checks run after changes, the sandbox holds, and a cut-off run can be resumed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("workspaces");
// A project of its own, outside the camp, to link.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "guild-camp-repo-")));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "test@example.com");
git(repo, "config", "user.name", "Test");
writeFileSync(join(repo, "app.txt"), "v1\n");
writeFileSync(join(repo, "AGENTS.md"), "Use tabs, never spaces. Run `make check` before finishing.\n");
writeFileSync(join(repo, "CLAUDE.md"), "@AGENTS.md\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "first");

const { addLink, linksBlock, projectInstructions, setLinkVerify } = await import("../src/links.ts");
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

test("sandbox: no network, no writes outside the project, no reading secrets; commits still work", { skip: !sandboxAvailable() }, async () => {
  const sandbox = sandboxPlanFor(repo);
  const outside = join(homedir(), `.guild-camp-sandbox-probe-${process.pid}`);
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
