// Is it paying off? For one project, over the last month: what the checking around the work
// (reviews, second opinions, sending a failed check back) was used for and what came of it,
// beside what it used; and how its pull requests went. Every number is counted from the camp's
// own record: the conversations, the quest log, the pull requests as last seen, your ratings.
// It's here so you can turn off what isn't earning its keep, rather than guess.

import { OPENING as CHRONICLE } from "./chronicle.js";
import { getProject, history } from "./conversations.js";
import { allFeedback } from "./feedback.js";
import { prStates } from "./prs.js";
import { questCost, recentQuests } from "./questlog.js";
import { allTurns } from "./threads.js";
import { median } from "./helpers.js";

export type Spent = "work" | "review" | "opinion" | "fixup" | "feedback" | "chronicle";
// What a request was for, from how it starts (the page's and the camp's own standing briefs).
// The fix brief (quartermaster.ts, fixBrief) names the place as the theme pack of the day did: "The camp ran…", "The ship ran…".
const FIX_BRIEF = /^The [^\n]{1,40}? ran the project's own checks/;
export function spentOn(task: string): Spent {
  const t = task.replace(/^@\w+\s+/, "").trimStart();
  if (t.startsWith("Review the changes made above")) return "review";
  if (t.startsWith("Give me a second opinion")) return "opinion";
  if (FIX_BRIEF.test(t)) return "fixup";
  if (t.startsWith("Address the feedback on pull request")) return "feedback";
  if (t.startsWith(CHRONICLE)) return "chronicle";
  return "work";
}
// The findings a review ended with: how many, and how many of them must be fixed.
export function findingsIn(reply: string): { n: number; blockers: number } {
  const m = reply.match(/```findings\s*\n([\s\S]*?)\n```/);
  if (!m) return { n: 0, blockers: 0 };
  try {
    const list = JSON.parse(m[1]);
    if (!Array.isArray(list)) return { n: 0, blockers: 0 };
    const real = list.filter((f) => f && typeof f === "object" && String(f.title ?? "").trim());
    return { n: real.length, blockers: real.filter((f) => String(f.severity).toLowerCase() === "blocker").length };
  } catch { return { n: 0, blockers: 0 }; }
}

export type Payoff = NonNullable<ReturnType<typeof projectPayoff>>;
export function projectPayoff(id: string, days = 30, now = Date.now()) {
  const p = getProject(id);
  if (!p) return null;
  const since = now - days * 86_400_000;
  const recent = (iso: string) => new Date(iso).getTime() >= since;
  const mine = history().conversations.filter((c) => c.project === id);
  const ids = new Set(mine.map((c) => c.id));
  const every = allTurns().filter((t) => ids.has(t.thread));
  const turns = every.filter((t) => recent(t.time));

  // Reviews: what they found, and whether you sent the findings back to be fixed.
  const reviews = turns.filter((t) => spentOn(t.task) === "review" && t.status === "done");
  let findings = 0, blockers = 0, sentBack = 0, clean = 0;
  for (const r of reviews) {
    const f = findingsIn(r.reply);
    findings += f.n; blockers += f.blockers;
    if (!f.n) clean++;
    const later = every.slice(every.indexOf(r) + 1).filter((t) => t.thread === r.thread); // the record is in the order things happened
    if (later.some((t) => t.task.trimStart().startsWith("Fix these review findings"))) sentBack++;
  }

  // Pull requests of this project's conversations, as the camp last saw them.
  const created = new Map(mine.map((c) => [c.id, c.created]));
  const prs = prStates().filter((x) => ids.has(x.conversation) && (!x.firstSeen || recent(x.firstSeen)));
  const hours = prs.flatMap((x) => (x.firstSeen && created.has(x.conversation) ? [(new Date(x.firstSeen).getTime() - new Date(created.get(x.conversation)!).getTime()) / 3_600_000] : [])).filter((h) => h >= 0);
  const rounds = turns.filter((t) => spentOn(t.task) === "feedback").length;

  // Where the usage went, from the quest log (every model call is logged once).
  const usage: Record<Spent, { runs: number; cost: number }> = { work: { runs: 0, cost: 0 }, review: { runs: 0, cost: 0 }, opinion: { runs: 0, cost: 0 }, fixup: { runs: 0, cost: 0 }, feedback: { runs: 0, cost: 0 }, chronicle: { runs: 0, cost: 0 } };
  for (const q of recentQuests(Number.MAX_SAFE_INTEGER)) {
    if (q.project !== id || !recent(q.time)) continue;
    const u = usage[spentOn(q.task)];
    u.runs++; u.cost += questCost(q);
  }
  const total = Object.values(usage).reduce((s, u) => s + u.cost, 0);
  const checking = usage.review.cost + usage.opinion.cost + usage.fixup.cost;

  const rated = allFeedback().filter((f) => turns.some((t) => t.expedition === f.expedition));
  return {
    days,
    conversations: new Set(turns.map((t) => t.thread)).size,
    usage, total,
    checkingShare: total > 0 ? Math.round((100 * checking) / total) : 0, // percent of usage that went on reviews, second opinions and fix-ups
    reviews: { asked: reviews.length, findings, blockers, sentBack, clean },
    opinions: turns.filter((t) => spentOn(t.task) === "opinion").length,
    fixups: usage.fixup.runs,
    prs: { seen: prs.length, merged: prs.filter((x) => x.state === "MERGED").length, open: prs.filter((x) => x.state === "OPEN").length, feedbackRounds: rounds, medianHoursToPr: median(hours) },
    ratings: { up: rated.filter((f) => f.rating === "up").length, down: rated.filter((f) => f.rating === "down").length },
  };
}
