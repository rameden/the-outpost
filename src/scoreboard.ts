// The scoreboard: is the camp taking work off you, week by week?
//
// payoff.ts asks whether the checking around the work earns its keep. This asks the question
// before that one: how much of what you type is deciding something, and how much is operating
// the pipeline (asking for the description again, bringing the review comments in, saying "yes,
// go on")? The second kind is what the camp's own initiative is for: the pull-request trigger,
// the morning brief. If they work, these numbers move, and here is where you'd see it.
//
// For each of the last few weeks, counted from the camp's own record and nothing else:
//   - what you asked for, by what kind of request it was, and what the camp started by itself;
//   - how many requests a ticket took;
//   - your pull requests: opened, merged, rounds of review, hours from opened to merged;
//   - who on the crew did the work, how long it ran, and what it used.
//
// What kind a request is, is read from how it's worded (kindOf below): a rough sort, good for a
// trend, not an audit. It also says what the camp could take over (offers): a kind of request
// you keep making by hand that a trigger would start for you.

import { weekLabel, weekOf } from "./chronicle.js";
import { GENERAL, getProject, history } from "./conversations.js";
import { allFeedback } from "./feedback.js";
import { spentOn } from "./payoff.js";
import { conversationOf, pulls as knownPulls, type Pull } from "./pulls.js";
import { questCost, recentQuests } from "./questlog.js";
import { currentName } from "./crew.js";
import { allTurns } from "./threads.js";
import { loadTriggers, type Trigger } from "./triggers.js";
import { median, weekSpan as span } from "./helpers.js";

// work: asking for something to be built, changed or fixed. feedback: bringing a pull request's
// review comments or failing checks to the crew. writeup: asking for a description or a write-up
// of work already done. goahead: a bare yes. question: asking how something is. review: a review
// or second opinion from the page's own buttons.
export const KINDS = ["work", "feedback", "writeup", "goahead", "question", "review"] as const;
export type Kind = (typeof KINDS)[number];
export const OPERATING: Kind[] = ["feedback", "writeup", "goahead"]; // running the pipeline, not deciding anything

const GO = /^(y|yes|yep|yeah|ok|okay|sure|please do|go ahead|do it|sounds good|lgtm|approved?|resume|continue|[a-d]|\d[.)]\s*(yes|no)\b[\s\S]{0,40}|pick up where this left off[\s\S]*)[\s.!]*$/i;
const FEEDBACK = /\b(unresolved|review|pr|pull request)\b[^.\n]{0,60}\bcomments?\b|\bcomments?\b[^.\n]{0,60}\b(pr\b|pull request|resolve|address|reply)|\b(address|resolve|answer|reply to)\b[^\n]{0,40}\bcomments?\b|\bfailing checks?\b/i;
const WRITEUP = /\b(pr|pull request|ticket)\s+(title|description)s?\b|\bdescriptions?\b|\bwrite[- ]?up\b|@scribe\b|\brelease notes\b|\bchangelog\b/i;
const QUESTION = /^(how|what|why|where|which|who|when)\b/i;

export function kindOf(task: string): Kind {
  const spent = spentOn(task);
  if (spent === "review" || spent === "opinion") return "review";
  if (spent === "feedback" || spent === "fixup") return "feedback";
  if (spent === "chronicle") return "writeup";
  const t = task.trim();
  if (/^Pull request #\d+: new commits to describe/.test(t)) return "writeup";
  if (/^Pull request #\d+: new feedback/.test(t)) return "feedback";
  if (GO.test(t) || t.length <= 3) return "goahead";
  if (FEEDBACK.test(t) && !/\b(write|update)\b[^.\n]{0,30}\bdescription/i.test(t)) return "feedback";
  if (WRITEUP.test(t)) return "writeup";
  if (QUESTION.test(t.replace(/^@\w+\s+/, ""))) return "question";
  return "work";
}


export type WeekScore = {
  week: string; label: string;
  requests: number;                 // what you typed
  byMae: number;                    // what the camp started by itself (a trigger)
  conversations: number;
  kinds: Record<Kind, number>;      // what you typed, by kind
  operating: number;                // percent of what you typed that was running the pipeline
  perTicket: number | null;         // requests a ticket took (the median, over tickets worked on that week)
  crew: { who: string; runs: number; seconds: number }[];
  seconds: number; cost: number;
  finished: number | null;          // percent of runs that ended cleanly
  prs: { opened: number; merged: number; rounds: number | null; hoursToMerge: number | null };
  ratings: { up: number; down: number };
};
export type Scoreboard = { project?: string; weeks: WeekScore[] }; // oldest week first; the last is this week

// project: one project's work only (its conversations, and pull requests in its repositories). weeks: how many, ending with this one.
export function scoreboard(o: { project?: string; weeks?: number; now?: Date; pulls?: Pull[] } = {}): Scoreboard {
  const now = o.now ?? new Date();
  const project = o.project && o.project !== GENERAL ? getProject(o.project) : undefined;
  const { conversations } = history();
  const mine = project ? conversations.filter((c) => c.project === project.id) : conversations;
  const ids = new Set(mine.map((c) => c.id));
  const ticket = new Map(mine.flatMap((c) => (c.jira ? [[c.id, c.jira] as const] : [])));
  const turns = allTurns().filter((t) => ids.has(t.thread));
  const all = allTurns();
  const prs = (o.pulls ?? knownPulls().pulls).filter((p) => {
    if (!project) return true;
    const at = conversationOf(p, all);
    return at ? ids.has(at.thread) : !!project.links?.includes(p.link);
  });
  const quests = recentQuests(Number.MAX_SAFE_INTEGER).filter((q) => (project ? q.project === project.id : true));
  const ratings = allFeedback();

  const weeks: WeekScore[] = [];
  for (let back = (o.weeks ?? 5) - 1; back >= 0; back--) {
    const week = weekOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * back));
    const { from, to } = span(week);
    const inWeek = (iso?: string) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= from && t < to; };
    const here = turns.filter((t) => inWeek(t.time));
    const typed = here.filter((t) => !t.by && !t.aside || (t.aside && !t.by)); // an aside you clicked for is yours too
    const kinds = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
    for (const t of typed) kinds[kindOf(t.task)]++;
    const perTicket = new Map<string, number>();
    for (const t of typed) { const key = ticket.get(t.thread); if (key) perTicket.set(key, (perTicket.get(key) ?? 0) + 1); }
    const ran = quests.filter((q) => inWeek(q.time));
    const crew = new Map<string, { runs: number; seconds: number }>();
    for (const q of ran) { const who = currentName(q.character), c = crew.get(who) ?? { runs: 0, seconds: 0 }; c.runs++; c.seconds += q.seconds; crew.set(who, c); }
    const merged = prs.filter((p) => inWeek(p.merged));
    const runs = new Set(here.map((t) => t.expedition));
    const rated = ratings.filter((f) => runs.has(f.expedition));
    weeks.push({
      week, label: weekLabel(week),
      requests: typed.length, byMae: here.filter((t) => t.by).length, conversations: new Set(here.map((t) => t.thread)).size,
      kinds, operating: typed.length ? Math.round((100 * OPERATING.reduce((n, k) => n + kinds[k], 0)) / typed.length) : 0,
      perTicket: median([...perTicket.values()]),
      crew: [...crew].map(([who, c]) => ({ who, ...c })).sort((a, b) => b.runs - a.runs),
      // The Quartermaster's own run spans its quests': only expeditions and direct chats are wall-clock time.
      seconds: ran.filter((q) => q.kind !== "quest" || !q.expedition).reduce((n, q) => n + q.seconds, 0),
      cost: Math.round(ran.reduce((n, q) => n + questCost(q), 0) * 100) / 100,
      finished: ran.length ? Math.round((100 * ran.filter((q) => q.status === "done").length) / ran.length) : null,
      prs: {
        opened: prs.filter((p) => inWeek(p.created)).length, merged: merged.length,
        rounds: median(merged.map((p) => p.rounds)),
        hoursToMerge: median(merged.map((p) => Math.max(0, (new Date(p.merged!).getTime() - new Date(p.created).getTime()) / 3_600_000))),
      },
      ratings: { up: rated.filter((f) => f.rating === "up").length, down: rated.filter((f) => f.rating === "down").length },
    });
  }
  return { ...(project ? { project: project.id } : {}), weeks };
}

// ---------- What the camp could take over ----------
// A kind of request you keep making by hand that a trigger would start for you. trigger: what
// one click would add (the same thing the form under Jobs makes).
export type Offer = { key: string; what: string; why: string; trigger: { name: string; kind: "github-pr"; link: string; describe: boolean; project?: string } };
const ENOUGH = 3; // times in the last two weeks before it's worth offering

export function offers(board: Scoreboard, o: { triggers?: Trigger[]; pulls?: Pull[] } = {}): Offer[] {
  const recent = board.weeks.slice(-2);
  const count = (k: Kind) => recent.reduce((n, w) => n + w.kinds[k], 0);
  const feedback = count("feedback"), writeup = count("writeup");
  if (feedback < ENOUGH && writeup < ENOUGH) return [];
  const triggers = o.triggers ?? loadTriggers();
  const projects = history().projects;
  // One per linked repository you have pull requests in and no pull-request trigger for yet.
  const links = [...new Set((o.pulls ?? knownPulls().pulls).map((p) => p.link))].filter((l) => !triggers.some((t) => t.kind === "github-pr" && t.link === l));
  const n = (c: number, one: string) => `${c} ${one}${c === 1 ? "" : "s"}`;
  return links.map((link) => {
    const project = (board.project ? projects.find((p) => p.id === board.project) : projects.find((p) => p.links?.includes(link)))?.id;
    const why = [feedback >= ENOUGH ? `${n(feedback, "time")} you brought a pull request's review comments to the crew yourself` : "", writeup >= ENOUGH ? `${n(writeup, "time")} you asked for a description to be written or brought up to date` : ""].filter(Boolean).join(", and ");
    return {
      key: `github-pr:${link}`,
      what: `Watch your pull requests in links/${link}`,
      why: `In the last two weeks: ${why}. With this on, new feedback starts a plan for you to approve${writeup >= ENOUGH ? ", and new commits have the Scribe draft the updated description for you to approve" : ""}.`,
      trigger: { name: `my-pull-requests-${link}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), kind: "github-pr" as const, link, describe: writeup >= ENOUGH, ...(project && project !== GENERAL ? { project } : {}) },
    };
  });
}
