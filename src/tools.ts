// The camp's armory: every tool any character can carry.
// Each tool = a definition the model sees + (for client tools) a handler we run.

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ask } from "./ask.js";
import { currentSignal, isUnattended } from "./context.js";
import { isAutoApproved } from "./shell.js";
import { resolveLinked, linkedDisplayPath, SECRET_NAME } from "./links.js";
import { allowShellCommand, selfEditAllowed, shellSettings } from "./settings.js";
import { sandboxAvailable, sandboxed, type SandboxPlan } from "./sandbox.js";
import { afterWrite, beforeWrite, noteRead } from "./checkpoints.js";

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
export type Handler = (input: any) => Promise<ToolOutput>;
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
const HARNESS_DIRS = ["src", "tests", "evals"];
const HARNESS_FILES = ["package.json", "package-lock.json", "tsconfig.json"];
function isHarnessCode(abs: string): boolean {
  const rel = relative(HARNESS_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return HARNESS_FILES.includes(rel) || HARNESS_DIRS.includes(rel.split(sep)[0]);
}
// Camp files that can hold tokens (connector env, the phone topic). Nobody's file tools read them.
const PRIVATE_CAMP_FILES = new Set(["mcp.json", "settings.json"]);

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

export function campPath(path: string, mode: "read" | "write", self?: string): string {
  // Linked folders (links/<name>/…) live elsewhere on disk; links.ts enforces their rules.
  const linked = resolveLinked(path, mode);
  if (linked) {
    const back = relative(CAMP_ROOT, linked);
    // A link that contains the camp doesn't get around the camp's own rules.
    if (back === "" || (!back.startsWith(".." + sep) && back !== ".." && !isAbsolute(back))) return campPath(back || ".", mode, self);
    if (mode === "write" && isHarnessCode(linked) && !selfEditAllowed()) throw new Error(`${path} is part of the camp's own code, which is read-only.`);
    return linked;
  }
  const abs = resolve(CAMP_ROOT, path);
  const rel = relative(CAMP_ROOT, abs);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`${path} is outside the camp (${CAMP_ROOT}). Use a path inside it, or ask the user to link that folder.`);
  }
  const parts = rel.split(sep);
  const top = parts[0];
  if (top.startsWith(".env")) throw new Error(`${path} holds secrets and is off limits.`);
  // The same secret names that are off limits in linked folders, at any depth (sub/.env, id_rsa, *.pem…).
  if (parts.some((seg) => SECRET_NAME.test(seg))) throw new Error(`${path} looks like a secret (keys, .env, credentials) and is off limits.`);
  if (top === "camp" && parts.length === 2 && PRIVATE_CAMP_FILES.has(parts[1])) {
    throw new Error(`${path} holds the user's private camp configuration and is off limits.`);
  }
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
      if (mine && area === "outputs") return abs;
      throw new Error(mine ? "Write your files under your outputs/ folder; use remember for your memory." : `camp/agents/${owner}/ is the ${owner}'s workspace, not yours.`);
    }
    return abs;
  }

  if (mode === "write" && READ_ONLY.has(top)) {
    throw new Error(
      top === "skills"
        ? "skills/ is read-only. New skills are proposed by the Quartermaster and approved by the user."
        : `${top}/ is read-only for file tools.` + (self ? ` Save your work to camp/agents/${self}/outputs/.` : "")
    );
  }
  return abs;
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
export type ShellOpts = { signal?: AbortSignal; timeoutMs?: number; cwd?: string; sandbox?: SandboxPlan };
export function runShell(command: string, signalOrOpts?: AbortSignal | ShellOpts, timeout?: number): Promise<string> {
  const o: ShellOpts = signalOrOpts instanceof AbortSignal || signalOrOpts === undefined ? { signal: signalOrOpts, timeoutMs: timeout } : signalOrOpts;
  const { signal, cwd = CAMP_ROOT } = o;
  const timeoutMs = o.timeoutMs ?? SHELL_TIMEOUT_MS;
  return new Promise((done) => {
    if (signal?.aborted) return done("Not run: the expedition was stopped.");
    const io = { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
    const box = o.sandbox ? sandboxed(command, o.sandbox) : null;
    const child = box ? spawn(box.file, box.args, io) : spawn(command, { ...io, shell: true });
    let out = "";
    let ended: string | null = null;
    const take = (chunk: Buffer) => { if (out.length < SHELL_MAX_BYTES) out += chunk.toString("utf8"); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const kill = (why: string) => {
      ended ??= why;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); // the whole process group
        else child.kill("SIGTERM");
      } catch { /* already gone */ }
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

// What a sandboxed command may write: the project it runs in (the git repository around `dir`,
// else `dir`), minus the parts the file tools protect too.
export function sandboxPlanFor(dir: string): SandboxPlan {
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const gitAt = (args: string[]) => {
    try { return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
  };
  const top = gitAt(["rev-parse", "--show-toplevel"]);
  const root = real(top || dir);
  // A worktree keeps its git data in the main repository's .git folder: commits need to write there.
  const common = top ? real(resolve(dir, gitAt(["rev-parse", "--git-common-dir"]) || ".git")) : "";
  const writable = [root, ...(common && !common.startsWith(root + sep) ? [common] : [])];
  // Hooks and git config run later, outside the sandbox, so a command can't plant them.
  const readOnly = common ? [resolve(common, "hooks"), resolve(common, "config")] : [];
  const camp = real(CAMP_ROOT);
  const unreadable = [resolve(camp, "camp", "mcp.json"), resolve(camp, "camp", "settings.json"), resolve(camp, "camp", "agents")];
  if (root === camp || camp.startsWith(root + sep)) {
    readOnly.push(resolve(camp, "camp"), resolve(camp, "skills"), resolve(camp, "plugins"));
    if (!selfEditAllowed()) readOnly.push(...HARNESS_DIRS.map((d) => resolve(HARNESS_ROOT, d)), ...HARNESS_FILES.map((f) => resolve(HARNESS_ROOT, f)));
  }
  return { writable, readOnly: readOnly.filter((p) => existsSync(dirname(p))), unreadable };
}

export const sandboxOn = () => shellSettings().sandbox === true && sandboxAvailable();
const SANDBOX_HINT = "\n\n[Ran in the sandbox: no network, and writes only inside this project. If that is why it failed " +
  "(an install, a download, a push), call bash again with unsandboxed: true and the user will be asked.]";

export function bashFor(self: string): Tool {
  return {
    def: {
      name: "bash",
      description:
        "Run a shell command and get its output. It runs in the camp folder unless you give cwd: use cwd \"links/<name>\" " +
        "(or a folder inside it) to run in a linked project, e.g. its tests or git commands. Simple read-only commands " +
        "(ls, git status, git diff, git log…) run right away. Other commands either run in a sandbox without asking " +
        "(no network; writes only inside that project) when the user has turned the sandbox on, or wait for the user's " +
        "approval. Commands stop after 2 minutes.",
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
      // Simple, read-only commands (ls, git status…) run without asking; see shell.ts.
      if (isAutoApproved(command)) return runShell(String(command), { signal, cwd: dir });
      if (sandboxOn() && !unsandboxed) {
        const out = await runShell(String(command), { signal, cwd: dir, sandbox: sandboxPlanFor(dir) });
        return /^(Exit code|Couldn't run)/.test(out) ? out + SANDBOX_HINT : out;
      }
      if (campMode.unattended) {
        return "Not run: this is a scheduled job with nobody here to approve that command. " +
          "Only simple read-only commands (ls, git status, git diff…) run unattended. Report what you would have run.";
      }
      const ok = (await ask({ kind: "shell", title: "⚔️  The Artificer wants to run a shell command:", body: command + where })).toLowerCase();
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
