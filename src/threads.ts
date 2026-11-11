// Follow-ups: a reply to an earlier expedition (or direct chat) carries that whole conversation,
// not just a short digest of it. Each finished run is one line in camp/threads.jsonl; a reply
// joins the thread of the run it answers, and the agent gets every earlier request and its
// full answer (the newest ~40,000 characters when a thread grows long).

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import type { Workspace } from "./context.js";
import { expeditionDigest } from "./feed.js";

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
  // aside: someone else stepping in for one turn (a second opinion, a review). It reads the
  // conversation and is part of it, but the conversation stays with whoever it was with.
  aside?: boolean };

let cache: { key: string; turns: Turn[] } | null = null;
function all(): Turn[] {
  if (!existsSync(THREADS_PATH)) return [];
  const st = statSync(THREADS_PATH);
  const key = `${st.mtimeMs}:${st.size}`;
  if (cache?.key === key) return cache.turns;
  const turns = readFileSync(THREADS_PATH, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as Turn]; } catch { return []; }
  });
  // The last line for each run wins (its ending, if it got that far).
  const last = new Map<string, Turn>();
  for (const t of turns) last.set(t.expedition, last.has(t.expedition) ? { ...t, time: last.get(t.expedition)!.time } : t);
  cache = { key, turns: [...last.values()] };
  return cache.turns;
}

// Every run on record, oldest first (one entry per run: its ending, if it got that far).
export const allTurns = (): Turn[] => all();

export function recordTurn(t: Omit<Turn, "time">) {
  mkdirSync("camp", { recursive: true });
  appendFileSync(THREADS_PATH, JSON.stringify({ ...t, time: new Date().toISOString() }) + "\n");
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
  jira?: string }                            // the ticket the conversation is working on;                        // folders attached earlier in the conversation stay attached

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
      ? `### ${when}\nThe user asked:\n${t.task.trim()}\n\nThat run was cut off before it finished (the camp stopped or restarted). What it had done by then:\n${expeditionDigest(t.expedition) || "(nothing was recorded)"}`
      : `### ${when}\nThe user asked${t.aside ? ` @${t.agent} to step in` : ""}:\n${t.task.trim()}\n\n${(reader ? t.agent !== reader : t.aside) ? `@${t.agent} answered` : "You answered"} (${t.status}):\n${answer}`;
    if (blocks.length && used + block.length > MAX_HISTORY_CHARS) break;
    blocks.unshift(block.slice(0, MAX_HISTORY_CHARS));
    used += block.length;
  }
  const dropped = mine.length - blocks.length;
  const last = [...mine].reverse().find((t) => !t.aside) ?? mine[mine.length - 1];
  const jira = mine.find((t) => t.jira)?.jira;
  // Where the conversation last worked in each folder, up to the run being replied to. Usually
  // that's just where that run worked; but a folder that was taken out for a while and is brought
  // back picks up in its worktree again, not in your own checkout.
  const worked: Record<string, Workspace> = Object.assign({}, ...mine.slice(0, mine.indexOf(hit) + 1).map((t) => t.workspaces ?? {}));
  return {
    thread: hit.thread, agent: last.agent, direct: last.direct, turns: mine.length, ...(jira ? { jira } : {}),
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
