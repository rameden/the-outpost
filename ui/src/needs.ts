// What needs you, across every conversation, in one list.
//
// Five kinds, in the order they're listed: a decision the crew is waiting on; a pull request
// with something new (failing checks, review comments, a conflict); a chained request that's
// held because the work before it didn't finish cleanly; a run that failed; and a run that
// finished since you last had its conversation open. The first three come from the camp. The
// last two are about what you've seen, which is kept in this browser: opening a conversation
// marks it seen, and the first time this runs everything already there counts as seen.

import { storeGet, storeSet } from "./api.ts";
import type { Activity } from "./feed/conversation.ts";
import { plural } from "./format.ts";
import type { CampState, Conversation } from "./types.ts";

export type NeedKind = "decision" | "pr" | "held" | "failed" | "finished";
export type Need = { key: string; kind: NeedKind; conversation: string; title: string; says: string };
const ORDER: Record<NeedKind, number> = { decision: 0, pr: 1, held: 2, failed: 3, finished: 4 };

// since: nothing that ended before this is new. at: when you last saw each conversation (its `updated` then).
export type Seen = { since: string; at: Record<string, string> };
export function loadSeen(now = new Date()): Seen {
  try {
    const s = JSON.parse(storeGet("camp-seen") ?? "") as Seen;
    if (typeof s?.since === "string" && s.at && typeof s.at === "object") return s;
  } catch { /* first time here */ }
  const fresh = { since: now.toISOString(), at: {} };
  storeSet("camp-seen", JSON.stringify(fresh));
  return fresh;
}
// You have this conversation open: what's in it now is seen. (The same object comes back if nothing changed.)
export function markSeen(seen: Seen, c: Pick<Conversation, "id" | "updated"> | undefined, known?: Set<string>): Seen {
  if (!c || seen.at[c.id] === c.updated) return seen;
  const at = { ...seen.at, [c.id]: c.updated };
  if (known) for (const id of Object.keys(at)) if (!known.has(id)) delete at[id]; // conversations that are gone
  const next = { since: seen.since, at };
  storeSet("camp-seen", JSON.stringify(next));
  return next;
}
export const unseen = (seen: Seen, c: Pick<Conversation, "id" | "updated" | "status">) =>
  c.status !== "running" && c.updated > (seen.at[c.id] ?? seen.since);

export function prNeed(p: CampState["prs"][number]): string {
  return [p.conflicts ? "conflicts with its base" : "", p.failing ? `${p.failing} failing ${plural(p.failing, "check")}` : "",
    p.review === "changes" ? "changes requested" : "", p.comments ? `${p.comments} ${plural(p.comments, "comment")}` : ""].filter(Boolean).join(" · ") || "something new";
}

// viewing: the conversation you have open (what ends there, you're watching end).
export function needsOf(o: { conversations: Conversation[]; prs?: CampState["prs"]; queued?: CampState["queued"]; activity: Activity; seen: Seen; viewing?: string | null }): Need[] {
  const title = new Map(o.conversations.map((c) => [c.id, c.title]));
  const out: Need[] = [];
  for (const [id, a] of Object.entries(o.activity)) {
    if (a.needs) out.push({ key: `decision:${id}`, kind: "decision", conversation: id, title: title.get(id) ?? "A conversation", says: a.needs === 1 ? "Waiting on your decision" : `${a.needs} decisions waiting on you` });
  }
  for (const p of o.prs ?? []) {
    if (p.attention && title.has(p.conversation)) out.push({ key: `pr:${p.path}`, kind: "pr", conversation: p.conversation, title: title.get(p.conversation)!, says: `Pull request #${p.number}: ${prNeed(p)}` });
  }
  for (const q of o.queued ?? []) {
    if (q.held) out.push({ key: `held:${q.id}`, kind: "held", conversation: q.id, title: q.task || "A chained request", says: `Held: the work it was waiting on ended as ${q.held}` });
  }
  for (const c of o.conversations) {
    if (c.id === o.viewing || !unseen(o.seen, c) || o.activity[c.id]?.running) continue;
    const ok = c.status === "done";
    out.push({ key: `${ok ? "finished" : "failed"}:${c.id}`, kind: ok ? "finished" : "failed", conversation: c.id, title: c.title,
      says: ok ? "Finished since you last looked" : `Ended as ${c.status.replace(/_/g, " ")}` });
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

// Everything that has finished is seen as of now (the "Mark them seen" row).
export function seenAll(now = new Date()): Seen {
  const next = { since: now.toISOString(), at: {} };
  storeSet("camp-seen", JSON.stringify(next));
  return next;
}

// A run that finished is news, not a job for you: the chip counts it apart from what needs doing.
export const needsDoing = (list: Need[]) => list.filter((n) => n.kind !== "finished");
// For the chip in the header: "2 decisions need you", "3 things need you · 2 finished", "2 finished".
export function needsLabel(list: Need[]): string {
  const doing = needsDoing(list), finished = list.length - doing.length;
  const all = (k: NeedKind) => doing.every((n) => n.kind === k);
  const noun = all("decision") ? "decision" : all("pr") ? "pull request" : "thing";
  const first = !doing.length ? "" : doing.length === 1 ? `1 ${noun} needs you` : `${doing.length} ${noun}s need you`;
  return [first, finished ? `${finished} finished` : ""].filter(Boolean).join(" · ");
}
