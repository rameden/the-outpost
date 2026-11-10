// Finding files and text, fast and completely, in projects of any size.
//
// The crew's glob and grep run on ripgrep when it's there: it lists and searches tens of
// thousands of files in well under a second and skips what a project's .gitignore skips (build
// output, dependencies). Claude Code ships ripgrep inside its own program, so if you run the crew
// on your subscription you already have it; a ripgrep on your PATH is used first.
//
// Without ripgrep the camp walks the folders itself (using git's file list in a repository). That
// is slower, and if it has to stop early it says so instead of quietly returning half an answer.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { CAMP_ROOT } from "./tools.js";

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", "coverage"];
const WALK_CAP = 200_000;
const MAX_FILE_BYTES = 1_000_000;

// ---------- Finding ripgrep ----------
type Rg = { file: string; argv0?: string };
let found: Rg | null | undefined;

function bundledClaude(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return join(dirname(pkg), "claude");
  } catch { return null; }
}

export function ripgrep(): Rg | null {
  if (found !== undefined) return found;
  const claude = process.env.CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
  // Claude Code answers as ripgrep when it's started under the name "rg".
  const candidates: Rg[] = [{ file: "rg" }, { file: claude, argv0: "rg" }, ...(bundledClaude() ? [{ file: bundledClaude()!, argv0: "rg" }] : [])];
  for (const c of candidates) {
    try {
      const r = spawnSync(c.file, ["--version"], { argv0: c.argv0, encoding: "utf8", timeout: 15_000 });
      if (r.status === 0 && /^ripgrep \d/.test(r.stdout)) return (found = c);
    } catch { /* try the next one */ }
  }
  return (found = null);
}
// Tests run both ways: with ripgrep (true: look for it again) and without (false).
export function useRipgrepForTests(on: boolean) { found = on ? undefined : null; }
export const searchEngine = () => (ripgrep() ? "ripgrep" : "built-in");

// Run ripgrep, handing each output line to `onLine`; returning false stops it early.
function rg(args: string[], cwd: string, onLine: (line: string) => boolean, timeoutMs = 60_000): Promise<{ code: number | null; stderr: string }> {
  const bin = ripgrep()!;
  return new Promise((done) => {
    const child = spawn(bin.file, args, { cwd, argv0: bin.argv0, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stopped = false;
    const stop = () => { stopped = true; child.kill("SIGTERM"); };
    const timer = setTimeout(stop, timeoutMs);
    child.stderr.on("data", (c: Buffer) => { if (stderr.length < 4000) stderr += c.toString("utf8"); });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => { if (!stopped && onLine(line) === false) stop(); });
    child.on("error", (e) => { clearTimeout(timer); done({ code: 2, stderr: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); done({ code: stopped ? 0 : code, stderr }); });
  });
}

// Inside the camp folder everything is searched (the wiki and outputs live in camp/, which git
// ignores). In a linked project, what its .gitignore skips is skipped.
const inCamp = (dir: string) => { const r = relative(CAMP_ROOT, dir); return r === "" || (!r.startsWith(".." + sep) && r !== ".."); };
function baseArgs(dir: string): string[] {
  const skip = (inCamp(dir) ? SKIP_DIRS : [".git", "node_modules"]).flatMap((d) => ["-g", `!${d}`]);
  return ["--hidden", ...(inCamp(dir) ? ["--no-ignore"] : []), ...skip, "-g", "!.env*", "-g", "!.DS_Store"];
}

// ---------- Listing files ----------
export type FileList = { files: string[]; truncated: boolean }; // paths relative to `dir`, with / separators

export async function listFiles(dir: string): Promise<FileList> {
  if (ripgrep()) {
    const files: string[] = [];
    const r = await rg(["--files", ...baseArgs(dir)], dir, (l) => { files.push(l); return files.length < WALK_CAP; });
    if (r.code === 0 || r.code === 1) return { files, truncated: files.length >= WALK_CAP };
  }
  return listWithoutRipgrep(dir);
}

function listWithoutRipgrep(dir: string): FileList {
  if (!inCamp(dir)) {
    try { // a repository knows its own files, minus what it ignores
      const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: dir, encoding: "utf8", maxBuffer: 200_000_000, stdio: ["ignore", "pipe", "ignore"] });
      const files = out.split("\n").filter((f) => f && !/(^|\/)(\.env[^/]*|\.DS_Store)$/.test(f) && !f.split("/").includes("node_modules"));
      return { files, truncated: false };
    } catch { /* not a repository: walk it */ }
  }
  const files: string[] = [];
  const skip = new Set(SKIP_DIRS);
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > WALK_CAP) return { files, truncated: true };
      if (skip.has(e.name) || e.name.startsWith(".env") || e.name === ".DS_Store") continue;
      const abs = join(d, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) files.push(relative(dir, abs).split(sep).join("/"));
    }
  }
  return { files, truncated: false };
}

// ---------- Searching text ----------
export type Match = { file: string; line: number; text: string; context?: boolean }; // file: relative to `dir`
export type SearchOpts = {
  pattern: string; ignoreCase?: boolean;
  glob?: string;          // only files matching this, relative to the search folder (e.g. "*.ts", "src/**/*.tsx")
  only?: string;          // search just this one file (relative to `dir`)
  context?: number;       // lines of context around each match
  limit: number;          // stop after this many matching lines
  accept: (file: string) => boolean; // the camp's boundaries: false drops that file's results
  globToRegex: (glob: string) => RegExp;
};
export type SearchResult = { matches: Match[]; more: boolean; truncated: boolean; error?: string };

export async function searchText(dir: string, o: SearchOpts): Promise<SearchResult> {
  if (ripgrep()) {
    const matches: Match[] = [];
    let count = 0, more = false;
    const args = ["--line-number", "--with-filename", "--no-heading", "--color", "never", "--null", "--max-columns", "400", "--max-columns-preview",
      ...(o.ignoreCase ? ["-i"] : []), ...(o.context ? ["-C", String(o.context)] : []), ...baseArgs(dir),
      ...(o.glob ? ["-g", o.glob] : []), "-e", o.pattern, "--", o.only ?? "."];
    const r = await rg(args, dir, (line) => {
      const nul = line.indexOf("\0");
      if (nul < 0) return true; // the "--" between groups of context
      const file = line.slice(0, nul).replace(/^\.\//, "");
      const m = line.slice(nul + 1).match(/^(\d+)([:-])(.*)$/s);
      if (!m || !o.accept(file)) return true;
      const context = m[2] === "-";
      if (!context && ++count > o.limit) { more = true; return false; }
      matches.push({ file, line: Number(m[1]), text: m[3], context });
      return true;
    });
    if (r.code === 0 || r.code === 1) return { matches, more, truncated: false };
    // A pattern ripgrep's regex syntax doesn't take (look-behind, back-references…): search the
    // slower way, which uses the same regex syntax as JavaScript.
    if (!/regex parse error|not supported|look-around|backreference/i.test(r.stderr)) return { matches: [], more: false, truncated: false, error: r.stderr.trim().split("\n").pop() };
  }
  return searchWithoutRipgrep(dir, o);
}

async function searchWithoutRipgrep(dir: string, o: SearchOpts): Promise<SearchResult> {
  let re: RegExp;
  try { re = new RegExp(o.pattern, o.ignoreCase ? "i" : ""); } catch (e: any) { return { matches: [], more: false, truncated: false, error: e.message }; }
  const list = o.only ? { files: [o.only], truncated: false } : await listFiles(dir);
  const filter = o.glob ? o.globToRegex(o.glob.includes("/") ? o.glob : `**/${o.glob}`) : null;
  const matches: Match[] = [];
  const ctx = o.context ?? 0;
  let count = 0, n = 0;
  for (const file of list.files) {
    if ((filter && !filter.test(file)) || !o.accept(file)) continue;
    if (++n % 200 === 0) await new Promise((r) => setImmediate(r)); // let the rest of the camp breathe
    const abs = join(dir, file);
    let text: string;
    try {
      if (statSync(abs).size > MAX_FILE_BYTES) continue;
      text = readFileSync(abs, "utf8");
    } catch { continue; }
    if (text.includes("\u0000")) continue; // binary
    const lines = text.split("\n");
    let shownTo = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      if (++count > o.limit) return { matches, more: true, truncated: list.truncated };
      for (let j = Math.max(shownTo + 1, i - ctx); j < i; j++) matches.push({ file, line: j + 1, text: lines[j], context: true });
      matches.push({ file, line: i + 1, text: lines[i] });
      const end = Math.min(lines.length - 1, i + ctx);
      for (let j = i + 1; j <= end && !re.test(lines[j]); j++) { matches.push({ file, line: j + 1, text: lines[j], context: true }); shownTo = j; }
      shownTo = Math.max(shownTo, i);
    }
  }
  return { matches, more: false, truncated: list.truncated };
}
