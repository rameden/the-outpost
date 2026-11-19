// The camp's armory: every tool any character can carry.
// Each tool = a definition the model sees + (for client tools) a handler we run.

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync, statSync, lstatSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { ask } from "./ask.js";
import { currentQuestId, currentSignal, isUnattended } from "./context.js";
import { emit } from "./events.js";
import { autoApproval, approvalNow, shellRule } from "./shell.js";
import { reviewCommand, reviewerOn } from "./reviewer.js";
import { resolveLinked, linkedDisplayPath, SECRET_NAME, inside, isSymlink, realTarget, loadLinks, linkRoot } from "./links.js";
import { allowShellCommand, selfEditAllowed, shellSettings } from "./settings.js";
import { childEnv, gitSafeEnv, sandboxAvailable, sandboxKind, sandboxed, type SandboxPlan } from "./sandbox.js";
import { allowedHosts, ensureProxy, proxyEnv, refusedSince } from "./netproxy.js";
import { afterWrite, beforeWrite, noteRead, snapshotBeforeShell } from "./checkpoints.js";
import { agentShell, shellNote, stopTree } from "./platform.js";

// How a real path is shown to agents: relative inside the camp, links/<name>/… inside a linked folder.
export function displayPath(abs: string): string {
  const rel = relative(CAMP_ROOT, abs);
  if (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)) return rel.split(sep).join("/") || ".";
  return linkedDisplayPath(abs) ?? abs;
}
export { rl } from "./terminal.js";

// Scheduled jobs run with nobody at the keyboard. Anything that would ask the user
// (shell commands, new jobs) is refused instead of waiting forever for an answer.
// It's per run (see context.ts), so a job running alongside your own expedition doesn't change yours.
export const campMode = { get unattended() { return isUnattended(); } };

// A handler returns text, or content blocks (e.g. an image) for tools like view_file.
export type ToolOutput = string | Exclude<Anthropic.ToolResultBlockParam["content"], string | undefined>;
// ctx.opId: the operation id the call was journaled under (oplog.ts), for a tool that can use it as an idempotency key.
export type Handler = (input: any, ctx?: { opId?: string }) => Promise<ToolOutput>;
export type Tool = { def: Anthropic.ToolUnion; run?: Handler }; // no `run` = server-side tool

// ---------- Camp boundaries ----------
// File tools only reach inside the camp folder, and each agent's tools are bound to that agent:
// - skills/ changes only through propose_skill + your review
// - camp/ is read-only, except the agent's OWN outputs folder (camp/agents/<self>/outputs/)
// - nobody can read another agent's memory or sessions (camp/agents/<other>/memory.md, sessions/)
export const CAMP_ROOT = process.cwd();
const READ_ONLY = new Set(["skills", "camp", ".git", "node_modules", "plugins"]);

// The camp's own code. Agents can read it but not change it (unless you set "selfEdit": true in
// camp/settings.json), so nothing they read can talk them into loosening the rules in this file
// or in shell.ts. It only applies where the harness itself lives, not to a project's own src/.
const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIRS = ["src", "dist", "tests", "evals"]; // dist/: the built server that `npm run prod` runs
const HARNESS_FILES = ["package.json", "package-lock.json", "tsconfig.json"];
function isHarnessCode(abs: string): boolean {
  const rel = relative(HARNESS_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return HARNESS_FILES.includes(rel) || HARNESS_DIRS.includes(rel.split(sep)[0]);
}
// Camp files that can hold tokens (connector env, the phone topic). Nobody's file tools read them.
const PRIVATE_CAMP_FILES = new Set([
  "mcp.json", "settings.json", "jira.json", "providers.json", "triggers.json", // jira.json holds your Jira API token; providers.json your other models' keys; triggers.json what starts work on its own
  ".token", // mission control's access token: with it, a command could drive the camp as you
  // The camp's own records of every conversation: what you asked, what each agent answered (other
  // agents' private work included), what was kept in memory, and how you rated it.
  "feed.jsonl", "threads.jsonl", "quest-log.jsonl", "conversations.json", "memory-log.jsonl", "feedback.jsonl", "limits.json",
  "notes.json", // your own notes (notes.ts): the crew sees one only when you put it in a message
  "tickets.json", // Mae tickets (tickets.ts): the crew reads and files them through its `tickets` tool, which checks what it writes
]);
// And whole folders: checkpoints/ keeps copies of files as they were before each change, from every
// conversation and project, whatever this one may see.
// briefs/ holds each morning's brief, which quotes your own notes (brief.ts).
const PRIVATE_CAMP_DIRS = new Set(["checkpoints", "briefs"]);
// A private file's other forms are as private as it is: the copy set aside when it couldn't be
// read (settings.json.damaged-<time>), and the temp file a write goes through (….tmp-<pid>-<x>).
const privateName = (name: string) => PRIVATE_CAMP_FILES.has(name.replace(/\.(damaged-[\w-]+|tmp-\d+-[a-z0-9]+)$/, ""));

// Near the turn limit, a note rides along with a tool result so the agent lands the work instead
// of being cut off mid-step. Used by both runtimes.
export function wrapUpNote(left: number): string | null {
  if (left === 3) return "[Camp note: you have 3 turns left in this run. Finish the step you're on, then use your last turn for the report: what is done, what is left, and exactly where to pick up (files, commands, findings). Don't start anything new.]";
  if (left === 1) return "[Camp note: this is your last turn. Don't call another tool. Write the report now: done, left to do, and where to pick up.]";
  return null;
}

// What the user says to an expedition while it's running, as the agent sees it.
export const steerNote = (texts: string[]) =>
  `[The user sent this while you were working. It's addressed to the whole expedition: act on it if it concerns your part, and carry on otherwise.]\n${texts.join("\n\n")}`;

// Long tool output is cut so one call can't flood the context. Used by both runtimes.
export const MAX_TOOL_OUTPUT = 50_000;
export function clipOutput<T>(out: T): T {
  if (typeof out === "string" && out.length > MAX_TOOL_OUTPUT) {
    return (out.slice(0, MAX_TOOL_OUTPUT) + `\n…[cut at ${MAX_TOOL_OUTPUT.toLocaleString()} characters; narrow the request to see the rest]`) as T;
  }
  return out;
}

// A folder's real path, and the real camp folder: a path can reach either through a symlink (on
// macOS /var is one, to /private/var), so "is this inside that" compares real paths.
const realOf = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
let realCampRoot: string | undefined;
const realCamp = () => (realCampRoot ??= realOf(CAMP_ROOT));

export function campPath(path: string, mode: "read" | "write", self?: string): string {
  // Linked folders (links/<name>/…) live elsewhere on disk; links.ts enforces their rules.
  const linked = resolveLinked(path, mode);
  if (linked) {
    const back = relative(CAMP_ROOT, linked);
    // A link that contains the camp doesn't get around the camp's own rules.
    if (back === "" || (!back.startsWith(".." + sep) && back !== ".." && !isAbsolute(back))) return campPath(back || ".", mode, self);
    // Nor does a symlink inside such a link that leads into the camp.
    const real = realTarget(linked);
    if (inside(real, realCamp())) campRules(resolve(CAMP_ROOT, relative(realCamp(), real)), path, mode, self);
    if (mode === "write" && (isHarnessCode(linked) || isHarnessCode(real)) && !selfEditAllowed()) throw new Error(`${path} is part of the camp's own code, which is read-only.`);
    return linked;
  }
  const abs = resolve(CAMP_ROOT, path);
  campRules(abs, path, mode, self);
  // Symlinks. The rules above went by the path as written; a shell command can make a symlink
  // with an innocent name that points at camp/providers.json or ~/.ssh/id_ed25519. So when the
  // path really leads somewhere else, that place has to pass the rules too: it must be in the
  // camp or a linked folder of this conversation, and be something this agent may read (or write).
  // A symlink that stays inside (node_modules/.bin/…) reads as before.
  const real = realTarget(abs);
  if (real !== resolve(realCamp(), relative(CAMP_ROOT, abs))) {
    const shown = `${path} (which is really ${displayPath(real)})`;
    if (inside(real, realCamp())) campRules(resolve(CAMP_ROOT, relative(realCamp(), real)), shown, mode, self);
    else {
      let inLink: string | undefined;
      try { inLink = resolveLinked(real, mode); } catch (e: any) { throw new Error(`${path} is a symlink, and where it leads is off limits: ${e.message}`); }
      if (!inLink) throw new Error(`${path} is a symlink that leads outside the camp, so file tools don't follow it.`);
      if (mode === "write" && isHarnessCode(real) && !selfEditAllowed()) throw new Error(`${path} is part of the camp's own code, which is read-only.`);
    }
    if (mode === "write" && isSymlink(abs)) throw new Error(`${path} is a symlink. File tools don't write through symlinks: write to the file it points to, by its own path.`);
  }
  return abs;
}

// The camp's own rules for one place inside the camp folder. Throws when `abs` isn't allowed.
// `path` is how the agent named it (for the message).
function campRules(abs: string, path: string, mode: "read" | "write", self?: string): void {
  const rel = relative(CAMP_ROOT, abs);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`${path} is outside the camp (${CAMP_ROOT}). Use a path inside it, or ask the user to link that folder.`);
  }
  const parts = rel.split(sep);
  const top = parts[0];
  if (top.startsWith(".env")) throw new Error(`${path} holds secrets and is off limits.`);
  // The same secret names that are off limits in linked folders, at any depth (sub/.env, id_rsa, *.pem…).
  if (parts.some((seg) => SECRET_NAME.test(seg))) throw new Error(`${path} looks like a secret (keys, .env, credentials) and is off limits.`);
  if (top === "camp" && parts.length === 2 && privateName(parts[1])) {
    throw new Error(`${path} holds the user's private camp configuration and is off limits.`);
  }
  if (top === "camp" && PRIVATE_CAMP_DIRS.has(parts[1])) throw new Error(`${path} is part of the camp's own record keeping and is off limits.`);
  // Git's own data at any depth (a nested repository's config and hooks can run programs).
  if (mode === "write" && parts.includes(".git")) throw new Error(`${path} is git's own data, which file tools don't change.`);
  if (mode === "write" && isHarnessCode(abs) && !selfEditAllowed()) {
    throw new Error(`${path} is part of the camp's own code, which is read-only. Work in a linked folder or your outputs folder` +
      (self ? ` (camp/agents/${self}/outputs/)` : "") + `. The user can allow it with "selfEdit": true in camp/settings.json.`);
  }

  // camp/agents/<owner>/<area>/...
  if (top === "camp" && parts[1] === "agents" && parts[2]) {
    const owner = parts[2];
    const area = parts[3] ?? "";
    const mine = owner === self;
    if (!mine && (area === "memory.md" || area === "sessions")) {
      throw new Error(`That's the ${owner}'s private ${area === "sessions" ? "session history" : "memory"}. You can read their outputs/ instead.`);
    }
    if (mode === "write") {
      if (mine && area === "outputs") return;
      throw new Error(mine ? "Write your files under your outputs/ folder; use remember for your memory." : `camp/agents/${owner}/ is the ${owner}'s workspace, not yours.`);
    }
    return;
  }

  if (mode === "write" && READ_ONLY.has(top)) {
    throw new Error(
      top === "skills"
        ? "skills/ is read-only. New skills are proposed by the Quartermaster and approved by the user."
        : `${top}/ is read-only for file tools.` + (self ? ` Save your work to camp/agents/${self}/outputs/.` : "")
    );
  }
}

// File tools bound to one agent, so the boundaries above know whose workspace is whose.
export function readFileFor(self: string): Tool {
  return {
    def: {
      name: "read_file",
      description:
        "Read a text file inside the camp folder or a linked folder (links/<name>/…): SKILL.md files, code, notes, wiki pages, " +
        "teammates' outputs. Long files come back in pieces: the reply says which lines you got and the offset to continue from.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number", description: "First line to return (1 = the top). Default 1." },
          limit: { type: "number", description: `How many lines to return. Default ${READ_MAX_LINES}.` },
        },
        required: ["path"],
      },
    },
    run: async ({ path, offset, limit }) => {
      const abs = campPath(path, "read", self);
      const text = readFileSync(abs, "utf8");
      noteRead(abs);
      return pageOf(text, offset, limit);
    },
  };
}

// One piece of a file: up to `limit` lines from line `offset`, and never more than READ_MAX_CHARS,
// so even a huge file (or one enormous line) can be read to the end a piece at a time.
const READ_MAX_LINES = 2000;
const READ_MAX_CHARS = 40_000;
export function pageOf(text: string, offset?: number, limit?: number): string {
  const lines = text.split("\n");
  const first = Math.max(1, Math.floor(Number(offset) || 1));
  const max = Math.max(1, Math.floor(Number(limit) || READ_MAX_LINES));
  if (first > lines.length) return `That file has ${lines.length} lines; offset ${first} is past the end.`;
  const out: string[] = [];
  let chars = 0;
  let i = first - 1;
  for (; i < lines.length && out.length < max; i++) {
    if (chars + lines[i].length > READ_MAX_CHARS) {
      if (out.length) break;
      out.push(lines[i].slice(0, READ_MAX_CHARS) + "…[line cut: it is longer than one read can return]");
      i++;
      break;
    }
    out.push(lines[i]);
    chars += lines[i].length + 1;
  }
  if (first === 1 && i >= lines.length) return out.join("\n");
  const more = i < lines.length ? ` Continue with offset=${i + 1}.` : " That's the end of the file.";
  return `${out.join("\n")}\n\n[Lines ${first}–${i} of ${lines.length}.${more}]`;
}

// outputsOnly: for roles that read untrusted content (the Scout reads the web), so nothing they
// read can get them to plant files in a project. They save to their own outputs folder only.
export function writeFileFor(self: string, opts: { outputsOnly?: boolean } = {}): Tool {
  const outputs = resolve(CAMP_ROOT, "camp", "agents", self, "outputs") + sep;
  return {
    def: {
      name: "write_file",
      description: opts.outputsOnly
        ? `Create or overwrite a text file in your own folder, camp/agents/${self}/outputs/ (parent folders are created). ` +
          `You can't write anywhere else: hand project changes to the Artificer or the Scribe.`
        : `Create or overwrite a text file (parent folders are created). Your own files go in ` +
        `camp/agents/${self}/outputs/; project files elsewhere are fine when a brief asks for them. ` +
        `skills/, plugins/, the camp's own code, and the rest of camp/ are read-only, and so are linked folders unless the user gave edit access.`,
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    run: async ({ path, content }) => {
      const abs = campPath(path, "write", self);
      if (opts.outputsOnly && !abs.startsWith(outputs)) {
        return `You can only write inside camp/agents/${self}/outputs/. Save it there and say where it is in your report.`;
      }
      beforeWrite(abs, displayPath(abs));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      afterWrite(abs);
      return `Wrote ${content.length} chars to ${path}`;
    },
  };
}

// Run a shell command without blocking the camp: other quests, the live feed, and Stop keep
// working while it runs. Stop (or the time limit) ends the command and everything it started.
const SHELL_TIMEOUT_MS = 120_000;
const SHELL_MAX_BYTES = 2_000_000;
// env: extra variables for this one command, on top of the camp's environment without its secrets.
export type ShellOpts = { signal?: AbortSignal; timeoutMs?: number; cwd?: string; sandbox?: SandboxPlan; env?: Record<string, string> };
export async function runShell(command: string, signalOrOpts?: AbortSignal | ShellOpts, timeout?: number): Promise<string> {
  const o: ShellOpts = signalOrOpts instanceof AbortSignal || signalOrOpts === undefined ? { signal: signalOrOpts, timeoutMs: timeout } : signalOrOpts;
  const { signal, cwd = CAMP_ROOT } = o;
  const timeoutMs = o.timeoutMs ?? SHELL_TIMEOUT_MS;
  // Every command gets the camp's environment without its secrets (API keys, tokens: see childEnv
  // in sandbox.ts), sandboxed or not. The owner can let a name through with CAMP_SHELL_ENV_ALLOW.
  let env = childEnv(o.env);
  // Sandboxed, with hosts you allow: through the camp's proxy (macOS; see netproxy.ts).
  if (o.sandbox && sandboxKind() === "seatbelt" && allowedHosts().length) {
    try { env = { ...env, ...proxyEnv(await ensureProxy()) }; } catch { /* no proxy: no network, as before */ }
  }
  return new Promise((done) => {
    if (signal?.aborted) return done("Not run: the expedition was stopped.");
    const io = { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], env, windowsHide: true };
    const box = o.sandbox ? sandboxed(command, o.sandbox) : null;
    // On Windows the command goes to Git Bash (or PowerShell, without it): see platform.ts.
    const shell = agentShell();
    const child = box ? spawn(box.file, box.args, io) : shell ? spawn(shell.file, shell.args(command), io) : spawn(command, { ...io, shell: true });
    let out = "";
    let ended: string | null = null;
    const take = (chunk: Buffer) => { if (out.length < SHELL_MAX_BYTES) out += chunk.toString("utf8"); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const kill = (why: string) => {
      ended ??= why;
      stopTree(child); // the command and everything it started
    };
    const timer = setTimeout(() => kill(`Stopped after ${Math.round(timeoutMs / 1000)}s (the time limit for one command).`), timeoutMs);
    const onAbort = () => kill("Stopped by the user.");
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (text: string) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      done(text);
    };
    child.on("error", (err) => finish(`Couldn't run it: ${err.message}`));
    child.on("close", (code) => {
      const body = out.trim();
      if (ended) return finish(`${ended}\n${body}`.trim());
      // A failing test run is useful output, not a crash.
      finish(code === 0 ? body || "(no output)" : `Exit code ${code ?? "?"}\n${body}`.trim());
    });
  });
}

// Where a command runs: the camp folder, or a folder you name the way the file tools do
// (links/<name> runs inside that linked folder, or this expedition's worktree of it).
export function shellDir(cwd: unknown, self?: string): string {
  if (cwd == null || cwd === "" || cwd === ".") return CAMP_ROOT;
  const abs = campPath(String(cwd), "read", self);
  if (!statSync(abs).isDirectory()) throw new Error(`${cwd} is a file, not a folder.`);
  return abs;
}

// "cd <folder> && …": the folder a command goes to first is the one it works in. The crew often
// writes that instead of giving cwd, and the sandbox would then let it write only where it started
// (so tests and type checks in a linked project failed there and came back asking to run outside
// it). Counts only for a folder cwd could have named: inside the camp or a folder linked to this
// conversation, by the same rules. Anything else, and the sandbox is planned for `dir` as before.
export function shellStartDir(command: string, dir: string, self?: string): string {
  const m = command.match(/^\s*cd\s+(?:"([^"$`\\]+)"|'([^']+)'|([^\s;&|"'$`\\*?()<>]+))\s*(?:&&|;|\n)/);
  if (!m) return dir;
  const to = (m[1] ?? m[2] ?? m[3]).replace(/^~(?=\/|$)/, homedir());
  // From the camp folder a relative path is a camp path (links/<name> is a linked folder).
  try { return shellDir(isAbsolute(to) || dir !== CAMP_ROOT ? resolve(dir, to) : to, self); } catch { return dir; }
}

// What a sandboxed command may write: the project it runs in (the git repository around `dir`,
// else `dir`), minus the parts the file tools protect too.
//
// The repository is what git says it is, and git goes by files a sandboxed command can write: a
// nested repository whose config says core.worktree=/Users/you would make your home folder "the
// project". So git's answer counts only when it stays inside a folder the camp was given (the camp
// itself, a linked folder, this expedition's worktree of one) and `dir` is inside it. Otherwise
// `dir` is the project, and a `dir` outside every such folder gets no writable folder at all.
//
// self: the agent whose command it is. Its own outputs folder stays writable though the rest of
// camp/ is read-only, as it is for its file tools.
export function sandboxPlanFor(dir: string, self?: string): SandboxPlan {
  const gitAt = (args: string[]) => {
    try { return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: gitSafeEnv() }).trim(); } catch { return ""; }
  };
  const camp = realCamp();
  const given = [camp, ...loadLinks().flatMap((l) => [l.path, linkRoot(l)]).map(realOf)];
  const allowed = (p: string) => given.some((g) => inside(p, g));
  const here = realOf(dir);
  const said = gitAt(["rev-parse", "--show-toplevel"]);
  const top = said && inside(here, realOf(said)) && allowed(realOf(said)) ? realOf(said) : "";
  const root = top || (allowed(here) ? here : "");
  // A worktree keeps its git data in the main repository's .git folder: commits need to write
  // there. That folder has to be the .git of a folder the camp was given, and has to list this
  // worktree as one of its own (which a command inside the worktree can't arrange).
  let common = top ? realOf(resolve(dir, gitAt(["rev-parse", "--git-common-dir"]) || ".git")) : "";
  if (common && !inside(common, root) && !(basename(common) === ".git" && allowed(dirname(common)) && listsWorktree(common, top))) common = "";
  const writable = [...(root ? [root] : []), ...(common && !inside(common, root) ? [common] : [])];
  // Hooks and git config run later, outside the sandbox, so a command can't plant them.
  const readOnly = common ? [resolve(common, "hooks"), resolve(common, "config"), resolve(common, "modules")] : [];
  if (root && (root === camp || camp.startsWith(root + sep))) {
    readOnly.push(resolve(camp, "camp"), resolve(camp, "skills"), resolve(camp, "plugins"));
    if (!selfEditAllowed()) readOnly.push(...HARNESS_DIRS.map((d) => resolve(HARNESS_ROOT, d)), ...HARNESS_FILES.map((f) => resolve(HARNESS_ROOT, f)));
  }
  // (A real folder only: a link put there would name somewhere else.)
  const outputs = self ? resolve(camp, "camp", "agents", self, "outputs") : "";
  let ownOutputs = false;
  try { ownOutputs = !!outputs && lstatSync(outputs).isDirectory(); } catch { /* not made yet */ }
  const writableAgain = ownOutputs ? [outputs] : [];
  return { writable, readOnly: readOnly.filter((p) => existsSync(dirname(p))), ...(writableAgain.length ? { writableAgain } : {}), unreadable: sandboxUnreadable(self) };
}

// For the simple read-only commands that run without asking (ls, git status…): nothing is
// writable but temp folders, and the same private files can't be read. So if a repository's
// config makes "git diff" run a program, that program runs in here and can't change anything.
export function readOnlyPlanFor(dir: string, self?: string): SandboxPlan {
  return { writable: [], unreadable: sandboxUnreadable(self), envRoots: [realOf(dir)] };
}

// The camp files no sandboxed command reads: the same ones the file tools refuse (PRIVATE_CAMP_FILES
// and PRIVATE_CAMP_DIRS above), and the agents' workspaces. A command an agent runs (`self`) reads
// what that agent's file tools read there: all of its own workspace, and the others' outputs.
// Their memory, sessions and anything else of theirs stay hidden. With no agent, all of it is.
function sandboxUnreadable(self?: string): string[] {
  const camp = realCamp();
  // (Their set-aside and half-written forms too: the ones there now. A sandbox names paths, not patterns.)
  let others: string[] = [];
  try { others = readdirSync(resolve(camp, "camp")).filter((name) => !PRIVATE_CAMP_FILES.has(name) && privateName(name)); } catch { /* no camp folder yet */ }
  const hidden = [...PRIVATE_CAMP_FILES, ...PRIVATE_CAMP_DIRS, ...others].map((name) => resolve(camp, "camp", name));
  const agents = resolve(camp, "camp", "agents");
  const list = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };
  if (!self || !list(agents).includes(self)) return [...hidden, agents];
  for (const owner of list(agents)) {
    if (owner === self) continue;
    const theirs = resolve(agents, owner);
    let isDir = false;
    try { isDir = lstatSync(theirs).isDirectory(); } catch { /* gone */ }
    if (!isDir) hidden.push(theirs);
    else hidden.push(...list(theirs).filter((area) => area !== "outputs").map((area) => resolve(theirs, area)));
  }
  return hidden;
}
// Whether a repository's .git folder has `top` on its list of worktrees (.git/worktrees/<name>/gitdir).
function listsWorktree(common: string, top: string): boolean {
  try {
    return readdirSync(resolve(common, "worktrees")).some((name) => {
      try { return realOf(dirname(readFileSync(resolve(common, "worktrees", name, "gitdir"), "utf8").trim())) === top; } catch { return false; }
    });
  } catch { return false; }
}

// God mode is for when you're here. A scheduled job has nobody watching and can be working from
// what it read somewhere (a ticket, a page), so there it gets the sandbox instead.
export const sandboxOn = () => { const level = approvalNow(); return (level === "sandbox" || (level === "god" && campMode.unattended)) && sandboxAvailable(); };
const godOn = () => approvalNow() === "god" && !campMode.unattended;
const READ_ONLY_HINT = "\n\n[Ran in a read-only sandbox, as simple read-only commands do: no network (beyond any hosts the user allowed) and nothing writable. " +
  "If that is why it failed, call bash again with unsandboxed: true and the user will be asked.]";
// How a command says the sandbox stopped it (a write, a private file, the network). A read-only
// command that just exits non-zero (git diff --quiet, which nothing) doesn't get the hint.
const SANDBOX_STOPPED = /Operation not permitted|Read-only file system|Permission denied|EPERM|EACCES|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|Could not resolve|network/i;
const SANDBOX_HINT = "\n\n[Ran in the sandbox: no network (beyond any hosts the user allowed), and writes only inside this project. If that is why it failed " +
  "(an install, a download, a push), call bash again with unsandboxed: true and the user will be asked. Only that command: " +
  "a test or check that simply fails doesn't need it, and your next commands go through the sandbox as usual.]";

// Commands don't see the camp's secrets: API keys, tokens and passwords in its environment are
// left out (childEnv in sandbox.ts). The owner can let a name through on purpose with
// CAMP_SHELL_ENV_ALLOW=GH_TOKEN,NPM_TOKEN in the camp's environment.
export function bashFor(self: string, name = "Artificer"): Tool {
  return {
    def: {
      name: "bash",
      description:
        "Run a shell command and get its output. It runs in the camp folder unless you give cwd: use cwd \"links/<name>\" " +
        "(or a folder inside it) to run in a linked project, e.g. its tests or git commands. Simple read-only commands " +
        "(ls, git status, git diff, git log…) run right away. Other commands either run in a sandbox without asking " +
        "(no network; writes only inside that project and your own outputs folder) when the user has turned the sandbox on, " +
        "or wait for the user's approval. Commands stop after 2 minutes." + shellNote(),
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string", description: "Folder to run in: a camp path such as links/<name> or links/<name>/packages/app. Default: the camp folder." },
          unsandboxed: { type: "boolean", description: "Ask the user to run this outside the sandbox (it needs the network or writes elsewhere). Only after a sandboxed try failed for that reason, or when it obviously will (npm install, git push)." },
        },
        required: ["command"],
      },
    },
    run: async ({ command, cwd, unsandboxed }) => {
      const dir = shellDir(cwd, self);
      const where = dir === CAMP_ROOT ? "" : `\n(in ${displayPath(dir)})`;
      const signal = currentSignal();
      // Record a linked repository's working tree before the expedition's first command there, so
      // View changes and Undo cover what commands change too (see checkpoints.ts).
      await snapshotBeforeShell(dir, linkedDisplayPath);
      // Your rules first: a denied command never runs; an "ask" one always waits for you.
      const rule = shellRule(String(command));
      if (rule?.verdict === "deny") return `Not run: the user's rules don't allow commands like this ("${rule.rule}"). Don't try to get around it with another command; find another way or say what you needed.`;
      // Simple, read-only commands (ls, git status…) run without asking; see shell.ts.
      // Commands the user allowed themselves ("Always allow", their allow list) run as approved.
      const auto = autoApproval(String(command));
      if (auto === "yours" || (auto === "builtin" && !sandboxAvailable())) return runShell(String(command), { signal, cwd: dir });
      // The built-in ones are read-only by definition, so where there is a sandbox they run in it
      // with nothing writable: "git diff" in a folder whose git config names a program to run
      // (diff.external, a filter, fsmonitor) can't be used to get out of the sandbox. Git is told
      // not to take its optional locks, since it can't write the index here. With unsandboxed: true
      // the command is treated like any other and waits for the user.
      if (auto === "builtin" && !unsandboxed) {
        const out = await runShell(String(command), { signal, cwd: dir, sandbox: readOnlyPlanFor(dir, self), env: { GIT_OPTIONAL_LOCKS: "0" } });
        return /^(Exit code|Couldn't run)/.test(out) && SANDBOX_STOPPED.test(out) ? out + READ_ONLY_HINT : out;
      }
      // God mode: everything else runs as it is, without asking. (Your "always ask" rules still ask.)
      if (godOn() && !rule) return runShell(String(command), { signal, cwd: dir });
      if (sandboxOn() && !unsandboxed && !rule) {
        const from = Date.now();
        const out = await runShell(String(command), { signal, cwd: dir, sandbox: sandboxPlanFor(shellStartDir(String(command), dir, self), self) });
        if (!/^(Exit code|Couldn't run)/.test(out)) return out;
        const hosts = refusedSince(from);
        return out + (hosts.length ? `\n\n[Ran in the sandbox, where only the user's allowed hosts can be reached. It tried: ${hosts.join(", ")}.]` : "") + SANDBOX_HINT;
      }
      if (campMode.unattended) {
        return "Not run: this is a scheduled job with nobody here to approve that command. " +
          "Only simple read-only commands (ls, git status, git diff…) run unattended. Report what you would have run.";
      }
      // The reviewer (if you turned it on) may clear a routine command; otherwise it says why you're being asked.
      let note = "";
      if (reviewerOn() && !rule) {
        const review = await reviewCommand(String(command), where.replace(/^\n\(in |\)$/g, ""), name);
        if (review.cleared) {
          emit({ type: "notice", who: name, emoji: "🛡️", depth: 1, questId: currentQuestId(), text: `Reviewer cleared: ${String(command).split("\n")[0].slice(0, 120)} (${review.reason})` });
          return runShell(String(command), { signal, cwd: dir });
        }
        note = `\n\nReviewer: ${review.reason}`;
      }
      if (rule) note = `\n\nYour rule "${rule.rule}" says to always ask about this.`;
      const ok = (await ask({ kind: "shell", title: `⚔️  The ${name} wants to run a shell command:`, body: command + where + note })).toLowerCase();
      // "always": run it, and stop asking about this exact command.
      if (ok === "a" || ok === "always") allowShellCommand(String(command));
      else if (ok !== "y") return "The user declined to run this command.";
      return runShell(String(command), { signal, cwd: dir });
    },
  };
}
export const bash: Tool = bashFor("artificer");

// Server tools: Anthropic runs them, so there are no handlers here.
// (Web search must be enabled for your org in the Claude Console.)
// The 20260209 versions filter results with code before they reach the model, so they use fewer tokens.
export const webSearch: Tool = {
  def: { type: "web_search_20260209", name: "web_search", max_uses: 5 },
};

// Fetches pages whose URLs are already in the conversation, e.g. a link the user attached.
export const webFetch: Tool = {
  def: { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
};

// The old shared ledger became the Quartermaster's own memory: see memory.ts.
