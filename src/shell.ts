// Which shell commands run without asking. The rule is narrow on purpose: a command is
// auto-approved only if it's on the list below AND it's a single, simple command:
//   - no chaining, pipes, redirects, or substitutions (; & | < > ` $ ( ) { } and newlines)
//   - no paths outside the camp (absolute paths, ~, ..) and nothing touching .env
// Anything else still asks you. Add your own in camp/settings.json:
//   "shell": { "allow": ["npm run build", "pytest"] }      or  "shell": { "autoApprove": false }

import { shellSettings } from "./settings.js";

// Each entry: a command prefix. "git status" allows "git status -s", not "git push".
// Deliberately NOT here by default:
//  - test runners and build scripts (npm test, pytest, cargo test…): they run project code, and
//    the Artificer can edit that code, so "npm test" could run anything. Add them to "allow" if
//    you're comfortable with that.
//  - cat, grep -r, find: they'd read .env and other agents' private memory. Agents have their own
//    read_file, grep, and glob tools for that, which respect the camp's boundaries.
const DEFAULT_ALLOW = [
  "ls", "pwd", "wc", "which", "echo", "date",
  "git status", "git diff", "git log", "git show", "git branch", "git blame", "git ls-files", "git rev-parse",
  "node --version", "node -v", "npm --version", "npm -v", "npm ls", "npm outdated", "npm view",
  "python3 --version", "python --version",
];

const UNSAFE_CHARS = /[;&|<>`$(){}\n\r\\]/;
// find can delete or run commands; git can be told to run a pager or editor.
const UNSAFE_ARGS = /(^|\s)(-exec|-execdir|-delete|-ok|-okdir|-fprint\S*|-fls|--output|-o\s|--exec|-c\s|--config|--ext-diff|--textconv)(\s|=|$)/;

export function isAutoApproved(command: string): boolean {
  const s = shellSettings();
  if (s.autoApprove === false) return false;
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
  const allow = [...DEFAULT_ALLOW, ...(s.allow ?? [])];
  return allow.some((prefix) => cmd === prefix || cmd.startsWith(prefix + " "));
}
