// History: every conversation you've had with the camp, filed under projects.
//
// A conversation is a thread (threads.ts): a first request and every follow-up to it. Starting a
// new conversation keeps unrelated work out of each other's context; replying in one carries the
// whole of it. The list is read from camp/threads.jsonl, so it needs no upkeep of its own.
//
// Projects are your own grouping: "General" for anything unfiled, one made for each linked
// folder the first time it's seen, and any you add. A project has a name, a description in your
// own words (what it is, what matters, how you like it done), and optionally the linked folder it
// is about. The crew is given all three at the start of every conversation filed under it. What you change by hand (a conversation's
// title, its project, whether it's been removed from the list) is in camp/conversations.json.
// Removing a conversation only hides it: its record stays in the camp's files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { CREW, type CrewId } from "./crew.js";
import type { CampEvent } from "./events.js";
import { emit } from "./events.js";
import { FEED_PATH } from "./feed.js";
import { loadLinks } from "./links.js";
import { allTurns, type Turn } from "./threads.js";

export const CONVERSATIONS_PATH = "camp/conversations.json";
export const GENERAL = "general";

// link: the linked folder this project is about. description: your own words about it, for the crew.
export type Project = { id: string; name: string; link?: string; description?: string };
export type ProjectDetails = { name?: unknown; description?: unknown; link?: unknown };
const MAX_DESCRIPTION = 4000;
type Meta = { title?: string; project?: string; removed?: boolean };
type Saved = { projects: Project[]; seenLinks: string[]; meta: Record<string, Meta> };

export type Conversation = {
  id: string;            // the thread: its first run's id
  title: string;
  project: string;
  created: string;
  updated: string;
  agent: string;         // who it's with: "quartermaster", or the crew member in a direct chat
  direct: boolean;
  expeditions: string[]; // its runs, oldest first
  status: string;        // how the latest run ended ("running" while it's going)
};
export type History = { projects: Project[]; conversations: Conversation[] };

function load(): Saved {
  let s: Partial<Saved> = {};
  try { if (existsSync(CONVERSATIONS_PATH)) s = JSON.parse(readFileSync(CONVERSATIONS_PATH, "utf8")); } catch { /* start over */ }
  const projects = Array.isArray(s.projects) ? s.projects.filter((p) => p && typeof p.id === "string" && typeof p.name === "string") : [];
  if (!projects.some((p) => p.id === GENERAL)) projects.unshift({ id: GENERAL, name: "General" });
  return { projects, seenLinks: Array.isArray(s.seenLinks) ? s.seenLinks : [], meta: s.meta && typeof s.meta === "object" ? s.meta : {} };
}

function save(s: Saved) {
  mkdirSync("camp", { recursive: true });
  writeFileSync(CONVERSATIONS_PATH, JSON.stringify(s, null, 2) + "\n");
  emit({ type: "changed", what: "history" });
}

const newId = () => randomBytes(4).toString("hex");
const cleanName = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

// A linked folder gets a project of its own the first time it's seen (once: delete it and it stays gone).
function withLinkProjects(s: Saved): Saved {
  const fresh = loadLinks().filter((l) => !s.seenLinks.includes(l.name));
  if (!fresh.length) return s;
  for (const l of fresh) {
    if (!s.projects.some((p) => p.link === l.name)) s.projects.push({ id: newId(), name: l.name, link: l.name });
    s.seenLinks.push(l.name);
  }
  save(s);
  return s;
}

export function titleOf(task: string): string {
  const flat = task.replace(/^@\w+\s+/, "").replace(/\s+/g, " ").trim();
  return flat.length > 64 ? flat.slice(0, 63).trimEnd() + "…" : flat || "Untitled";
}

export function history(): History {
  const s = withLinkProjects(load());
  const known = new Set(s.projects.map((p) => p.id));
  const byThread = new Map<string, Turn[]>();
  for (const t of allTurns()) byThread.set(t.thread, [...(byThread.get(t.thread) ?? []), t]);
  const conversations: Conversation[] = [];
  for (const [id, turns] of byThread) {
    const meta = s.meta[id] ?? {};
    if (meta.removed) continue;
    const first = turns[0], last = turns[turns.length - 1];
    conversations.push({
      id, title: meta.title || titleOf(first.task), project: meta.project && known.has(meta.project) ? meta.project : GENERAL,
      created: first.time, updated: last.time, agent: last.agent, direct: last.direct,
      expeditions: turns.map((t) => t.expedition), status: last.status,
    });
  }
  conversations.sort((a, b) => b.updated.localeCompare(a.updated));
  return { projects: s.projects, conversations };
}

// ---------- Your changes ----------
function setMeta(thread: string, patch: Meta) {
  const s = load();
  s.meta[thread] = { ...(s.meta[thread] ?? {}), ...patch };
  save(s);
}

const cleanDescription = (d: unknown) => String(d ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_DESCRIPTION);
const knownLink = (link: unknown) => (typeof link === "string" && loadLinks().some((l) => l.name === link) ? link : undefined);

export function addProject(details: ProjectDetails | string): Project {
  const d = typeof details === "string" ? { name: details } : details;
  const s = load();
  const link = knownLink(d.link);
  const description = cleanDescription(d.description);
  const project: Project = { id: newId(), name: cleanName(d.name) || link || "New project", ...(link ? { link } : {}), ...(description ? { description } : {}) };
  s.projects.push(project);
  // Its folder now has a project: don't make a second one for it automatically.
  if (link && !s.seenLinks.includes(link)) s.seenLinks.push(link);
  save(s);
  return project;
}

// Change what's given: its name, its description, the folder it's about (link: "" for none).
export function updateProject(id: string, d: ProjectDetails): boolean {
  const s = load();
  const p = s.projects.find((x) => x.id === id);
  if (!p) return false;
  if (d.name !== undefined && cleanName(d.name)) p.name = cleanName(d.name);
  if (d.description !== undefined) { const text = cleanDescription(d.description); if (text) p.description = text; else delete p.description; }
  if (d.link !== undefined && p.id !== GENERAL) { const link = knownLink(d.link); if (link) p.link = link; else delete p.link; }
  if (p.link && !s.seenLinks.includes(p.link)) s.seenLinks.push(p.link);
  save(s);
  return true;
}

export const renameProject = (id: string, name: unknown) => !!cleanName(name) && updateProject(id, { name });

// Its conversations go back to General.
export function removeProject(id: string): boolean {
  const s = load();
  if (id === GENERAL || !s.projects.some((p) => p.id === id)) return false;
  s.projects = s.projects.filter((p) => p.id !== id);
  save(s);
  return true;
}

export const renameConversation = (thread: string, title: unknown) => setMeta(thread, { title: cleanName(title) || undefined });
export const removeConversation = (thread: string) => setMeta(thread, { removed: true });
export function moveConversation(thread: string, project: string): boolean {
  if (!load().projects.some((p) => p.id === project)) return false;
  setMeta(thread, { project });
  return true;
}

// A new conversation started inside a project is filed there.
export function fileConversation(thread: string, project: unknown) {
  const s = load();
  if (typeof project !== "string" || project === GENERAL || !s.projects.some((p) => p.id === project) || s.meta[thread]?.project) return;
  s.meta[thread] = { ...(s.meta[thread] ?? {}), project };
  save(s);
}

// For the prompt: the project this conversation is filed under: its name, what the user wrote
// about it, and its folder. So "the app" or "the repo" means the right one, and their standing
// notes about the project don't have to be repeated in every request.
export function projectNote(project: unknown, thread?: string): string {
  const s = load();
  const id = (thread && s.meta[thread]?.project) || (typeof project === "string" ? project : "");
  const p = s.projects.find((x) => x.id === id);
  if (!p || (p.id === GENERAL && !p.description)) return "";
  const link = p.link ? loadLinks().find((l) => l.name === p.link) : undefined;
  return `## Project: ${p.name}\n` +
    (p.id === GENERAL ? "This conversation isn't filed under a particular project." : `The user filed this conversation under their project "${p.name}".`) +
    (link ? ` It is about the linked folder links/${link.name}/ (${link.access === "write" ? "you may edit files there" : "read-only"}): unless they say otherwise, that's where the work is.` : "") +
    (p.description ? `\n\nWhat the user wrote about this project (their own words; keep it in mind for everything here, and pass on what matters when you brief the crew):\n${p.description}` : "");
}

// ---------- Reading a conversation back ----------
// Everything the feed recorded for a conversation's runs, oldest first. A run the feed no longer
// has (the feed file is trimmed when it grows large) is shown from its record instead: what was
// asked and the final answer.
export function conversationEvents(thread: string): CampEvent[] {
  const turns = allTurns().filter((t) => t.thread === thread);
  if (!turns.length) return [];
  const ids = new Set(turns.map((t) => t.expedition));
  const byRun = new Map<string, CampEvent[]>();
  if (existsSync(FEED_PATH)) {
    for (const line of readFileSync(FEED_PATH, "utf8").split("\n")) {
      if (!line || !line.includes('"expeditionId"')) continue;
      let e: CampEvent;
      try { e = JSON.parse(line) as CampEvent; } catch { continue; }
      if (e.expeditionId && ids.has(e.expeditionId)) byRun.set(e.expeditionId, [...(byRun.get(e.expeditionId) ?? []), e]);
    }
  }
  const out: CampEvent[] = [];
  for (const t of turns) {
    const recorded = byRun.get(t.expedition);
    if (recorded?.some((e) => e.type === "expedition_start")) { out.push(...recorded); continue; }
    const who = CREW[t.agent as CrewId] ?? CREW.quartermaster;
    const base = { time: t.time, seq: 0, expeditionId: t.expedition };
    out.push({ ...base, type: "expedition_start", id: t.expedition, task: t.direct ? `@${t.agent} ${t.task}` : t.task, source: t.direct ? "direct" : "user", thread });
    if (t.status === "running") continue;
    if (t.reply) out.push({ ...base, type: "text", who: who.name, emoji: who.emoji, depth: 0, text: t.reply });
    out.push({ ...base, type: "expedition_end", id: t.expedition, status: t.status, text: "" });
  }
  return out;
}
