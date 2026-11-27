// The morning brief: where your work stands, written down each weekday before you ask.
//
// It's put together from what the camp already has and one look outside: your pull requests in
// linked repositories (pulls.ts), the tickets your Jira filter pulls in, and the camp's own
// record of conversations and runs. No model is called (unless you turn on AI news), so nothing in it is a guess: every line
// is something that's there to open. It says:
//
//   - Waiting on you: pull requests with open comments, failing checks or a conflict; ones
//     approved and ready to merge; runs that stopped or failed.
//   - In motion: pull requests waiting on someone else.
//   - Your tickets: the Jira tickets you're in the middle of, each with where it stands here (the
//     conversation working on it, its pull request).
//   - Today on your calendar (when Google Calendar is linked): today's events on the calendars
//     you picked for Home's week (gcal.ts). Like your notes, the events are shown on the page
//     only: an invitation's words are whoever sent it, and the inbox is readable by the crew, so
//     the inbox and the notification say how many there are, never what they are.
//   - Upcoming: tickets assigned to you that nothing has picked up yet, and the scheduled jobs
//     that will run by themselves.
//   - Your notes: the ones you changed most recently, to pick a thought back up.
//   - Since last time: what finished, what merged, and what it used.
//   - AI news (only if you turn it on): recent AI news, features, best practices and trends that
//     could help the outpost, with links. This is the one part that calls a model (briefnews.ts).
//
// Each line that has an obvious next step carries it (address the feedback, resume the run,
// start the ticket), so the entry page can offer it as one click. Starting any of them is still
// your click: the brief itself starts nothing.
//
// One is kept per day in camp/briefs/<day>.json. It's also put in the inbox and announced the
// way a scheduled job's report is (a notification, and your phone if you've set one up). Your
// notes are the exception: they're yours, so they're shown on the page and nowhere else. They
// aren't in the inbox or the notification, and no crew member can read camp/briefs/ (tools.ts).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { posix } from "node:path";
import { writeJsonAtomic } from "./atomic.js";
import { history } from "./conversations.js";
import { emit } from "./events.js";
import { jiraConnected, pulledTickets, type JiraCard } from "./jira.js";
import { loadJobs, type Job } from "./jobs.js";
import { loadNotes, type Note } from "./notes.js";
import { checkPulls, conversationOf, pullSays, pulls as knownPulls, readyToMerge, waitsOnYou, type Pulls } from "./pulls.js";
import { questCost, recentQuests } from "./questlog.js";
import { notify, toInbox } from "./scheduler.js";
import { drive, type Drive } from "./settings.js";
import { allTurns } from "./threads.js";
import { dayOf } from "./helpers.js";
import { gatherNews, type NewsItem } from "./briefnews.js";
import { pausedUntil } from "./limits.js";
import { OUTPOST } from "./outpost.js";
import { calendarConnected, weekEvents, type WeekEvent } from "./gcal.js";

export const BRIEFS_DIR = posix.join("camp", "briefs");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UNFINISHED_DAYS = 7;
const MAX_NEXT = 8;
const MAX_TICKETS = 12;
const MAX_NOTES = 5;
const NOTE_CHARS = 200;
const KEEP = 60; // days of briefs kept
const NEWS_SEEN_DAYS = 14; // links in this many past briefs aren't reported again

// What one click on a line does. address: bring a pull request's feedback to the crew. resume:
// pick a stopped run back up. start: begin work on a ticket.
export type BriefAct = { do: "address"; url: string } | { do: "resume"; run: string } | { do: "start"; jira: string };
export type BriefLine = { kind: "pull" | "run" | "ticket" | "job"; title: string; says: string; url?: string; conversation?: string; act?: BriefAct };
// One of your notes, as the brief shows it: its title and how it starts.
export type BriefNote = { id: string; title: string; text: string; updated: string };
export type Brief = {
  day: string; written: string; since: string;
  needs: BriefLine[];     // waiting on you
  moving: BriefLine[];    // waiting on someone else
  tickets: BriefLine[];   // the tickets you're in the middle of, and where each stands here
  next: BriefLine[];      // upcoming: tickets nothing has picked up, and scheduled jobs
  yourNotes: BriefNote[]; // your latest notes (shown on the page only)
  calendar?: { events: WeekEvent[]; timeZone: string | null; more: boolean }; // today on your picked calendars (page only; left out when it isn't linked)
  done: { finished: { conversation: string; title: string; runs: number }[]; merged: { title: string; url: string }[]; requests: number; byMae: number; cost: number };
  waiting: { memory: number; skills: number }; // proposals waiting for your say
  news?: NewsItem[];      // AI news that could help the outpost (only when you've turned it on)
  notes: string[];        // what couldn't be read, and why
};

const fileOf = (day: string) => posix.join(BRIEFS_DIR, `${day}.json`);

// ---------- Kept briefs ----------
export function readBrief(day: string): Brief | null {
  if (!DAY.test(day) || !existsSync(fileOf(day))) return null;
  // (One written before tickets and notes were part of it reads as having none.)
  try { const b = JSON.parse(readFileSync(fileOf(day), "utf8")) as Brief; return b && Array.isArray(b.needs) ? { ...b, tickets: b.tickets ?? [], yourNotes: b.yourNotes ?? [] } : null; } catch { return null; }
}
// The days there's a brief for, newest first.
export function briefDays(limit = 14): string[] {
  if (!existsSync(BRIEFS_DIR)) return [];
  return readdirSync(BRIEFS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse().slice(0, limit);
}

// ---------- Putting one together ----------
// tickets: what your Jira filter pulls in (null: Jira isn't linked). running: is that run going right now?
// jobs: the camp's scheduled jobs. yours: your own notes. notes: what couldn't be read.
export function gatherBrief(o: { now?: Date; pulls: Pulls; tickets: JiraCard[] | null; running?: (expedition: string) => boolean; waiting?: { memory: number; skills: number };
  jobs?: Job[]; yours?: Note[]; notes?: string[]; news?: NewsItem[] | null; calendar?: Brief["calendar"] | null }): Brief {
  const now = o.now ?? new Date();
  const day = dayOf(now);
  // "Since last time": since the brief before this one, or a day back when there isn't a recent one.
  const before = briefDays(2).filter((d) => d !== day).map(readBrief).find(Boolean);
  const floor = now.getTime() - 4 * 86_400_000;
  const since = before && new Date(before.written).getTime() > floor ? before.written : new Date(now.getTime() - 86_400_000).toISOString();

  const { conversations } = history();
  const turns = allTurns();
  const title = new Map(conversations.map((c) => [c.id, c.title]));
  const needs: BriefLine[] = [], moving: BriefLine[] = [];
  const open = o.pulls.pulls.filter((p) => p.state === "OPEN");
  for (const p of open) {
    const at = conversationOf(p, turns);
    const line: BriefLine = { kind: "pull", title: `#${p.number} ${p.title}`, says: pullSays(p), url: p.url, ...(at ? { conversation: at.thread } : {}) };
    if (waitsOnYou(p)) needs.push({ ...line, ...(p.mark ? { act: { do: "address", url: p.url } } : {}) });
    else if (readyToMerge(p)) needs.push(line);
    else moving.push(line);
  }
  const recent = now.getTime() - UNFINISHED_DAYS * 86_400_000;
  for (const c of conversations) {
    if (c.status === "done" || new Date(c.updated).getTime() < recent) continue;
    const last = c.expeditions[c.expeditions.length - 1];
    if (o.running?.(last)) continue;
    needs.push({ kind: "run", title: c.title, says: c.status === "running" ? "Cut off before it finished" : `Ended as ${c.status.replace(/_/g, " ")}`, conversation: c.id, act: { do: "resume", run: last } });
  }

  // Your tickets. One you're in the middle of (Jira says so, a conversation here is working on it,
  // or an open pull request is named for it) is listed with where it stands. The rest are upcoming.
  const pullFor = (key: string) => open.find((p) => new RegExp(`(^|[^a-z0-9])${key.toLowerCase()}(?![0-9])`).test(`${p.branch} ${p.title}`.toLowerCase()));
  const talkFor = (key: string) => conversations.find((c) => c.jira === key); // the latest one: they're newest first
  const tickets: BriefLine[] = [], next: BriefLine[] = [];
  for (const t of [...(o.tickets ?? [])].sort((a, b) => Number(b.group === "doing") - Number(a.group === "doing"))) {
    if (t.group === "done") continue;
    const pr = pullFor(t.key), talk = talkFor(t.key);
    const line = { kind: "ticket" as const, title: `${t.key} ${t.summary}`, url: t.url };
    const status = [t.status, t.priority].filter(Boolean).join(" · ");
    if (pr || talk || t.group === "doing") {
      const here = pr ? `pull request #${pr.number} ${pullSays(pr)}` : talk ? "a conversation here is working on it" : "nothing here has picked it up";
      tickets.push({ ...line, says: [status, here].filter(Boolean).join(" · "), ...(talk ? { conversation: talk.id } : {}), ...(!pr && !talk ? { act: { do: "start" as const, jira: t.key } } : {}) });
    } else next.push({ ...line, says: status || "Not started", act: { do: "start", jira: t.key } });
  }
  tickets.splice(MAX_TICKETS); next.splice(MAX_NEXT);
  for (const j of o.jobs ?? []) if (j.enabled) next.push({ kind: "job", title: j.name, says: `Runs by itself, ${j.schedule}` });
  const first = (text: string) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > NOTE_CHARS ? `${t.slice(0, NOTE_CHARS - 1).trimEnd()}…` : t; };
  const yourNotes: BriefNote[] = (o.yours ?? []).slice(0, MAX_NOTES).map((n) => ({ id: n.id, title: n.title.trim() || first(n.text).slice(0, 60) || "Untitled", text: first(n.text), updated: n.updated }));

  const after = turns.filter((t) => t.time > since && !t.aside);
  const ended = after.filter((t) => t.status === "done");
  const byThread = new Map<string, number>();
  for (const t of ended) if (title.has(t.thread)) byThread.set(t.thread, (byThread.get(t.thread) ?? 0) + 1);
  const cost = recentQuests(Number.MAX_SAFE_INTEGER).filter((q) => q.time > since).reduce((s, q) => s + questCost(q), 0);
  return {
    day, written: now.toISOString(), since, needs, moving, tickets, next, yourNotes,
    done: {
      finished: [...byThread].map(([conversation, runs]) => ({ conversation, title: title.get(conversation)!, runs })),
      merged: o.pulls.pulls.filter((p) => p.merged && p.merged > since).map((p) => ({ title: `#${p.number} ${p.title}`, url: p.url })),
      requests: after.length, byMae: after.filter((t) => t.by).length, cost: Math.round(cost * 100) / 100,
    },
    waiting: o.waiting ?? { memory: 0, skills: 0 },
    ...(o.news ? { news: o.news } : {}),
    ...(o.calendar ? { calendar: o.calendar } : {}),
    notes: [...(o.notes ?? []), ...(o.pulls.error ? [`Your pull requests couldn't be read: ${o.pulls.error}`] : [])],
  };
}

// The brief in words: for the inbox, a notification, or to paste somewhere.
export function briefText(b: Brief): string {
  const list = (lines: BriefLine[]) => lines.map((l) => `- ${l.url ? `[${l.title}](${l.url})` : l.title}: ${l.says}`).join("\n");
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (b.needs.length) parts.push(`**Waiting on you (${b.needs.length})**\n${list(b.needs)}`);
  if (b.moving.length) parts.push(`**In motion (${b.moving.length})**\n${list(b.moving)}`);
  if (b.calendar) parts.push(b.calendar.events.length ? `**Today on your calendar**\n${n(b.calendar.events.length, "event")}${b.calendar.more ? " or more" : ""}: open ${OUTPOST.name} to see them.` : "**Today on your calendar**\nNothing.");
  if (b.tickets.length) parts.push(`**Your tickets (${b.tickets.length})**\n${list(b.tickets)}`);
  if (b.next.length) parts.push(`**Upcoming (${b.next.length})**\n${list(b.next)}`);
  const d = b.done;
  const since = [
    d.finished.length ? `${n(d.finished.length, "conversation")} had work finish` : "",
    d.merged.length ? `${n(d.merged.length, "pull request")} merged` : "",
    d.requests ? `${n(d.requests, "request")}${d.byMae ? ` (${d.byMae} started by ${OUTPOST.name})` : ""}` : "",
  ].filter(Boolean);
  if (since.length) parts.push(`**Since last time**\n${since.join(", ")}.`);
  const say = b.waiting.memory + b.waiting.skills;
  if (b.news?.length) parts.push(`**AI news for ${OUTPOST.name} (${b.news.length})**\n${b.news.map((x) => `- [${x.title}](${x.url}): ${[x.says, x.why].filter(Boolean).join(" ")}`).join("\n")}`);
  if (say) parts.push(`${n(say, "suggestion")} ${say === 1 ? "is" : "are"} waiting for your say.`);
  if (b.notes.length) parts.push(b.notes.map((x) => `_${x}_`).join("\n"));
  return parts.join("\n\n") || "Nothing is waiting on you, and nothing is in motion."; // (your notes aren't in it: this text leaves the page)
}
// A brief in a line, for a notification.
export function briefLine(b: Brief): string {
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  return [b.needs.length ? `${n(b.needs.length, "thing")} waiting on you` : "Nothing waiting on you", b.calendar?.events.length ? `${n(b.calendar.events.length, "event")} today` : "", b.moving.length ? `${b.moving.length} in motion` : "", b.tickets.length ? `${n(b.tickets.length, "ticket")} under way` : "", b.next.length ? `${b.next.length} upcoming` : ""].filter(Boolean).join(", ") + ".";
}

// ---------- Writing today's ----------
// Read what's outside (GitHub, Jira), put the brief together, keep it. announce: also put it in
// the inbox and send a notification (the morning one does; one you ask for from the page doesn't).
let writing: Promise<Brief> | null = null;
export function writeBrief(o: { now?: Date; running?: (expedition: string) => boolean; waiting?: { memory: number; skills: number }; announce?: boolean;
  read?: { pulls?: () => Promise<Pulls>; tickets?: () => Promise<JiraCard[] | null>; jobs?: () => Job[]; notes?: () => Note[]; news?: (since: string, seen: string[]) => Promise<NewsItem[]>; calendar?: (from: Date) => Promise<Brief["calendar"] | null> };
  d?: Drive } = {}): Promise<Brief> {
  return (writing ??= (async () => {
    const notes: string[] = [];
    const pulls = await (o.read?.pulls ?? (() => checkPulls()))().catch(() => knownPulls());
    const tickets = await (o.read?.tickets ?? (async () => (jiraConnected() ? (await pulledTickets()).tickets : null)))()
      .catch((e: any) => { notes.push(`Jira couldn't be read: ${String(e?.message ?? e).slice(0, 200)}`); return null; });
    const news = await briefNews(o.now ?? new Date(), o.d ?? drive(), o.read?.news, notes);
    const calendar = await (o.read?.calendar ?? todaysEvents)(new Date(new Date(o.now ?? Date.now()).setHours(0, 0, 0, 0)))
      .catch((e: any) => { notes.push(`Your calendar couldn't be read: ${String(e?.message ?? e).slice(0, 200)}`); return null; });
    const b = gatherBrief({ now: o.now, pulls, tickets, running: o.running, waiting: o.waiting, notes, jobs: (o.read?.jobs ?? loadJobs)(), yours: (o.read?.notes ?? loadNotes)(), news, calendar });
    mkdirSync(BRIEFS_DIR, { recursive: true });
    writeJsonAtomic(fileOf(b.day), b);
    for (const old of briefDays(1000).slice(KEEP)) rmSync(fileOf(old), { force: true });
    emit({ type: "changed", what: "inbox" });
    if (o.announce) {
      toInbox(`${(o.now ?? new Date()).toLocaleString()} · morning-brief`, briefText(b));
      notify(`${OUTPOST.name}: morning brief`, briefLine(b));
      emit({ type: "job", name: "morning-brief", outcome: "reported", text: `${briefLine(b)}\n\n${briefText(b)}` });
    }
    return b;
  })().finally(() => { writing = null; }));
}

// Today's events on the calendars Home's week shows (null: Google Calendar isn't linked).
async function todaysEvents(from: Date): Promise<Brief["calendar"] | null> {
  if (!calendarConnected()) return null;
  const { events, timeZone, more } = await weekEvents({ from: from.toISOString(), days: 1 });
  return { events, timeZone, more };
}

// The day's AI news, when you've turned it on (null: it's off, or couldn't be had). A brief
// written again the same day keeps the news it already found, rather than searching again.
async function briefNews(now: Date, d: Drive, read: ((since: string, seen: string[]) => Promise<NewsItem[]>) | undefined, notes: string[]): Promise<NewsItem[] | null> {
  if (!d.briefNews) return null;
  const today = readBrief(dayOf(now));
  if (today?.news) return today.news;
  if (!read && pausedUntil(now.getTime())) { notes.push("AI news was skipped: your plan's usage limit is used up for now."); return null; }
  const past = briefDays(NEWS_SEEN_DAYS).map(readBrief).filter((b): b is Brief => !!b);
  const seen = past.flatMap((b) => (b.news ?? []).map((x) => x.url));
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  try { return await (read ?? ((s, u) => gatherNews({ since: s, seen: u })))(since, seen); }
  catch (e: any) { notes.push(`AI news couldn't be gathered: ${String(e?.message ?? e).slice(0, 200)}`); return null; }
}

// Is this morning's brief due? On a weekday, once the time you set has passed, if today's isn't written yet.
export function briefDue(now = new Date(), d: Drive = drive()): boolean {
  if (!d.brief || now.getDay() === 0 || now.getDay() === 6) return false;
  const [h, m] = d.briefAt.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m && !readBrief(dayOf(now));
}
