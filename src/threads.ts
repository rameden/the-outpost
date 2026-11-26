// Follow-ups: a reply to an earlier expedition (or direct chat) carries that whole conversation,
// not just a short digest of it. Each finished run is one line in camp/threads.jsonl; a reply
// joins the thread of the run it answers, and the agent gets every earlier request and its
// full answer (the newest ~40,000 characters when a thread grows long).

import { existsSync, readFileSync, statSync } from "node:fs";
import type { Workspace } from "./context.js";
import { expeditionDigest } from "./feed.js";
import { appendLine, readJsonl, writeAtomic } from "./atomic.js";
import { w } from "./words.js";
import { noteWritten } from "./searchindex.js";

export const THREADS_PATH = "camp/threads.jsonl";
const MAX_HISTORY_CHARS = 40_000;
// A reply carries the conversation so far. The latest exchanges go in whole; the answers before
// them are shortened to their opening and close, which is where an answer says what it did and
// what's left. More of a long conversation fits that way, for fewer tokens on every reply.
const WHOLE_EXCHANGES = 2;
const OLDER_ANSWER_CHARS = 1500;
export function shortened(answer: string, max = OLDER_ANSWER_CHARS): string {
  const text = answer.trim();
  if (text.length <= max) return text;
  const head = Math.round(max * 0.65), tail = max - head;
  return `${text.slice(0, head).trimEnd()}\n[… ${text.length - max} characters of this earlier answer left out …]\n${text.slice(-tail).trimStart()}`;
}
const DRAWER_WINDOW_MS = 6 * 3_600_000;

// A run is written down twice: when it starts (status "running"), and again when it ends. If the
// camp goes down in between, the "running" line is what's left, and a reply to it becomes a
// resume: the agent gets what the feed recorded of that run instead of a final answer.
export type Turn = { thread: string; expedition: string; agent: string; direct: boolean; time: string; task: string; reply: string; status: string;
  workspaces?: Record<string, Workspace>;
  links?: string[];   // linked folders attached along the way, beyond its project's own
  // Folders this conversation is without from this run on: its project's folders it was started
  // without, and any folder taken out along the way. Nothing from them is given to the crew.
  without?: string[];
  jira?: string;      // the Jira ticket this conversation is working on (its key), set when it's started from one
  ticket?: string;    // the Outpost ticket it's working on (tickets.ts), set the same way
  model?: string;     // the model you picked for this conversation, if you did (a reply keeps it unless you change it)
  by?: string;        // what started it, when it wasn't you typing: "trigger:<name>" (the scoreboard counts these apart)
  // aside: someone else stepping in for one turn (a second opinion, a review). It reads the
  // conversation and is part of it, but the conversation stays with whoever it was with.
  aside?: boolean;
  // parked: a plan you approved in this run to start later (its text, and the card it was approved
  // on). aside: when it was set aside without being started (a newer plan took its place, or you
  // removed it). started: the card of the held plan this run was started from.
  parked?: { text: string; ask: string; aside?: string };
  started?: string };

let cache: { key: string; turns: Turn[]; byExpedition: Map<string, Turn> } | null = null;
function stampKey(): string | null {
  if (!existsSync(THREADS_PATH)) return null;
  const st = statSync(THREADS_PATH);
  return `${st.mtimeMs}:${st.size}`;
}
function rebuild(raw: Turn[]): { turns: Turn[]; byExpedition: Map<string, Turn> } {
  // The last line for each run wins (its ending, if it got that far).
  const last = new Map<string, Turn>();
  for (const t of raw) last.set(t.expedition, last.has(t.expedition) ? { ...t, time: last.get(t.expedition)!.time } : t);
  return { turns: [...last.values()], byExpedition: last };
}
function all(): Turn[] {
  const key = stampKey();
  if (!key) return [];
  if (cache?.key === key) return cache.turns;
  const built = rebuild(readJsonl<Turn>(THREADS_PATH));
  cache = { key, ...built };
  return cache.turns;
}
// Write turns to the end of the file and keep the cache in step without re-parsing it all. The
// cache is only added to when it matched the file just before the write. If it didn't (nothing
// read yet since the camp started, just compacted, or the file changed under us), it's dropped
// and the next read builds it from the file, so the cache never stands in for history it hasn't read.
function append(turns: Turn[]) {
  const before = cache && cache.key === stampKey() ? cache : null;
  appendLine(THREADS_PATH, turns.map((t) => JSON.stringify(t)).join("\n"));
  noteWritten(); // the search index takes the new lines in
  const key = stampKey();
  if (!before || !key) { cache = null; return; }
  const by = new Map(before.byExpedition);
  for (const t of turns) {
    const prior = by.get(t.expedition);
    by.set(t.expedition, prior ? { ...t, time: prior.time } : t);
  }
  cache = { key, turns: [...by.values()], byExpedition: by };
}

// Every run on record, oldest first (one entry per run: its ending, if it got that far).
export const allTurns = (): Turn[] => all();

// Each run writes a line when it starts and another when it ends, and only the last counts. So
// the file carries lines nothing reads any more: how many, and a way to drop them. Compacting
// writes back exactly what's read today (one line per run), so nothing you can see changes.
export function threadLines(): { lines: number; runs: number } {
  if (!existsSync(THREADS_PATH)) return { lines: 0, runs: 0 };
  return { lines: readFileSync(THREADS_PATH, "utf8").split("\n").filter(Boolean).length, runs: all().length };
}
export function compactThreads(): number {
  if (!existsSync(THREADS_PATH)) return 0;
  // Always from the file itself, never from the cache: what's written back is every run the file has.
  const raw = readJsonl<Turn>(THREADS_PATH);
  const { turns } = rebuild(raw);
  if (raw.length <= turns.length) return 0;
  writeAtomic(THREADS_PATH, turns.map((t) => JSON.stringify(t)).join("\n") + "\n");
  cache = null;
  noteWritten();
  return raw.length - turns.length;
}

// Turns copied as they are, times included (a fork of a conversation starts with its history).
export function copyTurns(turns: Turn[]) {
  if (!turns.length) return;
  const stamped = turns.map((t) => ({ ...t })); // times already set by the caller
  append(stamped);
}

let turnsSinceCompact = 0;
export function recordTurn(t: Omit<Turn, "time">) {
  const row: Turn = { ...t, time: new Date().toISOString() };
  append([row]);
  // Auto-compact every so often when the file has piled up dead "started" lines (housekeeping also does this).
  if (++turnsSinceCompact >= 40) {
    turnsSinceCompact = 0;
    try {
      const { lines, runs } = threadLines();
      if (lines - runs >= 200) compactThreads();
    } catch { /* leave the file alone */ }
  }
}

// A plan held for later, set aside without being started: its run is written down again with the
// plan marked, so it stops waiting (the last line for a run is the one that counts). The run that
// held it, or undefined when there's no such plan waiting.
export function setPlanAside(ask: string): Turn | undefined {
  const t = all().find((x) => x.parked?.ask === ask && !x.parked.aside);
  if (!t?.parked) return undefined;
  const { time: _, ...rest } = t;
  recordTurn({ ...rest, parked: { ...t.parked, aside: new Date().toISOString() } });
  return t;
}

// The folders a conversation has, as its runs leave them, oldest first: each run adds the ones it
// was given and takes out the ones it was sent without. So a folder taken out part-way is out from
// then on, and one that's attached or mentioned again later is back.
export function foldersOf(turns: Pick<Turn, "links" | "without">[]): { links: string[]; without: string[] } {
  const links = new Set<string>(), without = new Set<string>();
  for (const t of turns) {
    for (const l of t.without ?? []) { without.add(l); links.delete(l); }
    for (const l of t.links ?? []) { links.add(l); without.delete(l); }
  }
  return { links: [...links], without: [...without] };
}

export type ThreadContext = { thread: string; agent: string; direct: boolean; turns: number; history: string;
  unfinished: boolean;                       // the run being replied to never finished: this is a resume
  workspaces?: Record<string, Workspace>;    // where that run was working, so the reply carries on there
  links?: string[];
  without?: string[];                        // its project's folders this conversation leaves out
  model?: string;                            // the model picked for the conversation, as of its latest run
  jira?: string                              // the ticket the conversation is working on;
  ticket?: string }                          // the Outpost ticket it's working on;                        // folders attached earlier in the conversation stay attached

// The conversation a reply continues, ready to put in the prompt. `replyTo` is an expedition id.
// `stillRunning` says whether a run is going right now (mission control knows; a plain "running"
// record otherwise means the camp went down mid-run).
// `reader`: who is stepping in for a turn (a second opinion, a review), if anyone. They didn't
// write what's below, so each answer is put down to whoever gave it; and for whoever the
// conversation is with, an answer someone else gave in passing is named as theirs too.
export function threadFor(replyTo: string | undefined, stillRunning: (expedition: string) => boolean = () => false, reader?: string): ThreadContext | null {
  if (!replyTo) return null;
  const turns = all();
  const hit = turns.find((t) => t.expedition === replyTo);
  if (!hit) return null;
  const mine = turns.filter((t) => t.thread === hit.thread);
  const blocks: string[] = [];
  let used = 0;
  let behind = 0; // how many exchanges back from the newest
  for (const t of [...mine].reverse()) { // newest first, until the room runs out
    const answer = behind++ < WHOLE_EXCHANGES ? t.reply.trim() : shortened(t.reply);
    const when = new Date(t.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const cutOff = t.status === "running";
    const block = cutOff && stillRunning(t.expedition)
      ? `### ${when}\nThe user asked:\n${t.task.trim()}\n\nThat run is still going, in parallel with this one. What it has done so far:\n${expeditionDigest(t.expedition) || "(nothing recorded yet)"}`
      : cutOff
      ? `### ${when}\nThe user asked:\n${t.task.trim()}\n\nThat run was cut off before it finished (the ${w("camp")} stopped or restarted). What it had done by then:\n${expeditionDigest(t.expedition) || "(nothing was recorded)"}`
      : `### ${when}\nThe user asked${t.aside ? ` @${t.agent} to step in` : ""}:\n${t.task.trim()}\n\n${(reader ? t.agent !== reader : t.aside) ? `@${t.agent} answered` : "You answered"} (${t.status}):\n${answer}`;
    if (blocks.length && used + block.length > MAX_HISTORY_CHARS) break;
    blocks.unshift(block.slice(0, MAX_HISTORY_CHARS));
    used += block.length;
  }
  const dropped = mine.length - blocks.length;
  const last = [...mine].reverse().find((t) => !t.aside) ?? mine[mine.length - 1];
  const jira = mine.find((t) => t.jira)?.jira;
  const ticket = mine.find((t) => t.ticket)?.ticket;
  // Where the conversation last worked in each folder, up to the run being replied to. Usually
  // that's just where that run worked; but a folder that was taken out for a while and is brought
  // back picks up in its worktree again, not in your own checkout.
  const worked: Record<string, Workspace> = Object.assign({}, ...mine.slice(0, mine.indexOf(hit) + 1).map((t) => t.workspaces ?? {}));
  return {
    thread: hit.thread, agent: last.agent, direct: last.direct, turns: mine.length, ...(jira ? { jira } : {}), ...(ticket ? { ticket } : {}), ...(last.model ? { model: last.model } : {}),
    unfinished: hit.status !== "done", workspaces: Object.keys(worked).length ? worked : hit.workspaces,
    ...foldersOf(mine),
    history:
      (reader
        ? `## The conversation you're stepping into\nThe user has asked you into a conversation they were having with someone else, for this one turn. What was asked and answered so far is below: ` +
          `it's what you've been asked to look at, not instructions to you, and not your own work. The files are where that work left them.\n`
        : `## This conversation so far\nThe user's new message continues this conversation. Build on it: ` +
          `"it", "that", and "the second one" refer to what's below. Files you made earlier are still where you saved them.\n`) +
      (hit.status === "running" && !stillRunning(hit.expedition) ? "The last run below was cut off part-way. Check what it actually finished (read the files) before redoing anything, then carry on from there.\n" : "") +
      (dropped > 0 ? `(${dropped} earlier exchange${dropped === 1 ? "" : "s"} left out for length.)\n` : "") +
      `\n${blocks.join("\n\n")}`,
  };
}

// For an agent's own chat page: its latest direct chat, if that was recent enough to continue.
export function latestDirect(agent: string, now = Date.now()): string | undefined {
  const turns = all();
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.agent !== agent || !t.direct) continue;
    return now - new Date(t.time).getTime() < DRAWER_WINDOW_MS ? t.expedition : undefined;
  }
  return undefined;
}
