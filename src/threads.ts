// Follow-ups: a reply to an earlier expedition (or direct chat) carries that whole conversation,
// not just a short digest of it. Each finished run is one line in camp/threads.jsonl; a reply
// joins the thread of the run it answers, and the agent gets every earlier request and its
// full answer (the newest ~40,000 characters when a thread grows long).

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";

export const THREADS_PATH = "camp/threads.jsonl";
const MAX_HISTORY_CHARS = 40_000;
const DRAWER_WINDOW_MS = 6 * 3_600_000;

export type Turn = { thread: string; expedition: string; agent: string; direct: boolean; time: string; task: string; reply: string; status: string };

let cache: { key: string; turns: Turn[] } | null = null;
function all(): Turn[] {
  if (!existsSync(THREADS_PATH)) return [];
  const st = statSync(THREADS_PATH);
  const key = `${st.mtimeMs}:${st.size}`;
  if (cache?.key === key) return cache.turns;
  const turns = readFileSync(THREADS_PATH, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as Turn]; } catch { return []; }
  });
  cache = { key, turns };
  return turns;
}

export function recordTurn(t: Omit<Turn, "time">) {
  mkdirSync("camp", { recursive: true });
  appendFileSync(THREADS_PATH, JSON.stringify({ ...t, time: new Date().toISOString() }) + "\n");
}

export type ThreadContext = { thread: string; agent: string; direct: boolean; turns: number; history: string };

// The conversation a reply continues, ready to put in the prompt. `replyTo` is an expedition id.
export function threadFor(replyTo: string | undefined): ThreadContext | null {
  if (!replyTo) return null;
  const turns = all();
  const hit = turns.find((t) => t.expedition === replyTo);
  if (!hit) return null;
  const mine = turns.filter((t) => t.thread === hit.thread);
  const blocks: string[] = [];
  let used = 0;
  for (const t of [...mine].reverse()) { // newest first, until the room runs out
    const when = new Date(t.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const block = `### ${when}\nThe user asked:\n${t.task.trim()}\n\nYou answered (${t.status}):\n${t.reply.trim()}`;
    if (blocks.length && used + block.length > MAX_HISTORY_CHARS) break;
    blocks.unshift(block.slice(0, MAX_HISTORY_CHARS));
    used += block.length;
  }
  const dropped = mine.length - blocks.length;
  const last = mine[mine.length - 1];
  return {
    thread: hit.thread, agent: last.agent, direct: last.direct, turns: mine.length,
    history:
      `## This conversation so far\nThe user's new message continues this conversation. Build on it: ` +
      `"it", "that", and "the second one" refer to what's below. Files you made earlier are still where you saved them.\n` +
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
