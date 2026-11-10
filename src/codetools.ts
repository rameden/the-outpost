// Coding tools: targeted edits and fast search, so agents change one function instead of
// rewriting a whole file, and find things without shelling out. Every path goes through
// campPath, so the same boundaries apply (no secrets, no other agent's memory, no writes to skills/).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { listFiles, searchText } from "./search.js";
import { campPath, CAMP_ROOT, displayPath, type Tool } from "./tools.js";
import { afterWrite, beforeWrite } from "./checkpoints.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
// Paths as agents see them: relative in the camp, links/<name>/… in a linked folder.
const rel = (abs: string) => displayPath(abs);

// The camp's read boundaries for search results, remembered per path within one search.
function boundary(self: string) {
  const known = new Map<string, boolean>();
  return (shown: string) => {
    let ok = known.get(shown);
    if (ok === undefined) {
      try { campPath(shown, "read", self); ok = true; } catch { ok = false; }
      known.set(shown, ok);
    }
    return ok;
  };
}
// A search folder as agents name it ("." for the camp, links/<name>/… for a linked folder), and how to name files under it.
const shownUnder = (root: string) => {
  const base = rel(root);
  return (file: string) => (base === "." ? file : `${base}/${file}`);
};

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
      description:
        "Find files by pattern, e.g. 'src/**/*.ts', '**/*.{md,txt}', or inside a linked folder 'links/<name>/**/*.ts'. " +
        "Returns paths, newest first. In a linked project, files its .gitignore skips (build output, dependencies) are left out.",
      input_schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
    },
    run: async ({ pattern }) => {
      const pat = String(pattern).replace(/^\.\//, "");
      const re = globToRegex(pat);
      // A pattern inside a linked folder searches that folder: links/site/**/*.ts
      const link = pat.match(/^links\/([^/*?{]+)/);
      const root = link ? campPath(`links/${link[1]}`, "read", self) : CAMP_ROOT;
      const shown = shownUnder(root);
      const allowed = boundary(self);
      const list = await listFiles(root);
      const hits: { path: string; mtime: number }[] = [];
      let total = 0;
      for (const f of list.files) {
        const p = shown(f);
        if (!re.test(p) || !allowed(p)) continue;
        total++;
        if (hits.length < 2000) { try { hits.push({ path: p, mtime: statSync(join(root, f)).mtimeMs }); } catch { /* gone */ } }
      }
      hits.sort((a, b) => b.mtime - a.mtime);
      if (!hits.length) return `No files match ${pattern}.` + (list.truncated ? " (The folder is very large and the search stopped early; narrow the pattern to a subfolder.)" : "");
      return hits.slice(0, 200).map((h) => h.path).join("\n") +
        (total > 200 ? `\n…(${total - 200} more match; narrow the pattern)` : "") +
        (list.truncated ? "\n…(the folder is very large and the search stopped early; narrow the pattern to a subfolder)" : "");
    },
  };
}

export function grepFor(self: string): Tool {
  return {
    def: {
      name: "grep",
      description:
        "Search file contents with a regular expression. Returns path:line: text. Narrow it with path (a folder or file, " +
        "e.g. links/<name> or links/<name>/src) and glob (e.g. '*.ts', or 'src/**/*.tsx' relative to path). " +
        "context adds surrounding lines; files_only lists just the files that match. In a linked project, files its " +
        ".gitignore skips are not searched.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Folder or file to search, default the camp root." },
          glob: { type: "string", description: "Only files whose name or path (relative to path) matches, e.g. '*.ts' or 'src/**/*.ts'." },
          ignore_case: { type: "boolean" },
          context: { type: "number", description: "Lines to show before and after each match (0–5)." },
          files_only: { type: "boolean", description: "Return only the paths of files that contain a match." },
        },
        required: ["pattern"],
      },
    },
    run: async ({ pattern, path = ".", glob, ignore_case = false, context = 0, files_only = false }) => {
      const target = campPath(path, "read", self);
      const isFile = statSync(target).isFile();
      const root = isFile ? dirname(target) : target;
      const shown = shownUnder(root);
      const allowed = boundary(self);
      const r = await searchText(root, {
        pattern: String(pattern), ignoreCase: !!ignore_case, glob: glob ? String(glob) : undefined,
        only: isFile ? basename(target) : undefined,
        context: files_only ? 0 : Math.min(5, Math.max(0, Math.floor(Number(context) || 0))),
        limit: files_only ? 5000 : 200,
        accept: (file) => allowed(shown(file)),
        globToRegex,
      });
      if (r.error) return `Bad regular expression: ${r.error}`;
      const early = r.truncated ? "\n…(the folder is very large and the search stopped early; narrow it with path)" : "";
      if (!r.matches.length) return `No matches for /${pattern}/.` + early;
      if (files_only) {
        const files = [...new Set(r.matches.map((m) => shown(m.file)))];
        return files.slice(0, 300).join("\n") + (files.length > 300 || r.more ? "\n…(more files match; narrow the search)" : "") + early;
      }
      const out: string[] = [];
      let last: { file: string; line: number } | null = null;
      for (const m of r.matches) {
        // A gap between groups of context lines, the way grep prints it.
        if (context && last && (last.file !== m.file || m.line > last.line + 1)) out.push("--");
        out.push(m.context ? `${shown(m.file)}-${m.line}- ${m.text.slice(0, 200)}` : `${shown(m.file)}:${m.line}: ${m.text.trim().slice(0, 200)}`);
        last = m;
      }
      return out.join("\n") + (r.more ? "\n…(stopped at 200 matches; narrow the search)" : "") + early;
    },
  };
}

// ---------- outline ----------
// A file's shape without reading it: its declarations, each with its line number. It works from
// patterns in the text (no compiler), so it's quick on any file and occasionally misses an
// unusual declaration; read_file is always the final word.
const WORDS = "if|for|while|switch|catch|return|else|do|try|function|new|await|typeof|throw|case|delete|void|yield|super|constructor";
const SCRIPT: RegExp[] = [
  /^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function\*?|class|interface|type|enum|namespace|module)\s+[\w$]+/,
  /^(export\s+)?(declare\s+)?(const|let|var)\s+[\w$]+/,                                   // top-level values, including components and hooks
  /^\s+(export\s+)?(const|let|var)\s+[\w$]+\s*(:[^=]+)?=\s*(async\s+)?(function\b|\([^)]*\)\s*(:[^=]+)?=>|[\w$]+\s*=>)/, // nested functions
  /^export\s+(default\b|\{|\*)/,
  /^module\.exports\b|^exports\.[\w$]+\s*=/,
  new RegExp(`^\\s{2,6}(?!(?:${WORDS})\\b)((public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*#?[\\w$]+\\s*(<[^>(]*>)?\\([^=]*\\)\\s*(:\\s*[^{=]+)?\\{\\s*$`), // methods
  /^\s*(describe|it|test|suite|context)(\.\w+)*\(\s*(['"`]).+?\3/,                         // tests, by name
];
const OUTLINES: { ext: RegExp; rules: RegExp[] }[] = [
  { ext: /^\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte)$/, rules: SCRIPT },
  { ext: /^\.py$/, rules: [/^\s*(async\s+)?(def|class)\s+\w+/, /^[A-Z_][A-Z0-9_]*\s*(:[^=]+)?=/] },
  { ext: /^\.go$/, rules: [/^(func|type|var|const)\s+[\w(]/] },
  { ext: /^\.rs$/, rules: [/^\s*(pub(\([^)]*\))?\s+)?(async\s+|unsafe\s+|const\s+)*(fn|struct|enum|trait|impl|mod|type|macro_rules!)\b/] },
  { ext: /^\.(java|kt|kts|cs|swift|scala|dart|php)$/, rules: [/^\s*((public|private|protected|internal|static|final|abstract|override|open|sealed|data|suspend|async|export)\s+)*(class|interface|struct|enum|protocol|extension|object|trait|func|fun|function|record|namespace)\s+[\w<]+/, /^\s{2,8}((public|private|protected|internal|static|final|override|virtual|async)\s+)+[\w<>\[\],.? ]+\s+\w+\s*\([^;]*$/] },
  { ext: /^\.rb$/, rules: [/^\s*(def|class|module)\s+[\w.:]+/] },
  { ext: /^\.(c|h|cc|cpp|hpp|m|mm)$/, rules: [/^[A-Za-z_][\w\s*&:<>,~]*\s+\**[\w:~]+\s*\([^;]*\)?\s*(const\s*)?\{?\s*$/, /^\s*(class|struct|enum|namespace|typedef|#define)\s+\w+/] },
  { ext: /^\.(sh|bash|zsh)$/, rules: [/^\s*(function\s+[\w-]+|[\w-]+\s*\(\)\s*\{)/] },
  { ext: /^\.(md|mdx)$/, rules: [/^#{1,4}\s+\S/] },
  { ext: /^\.(css|scss|less)$/, rules: [/^[^\s@/][^{};]*\{\s*$/, /^@(media|mixin|keyframes|layer|supports|function)\b/] },
  { ext: /^\.(ya?ml)$/, rules: [/^[\w.-]+:/] },
  { ext: /^\.json$/, rules: [/^ {2}"[^"]+":/, /^\t"[^"]+":/] },
  { ext: /^\.(sql)$/, rules: [/^\s*(create|alter|drop)\s+(or\s+replace\s+)?(table|view|function|procedure|index|trigger|type)\b/i] },
];
const MAX_OUTLINE = 300;

export function outlineOf(name: string, text: string): string {
  const kind = OUTLINES.find((o) => o.ext.test(extname(name).toLowerCase()));
  const lines = text.split("\n");
  if (!kind) return `${name} (${lines.length} lines): no outline for this kind of file. Use grep to find what you need, or read_file with offset and limit.`;
  const out: string[] = [];
  let found = 0, inFence = false;
  const markdown = kind.ext.test(".md");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (markdown && /^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; } // "# comment" in a code block isn't a heading
    if (inFence || line.length > 2000 || !kind.rules.some((r) => r.test(line))) continue;
    if (++found > MAX_OUTLINE) continue;
    const indent = Math.min(3, Math.floor(line.replace(/\t/g, "  ").match(/^ */)![0].length / 2));
    const sig = line.trim().replace(/\s*\{\s*$/, "").replace(/\s+/g, " ");
    out.push(`${String(i + 1).padStart(5)}  ${"  ".repeat(indent)}${sig.length > 160 ? sig.slice(0, 160) + "…" : sig}`);
  }
  if (!found) return `${name} (${lines.length} lines): no declarations found. Use read_file.`;
  return `${name} (${lines.length} lines)\n${out.join("\n")}` + (found > MAX_OUTLINE ? `\n…(${found - MAX_OUTLINE} more not shown; use grep for a specific name)` : "");
}

export function outlineFor(self: string): Tool {
  return {
    def: {
      name: "outline",
      description:
        "See a file's structure without reading it: its functions, classes, components, types, exports, and tests " +
        "(or a document's headings), each with its line number. Use it on a large or unfamiliar file, then read_file " +
        "with offset and limit for just the part you need. It reads patterns in the text, so treat it as a map, not a guarantee.",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    run: async ({ path }) => {
      const abs = campPath(path, "read", self);
      const st = statSync(abs);
      if (st.isDirectory()) return `${path} is a folder. Use list_dir or glob to see what's in it.`;
      if (st.size > 3_000_000) return `${path} is ${Math.round(st.size / 1_000_000)} MB: too large to outline. Use grep.`;
      const text = readFileSync(abs, "utf8");
      if (text.includes("\u0000")) return `${path} is a binary file.`;
      return outlineOf(rel(abs), text);
    },
  };
}
