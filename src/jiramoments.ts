// The two moments of Jira write-back that nobody clicks for (jira.ts has the other two, and the
// writing itself):
//
//   - ready to look over: a run in a conversation that was started from a ticket has finished
//     cleanly and changed files. Said once per conversation: the fixes that follow don't each
//     leave a comment.
//   - merged: the pull request of a worktree that conversation worked in has been merged (the
//     pull-request watch in pulls.ts sees it happen).
//
// Both write only when write-back and that moment of it are on, in the camp's own fixed words. What has been said is
// kept in camp/jira-moments.json, so a restart (or the same merge seen twice) doesn't say it again.

import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { changedFiles } from "./checkpoints.js";
import { emit } from "./events.js";
import { writeBack, writesAt, type WriteEvent } from "./jira.js";
import { allTurns } from "./threads.js";

export const MOMENTS_PATH = "camp/jira-moments.json";
const KEEP = 400;
type Said = Record<string, string>; // "<conversation>|<moment>" → when it was said

const said = (): Said => { const kept = readJsonFile(MOMENTS_PATH, {}); return kept && typeof kept === "object" && !Array.isArray(kept) ? kept as Said : {}; };
function note(conversation: string, event: WriteEvent) {
  const all = Object.entries({ ...said(), [`${conversation}|${event}`]: new Date().toISOString() });
  writeJsonAtomic(MOMENTS_PATH, Object.fromEntries(all.slice(-KEEP)));
}
type Write = typeof writeBack;
async function say(conversation: string, event: WriteEvent, key: string, detail: { branch?: string; url?: string }, run: string | undefined, write: Write): Promise<string | null> {
  if (said()[`${conversation}|${event}`]) return null;
  const line = await write(event, key, detail);
  if (!line) return null;
  // Said, or tried and refused: either way it isn't tried again on every run that follows.
  note(conversation, event);
  emit({ type: "notice", who: "Jira", emoji: "🔖", depth: 0, text: line, ...(run ? { expeditionId: run } : {}) });
  return line;
}

// A run has ended (status: how). changed: whether it changed files (worked out from its
// checkpoint unless a test says).
export async function runFinished(run: string, status: string, o: { changed?: boolean; write?: Write } = {}): Promise<string | null> {
  if (status !== "done" || !writesAt("review")) return null;
  const turns = allTurns();
  const turn = turns.find((t) => t.expedition === run);
  if (!turn || turn.aside) return null;
  const key = turns.find((t) => t.thread === turn.thread && t.jira)?.jira;
  if (!key) return null;
  if (!(o.changed ?? changedFiles(run, { sealedOnly: true }).length > 0)) return null;
  return say(turn.thread, "review", key, { branch: Object.values(turn.workspaces ?? {})[0]?.branch }, run, o.write ?? writeBack);
}

// A conversation's pull request has been merged. key: the ticket that conversation works on.
export async function pullMerged(conversation: string, key: string | undefined, url: string, write: Write = writeBack): Promise<string | null> {
  if (!key || !writesAt("merged")) return null;
  return say(conversation, "merged", key, { url }, undefined, write);
}
