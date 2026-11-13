// The Mae demo: a camp of its own, pointed at a small sample project with seeded bugs in it,
// one for each ticket in demo/tickets/.
//
//   npm run demo          start it (sets it up the first time)
//   npm run demo:reset    put everything back to the buggy state, to run the demo again
//   npm run demo:check    say which tickets' tests fail in the sample project right now
//
// Everything the demo makes lives in demo/.instance/ (not in git): the sample project as a git
// repository of its own, the bare repository it pushes to, the stand-ins' state, and the demo's
// camp folder. Your own camp (camp/ at the top of this repository) is never touched, and the
// demo runs on its own port, so both can be open at once.
//
// Tickets and pull requests are stand-ins on this machine (see standins/): no Jira or GitHub
// account is used, and nothing is pushed anywhere but demo/.instance/forge/.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const DEMO = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DEMO, "..");
const INSTANCE = join(DEMO, ".instance");
const MARKER = join(INSTANCE, ".mae-demo");          // says this folder is the demo's to delete
const PROJECT = join(INSTANCE, "ledgerline");        // the sample project, as its own git repository
const WORKTREES = join(INSTANCE, "ledgerline-camp"); // where Mae puts a worktree for each piece of work
const FORGE = join(INSTANCE, "forge");               // the bare repository it pushes to, and the stand-ins' state
const CAMP = join(INSTANCE, "mae");                  // the demo's camp folder (Mae runs from here)
const PID = join(INSTANCE, "demo.pid");
const TOKEN = join(CAMP, "camp", ".token");

const CAMP_PORT = Number(process.env.MAE_DEMO_PORT ?? 4848);
const STANDIN_PORT = Number(process.env.MAE_DEMO_STANDIN_PORT ?? 4849);
const STANDIN_URL = `http://127.0.0.1:${STANDIN_PORT}`;
const shown = (path) => relative(ROOT, path) || ".";

// The tickets' keys, from the files in demo/tickets/ ("LED-101", …), and how to say them.
const ticketKeys = () => readdirSync(join(DEMO, "tickets")).filter((f) => /^[A-Z][A-Z0-9_]+-\d+\.md$/.test(f)).map((f) => f.replace(/\.md$/, "")).sort();
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n) => NUMBERS[n] ?? String(n);
const keyRange = (keys) => (keys.length > 2 ? `${keys[0]} to ${keys.at(-1)}` : keys.join(" and "));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const writeJson = (path, value, mode) => { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", mode ? { mode } : undefined); if (mode) chmodSync(path, mode); };

// ---------- Is it running? ----------
function runningPid() {
  try {
    const pid = Number(readFileSync(PID, "utf8").trim());
    if (!pid) return null;
    process.kill(pid, 0); // throws if there's no such process
    return pid;
  } catch { return null; }
}

// ---------- Setting it up ----------
// The sample project: a copy of demo/sample/ledgerline, committed, with a bare repository beside
// it as its "origin" so a branch can be pushed and a pull request opened without leaving this machine.
function seedProject() {
  cpSync(join(DEMO, "sample", "ledgerline"), PROJECT, { recursive: true });
  git(PROJECT, "init", "-q", "-b", "main");
  // Its own name on commits, and no signing: the demo's commits are throwaway, and shouldn't need your key.
  git(PROJECT, "config", "user.name", "Demo User");
  git(PROJECT, "config", "user.email", "demo@example.com");
  git(PROJECT, "config", "commit.gpgsign", "false");
  git(PROJECT, "add", "-A");
  git(PROJECT, "commit", "-q", "-m", "Ledgerline 0.4.0");
  mkdirSync(FORGE, { recursive: true });
  git(FORGE, "init", "-q", "--bare", "-b", "main", "ledgerline.git");
  git(PROJECT, "remote", "add", "origin", join(FORGE, "ledgerline.git"));
  git(PROJECT, "push", "-q", "-u", "origin", "main");
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

// The demo's camp: Mae's skills, the sample project linked with edit access, a project that
// starts each conversation in its own worktree and has changes reviewed, and Jira pointed at
// the stand-in. `token` is the key of the camp this replaces, so a browser stays signed in.
function seedCamp(token) {
  mkdirSync(join(CAMP, "camp"), { recursive: true });
  cpSync(join(ROOT, "skills"), join(CAMP, "skills"), { recursive: true });
  const at = new Date().toISOString();
  writeJson(join(CAMP, "camp", "links.json"), [
    // verify: run by the camp after a quest changes files here, and shown on its report.
    { name: "ledgerline", path: realpathSync.native(PROJECT), access: "write", added: at, files: countFiles(PROJECT), verify: ["npm test"] },
  ]);
  writeJson(join(CAMP, "camp", "conversations.json"), {
    projects: [
      { id: "general", name: "General" },
      {
        id: "ledgerline", name: "Ledgerline", links: ["ledgerline"], pinned: true,
        description: "Ledgerline is a small invoicing library: totals, discount codes, billing dates, a CSV export, roles, and an audit trail. Bugs come in as LED tickets. Each ticket is fixed on its own branch and goes out as its own pull request.",
        settings: { workIn: "worktree", review: "on" },
      },
    ],
    seenLinks: ["ledgerline"],
    meta: {},
  });
  writeJson(join(CAMP, "camp", "settings.json"), {
    agents: {},
    // The project's own test command runs without asking. Everything else still asks.
    shell: { allow: ["npm test"] },
    // Starting from a ticket moves it to In Progress; opening its pull request moves it to In Review.
    jiraWrite: { on: true, startStatus: "In Progress", prStatus: "In Review" },
  }, 0o600);
  writeJiraLink();
  if (token) writeFileSync(TOKEN, token + "\n", { mode: 0o600 });
}

// Where the camp finds Jira: the stand-in. (Not a real account: the stand-in takes any email and token.)
function writeJiraLink() {
  writeJson(join(CAMP, "camp", "jira.json"), {
    siteUrl: STANDIN_URL, email: "demo@example.com", apiToken: "stand-in-not-a-real-token",
    accountId: "demo-user", displayName: "Demo User", connected: new Date().toISOString(),
  }, 0o600);
}

function setUp() {
  mkdirSync(INSTANCE, { recursive: true });
  writeFileSync(MARKER, "Made by `npm run demo`. Everything in this folder is the demo's own and is replaced by `npm run demo:reset`.\n");
  const fresh = !existsSync(join(PROJECT, ".git"));
  if (fresh) {
    // Half of a set-up is worse than none: start both halves from clean.
    for (const dir of [PROJECT, WORKTREES, FORGE]) rmSync(dir, { recursive: true, force: true });
    seedProject();
  }
  if (!existsSync(join(CAMP, "camp", "links.json"))) seedCamp(keptToken());
  return fresh;
}

const keptToken = () => { try { const t = readFileSync(TOKEN, "utf8").trim(); return /^[0-9a-f]{48}$/.test(t) ? t : null; } catch { return null; } };

// ---------- reset ----------
function reset() {
  const pid = runningPid();
  if (pid) {
    console.error(`The demo is running (process ${pid}). Stop it first (Ctrl+C in its terminal), then reset.`);
    process.exit(1);
  }
  if (existsSync(INSTANCE) && !existsSync(MARKER)) {
    console.error(`${shown(INSTANCE)} exists but wasn't made by the demo, so it's left alone. Move it away, then run this again.`);
    process.exit(1);
  }
  const token = keptToken();
  for (const dir of [PROJECT, WORKTREES, FORGE, CAMP]) rmSync(dir, { recursive: true, force: true });
  rmSync(PID, { force: true });
  mkdirSync(INSTANCE, { recursive: true });
  writeFileSync(MARKER, "Made by `npm run demo`. Everything in this folder is the demo's own and is replaced by `npm run demo:reset`.\n");
  seedProject();
  seedCamp(token);
  console.log("The demo is back to its starting state:");
  const n = count(ticketKeys().length);
  console.log(`  ${shown(PROJECT)} has its ${n} bugs again, on main, with no other branches or worktrees`);
  console.log(`  all ${n} tickets are back in To Do, and there are no pull requests`);
  console.log("  the demo's camp has no conversations, and the crew remembers nothing of the last run");
  console.log("Start it with: npm run demo");
}

// ---------- check ----------
// Run the sample project's tests and say, ticket by ticket, what fails. A ticket's tests are
// the ones marked { todo: "<key>" }: they fail while its bug is there, without failing the build.
function check(dirArg) {
  const dir = dirArg ? resolve(dirArg) : PROJECT;
  if (!existsSync(join(dir, "package.json"))) {
    console.error(dirArg ? `${dir} isn't a copy of the sample project.` : "The demo isn't set up yet. Run `npm run demo` once, or `npm run demo:reset`.");
    process.exit(1);
  }
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap"], { cwd: dir, encoding: "utf8" });
  const results = [...run.stdout.matchAll(/^\s*(not ok|ok) \d+ - (.*?)(?: # TODO (\S+).*)?$/gm)].map((m) => ({ ok: m[1] === "ok", name: m[2], ticket: m[3] }));
  const keys = ticketKeys();
  console.log(`Tests in ${shown(dir)}:\n`);
  for (const key of keys) {
    const mine = results.filter((r) => r.ticket === key);
    const failing = mine.filter((r) => !r.ok);
    if (failing.length) {
      console.log(`  ${key}  open: ${failing.length} of its ${mine.length} ${mine.length === 1 ? "test fails" : "tests fail"}`);
      for (const r of failing) console.log(`            ✗ ${r.name}`);
    } else if (mine.length) {
      console.log(`  ${key}  its ${mine.length === 1 ? "test passes" : `${mine.length} tests pass`}, but ${mine.length === 1 ? "it is" : "they are"} still marked as open (the marker should come off with the fix)`);
    } else {
      console.log(`  ${key}  no tests are marked as open for it here: it has been fixed in this copy`);
    }
  }
  const hard = results.filter((r) => !r.ok && !r.ticket);
  const passing = results.filter((r) => r.ok && !r.ticket).length;
  console.log(`\n  ${passing} other ${passing === 1 ? "test passes" : "tests pass"}${hard.length ? `, and ${hard.length} ${hard.length === 1 ? "fails" : "fail"} outright:` : "."}`);
  for (const r of hard) console.log(`            ✗ ${r.name}`);
  console.log(`  \`npm test\` here ${run.status === 0 ? "passes (tests marked as open don't count against it)" : `fails (exit code ${run.status})`}.`);
  process.exit(hard.length ? 1 : 0);
}

// ---------- start ----------
async function start() {
  const already = runningPid();
  if (already) {
    console.error(`The demo is already running (process ${already}): http://127.0.0.1:${CAMP_PORT}/\nStop it with Ctrl+C in its terminal before starting another.`);
    process.exit(1);
  }
  if (Number(process.versions.node.split(".")[0]) < 22) {
    console.error(`Mae needs Node 22.9 or later (this is ${process.versions.node}).`);
    process.exit(1);
  }
  if (!existsSync(join(ROOT, "node_modules", "tsx"))) {
    console.error("Mae's packages aren't installed yet. Run `npm install` first.");
    process.exit(1);
  }
  const fresh = setUp();
  writeJiraLink(); // (the stand-in's port can be changed between starts)
  const tsx = import.meta.resolve("tsx");

  // The page, built if it's missing or older than its sources (as `npm run ui:serve` does).
  const built = spawnSync(process.execPath, ["--import", tsx, join(ROOT, "scripts", "ui-build.ts"), "--if-stale"], { cwd: ROOT, stdio: "inherit" });
  if (built.status !== 0) {
    if (!existsSync(join(ROOT, "ui", "dist", "index.html"))) { console.error("Mission control's page couldn't be built, so there's nothing to show. Fix the build (`npm run ui:build`) and start again."); process.exit(1); }
    console.error("⚠️  Mission control's page couldn't be rebuilt; the demo is using the last build.");
  }

  const { startStandIns } = await import("./standins/server.mjs");
  process.env.MAE_DEMO_FORGE = FORGE;
  let standIns;
  try { standIns = await startStandIns(STANDIN_PORT); }
  catch (e) {
    console.error(e?.code === "EADDRINUSE" ? `Port ${STANDIN_PORT} is taken. Set MAE_DEMO_STANDIN_PORT to a free port and start again.` : `The stand-in for Jira couldn't start: ${e?.message ?? e}`);
    process.exit(1);
  }

  // The camp's environment: yours (and the repository's .env, if there is one, for an API key),
  // then the demo's own settings on top.
  const env = { ...process.env };
  try { for (const [name, value] of Object.entries(parseEnv(readFileSync(join(ROOT, ".env"), "utf8")))) env[name] ??= value; } catch { /* no .env: fine on a subscription */ }
  // Never your real Jira, and never open to the network: this is a demo with stand-in data.
  for (const name of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "CAMP_LAN", "CAMP_HOST", "CAMP_NAMES", "CAMP_NEW_TOKEN"]) delete env[name];
  const bin = join(DEMO, "standins", "bin");
  Object.assign(env, {
    CAMP_PORT: String(CAMP_PORT),
    JIRA_ALLOW_ANY_HOST: "1",                                   // lets the camp's Jira link point at 127.0.0.1
    CAMP_GH: join(bin, "gh"),                                   // the stand-in for the GitHub CLI…
    PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? ""}`, // …wherever the camp runs `gh`
    MAE_DEMO_FORGE: FORGE,
  });

  console.log("🎪 Mae demo");
  console.log(`   Sample project:  ${shown(PROJECT)}${fresh ? ` (just set up, with its ${count(ticketKeys().length)} bugs)` : ""}`);
  console.log(`   Tickets and pull requests (stand-ins for Jira and GitHub): ${STANDIN_URL}/`);
  console.log(`   Tickets to try:  ${keyRange(ticketKeys())} (see demo/README.md)`);
  console.log("   To start over:   stop this, then `npm run demo:reset`\n");

  const camp = spawn(process.execPath, ["--import", tsx, join(ROOT, "src", "server.ts")], { cwd: CAMP, env, stdio: "inherit" });
  writeFileSync(PID, `${process.pid}\n`);
  const done = (code) => { rmSync(PID, { force: true }); standIns.close(); process.exit(code); };
  camp.on("exit", (code) => done(code ?? 0));
  camp.on("error", (e) => { console.error(`The camp couldn't start: ${e.message}`); done(1); });
  // Ctrl+C reaches the camp too (same terminal); a signal sent to this process alone is passed on.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { if (camp.exitCode === null && camp.signalCode === null) camp.kill(signal); });
}

const [command = "start", ...rest] = process.argv.slice(2);
if (command === "start") await start();
else if (command === "reset") reset();
else if (command === "check") check(rest[0]);
else { console.error("Usage: node demo/demo.mjs [start | reset | check [folder]]"); process.exit(1); }
