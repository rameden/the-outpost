// A linked repository's own guidance for agents, beyond the guide at its top.
//
// The guide at a repository's top (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md) goes
// into every prompt whole (links.ts). Two more kinds are only listed, so the crew knows they're
// there and reads the one that applies:
//
//   - guides for part of the repository: a package's or folder's own AGENTS.md or CLAUDE.md,
//     to read before working in that folder;
//   - the repository's own skills: <folder>/.claude/skills/<name>/SKILL.md (or .agents/skills,
//     .github/skills), each with its description, to read and follow when the work matches.
//
// They're found with `git ls-files` (tracked and new files, never ignored ones such as
// node_modules), so a folder that isn't a git repository lists nothing. A skill folder that's a
// symlink to another one counts once: git lists the link, not what's behind it.
//
// Only the files are read. The repository's .claude/settings.json, its hooks and its MCP servers
// aren't loaded: what runs is still decided by the camp's approvals, so a skill that expects one
// of those won't find it.

import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { w } from "./words.js";

const SKILL_RE = /^(?:(.*)\/)?\.(?:claude|agents|github)\/skills\/([^/]+)\/SKILL\.md$/;
const GUIDE_RE = /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/;
// A guide inside a skill's folder belongs to the skill, not to the repository.
const IN_SKILL_RE = /(?:^|\/)\.(?:claude|agents|github)\/skills\//;
// The guides at the top are loaded whole elsewhere: they aren't listed again here.
const AT_TOP = new Set(["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"]);

const MAX_GUIDES = 40;
const MAX_SKILLS = 60;
const MAX_DESCRIPTION = 300;
const KEEP_MS = 20_000;

export type FolderGuide = { path: string; folder: string };
export type RepoSkill = { name: string; description: string; path: string; folder?: string };
export type Guidance = { guides: FolderGuide[]; skills: RepoSkill[]; more: { guides: number; skills: number } };

// Sort the files git found into folder guides and skills. One guide per folder: where a folder
// has both an AGENTS.md and a CLAUDE.md, AGENTS.md is the one listed.
export function classify(paths: string[]): { guides: FolderGuide[]; skills: { path: string; dir: string; folder?: string }[] } {
  const files = [...new Set(paths.map((p) => p.replace(/^\.\//, "")))].filter((p) => p && !p.split("/").includes("node_modules")).sort();
  const byFolder = new Map<string, string>();
  const skills: { path: string; dir: string; folder?: string }[] = [];
  for (const p of files) {
    const m = SKILL_RE.exec(p);
    if (m) { skills.push({ path: p, dir: m[2], ...(m[1] ? { folder: m[1] } : {}) }); continue; }
    if (AT_TOP.has(p) || IN_SKILL_RE.test(p) || !GUIDE_RE.test(p)) continue;
    const folder = p.slice(0, p.lastIndexOf("/"));
    if (!folder || folder === ".claude") continue;
    if (!byFolder.has(folder) || p.endsWith("/AGENTS.md")) byFolder.set(folder, p);
  }
  return { guides: [...byFolder].map(([folder, path]) => ({ path, folder })), skills };
}

// A SKILL.md's name and description from its front matter (plain, quoted, or a folded `>` /
// literal `|` block).
export function frontMatter(text: string): { name?: string; description?: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out: { name?: string; description?: string } = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      value = block.join(" ").replace(/\s+/g, " ").trim();
    } else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    out[kv[1] as "name" | "description"] = value;
  }
  return out;
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
};
// The start of a file inside the folder (a symlink that leads out of it reads as nothing).
function head(root: string, path: string, bytes = 4000): string {
  try {
    const file = join(root, path);
    if (!statSync(file).isFile() || !inside(realpathSync(file), realpathSync(root))) return "";
    const fd = openSync(file, "r");
    try { const buf = Buffer.alloc(bytes); return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0)); } finally { closeSync(fd); }
  } catch { return ""; }
}
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

function listed(root: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
      ":(glob)**/SKILL.md", ":(glob)**/AGENTS.md", ":(glob)**/CLAUDE.md"],
      { cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
  } catch { return []; } // not a repository, or no git: there's nothing to list
}

// What a folder holds, kept for a moment: every prompt asks, and a run starts several.
const kept = new Map<string, { at: number; found: Guidance }>();
export function forgetGuidance() { kept.clear(); }

export function repoGuidance(root: string, now = Date.now()): Guidance {
  const was = kept.get(root);
  if (was && now - was.at < KEEP_MS) return was.found;
  const sorted = classify(listed(root));
  const skills: RepoSkill[] = [];
  const seen = new Set<string>();
  for (const s of sorted.skills) {
    const fm = frontMatter(head(root, s.path));
    const name = (fm.name || s.dir).replace(/\s+/g, " ").trim();
    const key = `${s.folder ?? ""}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push({ name, description: clip((fm.description ?? "").replace(/\s+/g, " ").trim(), MAX_DESCRIPTION), path: s.path, ...(s.folder ? { folder: s.folder } : {}) });
  }
  const found: Guidance = {
    guides: sorted.guides.slice(0, MAX_GUIDES), skills: skills.slice(0, MAX_SKILLS),
    more: { guides: Math.max(0, sorted.guides.length - MAX_GUIDES), skills: Math.max(0, skills.length - MAX_SKILLS) },
  };
  if (kept.size >= 50) kept.delete(kept.keys().next().value!);
  kept.set(root, { at: now, found });
  return found;
}

// What the crew is told about one folder (label: how they see its top, "links/web/"), or "" when
// it has neither.
export function guidanceBlock(label: string, g: Guidance): string {
  const parts: string[] = [];
  if (g.guides.length) {
    parts.push(`### ${label}: guides for parts of it\nRead the one for a folder before you work in that folder.\n` +
      g.guides.map((x) => `- ${label}${x.path} (for ${label}${x.folder}/)`).join("\n") +
      (g.more.guides ? `\n- …and ${g.more.guides} more (glob for AGENTS.md)` : ""));
  }
  if (g.skills.length) {
    parts.push(`### ${label}: its own skills\nWhen the work matches one, read its SKILL.md and follow it, with the files beside it. ` +
      `Anything it has you run still goes through the ${w("camp")}'s approvals, and the hooks or MCP servers it may expect aren't loaded here: say so if a skill needs one.\n` +
      g.skills.map((s) => `- **${s.name}**${s.folder ? ` (for ${label}${s.folder}/)` : ""}${s.description ? `: ${s.description}` : ""} → ${label}${s.path}`).join("\n") +
      (g.more.skills ? `\n- …and ${g.more.skills} more (glob for SKILL.md)` : ""));
  }
  return parts.join("\n\n");
}
