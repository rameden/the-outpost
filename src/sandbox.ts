// The shell sandbox (macOS and Linux): when it's on, commands the crew runs can't reach the network, can't
// write outside the folder they're working in (plus temp folders), and can't read your keys or
// .env files. Because of those limits they run without asking you first, which is what lets tests
// and type checks run unattended. Anything that needs more (an install, a push) is asked for the
// usual way and runs outside the sandbox only if you approve it.
//
// Turn it on in mission control (Quests tab) or with "shell": { "sandbox": true } in
// camp/settings.json. On macOS it uses the system's own sandbox-exec. On Linux it uses bubblewrap
// (bwrap, from your distribution's "bubblewrap" package), when it's installed and the system lets
// it make a namespace (it's tried once). Elsewhere it stays off and every command asks, as before.
//
// Allowed hosts (macOS): "shell": { "allowHosts": ["registry.npmjs.org", "*.github.com"] } lets
// sandboxed commands reach those hosts, and only those, through a proxy the camp runs (netproxy.ts),
// so installs and fetches stop needing an unsandboxed approval. On Linux a sandboxed command has
// its own network with nothing but its own localhost, so allowed hosts don't apply there yet.
//
// Linux differences: .env files are hidden in the folder the command works in (to a few levels
// deep, outside node_modules and .git) rather than anywhere on disk, and localhost is the
// sandbox's own: a server you run outside it can't be reached from inside.
//
// Two things it's also used for, whether or not you turned it on, wherever it's available:
//  - The simple read-only commands that never ask (ls, git status, git diff…) run inside it with
//    nothing writable but temp folders. "git diff" runs whatever program the folder's git config
//    names, so "read-only" is enforced rather than assumed.
//  - No sandboxed command can write git's config or hooks, in any repository under the project
//    (.git/config, .git/hooks, .git/modules), because the camp and you run git there later, outside
//    the sandbox. So "git init", "git config" and "git remote add" inside a project need the
//    unsandboxed approval; committing works. Repositories in temp folders are left alone.
//
// What it does not do: protect the working folder itself. A sandboxed command can still change or
// delete files there (that's what running a build or a formatter needs). Use a worktree for work
// you want kept apart from your own checkout.
//
// Nor (on macOS) does it keep a command from connecting to mission control's port: localhost is
// open so test servers work, and sandbox-exec can't reliably carve one port out of that. What
// keeps a command from driving the camp is the access token, which it can't read (camp/.token is
// hidden from the sandbox and from the file tools). On Linux the sandbox has its own localhost.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
export type SandboxKind = "seatbelt" | "bwrap";
let bwrapPath: string | null | undefined;
// bubblewrap is there and works here (some systems don't allow unprivileged namespaces): tried once.
function findBwrap(): string | null {
  if (bwrapPath !== undefined) return bwrapPath;
  bwrapPath = null;
  for (const p of ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]) {
    if (!existsSync(p)) continue;
    try { execFileSync(p, ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", "/bin/true"], { stdio: "ignore", timeout: 5000 }); bwrapPath = p; } catch { /* not allowed here */ }
    break;
  }
  return bwrapPath;
}
export function sandboxKind(): SandboxKind | null {
  if (process.platform === "darwin") return existsSync(SANDBOX_EXEC) ? "seatbelt" : null;
  if (process.platform === "linux") return findBwrap() ? "bwrap" : null;
  return null;
}
export const sandboxAvailable = () => sandboxKind() !== null;
export const SANDBOX_NEEDS = "The sandbox needs macOS (sandbox-exec) or Linux with bubblewrap (bwrap) installed.";

const q = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const HOME = homedir();
// Credentials no command needs for building or testing.
const PRIVATE_HOME = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".claude", ".config/gh", ".config/gcloud", ".config/anthropic", "Library/Keychains",
  // Your browsers' own folders: history (which holds mission control's link, key and all, and a
  // sandboxed command can reach localhost), cookies, and saved sign-ins. Test browsers that tools
  // download for themselves (Playwright, Puppeteer) keep their files elsewhere and are unaffected.
  "Library/Application Support/Google/Chrome", "Library/Application Support/Chromium", "Library/Application Support/BraveSoftware", "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc", "Library/Application Support/Vivaldi", "Library/Application Support/Firefox", "Library/Application Support/com.operasoftware.Opera",
  "Library/Safari", "Library/Cookies", "Library/Containers/com.apple.Safari",
  ".mozilla", ".config/google-chrome", ".config/chromium", ".config/BraveSoftware", ".config/microsoft-edge",
  // What you've typed at a prompt, which now and then includes a pasted key.
  ".zsh_history", ".bash_history", ".zsh_sessions"];

export type SandboxPlan = {
  writable: string[];      // folders the command may write in (real paths)
  readOnly?: string[];     // inside those, paths that stay read-only
  unreadable?: string[];   // extra paths the command can't read
  envRoots?: string[];     // Linux: folders whose .env files are covered over (default: the writable ones)
};

// ---------- What a command the crew starts gets to see of your environment ----------
// The camp loads .env into its own environment (scripts/env.mjs), so its API key, your Jira token
// and the like are all there. A command an agent runs has no use for them, and a sandboxed `env`
// would print them, so they're left out of every shell command and connector the camp starts:
// names starting ANTHROPIC_, JIRA_ or CLAUDE_CODE_OAUTH, and any name ending _API_KEY, _TOKEN,
// _SECRET, _PASSWORD or _CREDENTIALS. To let one through on purpose (GH_TOKEN for `gh`, say), name
// it in CAMP_SHELL_ENV_ALLOW, comma-separated: CAMP_SHELL_ENV_ALLOW=GH_TOKEN,NPM_TOKEN
const SECRET_ENV = /^(ANTHROPIC_|JIRA_|CLAUDE_CODE_OAUTH)|(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i;
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const keep = new Set((process.env.CAMP_SHELL_ENV_ALLOW ?? "").split(",").map((n) => n.trim()).filter(Boolean));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (keep.has(name) || !SECRET_ENV.test(name)) env[name] = value;
  return { ...env, ...extra };
}

// The environment for git when the camp itself runs it (the git tool, the Files flyout) in a
// folder whose git config it can't trust: a sandboxed command may have written that config, and
// git runs the programs a config names (a file-system monitor, hooks, filters) as you, outside
// the sandbox. These settings come after the repository's own and win over it. `more` adds
// settings for one call (see gitFilterOverrides). No secrets are passed on either.
export function gitSafeEnv(more: [key: string, value: string][] = []): NodeJS.ProcessEnv {
  const env = childEnv({ GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
  // These would name a program to run, or point git at another repository or config.
  for (const name of ["GIT_EXTERNAL_DIFF", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_PARAMETERS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_EDITOR"]) delete env[name];
  const pairs: [string, string][] = [
    ["core.fsmonitor", "false"],               // a program run on every status and diff
    ["core.hooksPath", "/dev/null"],           // no hooks (post-index-change runs when the index is refreshed)
    ["core.pager", "cat"],
    ["log.showSignature", "false"],            // gpg.program
    ["status.submoduleSummary", "false"],      // these two make git run itself inside each submodule
    ["diff.submodule", "short"],
    ["safe.bareRepository", "explicit"],       // a folder made to look like a bare repository isn't taken for one
    ...more,
  ];
  let n = Number(env.GIT_CONFIG_COUNT) || 0;   // after any you set yourself
  for (const [key, value] of pairs) { env[`GIT_CONFIG_KEY_${n}`] = key; env[`GIT_CONFIG_VALUE_${n}`] = value; n++; }
  env.GIT_CONFIG_COUNT = String(n);
  return env;
}

// Settings that switch off every clean/smudge filter the repository's own config defines. status,
// diff and blame run a file's "clean" filter to compare it with what's committed, and a filter
// is a program named in the config. Filters set up only in your own git config (~/.gitconfig:
// git-lfs, say) are yours and stay on; one the repository's config defines or redefines is off.
// Reading the config runs nothing.
export function gitFilterOverrides(dir: string): Promise<[string, string][]> {
  const find = (scoped: boolean) => new Promise<{ out: string; failed: boolean }>((done) => {
    execFile("git", ["config", ...(scoped ? ["--show-scope"] : []), "-z", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"],
      { cwd: dir, timeout: 8000, maxBuffer: 1_000_000, encoding: "utf8", env: gitSafeEnv() },
      (err, stdout) => done({ out: String(stdout ?? ""), failed: !!err && (err as { code?: unknown }).code !== 1 })); // 1: nothing matched
  });
  const nameOf = (entry: string) => entry.split("\n")[0].match(/^filter\.(.*)\.[a-z]+$/s)?.[1];
  return (async () => {
    const names = new Set<string>();
    // Each entry is "scope\0key\nvalue\0". (Zero-separated, so a filter's name can't be made to hide another line.)
    let { out, failed } = await find(true);
    const parts = out.split("\0");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const name = nameOf(parts[i + 1]);
      if (name !== undefined && parts[i] !== "global" && parts[i] !== "system") names.add(name);
    }
    // A git too old to say where a setting comes from: every filter is switched off.
    if (failed) { ({ out, failed } = await find(false)); for (const entry of out.split("\0")) { const name = nameOf(entry); if (name !== undefined) names.add(name); } }
    // An empty command means "no filter"; required=false so the missing filter isn't an error.
    return [...names].flatMap((name): [string, string][] => [
      [`filter.${name}.clean`, ""], [`filter.${name}.smudge`, ""], [`filter.${name}.process`, ""], [`filter.${name}.required`, "false"],
    ]);
  })();
}

// Git's own config, hooks and submodule repositories, in any repository (nested ones, ones made a
// moment ago): git runs what they name, and the camp runs git outside the sandbox.
const GIT_RUNS = "/\\.git/(config|hooks(/.*)?|modules(/.*)?)$";
const TEMP_DIRS = ["/private/tmp", "/private/var/folders"];

export function sandboxProfile(plan: SandboxPlan): string {
  const sub = (paths: string[]) => paths.map((p) => `(subpath ${q(p)})`).join(" ");
  return [
    "(version 1)",
    "(allow default)",
    // No network, except talking to itself: test servers on localhost keep working.
    "(deny network*)",
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-bind (local ip "localhost:*") (local ip "*:*"))',
    // (That includes mission control's own port. A rule denying one localhost port was tried here
    // and doesn't hold: next to the "localhost:*" allow, sandbox-exec ignores it most of the time,
    // whichever comes first. See "What it does not do" at the top.)
    // Writes: only the working folder and temp folders.
    "(deny file-write*)",
    `(allow file-write* ${sub([...plan.writable, ...TEMP_DIRS, "/dev"])})`,
    plan.readOnly?.length ? `(deny file-write* ${sub(plan.readOnly)})` : "",
    // Not git's config or hooks, wherever a repository is (after the allow, so it wins). Temp
    // folders are left alone: test suites make repositories there, and the camp never runs git there.
    `(deny file-write* (require-all (regex #"${GIT_RUNS}") ${TEMP_DIRS.map((t) => `(require-not (subpath ${q(t)}))`).join(" ")}))`,
    // Reads: not your credentials, and not .env files anywhere.
    `(deny file-read* ${sub([...PRIVATE_HOME.map((p) => join(HOME, p)), ...(plan.unreadable ?? [])])} (regex #"/\\.env[^/]*$"))`,
  ].filter(Boolean).join("\n");
}

// Linux: everything read-only, then the writable folders (and /tmp) bound back writable, the
// read-only ones inside them bound read-only again, and what mustn't be read covered over.
// --unshare-net: no network but its own localhost. --die-with-parent: Stop ends it.
export function bwrapArgs(plan: SandboxPlan, command: string): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session"];
  for (const w of [...plan.writable, "/tmp", "/var/tmp"]) if (existsSync(w)) args.push("--bind", w, w);
  // Git's config, hooks and submodule repositories: the ones named in the plan, and those of any
  // repository found a few levels down in the writable folders. (bubblewrap can only cover what is
  // already there, so a repository made inside the sandbox isn't covered until the next command.)
  const gitParts = plan.writable.flatMap((root) => gitDirsIn(root)).flatMap((g) => [join(g, "config"), join(g, "hooks"), join(g, "modules")]);
  for (const r of new Set([...(plan.readOnly ?? []), ...gitParts])) if (existsSync(r)) args.push("--ro-bind", r, r);
  const hide = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) args.push("--tmpfs", p);
    else args.push("--ro-bind", "/dev/null", p);
  };
  for (const p of [...PRIVATE_HOME.map((x) => join(HOME, x)), ...(plan.unreadable ?? [])]) hide(p);
  for (const root of plan.envRoots ?? plan.writable) for (const env of envFilesIn(root)) hide(env);
  return [...args, "/bin/sh", "-c", command];
}
// Names matching `want` a few levels down (bwrap can't match a pattern the way sandbox-exec can).
function namedIn(root: string, want: RegExp, depth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      if (want.test(n)) { out.push(p); continue; }
      if (d > 0 && n !== "node_modules" && n !== ".git") { try { if (statSync(p).isDirectory()) walk(p, d - 1); } catch { /* gone */ } }
    }
  };
  walk(root, depth);
  return out.slice(0, 500);
}
const envFilesIn = (root: string) => namedIn(root, /^\.env/, 4);
const gitDirsIn = (root: string) => namedIn(root, /^\.git$/, 4).filter((p) => { try { return lstatSync(p).isDirectory(); } catch { return false; } });

// The command line that runs `command` inside the sandbox. env: what to add to its environment
// (the allowed-hosts proxy, when there is one).
export function sandboxed(command: string, plan: SandboxPlan, kind: SandboxKind | null = sandboxKind()): { file: string; args: string[] } {
  if (kind === "bwrap") return { file: findBwrap() ?? "bwrap", args: bwrapArgs(plan, command) };
  return { file: SANDBOX_EXEC, args: ["-p", sandboxProfile(plan), "/bin/sh", "-c", command] };
}
