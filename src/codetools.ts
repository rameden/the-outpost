// Coding tools: targeted edits and fast search, so agents change one function instead of
// rewriting a whole file, and find things without shelling out. Every path goes through
// campPath, so the same boundaries apply (no secrets, no other agent's memory, no writes to skills/).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { campPath, CAMP_ROOT, displayPath, type Tool } from "./tools.js";
import { afterWrite, beforeWrite } from "./checkpoints.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const MAX_FILE_BYTES = 1_000_000;
// Paths as agents see them: relative in the camp, links/<name>/… in a linked folder.
const rel = (abs: string) => displayPath(abs);

// Walk files under a directory, honoring the camp's read boundaries.
function* walk(dir: string, self: string, maxEntries = 20_000): Generator<string> {
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > maxEntries) return;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".env")) continue;
      const abs = join(d, e.name);
      try { campPath(rel(abs), "read", self); } catch { continue; }
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) yield abs;
    }
  }
}

// "src/**/*.ts" → regex. Supports **, *, ?, and {a,b}.
export function globToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      re += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end < 0) { re += "\\{"; continue; }
      re += "(?:" + pattern.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")";
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function editFileFor(self: string): Tool {
  return {
    def: {
      name: "edit_file",
      description:
        "Change part of a file by replacing exact text. old_string must match the file exactly " +
        "(whitespace included) and appear once, unless replace_all is true. Read the file first. " +
        "Prefer this over write_file for changes to existing files.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string", description: "Exact text to replace (include enough surrounding lines to be unique)." },
          new_string: { type: "string" },
          replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    run: async ({ path, old_string, new_string, replace_all = false }) => {
      const abs = campPath(path, "write", self);
      if (!existsSync(abs)) return `No file at ${path}. Use write_file to create it.`;
      if (old_string === new_string) return "old_string and new_string are the same; nothing to change.";
      const text = readFileSync(abs, "utf8");
      const count = old_string ? text.split(old_string).length - 1 : 0;
      if (count === 0) return `old_string wasn't found in ${path}. Read the file again and copy the text exactly.`;
      if (count > 1 && !replace_all) return `old_string appears ${count} times in ${path}. Add surrounding lines to make it unique, or set replace_all.`;
      const next = replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string);
      beforeWrite(abs, displayPath(abs));
      writeFileSync(abs, next);
      afterWrite(abs);
      return `Edited ${path} (${replace_all ? count : 1} replacement${(replace_all ? count : 1) === 1 ? "" : "s"}).`;
    },
  };
}

export function listDirFor(self: string): Tool {
  return {
    def: {
      name: "list_dir",
      description: "List what's in a folder (folders end with /), including linked folders like links/<name>. depth 1 by default, up to 4.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string", description: "Folder, default the camp root." }, depth: { type: "number" } },
      },
    },
    run: async ({ path = ".", depth = 1 }) => {
      const root = campPath(path, "read", self);
      if (!statSync(root).isDirectory()) return `${path} is a file, not a folder.`;
      const lines: string[] = [];
      const visit = (dir: string, level: number) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
        for (const e of entries) {
          if (lines.length >= 400) return;
          if (SKIP_DIRS.has(e.name) || e.name.startsWith(".env") || e.name === ".DS_Store") continue;
          const abs = join(dir, e.name);
          try { campPath(rel(abs), "read", self); } catch { continue; }
          const pad = "  ".repeat(level);
          if (e.isDirectory()) {
            lines.push(`${pad}${e.name}/`);
            if (level + 1 < Math.min(4, Math.max(1, depth))) visit(abs, level + 1);
          } else {
            lines.push(`${pad}${e.name} (${Math.max(1, Math.round(statSync(abs).size / 1024))} KB)`);
          }
        }
      };
      visit(root, 0);
      return lines.length ? lines.join("\n") + (lines.length >= 400 ? "\n…(more not shown)" : "") : "(empty)";
    },
  };
}

export function globFor(self: string): Tool {
  return {
    def: {
      name: "glob",
      description: "Find files by pattern, e.g. 'src/**/*.ts', '**/*.{md,txt}', or inside a linked folder 'links/<name>/**/*.ts'. Returns paths, newest first.",
      input_schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
    },
    run: async ({ pattern }) => {
      const pat = String(pattern).replace(/^\.\//, "");
      const re = globToRegex(pat);
      // A pattern inside a linked folder searches that folder: links/site/**/*.ts
      const link = pat.match(/^links\/([^/*?{]+)/);
      const root = link ? campPath(`links/${link[1]}`, "read", self) : CAMP_ROOT;
      const hits: { path: string; mtime: number }[] = [];
      for (const abs of walk(root, self)) {
        const p = rel(abs);
        if (re.test(p)) hits.push({ path: p, mtime: statSync(abs).mtimeMs });
        if (hits.length >= 500) break;
      }
      hits.sort((a, b) => b.mtime - a.mtime);
      return hits.length ? hits.slice(0, 200).map((h) => h.path).join("\n") : `No files match ${pattern}.`;
    },
  };
}

export function grepFor(self: string): Tool {
  return {
    def: {
      name: "grep",
      description:
        "Search file contents with a regular expression. Returns path:line: text. Narrow it with " +
        "path (a folder or file, e.g. links/<name> for a linked folder) and glob (e.g. '*.ts').",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Folder or file to search, default the camp root." },
          glob: { type: "string", description: "Only files whose name or path matches, e.g. '*.ts' or 'src/**/*.ts'." },
          ignore_case: { type: "boolean" },
        },
        required: ["pattern"],
      },
    },
    run: async ({ pattern, path = ".", glob, ignore_case = false }) => {
      let re: RegExp;
      try { re = new RegExp(pattern, ignore_case ? "i" : ""); } catch (e: any) { return `Bad regular expression: ${e.message}`; }
      const root = campPath(path, "read", self);
      const fileFilter = glob ? globToRegex(String(glob).includes("/") ? glob : `**/${glob}`) : null;
      const files = statSync(root).isFile() ? [root] : [...walk(root, self)];
      const out: string[] = [];
      for (const abs of files) {
        const p = rel(abs);
        if (fileFilter && !fileFilter.test(p)) continue;
        if (statSync(abs).size > MAX_FILE_BYTES) continue;
        const text = readFileSync(abs, "utf8");
        if (text.includes("\u0000")) continue; // binary
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) out.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (out.length >= 200) return out.join("\n") + "\n…(stopped at 200 matches; narrow the search)";
        }
      }
      return out.length ? out.join("\n") : `No matches for /${pattern}/.`;
    },
  };
}
