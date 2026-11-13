// What a project gives the crew, beyond its settings (conversations.ts):
//
//   camp/projects/<id>/notes.md   lessons the crew has learned about this project, one dated line
//                                 each (they add to it with project_remember; you can edit it)
//   camp/projects/<id>/brief.md   a survey of the project's folders: stack, commands, layout
//                                 (written by "Survey this project", replaced each time)
//
// Both are loaded into every prompt in that project, and nowhere else, so what the crew learns
// about one project doesn't use up their own memory or leak into another project's work.
// This file also builds the project's block of the prompt, and the numbers on a project's page.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GENERAL, getProject, history, type Project } from "./conversations.js";
import { changedFiles } from "./checkpoints.js";
import { currentProjectId, inScope, leftOutHere, type Workspace } from "./context.js";
import { emit } from "./events.js";
import { loadJobs } from "./jobs.js";
import { loadLinks } from "./links.js";
import { logKept, type KeptHow } from "./memlog.js";
import { currentExpeditionId } from "./context.js";
import { questCost, recentQuests } from "./questlog.js";
import { allTurns } from "./threads.js";
import { campPath, type Tool } from "./tools.js";
import { writeAtomic } from "./atomic.js";
import { fitMemory } from "./memfit.js";

export const PROJECTS_DIR = join("camp", "projects");
export const NOTES_MAX = 6000;       // characters of notes loaded into a prompt
const NOTES_NUDGE = 4500;     // past this, the crew is asked to tidy them
const BRIEF_MAX = 8000;
const PIN_MAX = 6000;         // per pinned file
const PINS_MAX = 20_000;      // all pinned files together

const SAFE_ID = /^[a-z0-9]{1,24}$/;
const dir = (id: string) => join(PROJECTS_DIR, id);
const today = () => new Date().toISOString().slice(0, 10);
const read = (file: string) => { try { return readFileSync(file, "utf8").trim(); } catch { return ""; } };

export const projectNotes = (id: string) => (SAFE_ID.test(id) ? read(join(dir(id), "notes.md")) : "");
export const projectBrief = (id: string) => (SAFE_ID.test(id) ? read(join(dir(id), "brief.md")) : "");

function write(id: string, file: "notes.md" | "brief.md", text: string) {
  if (!SAFE_ID.test(id)) throw new Error("No such project.");
  mkdirSync(dir(id), { recursive: true });
  writeAtomic(join(dir(id), file), text.trim() ? text.trim() + "\n" : "");
  emit({ type: "changed", what: "history" });
}
// You can edit either by hand, from the project's page.
export const setProjectNotes = (id: string, text: string) => write(id, "notes.md", String(text).slice(0, 20_000));
export const setProjectBrief = (id: string, text: string) => write(id, "brief.md", String(text).slice(0, 20_000));

// Add one dated line to a project's notes (what project_remember does; also used when you keep a feedback note).
export function addProjectNote(id: string, text: string, how: KeptHow = "remember", run?: string) {
  if (!SAFE_ID.test(id)) throw new Error("No such project.");
  mkdirSync(dir(id), { recursive: true });
  appendFileSync(join(dir(id), "notes.md"), `- ${today()} ${text.replace(/\s+/g, " ").trim()}\n`);
  logKept(`project:${id}`, text, how, run ?? currentExpeditionId());
  emit({ type: "changed", what: "history" });
}

// The crew's tool for what they learn about the project they're working in.
export const projectRemember: Tool = {
  def: {
    name: "project_remember",
    description:
      "Save something about THE PROJECT this conversation is filed under, so every later conversation in that project " +
      "starts with it: how its code is laid out, the commands that work, conventions the user wants there, a pitfall " +
      "that cost a retry. Use this instead of remember for anything that is only true of this project; remember is " +
      "for how you work in general. 'append' adds one dated line (the default). 'rewrite' replaces all the notes: use " +
      "it to tidy them, keeping what's still true. 'brief' replaces the project's survey (its stack, commands, and " +
      "layout): only when asked to survey the project.",
    input_schema: {
      type: "object",
      properties: {
        entry: { type: "string", description: "One line for 'append'; the full text for 'rewrite' or 'brief'." },
        mode: { type: "string", enum: ["append", "rewrite", "brief"] },
      },
      required: ["entry"],
    },
  },
  run: async ({ entry, mode = "append" }) => {
    const id = currentProjectId();
    const project = getProject(id);
    if (!id || !project || id === GENERAL) return "This conversation isn't filed under a project, so there's nowhere to keep project notes. Use remember, or the wiki.";
    const text = String(entry ?? "").trim();
    if (!text) return "Nothing to save.";
    if (mode === "brief") { setProjectBrief(id, text); return `Saved the survey of ${project.name}.`; }
    if (mode === "rewrite") { setProjectNotes(id, text); return `Rewrote the notes for ${project.name}.`; }
    addProjectNote(id, text);
    const size = projectNotes(id).length;
    return `Noted for ${project.name}.` + (size > NOTES_NUDGE ? ` The notes are getting long (${size} characters; a prompt loads about ${NOTES_MAX}: the pinned lines, the newest, and older ones only when a request is about them). When you have a moment, use mode 'rewrite' to merge them into fewer, still-true lines.` : "");
  },
};

// ---------- The project's part of every prompt ----------
// Files you pinned are shown in full (up to a limit); web addresses are listed for the Scout to fetch.
function pinsBlock(project: Project, self: string): string {
  const files: string[] = [], urls: string[] = [];
  let used = 0;
  for (const pin of project.pins ?? []) {
    if (/^https?:\/\//i.test(pin)) { urls.push(`- ${pin}`); continue; }
    try {
      const abs = campPath(pin, "read", self);
      if (!statSync(abs).isFile()) { files.push(`### ${pin}\n(a folder: browse it with list_dir)`); continue; }
      const text = readFileSync(abs, "utf8");
      if (text.includes("\u0000")) { files.push(`### ${pin}\n(not a text file: open it with view_file)`); continue; }
      const room = Math.min(PIN_MAX, PINS_MAX - used);
      if (room <= 0) { files.push(`### ${pin}\n(not shown for length: read it with read_file)`); continue; }
      const body = text.length > room ? text.slice(0, room) + `\n…[cut: read the rest with read_file]` : text.trim();
      used += body.length;
      files.push(`### ${pin}\n${body}`);
    } catch (e: any) {
      files.push(`### ${pin}\n(couldn't be read: ${e.message})`);
    }
  }
  return (files.length ? `\n\n### Pinned references (the user wants these in front of you for everything in this project)\n${files.join("\n\n")}` : "") +
    (urls.length ? `\n\n### Pinned links (fetch one when it's relevant)\n${urls.join("\n")}` : "");
}

// Everything about the project the current run belongs to. Empty when there's none.
// task: the request this run is for, so an older note that bears on it is loaded when the notes have outgrown their room.
export function projectBlock(self: string, id = currentProjectId(), task = ""): string {
  const p = getProject(id);
  if (!p) return "";
  const general = p.id === GENERAL;
  const notes = general ? "" : projectNotes(p.id);
  const brief = general ? "" : projectBrief(p.id);
  if (general && !p.description && !p.pins?.length) return "";
  const links = loadLinks().filter((l) => p.links?.includes(l.name) && inScope(l.name));
  const left = loadLinks().filter((l) => p.links?.includes(l.name) && !inScope(l.name)).map((l) => l.name); // the ones this conversation was started without
  const cap = (text: string, max: number) => (text.length > max ? "…\n" + text.slice(-max) : text);
  return `## Project: ${p.name}\n` +
    (general ? "This conversation isn't filed under a particular project." : `The user filed this conversation under their project "${p.name}".`) +
    (links.length ? ` It is about ${links.map((l) => `links/${l.name}/ (${l.access === "write" ? "you may edit files there" : "read-only"})`).join(" and ")}: unless they say otherwise, that's where the work is.` : "") +
    (left.length ? ` The user left ${left.map((l) => `links/${l}/`).join(" and ")} out of this conversation: nothing from ${left.length === 1 ? "it" : "them"} is part of this conversation. Work without ${left.length === 1 ? "it" : "them"}, and don't ask for ${left.length === 1 ? "it" : "them"} unless the request can't be done otherwise.` : "") +
    (general ? "" : " Other projects' folders aren't part of this conversation.") +
    (p.settings?.web === "careful" ? "\nThis project is confidential. Never put its name, its code, its internal names, or anything else from its files into a web search or a fetched address: phrase research generically (the library, the error message, the pattern)." : "") +
    (p.settings?.web === "off" ? "\nWeb search and fetch are turned off for this project. Work from the files, and say so if something needs looking up." : "") +
    (p.description ? `\n\n### What the user wrote about this project (their own words; keep it in mind for everything here)\n${p.description}` : "") +
    (brief ? `\n\n### Survey of the project (from the crew's own look through its folders; check the files if it matters)\n${cap(brief, BRIEF_MAX)}` : "") +
    (notes ? `\n\n### What the crew has learned about this project (add to it with project_remember)\n${fitMemory(notes, NOTES_MAX, task).text}` : general ? "" : "\n\n(No project notes yet. When you learn something that's true of this project, save it with project_remember.)") +
    pinsBlock(p, self);
}

// Folders the user took out of this conversation that aren't its project's own (those are named in
// the project's block): the crew may have worked in one earlier, so it's told the folder is gone on purpose.
export function leftOutBlock(id = currentProjectId()): string {
  const own = getProject(id)?.links ?? [];
  const out = loadLinks().map((l) => l.name).filter((l) => leftOutHere().includes(l) && !inScope(l) && !own.includes(l));
  if (!out.length) return "";
  const it = out.length === 1 ? "it" : "them";
  return `## Folders taken out of this conversation
The user took ${out.map((l) => `links/${l}/`).join(" and ")} out of this conversation: nothing from ${it} is part of it now, even where earlier messages worked there. ` +
    `Work without ${it}, and don't ask for ${it} back unless the request can't be done otherwise.`;
}

// The request "Survey this project" sends, for the Scout.
export function surveyRequest(p: Project): string {
  const folders = (p.links ?? []).map((l) => `links/${l}/`).join(" and ");
  return `Survey the project "${p.name}" so the crew can start work there without rediscovering it each time. Look through ${folders} ` +
    `(list_dir, glob, outline, and read the README, the package or build files, any AGENTS.md or contributing guide, and a few representative source files). ` +
    `Don't change anything and don't search the web.\n\nThen save a brief with project_remember, mode "brief", in Markdown, under 600 words, covering:\n` +
    `- What it is, in two sentences\n- The stack and main dependencies\n- How it's laid out: the folders that matter and what lives in each\n` +
    `- The commands to install, run, test, typecheck, and lint (exactly as written in its scripts)\n- Conventions that stand out (naming, formatting, patterns, things its own docs insist on)\n` +
    `- Anything risky or surprising\n\nOnly state what you saw in the files. Finish by telling me in three lines what you found.`;
}

// ---------- A project's page ----------
export type ProjectPageData = {
  notes: string; brief: string;
  usage: { runs: number; cost: number; week: number; lastRun: string | null };
  workspaces: (Workspace & { conversation: string })[]; // worktrees its conversations have worked in, newest first
  changed: { path: string; change: string; conversation: string; title: string }[];
  jobs: { name: string; schedule: string; enabled: boolean; lastRun?: string }[];
};

export function projectPage(id: string): ProjectPageData | null {
  const p = getProject(id);
  if (!p) return null;
  const mine = history().conversations.filter((c) => c.project === id);
  const titles = new Map(mine.map((c) => [c.id, c.title]));
  const runs = recentQuests(Number.MAX_SAFE_INTEGER).filter((q) => q.project === id);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const usage = {
    runs: runs.length,
    cost: runs.reduce((s, q) => s + questCost(q), 0),
    week: runs.filter((q) => new Date(q.time).getTime() > weekAgo).reduce((s, q) => s + questCost(q), 0),
    lastRun: runs.at(-1)?.time ?? null,
  };
  const turns = allTurns().filter((t) => titles.has(t.thread)).reverse();
  const seen = new Set<string>();
  const workspaces: ProjectPageData["workspaces"] = [];
  for (const t of turns) for (const w of Object.values(t.workspaces ?? {})) {
    if (seen.has(w.path) || !existsSync(w.path)) continue;
    seen.add(w.path);
    workspaces.push({ ...w, conversation: t.thread });
  }
  const changed: ProjectPageData["changed"] = [];
  const files = new Set<string>();
  for (const t of turns.slice(0, 25)) for (const f of changedFiles(t.expedition, { sealedOnly: true })) {
    if (files.has(f.path) || changed.length >= 30) continue;
    files.add(f.path);
    changed.push({ ...f, conversation: t.thread, title: titles.get(t.thread) ?? "" });
  }
  const jobs = loadJobs().filter((j) => j.project === id).map((j) => ({ name: j.name, schedule: j.schedule, enabled: j.enabled, lastRun: j.lastRun }));
  return { notes: projectNotes(id), brief: projectBrief(id), usage, workspaces: workspaces.slice(0, 12), changed, jobs };
}
