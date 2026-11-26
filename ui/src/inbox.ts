// The inbox's count: one number for everything waiting on you, worked out in one place so the
// header, the sidebar, Today, Memory, the dock and the Inbox itself always say the same.
//
// waiting: what needs you to do something. Decisions the crew is waiting on, pull requests with
// something new, chained requests that are held, runs that failed, and what the crew proposed to
// remember or to add as a skill.
// fresh: what is only news. Runs that finished since you looked, and unread reports.
// The Inbox (components/Inbox.tsx) lists every one of them and is where each is handled.

import { api } from "./api.ts";
import { plural } from "./format.ts";
import type { Need } from "./needs.ts";
import type { BriefLine, CampState } from "./types.ts";
import { unreadCount } from "./unread.ts";

export type InboxCount = { waiting: number; fresh: number; total: number };
export const NO_INBOX: InboxCount = { waiting: 0, fresh: 0, total: 0 };

// asks: how many decisions are open in the feed (every one, whichever conversation it belongs to).
export function inboxCount(S: CampState | null | undefined, needs: Need[], asks: number): InboxCount {
  const doing = needs.filter((n) => n.kind === "pr" || n.kind === "held" || n.kind === "failed").length;
  const waiting = asks + doing + (S?.memoryProposals?.length ?? 0) + (S?.skills?.length ?? 0);
  const fresh = needs.filter((n) => n.kind === "finished").length + unreadCount(S);
  return { waiting, fresh, total: waiting + fresh };
}

// "3 waiting on you · 2 new", "1 waiting on you", "2 new", or nothing at all.
export function inboxLabel(c: InboxCount): string {
  return [c.waiting ? `${c.waiting} waiting on you` : "", c.fresh ? `${c.fresh} new` : ""].filter(Boolean).join(" · ");
}

// The first few things in the inbox, one line each, for a short preview that opens it.
export type InboxLine = { key: string; title: string; says: string };
export function inboxPreview(S: CampState | null | undefined, needs: Need[], asks: number, max = 3): InboxLine[] {
  const out: InboxLine[] = [];
  const decisions = needs.filter((n) => n.kind === "decision");
  for (const n of decisions) out.push({ key: n.key, title: n.title, says: n.says });
  const elsewhere = asks - decisions.reduce((sum, n) => sum + (Number.parseInt(n.says, 10) || 1), 0);
  if (elsewhere > 0) out.push({ key: "decisions", title: `${elsewhere}${decisions.length ? " more" : ""} ${plural(elsewhere, "decision")}`, says: "Waiting on you" });
  for (const n of needs) if (n.kind === "pr" || n.kind === "held" || n.kind === "failed") out.push({ key: n.key, title: n.title, says: n.says });
  const memory = S?.memoryProposals?.length ?? 0, skills = S?.skills?.length ?? 0;
  if (memory) out.push({ key: "memory", title: `${memory} ${plural(memory, "suggestion")} about memory`, says: "Nothing is kept until you approve it" });
  if (skills) out.push({ key: "skills", title: `${skills} skill ${plural(skills, "proposal")}`, says: "Nothing goes live until you approve it" });
  return out.slice(0, max);
}

// ---------- The brief's "waiting on you" ----------
// The brief (written once, in the morning) names pull requests and unfinished runs waiting on you,
// each with its one next step. The live list above already has the ones that belong to a
// conversation here; the rest are shown under it in the Inbox as the brief wrote them. They are a
// snapshot, so they aren't counted: writing the brief again clears the ones that are done.

const sameThing = (l: BriefLine, n: Need) => !!l.conversation && l.conversation === n.conversation
  && ((l.kind === "pull" && n.kind === "pr") || (l.kind === "run" && n.kind === "failed"));
// The brief's line for something on the live list: it carries that thing's next step (Address it, Resume).
export const briefLineFor = (n: Need, lines: BriefLine[]) => lines.find((l) => sameThing(l, n));
// The brief's lines that the live list doesn't already have.
export const briefOnly = (lines: BriefLine[], needs: Need[]) => lines.filter((l) => !needs.some((n) => sameThing(l, n)));

export const ACT: Record<NonNullable<BriefLine["act"]>["do"], string> = { address: "Address it", resume: "Resume", start: "Start…" };
// A line's one next step: bring a pull request's feedback to the crew, resume a run, or open the ticket kickoff.
export async function briefAct(l: BriefLine, go: { open: (conversation: string) => void; startTicket: (t: { key: string; summary: string }) => void }) {
  const a = l.act;
  if (!a) return;
  if (a.do === "start") return go.startTicket({ key: a.jira, summary: l.title.replace(`${a.jira} `, "") });
  const r = a.do === "address" ? await api<{ thread: string }>("/api/pulls/address", { url: a.url }) : await api<{ thread: string }>("/api/send", { resume: a.run });
  go.open(r.thread);
}
