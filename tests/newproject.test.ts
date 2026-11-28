// Starting a new project (src/newproject.ts and the Quartermaster's start_project).
// - A new project is a git repository with a first commit, outside the outpost's folder, linked
//   with edit access; asked for again, the same one is used.
// - A folder the crew made inside the outpost's folder is moved out and started the same way; the
//   outpost's own folders, and anything its repository tracks, never are.
// - Through the Quartermaster: the project joins the conversation, and two writers sent there
//   together each get a worktree, and both land.
// - Its checks and setup are commands the camp runs by itself from then on, so they're kept only
//   with the user's say-so: asked once, unless the user's own choices already say they run.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox, NEEDS_POSIX } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, lastToolResults, whoAsks, type Reply } from "./helpers/fake-api.ts";

const CAMP = enterSandbox("newproject");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads
const HOME = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-projects-")));
process.env.OUTPOST_PROJECTS_DIR = HOME;

const { startProject, projectSlug, agreeCommands } = await import("../src/newproject.ts");
const { runExpedition, hadRepo, questSlotsForTests } = await import("../src/quartermaster.ts");
const { isGitTop, questTreesForTests } = await import("../src/questtrees.ts");
const { folderLocksForTests } = await import("../src/folderlock.ts");
const { findLink, loadLinks } = await import("../src/links.ts");
const { allTurns } = await import("../src/threads.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
const { setApprovalLevel, setShellLists } = await import("../src/settings.ts");
const { withExpedition } = await import("../src/context.ts");
const { sandboxAvailable } = await import("../src/sandbox.ts");
after(async () => { rl.close(); await api.close(); });

// Every plan is approved as it stands; a shell question gets shellAnswer, and is kept.
const shellAsks: any[] = [];
let shellAnswer = "n";
setAsker(async (q) => { if (q.kind !== "shell") return ""; shellAsks.push(q); return shellAnswer; });
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => {
  events.length = 0; api.seen.length = 0; shellAsks.length = 0; shellAnswer = "n";
  setApprovalLevel("safe"); setShellLists({ allow: [], deny: [], ask: [] });
});

const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

// ---------- 1. The project itself ----------

test("a new project: its own folder outside the outpost, a git repository with a first commit, linked with edit access", async () => {
  const s = await startProject({ name: "Star Map" });
  assert.equal(s.state, "new");
  assert.equal(s.path, join(HOME, "star-map"));
  assert.ok(!s.path.startsWith(CAMP + "/"), "not inside the outpost's folder");
  assert.equal(await isGitTop(s.path), true, "a worktree can be cut from it");
  assert.equal(git(s.path, "rev-parse", "HEAD"), s.commit);
  assert.equal(git(s.path, "branch", "--show-current"), "main");
  assert.match(readFileSync(join(s.path, ".gitignore"), "utf8"), /node_modules/);
  assert.equal(git(s.path, "status", "--porcelain"), "", "everything it starts with is committed");
  assert.deepEqual({ name: s.link.name, access: s.link.access, path: s.link.path }, { name: "star-map", access: "write", path: s.path });

  assert.equal(findLink("star-map")?.campMade, true, "marked as one the camp started");
  assert.equal(findLink("star-map")?.verify, undefined, "no commands of its own until the user agrees to some");

  // Asked for again (a follow-up, or the Quartermaster adding checks): the same project.
  const again = await startProject({ name: "star-map" });
  assert.equal(again.state, "existing");
  assert.equal(again.commit, s.commit);
  assert.equal(loadLinks().filter((l) => l.path === s.path).length, 1);
});

test("what start_project refuses: no name, and a folder of that name that isn't the outpost's", async () => {
  assert.equal(projectSlug("  ¡¿  "), "");
  await assert.rejects(startProject({ name: "  ¡¿  " }), /Give the project a name/);
  mkdirSync(join(HOME, "taken"));
  writeFileSync(join(HOME, "taken", "mine.txt"), "someone's\n");
  await assert.rejects(startProject({ name: "taken" }), /already exists and isn't one of the outpost's linked folders/);
  assert.equal(existsSync(join(HOME, "taken", ".git")), false, "it was left as it was");
});

test("adopting a folder the crew made in the outpost's folder: moved out, committed without packages or secrets, linked", async () => {
  const made = join(CAMP, "holonet");
  mkdirSync(join(made, "packages", "sim"), { recursive: true });
  mkdirSync(join(made, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(made, "package.json"), "{}\n");
  writeFileSync(join(made, "packages", "sim", "index.ts"), "export {};\n");
  writeFileSync(join(made, "node_modules", "left-pad", "index.js"), "\n");
  writeFileSync(join(made, ".env"), "SECRET=1\n");
  const s = await startProject({ from: "holonet" });
  assert.equal(s.state, "adopted");
  assert.equal(s.movedFrom, made);
  assert.equal(s.path, join(HOME, "holonet"));
  assert.equal(existsSync(made), false, "moved, not copied: nothing is left to edit by mistake");
  assert.equal(readFileSync(join(s.path, "packages", "sim", "index.ts"), "utf8"), "export {};\n");
  const tracked = git(s.path, "ls-files").split("\n");
  assert.ok(tracked.includes("package.json") && tracked.includes("packages/sim/index.ts") && tracked.includes(".gitignore"));
  assert.ok(!tracked.some((f) => f.startsWith("node_modules/")), "installed packages aren't committed");
  assert.ok(!tracked.includes(".env"), "nor secrets");
  assert.equal(existsSync(join(s.path, ".env")), true, "but they came along");
  assert.equal(s.link.access, "write");
  // Asked again after a break (the folder is already moved): the same project.
  assert.equal((await startProject({ from: "holonet" })).state, "existing");
});

test("adopting refuses the outpost's own folders, folders outside it, and folders with symlinks", async () => {
  mkdirSync(join(CAMP, "camp", "memory"), { recursive: true });
  await assert.rejects(startProject({ from: "camp/memory" }), /part of the outpost itself/);
  await assert.rejects(startProject({ from: "skills" }), /part of the outpost itself/);
  await assert.rejects(startProject({ from: "." }), /isn't inside the outpost's folder/);
  const elsewhere = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-elsewhere-")));
  await assert.rejects(startProject({ from: elsewhere }), /isn't inside the outpost's folder/);
  await assert.rejects(startProject({ from: "nothing-here" }), /There's no folder/);
  // A crew member's own outputs are theirs to build in.
  const out = join(CAMP, "camp", "agents", "artificer", "outputs", "tool");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "a.txt"), "a\n");
  assert.equal((await startProject({ from: out })).state, "adopted");
});

test("adopting refuses a symlink inside the folder", { skip: NEEDS_POSIX }, async () => {
  const made = join(CAMP, "linky");
  mkdirSync(made);
  symlinkSync(join(CAMP, "camp"), join(made, "to-camp"));
  await assert.rejects(startProject({ from: "linky" }), /is a symlink/);
  assert.equal(existsSync(made), true);
});

test("adopting never takes what the outpost's own repository tracks (Mae is the app's own checkout)", async () => {
  const camp = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-campgit-")));
  git(camp, "init", "-q");
  mkdirSync(join(camp, "app"));
  writeFileSync(join(camp, "app", "main.ts"), "x\n");
  git(camp, "add", "-A");
  git(camp, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "x");
  await assert.rejects(startProject({ from: "app" }, camp), /holds files of the outpost's own repository/);
  assert.equal(existsSync(join(camp, "app", "main.ts")), true);
});


// ---------- 2. Its checks and setup: the user's say-so ----------

test("checks and setup are asked about once, listing every command, and kept only on a yes; the same ones again aren't asked about", async () => {
  const { link } = await startProject({ name: "agree-yes" });
  shellAnswer = "y";
  const note = await agreeCommands(link, { checks: ["make test", "make lint"], setup: ["npm ci"] });
  assert.equal(shellAsks.length, 1, "one question for all of them");
  const body = shellAsks[0].body;
  for (const c of ["make test", "make lint", "npm ci"]) assert.ok(body.includes(c), `${c} is listed`);
  assert.match(body, /run after each change there/);
  assert.match(body, /in each new worktree.*outside the sandbox/);
  assert.match(body, /runs these by itself, without asking you each time/);
  assert.match(note, /Checks and setup: set, with the user's say-so/);
  assert.deepEqual(findLink("agree-yes")?.verify, ["make test", "make lint"]);
  assert.deepEqual(findLink("agree-yes")?.setup, ["npm ci"]);

  // The same again (a follow-up calling start_project with them): nothing asked, nothing changed.
  const again = await agreeCommands(findLink("agree-yes")!, { checks: ["make test", "make lint"], setup: ["npm ci"] });
  assert.equal(shellAsks.length, 1);
  assert.match(again, /Checks: already set to these[\s\S]*Setup: already set to these/);
  // A changed list is asked about again.
  await agreeCommands(findLink("agree-yes")!, { checks: ["make test"] });
  assert.equal(shellAsks.length, 2);
  assert.deepEqual(findLink("agree-yes")?.verify, ["make test"]);
});

test("declined: the project stands, without the commands, and the Quartermaster is told", async () => {
  const { link } = await startProject({ name: "agree-no" });
  shellAnswer = "n";
  const note = await agreeCommands(link, { checks: ["make test"], setup: ["npm ci"] });
  assert.equal(shellAsks.length, 1);
  assert.match(note, /not set, because the user declined them/);
  assert.equal(findLink("agree-no")?.verify, undefined);
  assert.equal(findLink("agree-no")?.setup, undefined);
  assert.equal(findLink("agree-no")?.access, "write", "the project itself is still there");
});

test("a command the user's rules deny is refused without asking; one they say to ask about is asked about even in god mode", async () => {
  const { link } = await startProject({ name: "agree-rules" });
  setShellLists({ deny: ["curl *"], ask: ["npm install*"] });
  setApprovalLevel("god");
  const note = await agreeCommands(link, { setup: ["curl https://example.com/x.sh"] });
  assert.equal(shellAsks.length, 0, "not asked about");
  assert.match(note, /Setup: not set, because the user's rules don't allow `curl https:\/\/example\.com\/x\.sh` \("curl \*"\)/);
  assert.equal(findLink("agree-rules")?.setup, undefined);

  shellAnswer = "y";
  await agreeCommands(link, { setup: ["npm install"] });
  assert.equal(shellAsks.length, 1, "your ask rule wins over god mode");
  assert.match(shellAsks[0].body, /your rule "npm install\*" says to ask about this/);
  assert.deepEqual(findLink("agree-rules")?.setup, ["npm install"]);
});

test("god mode with someone here, or commands all on the allow list: kept without asking", async () => {
  const { link } = await startProject({ name: "agree-god" });
  setApprovalLevel("god");
  assert.match(await agreeCommands(link, { checks: ["make test"], setup: ["npm ci"] }), /set, with the user's say-so/);
  assert.equal(shellAsks.length, 0);
  assert.deepEqual(findLink("agree-god")?.setup, ["npm ci"]);

  setApprovalLevel("safe");
  setShellLists({ allow: ["make test", "make lint"] });
  const other = (await startProject({ name: "agree-allowed" })).link;
  await agreeCommands(other, { checks: ["make test", "make lint"] });
  assert.equal(shellAsks.length, 0, "your allow list already lets them run as they are");
  assert.deepEqual(findLink("agree-allowed")?.verify, ["make test", "make lint"]);
  await agreeCommands(findLink("agree-allowed")!, { checks: ["make test", "rm -rf build"] });
  assert.equal(shellAsks.length, 1, "one that isn't on it is asked about");
});

test("sandbox mode: checks are still asked about (kept, they'd run by themselves under any level later), and so is setup", { skip: !sandboxAvailable() && "no sandbox here" }, async () => {
  const { link } = await startProject({ name: "agree-sandbox" });
  setApprovalLevel("sandbox");
  await agreeCommands(link, { checks: ["make test"] });
  assert.equal(shellAsks.length, 1);
  assert.match(shellAsks[0].body, /inside the sandbox/);
  await agreeCommands(findLink("agree-sandbox")!, { setup: ["npm ci"] });
  assert.equal(shellAsks.length, 2);
  assert.match(shellAsks[1].body, /outside the sandbox/);
});

test("nobody here to ask (a scheduled job): the project stands, nothing new is kept, and the Quartermaster is told", async () => {
  const { link } = await startProject({ name: "agree-unattended" });
  setApprovalLevel("god"); // god mode is for when you're here: a job doesn't get it
  const note = await withExpedition({ id: "job-run", unattended: true }, () => agreeCommands(link, { checks: ["make test"], setup: ["npm ci"] }));
  assert.equal(shellAsks.length, 0);
  assert.match(note, /Checks and setup: not set, because nobody is here to agree/);
  assert.equal(findLink("agree-unattended")?.verify, undefined);
  assert.equal(findLink("agree-unattended")?.setup, undefined);
});

// ---------- 3. Through the Quartermaster ----------

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

test("start_project waits for an approved plan", async () => {
  script = (b) => {
    const res = lastToolResults(b);
    if (isFirstTurn(b)) return { tools: [{ name: "start_project", input: { name: "too-soon" } }] };
    return { text: res.includes("Blocked: submit your plan") ? "blocked" : "not blocked" };
  };
  const r = await runExpedition("Build me a thing", { links: [] });
  assert.equal(r.text, "blocked");
  assert.equal(existsSync(join(HOME, "too-soon")), false);
  const end = events.find((e) => e.type === "expedition_end");
  assert.equal(end?.repo, false, "no repository to work in, so no pull request to post on");
});

test("a project the Quartermaster starts joins the conversation, and two writers sent there together each get a worktree", async () => {
  const watch = watchTwoWriters();
  const P = "links/orrery";
  script = async (b: any): Promise<Reply> => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scribe" || who === "Artificer") {
      if (isFirstTurn(b)) { await watch.asked(who); return { tools: [{ name: "write_file", input: { path: `${P}/${who}/part.txt`, content: `${who}'s part\n` } }] }; }
      watch.back(who);
      return { text: `${who} built its part.` };
    }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Start the project and set down the contracts\n2. (after 1) Scribe's part\n3. (after 1) Artificer's part" } }] };
    if (res.includes("approved the plan")) return { tools: [{ name: "start_project", input: { name: "orrery", checks: ["test -d .git || test -f .git"] } }] };
    if (res.startsWith("Done: links/orrery/")) return { tools: [
      { name: "dispatch", input: { adventurer: "scribe", brief: "build your part" } },
      { name: "dispatch", input: { adventurer: "artificer", brief: "build your part" } },
    ] };
    return { text: "Both parts are in." };
  };
  // A conversation that started with no folders: its scope is empty until the project joins it.
  const id = "orrery-run";
  const r = await runExpedition("Build an orrery app", { id, links: [] }).finally(watch.done);
  assert.equal(r.status, "done");
  assert.ok(events.some((e) => e.type === "notice" && /started a new project at .*orrery: a git repository, linked with edit access as links\/orrery\//.test(e.text)), "the user sees it happen");
  assert.equal(shellAsks.length, 1, "the checks it proposed were put to the user");
  const told = api.seen.map((x) => lastToolResults(x.body)).find((t) => t.startsWith("Done: links/orrery/")) ?? "";
  assert.match(told, /Checks: not set, because the user declined them/);
  assert.equal(findLink("orrery")?.verify, undefined);
  assert.equal(events.find((e) => e.type === "expedition_end")?.repo, false, "a new project has no remote yet, so there's no pull request to post on");
  execFileSync("git", ["remote", "add", "origin", "https://example.invalid/orrery.git"], { cwd: findLink("orrery")!.path });
  assert.deepEqual(await hadRepo(["orrery"]), { repo: true }, "given a remote, there can be one");
  assert.deepEqual(await hadRepo([]), { repo: false }, "not for a run the project isn't part of");
  assert.ok(watch.overlapped(), "both were working at the same time");
  assert.ok(!events.some((e) => e.type === "notice" && /is waiting for .* to finish in links\//.test(e.text)), "nobody waited for the folder");
  const trees = events.filter((e) => e.type === "quest_tree");
  assert.deepEqual(trees.map((e) => `${e.who} ${e.state}`).sort(), ["Artificer merged", "Artificer working", "Scribe merged", "Scribe working"]);
  assert.ok(trees.every((e) => e.link === "orrery"));
  const dir = join(HOME, "orrery");
  assert.equal(readFileSync(join(dir, "Scribe", "part.txt"), "utf8"), "Scribe's part\n");
  assert.equal(readFileSync(join(dir, "Artificer", "part.txt"), "utf8"), "Artificer's part\n");
  assert.equal(git(dir, "branch", "--list", "outpost/*"), "", "the worktrees' branches are gone");
  // The conversation keeps it: its next turn is in the project too.
  assert.ok(allTurns().find((t) => t.expedition === id)?.links?.includes("orrery"));
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 });
  assert.deepEqual(questTreesForTests.wanting(), []);
  assert.deepEqual(questSlotsForTests.now(), { running: 0, waiting: 0 });
});
