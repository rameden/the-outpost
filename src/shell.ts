// Which shell commands run without asking. The rule is narrow on purpose: a command is
// auto-approved only if it's on the list below AND it's a single, simple command:
//   - no chaining, pipes, redirects, or substitutions (; & | < > ` $ ( ) { } and newlines)
//   - no paths outside the camp (absolute paths, ~, ..) and nothing touching .env
// Anything else still asks you. Add your own in camp/settings.json:
//   "shell": { "allow": ["npm run build", "npm run test:*"] }      or  "shell": { "autoApprove": false }
// "Always allow" on an approval adds that exact command to "shell": { "exact": [...] }.
//
// Rules come first, and win over everything above:
//   "shell": { "deny": ["git push*", "rm -rf *"], "ask": ["npm install*"] }
// A command that matches a deny rule never runs (not with "always allow", not in the sandbox, not
// with your OK). One that matches an ask rule always waits for you, even where the sandbox would
// have run it. Each part of a chained command (a && b; c | d) is checked on its own, so
// "cd web && git push" is caught by "git push*". * matches anything; the rest matches as written.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { shellSettings, approvalLevel, skillCommands, type ApprovalLevel } from "./settings.js";
import { currentProjectId } from "./context.js";
import { getProject } from "./conversations.js";

// How shell commands are approved for the run that's asking: its project's own level if it set
// one, else the camp's. ("ask": everything waits for you. "safe": simple read-only commands
// run. "sandbox": the rest run in the sandbox without asking.)
export function approvalNow(): ApprovalLevel {
  return getProject(currentProjectId())?.settings?.approval ?? approvalLevel();
}

// Each entry: a command prefix. "git status" allows "git status -s", not "git push".
// Deliberately NOT here by default:
//  - test runners and build scripts (npm test, pytest, cargo test…): they run project code, and
//    the Artificer can edit that code, so "npm test" could run anything. Add them to "allow" if
//    you're comfortable with that.
//  - cat, grep -r, find: they'd read .env and other agents' private memory. Agents have their own
//    read_file, grep, and glob tools for that, which respect the camp's boundaries.
export const DEFAULT_ALLOW = [
  "ls", "pwd", "wc", "which", "echo", "date",
  "git status", "git diff", "git log", "git show", "git branch", "git blame", "git ls-files", "git rev-parse",
  "node --version", "node -v", "npm --version", "npm -v", "npm ls", "npm outdated", "npm view",
  "python3 --version", "python --version",
];

// Commands you approved for an imported skill (skillpacks.ts) that still stand. One of the
// skill's own scripts counts only while its file is as it was when you approved it: change the
// file and the command asks again.
export function approvedSkillPrefixes(): string[] {
  const out: string[] = [];
  for (const list of Object.values(skillCommands())) for (const c of list) {
    if (!c.file) { out.push(c.prefix); continue; }
    try { if (createHash("sha256").update(readFileSync(c.file)).digest("hex") === c.sha256) out.push(c.prefix); } catch { /* the file is gone: it asks */ }
  }
  return out;
}

const UNSAFE_CHARS = /[;&|<>`$(){}\n\r\\]/;
// find can delete or run commands; git can be told to run a pager or editor.
const UNSAFE_ARGS = /(^|\s)(-exec|-execdir|-delete|-ok|-okdir|-fprint\S*|-fls|--output|-o\s|--exec|-c\s|--config|--ext-diff|--textconv)(\s|=|$)/;

// "git push*" → matches "git push" and "git push origin main" (spaces collapsed, whole command).
export function globToRegex(pattern: string): RegExp {
  const p = pattern.trim().replace(/\s+/g, " ");
  return new RegExp("^" + p.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
}
// The parts a chained command runs: split on ; && || | & and newlines, and what's inside $( ) or backticks.
export function commandParts(command: string): string[] {
  const flat = command.replace(/\$\(|`|\)/g, ";");
  const parts = flat.split(/;|&&|\|\||\||&|\n/).map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  // A leading "sudo", "env X=1", or a subshell's "(" doesn't hide the command it runs.
  return [command.trim().replace(/\s+/g, " "), ...parts.flatMap((p) => [p, p.replace(/^(sudo|exec|command|nohup|time|env(\s+\w+=\S+)*)\s+/, "")])];
}
// The first of your rules this command meets: deny before ask.
export function shellRule(command: string): { verdict: "deny" | "ask"; rule: string } | null {
  const s = shellSettings();
  const parts = commandParts(String(command));
  for (const verdict of ["deny", "ask"] as const) {
    for (const rule of s[verdict] ?? []) {
      const re = globToRegex(rule);
      if (parts.some((p) => re.test(p))) return { verdict, rule };
    }
  }
  return null;
}

export function isAutoApproved(command: string): boolean {
  const s = shellSettings();
  if (approvalNow() === "ask") return false;
  if (shellRule(command)) return false; // your deny and ask rules win over every allow
  // Commands you chose "Always allow" for run as-is, but only that exact command.
  if (s.exact?.includes(command.trim())) return true;
  const cmd = command.trim().replace(/\s+/g, " ");
  if (!cmd || UNSAFE_CHARS.test(cmd) || UNSAFE_ARGS.test(` ${cmd} `)) return false;
  const words = cmd.split(" ");
  // Arguments must stay inside the camp and away from secrets.
  for (const w of words.slice(1)) {
    const bare = w.replace(/^['"]|['"]$/g, "").replace(/^-[^=]*=/, "");
    // ":" covers git's rev:path form (git show HEAD:.env).
    if (bare.startsWith("/") || bare.startsWith("~") || /(^|[/:])\.\.(\/|$)/.test(bare) || /(^|[/:])\.env/.test(bare)) return false;
    if (/(^|[/:])camp\/agents(\/|$)/.test(bare) || /[*?[]/.test(bare)) return false; // private workspaces; globs
  }
  const allow = [...DEFAULT_ALLOW, ...(s.allow ?? []), ...approvedSkillPrefixes()];
  return allow.some((prefix) => (prefix.includes("*") ? globToRegex(prefix).test(cmd) : cmd === prefix || cmd.startsWith(prefix + " ")));
}
