// The camp's armory: every tool any character can carry.
// Each tool = a definition the model sees + (for client tools) a handler we run.

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ask } from "./ask.js";
import { isAutoApproved } from "./shell.js";
export { rl } from "./terminal.js";

// Scheduled jobs run with nobody at the keyboard. Anything that would ask the user
// (shell commands, new jobs) is refused instead of waiting forever for an answer.
export const campMode = { unattended: false };

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

export function campPath(path: string, mode: "read" | "write", self?: string): string {
  const abs = resolve(CAMP_ROOT, path);
  const rel = relative(CAMP_ROOT, abs);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`${path} is outside the camp (${CAMP_ROOT}). Use a path inside it.`);
  }
  const parts = rel.split(sep);
  const top = parts[0];
  if (top.startsWith(".env")) throw new Error(`${path} holds secrets and is off limits.`);

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
      description: "Read a text file inside the camp folder: SKILL.md files, code, notes, wiki pages, teammates' outputs.",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    run: async ({ path }) => readFileSync(campPath(path, "read", self), "utf8"),
  };
}

export function writeFileFor(self: string): Tool {
  return {
    def: {
      name: "write_file",
      description:
        `Create or overwrite a text file (parent folders are created). Your own files go in ` +
        `camp/agents/${self}/outputs/; project files elsewhere are fine when a brief asks for them. ` +
        `skills/, plugins/, and the rest of camp/ are read-only.`,
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    run: async ({ path, content }) => {
      const abs = campPath(path, "write", self);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      return `Wrote ${content.length} chars to ${path}`;
    },
  };
}

export const bash: Tool = {
  def: {
    name: "bash",
    description: "Run a shell command in the camp folder; returns its output. Simple read-only commands (ls, grep, git status, npm test…) run right away; anything else waits for the user's approval.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  run: async ({ command }) => {
    // Simple, read-only commands (ls, git status, npm test…) run without asking; see shell.ts.
    if (!isAutoApproved(command)) {
      if (campMode.unattended) {
        return "Not run: this is a scheduled job with nobody here to approve that command. " +
          "Only simple read-only commands (ls, git status, npm test…) run unattended. Report what you would have run.";
      }
      const ok = await ask({ kind: "shell", title: "⚔️  The Artificer wants to run a shell command:", body: command });
      if (ok.toLowerCase() !== "y") return "The user declined to run this command.";
    }
    try {
      return execSync(command, { encoding: "utf8", timeout: 120_000, stdio: "pipe", cwd: CAMP_ROOT }) || "(no output)";
    } catch (err: any) {
      // A failing test run is useful output, not a crash.
      return `Exit code ${err.status ?? "?"}\n${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    }
  },
};

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
