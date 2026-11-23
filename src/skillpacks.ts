// Packaged skills: a `.skill` file is a zip of a skill's folder, SKILL.md (with `name` and
// `description` in its front matter) beside whatever it needs: scripts, reference pages, assets.
//
// Importing is two steps, both yours. First the camp opens the archive in memory and shows you
// what's in it: nothing is written, and nothing in it runs. Then, if you install it, its files
// go to skills/<owner>/<name>/ (which no crew member's file tools can change), and you choose
// which of its commands, if any, may run without asking.
//
// The archive is read in memory (zip.ts), entry by entry, rather than handed to an unzip program: every file
// is one this code wrote, so an archive can't plant a link, or a path that climbs out of the
// skill's folder. It's also why the limits below hold while the files are still being inflated.
//
// Commands a skill may run without asking are kept with your settings (never in the skill's own
// folder), listed with the skill, and gone when the skill is removed. A script from the pack is
// pinned to the file as it was when you approved it: change the file and it asks again. They
// still pass the same test as every auto-approved command (shell.ts): one simple command, no
// chaining or redirection, nothing outside the camp, nothing near a secret.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve, sep } from "node:path";
import { readArchive as readZip, type ArchiveLimits, type Entry } from "./zip.js";
import { emit } from "./events.js";
import { ROSTER } from "./roster.js";
import { alwaysSkills, setAlwaysSkills, setSkillCommands, skillCommands, type SkillCommand } from "./settings.js";
import { w } from "./words.js";
// Paths inside the camp are written with forward slashes on every system (Windows takes them too),
// so what the crew and the page are shown reads the same everywhere.
const join = posix.join;

const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_ENTRIES = 300;
const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 8 * 1024 * 1024;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const owners = () => ["shared", "quartermaster", ...Object.keys(ROSTER)];
const bad = (message: string) => Object.assign(new Error(message), { fixable: true });

// ---------- Reading the archive (zip.ts) ----------
const SKILL_LIMITS: ArchiveLimits = {
  archive: MAX_ARCHIVE, entries: MAX_ENTRIES, file: MAX_FILE, total: MAX_TOTAL, what: "a skill",
  notOne: "That isn't a .skill file (a .skill is a zip of a skill's folder).",
};
export const readArchive = (buf: Buffer) => readZip(buf, SKILL_LIMITS);

// A path inside the skill's folder, or null if it isn't one we'd write (it climbs out, is
// absolute, is hidden, or has characters a file name shouldn't).
export function safePath(path: string): string | null {
  if (!path || path.length > 200 || path.includes("\\") || path.startsWith("/") || /[\u0000-\u001f\u007f:]/.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || s.startsWith(".") || s.endsWith(" ") || s.endsWith("."))) return null;
  return parts.join("/");
}

// ---------- Looking before installing ----------
const RUNNERS: Record<string, string> = { py: "python3", sh: "bash", js: "node", mjs: "node" };
export type PackPreview = {
  id: string;                 // what "install" is given: the pack is held in memory for a while
  name: string; description: string;
  body: string;               // SKILL.md, as it will be read
  files: { path: string; size: number }[];
  // The pack's own scripts, each of which you may let run without asking. text: for you to read first.
  scripts: { file: string; runner: string; text: string }[];
  installed: string[];        // owners that already have a skill by this name (installing there replaces it)
  skipped: string[];          // entries left out (hidden files, names that aren't safe)
};
type Held = { preview: PackPreview; files: Entry[]; at: number };
const held = new Map<string, Held>();
const HOLD_MS = 20 * 60_000;

function frontmatter(text: string): { name: string; description: string } {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: "", description: "" };
  const lines = m[1].split(/\r?\n/);
  const value = (key: string) => {
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at < 0) return "";
    let v = lines[at].slice(key.length + 1).trim();
    // A folded or multi-line value: the indented lines under it.
    if (!v || v === ">" || v === "|" || v === ">-" || v === "|-") { v = ""; for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) v += ` ${lines[i].trim()}`; }
    return v.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").replace(/\s+/g, " ");
  };
  return { name: value("name"), description: value("description") };
}

export function inspectPack(buf: Buffer, filename = ""): PackPreview {
  const all = readArchive(buf);
  // The skill's folder is the archive itself, or the one folder at its top.
  const tops = new Set(all.map((e) => e.path.split("/")[0]));
  const rooted = all.some((e) => e.path === "SKILL.md");
  const prefix = !rooted && tops.size === 1 && all.some((e) => e.path === `${[...tops][0]}/SKILL.md`) ? `${[...tops][0]}/` : "";
  if (!rooted && !prefix) throw bad("There's no SKILL.md at the top of that archive (or of the one folder in it), so it isn't a packaged skill.");
  const files: Entry[] = [], skipped: string[] = [];
  for (const e of all) {
    const path = safePath(e.path.slice(prefix.length));
    if (!path) { skipped.push(e.path); continue; }
    if (files.some((f) => f.path.toLowerCase() === path.toLowerCase())) throw bad(`${path} is in the archive twice.`);
    files.push({ path, data: e.data });
  }
  const skill = files.find((f) => f.path === "SKILL.md");
  if (!skill) throw bad("There's no SKILL.md in that archive.");
  if (skill.data.includes(0)) throw bad("SKILL.md isn't text.");
  const body = skill.data.toString("utf8");
  const fm = frontmatter(body);
  const fallback = (prefix.slice(0, -1) || filename.replace(/\.(skill|zip)$/i, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const name = NAME_RE.test(fm.name) ? fm.name : NAME_RE.test(fallback) ? fallback : "";
  if (!name || name.length > 60) throw bad("SKILL.md needs a `name:` in its front matter, in kebab-case (like research-brief).");
  if (!fm.description) throw bad(`SKILL.md needs a \`description:\` in its front matter: one line saying when to use the skill. It's all a ${w("crew")} member sees until they open it.`);
  const scripts = files.filter((f) => RUNNERS[f.path.split(".").pop() ?? ""] && !f.data.includes(0))
    .map((f) => ({ file: f.path, runner: RUNNERS[f.path.split(".").pop()!], text: f.data.toString("utf8").slice(0, 20_000) }));
  const id = createHash("sha256").update(buf).digest("hex").slice(0, 24);
  const preview: PackPreview = {
    id, name, description: fm.description.slice(0, 400), body: body.slice(0, 40_000),
    files: files.map((f) => ({ path: f.path, size: f.data.length })).sort((a, b) => a.path.localeCompare(b.path)),
    scripts, skipped,
    installed: owners().filter((o) => existsSync(join("skills", o, name, "SKILL.md"))),
  };
  for (const [k, h] of held) if (Date.now() - h.at > HOLD_MS) held.delete(k);
  if (held.size >= 6) held.delete(held.keys().next().value!);
  held.set(id, { preview, files, at: Date.now() });
  return preview;
}

// ---------- Commands a skill may run without asking ----------
// Prefixes nobody should hand out wholesale: they'd let any script or any command through.
const TOO_BROAD = new Set(["sh", "bash", "zsh", "python", "python3", "node", "npx", "npm", "pnpm", "yarn", "sudo", "env", "eval", "exec", "rm", "curl", "wget", "ssh", "git", "git push", "chmod", "chown", "mv", "cp", "tee", "xargs"]);
export function cleanPrefix(raw: unknown): string {
  const p = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!p) return "";
  if (p.length > 120 || /[;&|<>`$(){}\\]/.test(p)) throw bad(`"${p.slice(0, 60)}" isn't one simple command (no ;, |, &, redirects or substitutions).`);
  if (TOO_BROAD.has(p)) throw bad(`"${p}" on its own would let almost anything run without asking. Give the whole command the skill needs, like "pnpm add" or "npm run lint".`);
  return p;
}
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export const scriptCommand = (owner: string, name: string, s: { runner: string; file: string }) => `${s.runner} skills/${owner}/${name}/${s.file}`;

// ---------- Installing and removing ----------
// scripts: the pack's scripts (by path) that may run without asking. commands: other command
// prefixes this skill may run without asking. replace: an installed skill by this name is replaced.
export function installPack(id: string, input: { owner?: unknown; scripts?: unknown; commands?: unknown; replace?: unknown }) {
  const h = held.get(id);
  if (!h) throw bad("That import has lapsed. Choose the .skill file again.");
  const owner = String(input.owner ?? "shared");
  if (!owners().includes(owner)) throw bad(`There's no ${w("crew")} member "${owner}" to give the skill to.`);
  const { name } = h.preview;
  const dir = join("skills", owner, name);
  if (existsSync(dir) && input.replace !== true) throw bad(`${owner} already has a skill called ${name}. Install it again with "replace" to swap it for this one.`);
  const wantScripts = new Set(Array.isArray(input.scripts) ? input.scripts.map(String) : []);
  const pinned = h.preview.scripts.filter((s) => wantScripts.has(s.file));
  const prefixes = [...new Set((Array.isArray(input.commands) ? input.commands : []).map(cleanPrefix).filter(Boolean))].slice(0, 20);
  rmSync(dir, { recursive: true, force: true });
  for (const f of h.files) {
    const to = join(dir, f.path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, f.data, { mode: 0o644, flag: "wx" }); // never through something already there
  }
  const commands: SkillCommand[] = [
    ...pinned.map((s) => ({ prefix: scriptCommand(owner, name, s), file: join(dir, s.file), sha256: sha(h.files.find((f) => f.path === s.file)!.data) })),
    ...prefixes.map((prefix) => ({ prefix })),
  ];
  setSkillCommands(`${owner}/${name}`, commands);
  held.delete(id);
  emit({ type: "changed", what: "skills" });
  return { owner, name, path: join(dir, "SKILL.md"), files: h.files.length, commands: commands.map((c) => c.prefix) };
}

// Take an installed skill off the disk, along with the commands approved for it.
export function removeSkill(owner: string, name: string): boolean {
  if (!owners().includes(owner) || !NAME_RE.test(name)) return false;
  const dir = join("skills", owner, name);
  if (!existsSync(join(dir, "SKILL.md"))) return false;
  rmSync(dir, { recursive: true, force: true });
  setSkillCommands(`${owner}/${name}`, null);
  if (alwaysFor(owner, name).length) setSkillAlways(owner, name, [], true);
  emit({ type: "changed", what: "skills" });
  return true;
}

// ---------- Editing an installed skill ----------
// Your own edits, from the page: a skill's SKILL.md and the text files beside it. Still nothing a
// crew member can do (their file tools can't write under skills/).
const MAX_EDIT = 200_000; // characters of one file
const MAX_LISTED = 400;
export type SkillFile = { path: string; size: number; text: boolean }; // text: it can be opened and edited here
export type SkillDetail = { owner: string; name: string; files: SkillFile[]; commands: string[] };

// The skill's folder, once it's known to be one (a real folder under skills/<owner>/ with a SKILL.md).
function skillDir(owner: string, name: string): string {
  if (!owners().includes(owner) || !NAME_RE.test(name)) throw bad("No such skill.");
  const dir = join("skills", owner, name);
  if (!existsSync(join(dir, "SKILL.md")) || lstatSync(dir).isSymbolicLink()) throw bad("No such skill.");
  return dir;
}
// A file inside the skill, by its path there. Not a link, and not somewhere a link in the path leads.
function skillFile(dir: string, path: string, mustExist: boolean): string {
  const rel = safePath(path);
  if (!rel) throw bad(`"${path}" isn't a path inside the skill (no .., no hidden files).`);
  const file = join(dir, rel);
  const root = realpathSync(dir) + sep;
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || !(realpathSync(file) + sep).startsWith(root)) throw bad(`${rel} isn't an ordinary file in the skill.`);
  } else {
    if (mustExist) throw bad(`There's no ${rel} in this skill.`);
    let up = dirname(file); // the nearest folder that's there must be inside the skill too
    while (!existsSync(up)) up = dirname(up);
    if (!(realpathSync(up) + sep).startsWith(root)) throw bad(`${rel} isn't inside the skill.`);
  }
  return file;
}
const looksText = (buf: Buffer) => buf.length <= MAX_FILE && !buf.subarray(0, 8000).includes(0);

export function skillDetail(owner: string, name: string): SkillDetail {
  const dir = skillDir(owner, name);
  const files: SkillFile[] = [];
  const walk = (at: string, rel: string) => {
    for (const e of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".") || files.length >= MAX_LISTED) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(at, e.name), path);
      else if (e.isFile()) { const buf = readFileSync(join(at, e.name)); files.push({ path, size: buf.length, text: looksText(buf) }); }
    }
  };
  walk(dir, "");
  files.sort((a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md")); // the skill itself first
  return { owner, name, files, commands: (skillCommands()[`${owner}/${name}`] ?? []).map((c) => c.prefix) };
}

export function readSkillFile(owner: string, name: string, path: string): { path: string; text: string } {
  const file = skillFile(skillDir(owner, name), path, true);
  const buf = readFileSync(file);
  if (!looksText(buf)) throw bad(`${path} isn't text, so it can't be edited here.`);
  return { path: safePath(path)!, text: buf.toString("utf8") };
}

// Save one file of a skill ({ create: true } to add a new one). SKILL.md has to stay a skill: it
// keeps its front matter, with the name the folder has and a description (all a crew member sees
// until they open it). A script you let run without asking stays approved, pinned to what you've
// just saved: the change is yours.
export function saveSkillFile(owner: string, name: string, path: string, text: unknown, create = false): SkillDetail & { saved: string; stillApproved: boolean } {
  const dir = skillDir(owner, name);
  const body = String(text ?? "").replace(/\r\n/g, "\n");
  if (body.length > MAX_EDIT) throw bad(`That's over ${MAX_EDIT.toLocaleString("en-US")} characters, which is more than a skill's file should hold.`);
  if (body.includes("\u0000")) throw bad("That isn't text.");
  const file = skillFile(dir, path, !create);
  const rel = safePath(path)!;
  if (create && existsSync(file)) throw bad(`There's already a ${rel} in this skill.`);
  if (rel === "SKILL.md") {
    const fm = frontmatter(body);
    if (!fm.description) throw bad(`SKILL.md needs its front matter: a first line of ---, then \`name:\` and \`description:\`, then --- again. The description is all a ${w("crew")} member sees until they open the skill.`);
    if (fm.name !== name) throw bad(`The \`name:\` in SKILL.md has to stay "${name}" (it's the skill's folder). To rename a skill, import or propose it under the new name.`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, { mode: 0o644 });
  // Pinned to the file as it was: pin it to the file as it is now.
  const key = `${owner}/${name}`;
  const mine = skillCommands()[key] ?? [];
  const pinned = mine.some((c) => c.file && resolve(c.file) === resolve(file));
  if (pinned) setSkillCommands(key, mine.map((c) => (c.file && resolve(c.file) === resolve(file) ? { ...c, sha256: sha(Buffer.from(body)) } : c)));
  emit({ type: "changed", what: "skills" });
  return { ...skillDetail(owner, name), saved: rel, stillApproved: pinned };
}

// ---------- Always on ----------
// A skill is normally listed by name and description, and opened when a task seems to match.
// Set "always on" for a crew member, its instructions go into every one of their prompts
// instead, so they follow it without having to notice it applies. A shared skill can be always
// on for anyone; a crew member's own skill, for them.
export const alwaysFor = (owner: string, name: string): string[] =>
  Object.entries(alwaysSkills()).filter(([, list]) => list.includes(`${owner}/${name}`)).map(([id]) => id);

export function setSkillAlways(owner: string, name: string, agents: unknown, gone = false): string[] {
  if (!gone) skillDir(owner, name); // it has to be there
  const crew = ["quartermaster", ...Object.keys(ROSTER)];
  const asked = [...new Set((Array.isArray(agents) ? agents : []).map(String))];
  for (const id of asked) {
    if (!crew.includes(id)) throw bad(`There's no ${w("crew")} member "${id}".`);
    if (owner !== "shared" && id !== owner) throw bad(`${owner}/${name} belongs to ${owner}: only they can use it. Import or propose it as shared to give it to others.`);
  }
  const key = `${owner}/${name}`;
  const all = { ...alwaysSkills() };
  for (const id of new Set([...Object.keys(all), ...asked])) {
    const rest = (all[id] ?? []).filter((k) => k !== key);
    all[id] = asked.includes(id) ? [...rest, key] : rest;
  }
  setAlwaysSkills(all);
  emit({ type: "changed", what: "skills" });
  return alwaysFor(owner, name);
}
