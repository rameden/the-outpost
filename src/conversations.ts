// History: every conversation you've had with the camp, filed under projects.
//
// A conversation is a thread (threads.ts): a first request and every follow-up to it. Starting a
// new conversation keeps unrelated work out of each other's context; replying in one carries the
// whole of it. The list is read from camp/threads.jsonl, so it needs no upkeep of its own.
//
// Projects are your own grouping: "General" for anything unfiled, one made for each linked
// folder the first time it's seen, and any you add. A project decides what the crew sees:
//   - its description, in your own words (what it is, what matters, how you like it done)
//   - its folders: the linked folders it is about. A conversation in the project can use those
//     folders and no others (unless you attach one), so projects stay apart from each other
//   - its pinned references: files or links always put in front of the crew
//   - its defaults: where to work, web access, budget, approvals, and models (see ProjectSettings)
// The crew's own notes about a project, and its survey brief, live in camp/projects/<id>/ (projects.ts). What you change by hand (a conversation's
// title, its project, whether it's been removed from the list) is in camp/conversations.json.
// Removing a conversation only hides it: its record stays in the camp's files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { CREW, type CrewId } from "./crew.js";
import type { CampEvent } from "./events.js";
import { emit } from "./events.js";
import { FEED_PATH } from "./feed.js";
import { loadLinks } from "./links.js";
import { allTurns, copyTurns, foldersOf, type Turn } from "./threads.js";
import { undoCheckpoint } from "./checkpoints.js";

export const CONVERSATIONS_PATH = "camp/conversations.json";
export const GENERAL = "general";

// Defaults that apply to every conversation in the project. Anything not set follows the camp's own settings.
export type ProjectSettings = {
  workIn?: "worktree";                 // start each new conversation in its own worktree and branch of the project's repos
  web?: "careful" | "off";             // careful: keep the project's names and code out of searches. off: no web tools at all
  budgetUsd?: number;                  // per-expedition budget, instead of the camp's
  approval?: "ask" | "safe" | "sandbox"; // how shell commands are approved here (see settings.ts)
  review?: "on" | "off";               // have changes reviewed before the Quartermaster reports, here, whatever the camp's setting
  agents?: Record<string, { model?: string; effort?: string }>; // per crew member
};
export type Project = {
  id: string; name: string;
  links?: string[];        // the linked folders this project is about (by name)
  description?: string;    // your own words about it, for the crew
  pins?: string[];         // files (camp paths) or web addresses always given to the crew
  pinned?: boolean;        // kept at the top of the list
  settings?: ProjectSettings;
};
export type ProjectDetails = { name?: unknown; description?: unknown; links?: unknown; link?: unknown; pins?: unknown; pinned?: unknown; settings?: unknown };
const MAX_DESCRIPTION = 4000;
const MAX_PINS = 12;
type Meta = { title?: string; project?: string; removed?: boolean; titled?: boolean }; // titled: you (or the camp) named it
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
  suggest?: string;      // filed under General, but it used a folder that belongs to this project
  jira?: string;         // the Jira ticket it's working on (its key), if it was started from one
  links?: string[];      // linked folders attached to it along the way, beyond its project's own
  without?: string[];    // folders it's without: left out when it started, or taken out since (the crew sees nothing of them here)
  // The worktrees its latest run worked in, by linked folder. base: the commit the work started from. created: the camp made it.
  workspaces?: Record<string, { path: string; branch: string; base?: string; created?: boolean }>;
};
export type History = { projects: Project[]; conversations: Conversation[] };

function load(): Saved {
  let s: Partial<Saved> = {};
  try { if (existsSync(CONVERSATIONS_PATH)) s = JSON.parse(readFileSync(CONVERSATIONS_PATH, "utf8")); } catch { /* start over */ }
  const projects = (Array.isArray(s.projects) ? s.projects.filter((p) => p && typeof p.id === "string" && typeof p.name === "string") : []).map((p) => {
    // Older files had one folder per project, as "link".
    const { link, ...rest } = p as Project & { link?: string };
    return link && !rest.links?.length ? { ...rest, links: [link] } : rest;
  });
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
    if (!s.projects.some((p) => p.links?.includes(l.name))) s.projects.push({ id: newId(), name: l.name, links: [l.name] });
    s.seenLinks.push(l.name);
  }
  save(s);
  return s;
}

export function titleOf(task: string): string {
  // Its first line: a long request (a brief with a checklist, say) is named by how it opens.
  const flat = (task.replace(/^@\w+\s+/, "").split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 64 ? flat.slice(0, 63).trimEnd() + "…" : flat || "Untitled";
}

// The folders a conversation has in play beyond its project's: what was attached, and where its
// latest run that used a worktree worked (for the Files flyout).
function folders(turns: Turn[]): Pick<Conversation, "links" | "workspaces" | "without"> {
  // Left out (when it started, or part-way), and not brought back since by attaching or mentioning it.
  const { links, without } = foldersOf(turns);
  const ws = [...turns].reverse().find((t) => t.workspaces && Object.keys(t.workspaces).length)?.workspaces;
  return {
    ...(links.length ? { links } : {}),
    ...(without.length ? { without } : {}),
    ...(ws ? { workspaces: Object.fromEntries(Object.entries(ws).map(([l, w]) => [l, { path: w.path, branch: w.branch, ...(w.base ? { base: w.base } : {}), ...(w.created ? { created: true } : {}) }])) } : {}),
  };
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
    // Who it's with: an aside (a second opinion, a review) doesn't take the conversation over.
    const own = [...turns].reverse().find((t) => !t.aside) ?? last;
    const jira = turns.find((t) => t.jira)?.jira;
    const project = meta.project && known.has(meta.project) ? meta.project : GENERAL;
    // Unfiled, but it used exactly one project's folder: offer to move it there.
    const used = new Set(turns.flatMap((t) => [...(t.links ?? []), ...Object.keys(t.workspaces ?? {})]));
    const owners = project === GENERAL ? s.projects.filter((p) => p.links?.some((l) => used.has(l))) : [];
    conversations.push({
      id, title: meta.title || titleOf(first.task), project, ...(owners.length === 1 ? { suggest: owners[0].id } : {}),
      created: first.time, updated: last.time, agent: own.agent, direct: own.direct, ...(jira ? { jira } : {}),
      expeditions: turns.map((t) => t.expedition), status: last.status,
      ...folders(turns),
    });
  }
  conversations.sort((a, b) => b.updated.localeCompare(a.updated));
  // General first, then the ones you pinned, then the rest in the order you made them.
  const order = (p: Project) => (p.id === GENERAL ? 0 : p.pinned ? 1 : 2);
  return { projects: [...s.projects].sort((a, b) => order(a) - order(b)), conversations };
}

// ---------- Your changes ----------
function setMeta(thread: string, patch: Meta) {
  const s = load();
  s.meta[thread] = { ...(s.meta[thread] ?? {}), ...patch };
  save(s);
}

const cleanDescription = (d: unknown) => String(d ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_DESCRIPTION);
// Only folders that are really linked, each once. Accepts a list, or one name (the older form).
function cleanLinks(links: unknown, link?: unknown): string[] {
  const names = new Set(loadLinks().map((l) => l.name));
  const asked = Array.isArray(links) ? links : typeof link === "string" && link ? [link] : [];
  return [...new Set(asked.filter((l): l is string => typeof l === "string" && names.has(l)))];
}
const cleanPins = (pins: unknown) =>
  [...new Set((Array.isArray(pins) ? pins : String(pins ?? "").split("\n")).map((p) => String(p).trim()).filter(Boolean))].slice(0, MAX_PINS);

export function cleanSettings(raw: unknown): ProjectSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;
  const out: ProjectSettings = {};
  if (r.workIn === "worktree") out.workIn = "worktree";
  if (r.web === "careful" || r.web === "off") out.web = r.web;
  const budget = Number(r.budgetUsd);
  if (r.budgetUsd !== "" && r.budgetUsd != null && Number.isFinite(budget) && budget > 0) out.budgetUsd = Math.round(budget * 100) / 100;
  if (r.approval === "ask" || r.approval === "safe" || r.approval === "sandbox") out.approval = r.approval;
  if (r.review === "on" || r.review === "off") out.review = r.review;
  if (r.agents && typeof r.agents === "object") {
    const agents: NonNullable<ProjectSettings["agents"]> = {};
    for (const [id, a] of Object.entries(r.agents as Record<string, any>)) {
      if (!(id in CREW) || !a || typeof a.model !== "string" || !a.model) continue;
      agents[id] = { model: a.model, ...(typeof a.effort === "string" && a.effort ? { effort: a.effort } : {}) };
    }
    if (Object.keys(agents).length) out.agents = agents;
  }
  return Object.keys(out).length ? out : undefined;
}

export function addProject(details: ProjectDetails | string): Project {
  const d = typeof details === "string" ? { name: details } : details;
  const s = load();
  const links = cleanLinks(d.links, d.link);
  const description = cleanDescription(d.description);
  const pins = cleanPins(d.pins);
  const settings = cleanSettings(d.settings);
  const project: Project = {
    id: newId(), name: cleanName(d.name) || links[0] || "New project",
    ...(links.length ? { links } : {}), ...(description ? { description } : {}), ...(pins.length ? { pins } : {}),
    ...(d.pinned ? { pinned: true } : {}), ...(settings ? { settings } : {}),
  };
  s.projects.push(project);
  // Its folders now have a project: don't make a second one for them automatically.
  for (const l of links) if (!s.seenLinks.includes(l)) s.seenLinks.push(l);
  save(s);
  return project;
}

// Change what's given: its name, description, folders, pinned references, pin, and defaults.
export function updateProject(id: string, d: ProjectDetails): boolean {
  const s = load();
  const p = s.projects.find((x) => x.id === id);
  if (!p) return false;
  if (d.name !== undefined && cleanName(d.name)) p.name = cleanName(d.name);
  if (d.description !== undefined) { const text = cleanDescription(d.description); if (text) p.description = text; else delete p.description; }
  if ((d.links !== undefined || d.link !== undefined) && p.id !== GENERAL) { const links = cleanLinks(d.links, d.link); if (links.length) p.links = links; else delete p.links; }
  if (d.pins !== undefined) { const pins = cleanPins(d.pins); if (pins.length) p.pins = pins; else delete p.pins; }
  if (d.pinned !== undefined) { if (d.pinned) p.pinned = true; else delete p.pinned; }
  if (d.settings !== undefined) { const st = cleanSettings(d.settings); if (st) p.settings = st; else delete p.settings; }
  for (const l of p.links ?? []) if (!s.seenLinks.includes(l)) s.seenLinks.push(l);
  save(s);
  return true;
}

export const renameProject = (id: string, name: unknown) => !!cleanName(name) && updateProject(id, { name });
export const getProject = (id: string | undefined): Project | undefined => (id ? load().projects.find((p) => p.id === id) : undefined);
// The project a conversation is filed under (General if none), or the one a new conversation asks for.
export function projectOf(thread: string | undefined, asked?: unknown): Project {
  const s = load();
  const id = (thread && s.meta[thread]?.project) || (typeof asked === "string" ? asked : "");
  return s.projects.find((p) => p.id === id) ?? s.projects.find((p) => p.id === GENERAL)!;
}

// Its conversations go back to General.
export function removeProject(id: string): boolean {
  const s = load();
  if (id === GENERAL || !s.projects.some((p) => p.id === id)) return false;
  s.projects = s.projects.filter((p) => p.id !== id);
  save(s);
  return true;
}

export const renameConversation = (thread: string, title: unknown) => setMeta(thread, { title: cleanName(title) || undefined, titled: !!cleanName(title) });
// A title the camp wrote for it (never over one you gave it yourself).
export function autoTitle(thread: string, title: string): boolean {
  const s = load();
  if (s.meta[thread]?.titled || !cleanName(title)) return false;
  s.meta[thread] = { ...(s.meta[thread] ?? {}), title: cleanName(title), titled: true };
  save(s);
  return true;
}
export const hasTitle = (thread: string) => !!load().meta[thread]?.titled;
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

// ---------- Searching ----------
// Conversations whose title, requests, or answers mention the words, newest first, each with
// the line that matched.
export function searchConversations(query: string, limit = 30): { id: string; snippet: string }[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const listed = new Map(history().conversations.map((c) => [c.id, c]));
  const hits = new Map<string, string>();
  const turns = allTurns();
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const c = listed.get(t.thread);
    if (!c || hits.has(t.thread)) continue;
    const found = [c.title, t.task, t.reply].find((text) => text.toLowerCase().includes(q));
    if (!found) continue;
    const at = found.toLowerCase().indexOf(q);
    const from = Math.max(0, at - 40);
    hits.set(t.thread, (from > 0 ? "…" : "") + found.slice(from, at + q.length + 80).replace(/\s+/g, " ").trim() + (found.length > at + q.length + 80 ? "…" : ""));
  }
  return [...listed.values()].filter((c) => hits.has(c.id)).slice(0, limit).map((c) => ({ id: c.id, snippet: hits.get(c.id)! }));
}

// ---------- Reading a conversation back ----------
// Everything the feed recorded for a conversation's runs, oldest first. A run the feed no longer
// has (the feed file is trimmed when it grows large) is shown from its record instead: what was
// asked and the final answer.
// feedbackOf: looks up a run's rating (passed in by the server: feedback.ts builds on this file).
export function conversationEvents(thread: string, feedbackOf?: (expedition: string) => { rating: "up" | "down"; note?: string; kept?: string } | undefined): CampEvent[] {
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
    const rated = feedbackOf?.(t.expedition); // the rating you gave it, which the feed would otherwise have carried
    if (rated) out.push({ ...base, type: "feedback", id: t.expedition, rating: rated.rating, note: rated.note, kept: rated.kept });
  }
  return out;
}

// ---------- Forking and going back ----------
// Fork: a new conversation that starts as a copy of this one up to and including the run you
// picked, so you can try something else from there and keep the original as it was. It keeps the
// same project, folders and worktree (so the two share files until one of them moves on).
// Going back is a fork that first puts back what every later run in the conversation changed,
// newest first, so the files are as they were right after the run you picked.
export type Fork = { thread: string; expedition: string; restored: string[]; skipped: string[] };
export function forkConversation(expedition: string, opts: { rewind?: boolean; running?: (expedition: string) => boolean } = {}): Fork | { error: string } {
  const turns = allTurns();
  const hit = turns.find((t) => t.expedition === expedition);
  if (!hit) return { error: "There's no record of that run." };
  if (hit.status === "running") return { error: "That run hasn't finished yet." };
  const mine = turns.filter((t) => t.thread === hit.thread);
  const upTo = mine.slice(0, mine.indexOf(hit) + 1);
  const later = mine.slice(mine.indexOf(hit) + 1);
  if (opts.rewind && later.some((t) => t.status === "running" || opts.running?.(t.expedition))) return { error: "A later run in this conversation is still going. Stop it first." };
  const restored: string[] = [], skipped: string[] = [];
  if (opts.rewind) for (const t of [...later].reverse()) {
    const r = undoCheckpoint(t.expedition);
    restored.push(...r.restored.filter((p) => !restored.includes(p)));
    skipped.push(...r.skipped.filter((p) => !skipped.includes(p)));
  }
  const thread = randomBytes(8).toString("hex");
  const tag = randomBytes(4).toString("hex");
  const copies = upTo.map((t) => ({ ...t, thread, expedition: `${t.expedition.slice(0, 60)}-f${tag}` }));
  copyTurns(copies);
  const s = load();
  const meta = s.meta[hit.thread] ?? {};
  const title = `${meta.title || titleOf(mine[0].task)}`.replace(/ \(fork\)$/, "") + " (fork)";
  s.meta[thread] = { ...(meta.project ? { project: meta.project } : {}), title, titled: true };
  save(s);
  return { thread, expedition: copies[copies.length - 1].expedition, restored, skipped };
}
