// Pull requests, two ways. The first part drafts a worktree's pull request description and
// watches the pull requests of the worktrees the crew worked in (camp/prwatch.json). The second
// reads every pull request you opened in a linked repository, wherever its branch lives
// (camp/pulls.json). They keep separate records and are read by different parts of the camp;
// what they share is how GitHub is asked and how its answer is read.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import type { Workspace } from "./context.js";
import { history, titleOf } from "./conversations.js";
import { emit } from "./events.js";
import { checkFailed, checkPending, gh } from "./github.js";
import { handEdits, handEditsSection, notesAfterEdits } from "./handedits.js";
import { jiraConnected, ticketDetail } from "./jira.js";
import { pullMerged } from "./jiramoments.js";
import { loadLinks } from "./links.js";
import { OUTPOST } from "./outpost.js";
import { checked, fail, tryGit } from "./repos.js";
import { prWatchOn } from "./settings.js";
import type { askSmall } from "./small.js";
import { allTurns, shortened, type Turn } from "./threads.js";
import { advanceTicket } from "./tickets.js";
import { clip } from "./helpers.js";

// ---------- Shared ----------
// GitHub's review decision on a pull request, as the camp keeps it.
const reviewOf = (decision: unknown): "approved" | "changes" | null =>
  decision === "APPROVED" ? "approved" : decision === "CHANGES_REQUESTED" ? "changes" : null;

// ========== Pull requests for the worktrees the crew worked in (was prs.ts) ==========
//
// Two things. A description worth reading, drafted from the record (the ticket and its
// acceptance criteria, what changed, the commits, how your checks came out, what the crew
// reported, and what you changed by hand after the crew finished: handedits.ts) for you to edit
// before anything is pushed. And a watch: now and then the camp looks
// at the pull requests of recent worktrees (with the GitHub CLI, as you) and keeps where each
// stands: failing checks, review comments, conflicts with its base. The page shows that on the
// conversation, and brings the feedback into a reply when you ask. Nothing here answers a
// review, pushes, or merges by itself, and nothing an agent says can trigger any of it.

type Where = Pick<Workspace, "link" | "path">;

async function ghIn(dir: string, args: string[]): Promise<string> {
  try { return await gh(args, { cwd: dir }); }
  catch (e: any) {
    if (e?.code === "ENOENT") throw new Error("The GitHub CLI (gh) isn't installed, so pull requests can't be read or changed from here.");
    throw fail(e);
  }
}

// ---------- A description from the record ----------
// handEdits: the files you changed yourself after the crew's last run there (handedits.ts), and
// whether the run's notes were rewritten to match them.
export type PrDraft = { title: string; body: string; branch: string; existing: { number: number; url: string } | null; handEdits?: { files: number; rewritten: boolean } };
const MAX_FILES = 40;

// The checks the camp ran for this folder after the last change, as they ended ("✓ npm test").
export function checksIn(reply: string, link: string): string[] {
  const out: string[] = [];
  const lines = reply.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(`Automatic checks in links/${link} `)) continue;
    for (let j = i + 1; j < lines.length && lines[j].trim(); j++) if (/^[✓✗] /.test(lines[j])) out.push(lines[j].trim());
  }
  return out;
}

// expedition: the run whose card you clicked (it says which conversation this is). base: the
// commit the work started from; without it, everything the branch has that its upstream's default doesn't.
export async function draftPullRequest(w: Where, opts: { expedition?: string; base?: string; ask?: typeof askSmall } = {}): Promise<PrDraft> {
  const dir = await checked(w);
  const branch = await tryGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const turns = allTurns();
  const hit = (opts.expedition ? turns.find((t) => t.expedition === opts.expedition) : undefined) ?? [...turns].reverse().find((t) => t.workspaces?.[w.link]?.path === w.path);
  const mine = hit ? turns.filter((t) => t.thread === hit.thread) : [];
  const first = mine[0];
  const last = [...mine].reverse().find((t) => !t.aside && t.status === "done" && t.reply.trim());
  const key = mine.find((t) => t.jira)?.jira;
  let ticket: Awaited<ReturnType<typeof ticketDetail>> | null = null;
  if (key && jiraConnected()) { try { ticket = await ticketDetail(key); } catch { /* the description does without it */ } }

  const base = opts.base || hit?.workspaces?.[w.link]?.base || (await tryGit(dir, ["merge-base", "HEAD", "origin/HEAD"]));
  const range = base ? `${base}..HEAD` : "HEAD~1..HEAD";
  const stats = (await tryGit(dir, ["diff", "--numstat", range])).split("\n").filter(Boolean).map((l) => { const [a, d, ...p] = l.split("\t"); return { path: p.join("\t"), added: Number(a) || 0, removed: Number(d) || 0, binary: a === "-" }; });
  const commits = (await tryGit(dir, ["log", "--format=%s", "--reverse", range])).split("\n").filter(Boolean);

  const titled = hit ? history().conversations.find((c) => c.id === hit.thread)?.title : undefined;
  const subject = ticket ? ticket.summary : titled ?? (first ? titleOf(first.task) : commits[0] ?? branch);
  const title = clip(`${key ? `${key}: ` : ""}${subject}`.replace(/\s+/g, " "), 120);

  const parts: string[] = [];
  parts.push("## Summary\n" + (ticket ? `Work for [${ticket.key}](${ticket.url}): ${ticket.summary}`
    : key ? `Work for ${key}.`
    : first ? clip(first.task.replace(/^@\w+\s+/, ""), 600) : "(Say what this changes and why.)"));
  if (stats.length) {
    const added = stats.reduce((n, s) => n + s.added, 0), removed = stats.reduce((n, s) => n + s.removed, 0);
    parts.push(`## Changes\n${stats.length} ${stats.length === 1 ? "file" : "files"} changed, +${added} −${removed}.\n\n` +
      stats.slice(0, MAX_FILES).map((s) => `- \`${s.path}\` ${s.binary ? "(binary)" : `(+${s.added} −${s.removed})`}`).join("\n") +
      (stats.length > MAX_FILES ? `\n- …and ${stats.length - MAX_FILES} more` : ""));
  }
  if (commits.length > 1) parts.push("## Commits\n" + commits.slice(0, 30).map((c) => `- ${c}`).join("\n") + (commits.length > 30 ? `\n- …and ${commits.length - 30} more` : ""));
  // Left unticked on purpose: you tick what you've checked yourself.
  if (ticket?.criteria.length) parts.push("## Acceptance criteria\n" + ticket.criteria.map((c) => `- [ ] ${c}`).join("\n"));
  const checks = last ? checksIn(last.reply, w.link) : [];
  parts.push("## Checks\n" + (checks.length ? checks.map((c) => `- ${c[0] === "✓" ? "Passed" : "FAILED"}: \`${c.slice(2)}\``).join("\n") + `\n\n(Run by Outpost ${OUTPOST.name} after the last change.)`
    : "No automatic checks ran for this change."));
  // What you changed by hand since the crew finished: listed, and the notes brought up to date with it.
  const byHand = await handEdits(dir, w.link, mine.filter((t) => !t.aside && t.workspaces?.[w.link]?.path === w.path).map((t) => t.expedition)).catch(() => ({ files: [], since: null }));
  if (byHand.files.length) parts.push(handEditsSection(byHand.files));
  let rewritten = false;
  if (last) {
    const notes = shortened(last.reply.replace(/\n*Automatic checks in links\/[\s\S]*$/, ""), 1500);
    const after = byHand.files.length ? await notesAfterEdits(dir, notes, byHand, { project: history().conversations.find((c) => c.id === hit?.thread)?.project, ask: opts.ask }) : { notes, rewritten: false };
    rewritten = after.rewritten;
    parts.push("## Notes from the run\n" + after.notes);
  }

  let existing: PrDraft["existing"] = null;
  try {
    const pr = JSON.parse(await ghIn(dir, ["pr", "view", "--json", "number,url,state"]));
    if (pr?.state === "OPEN") existing = { number: pr.number, url: pr.url };
  } catch { /* no pull request yet, or no gh: it's a new one */ }
  return { title, body: parts.join("\n\n") + "\n", branch, existing, ...(byHand.files.length ? { handEdits: { files: byHand.files.length, rewritten } } : {}) };
}

// Change the title and description of the pull request this branch already has.
export async function updatePullRequest(w: Where, title: string, body: string): Promise<string> {
  const dir = await checked(w);
  const out = await ghIn(dir, ["pr", "edit", "--title", title.trim() || "Untitled", "--body", body]);
  return out.trim().split("\n").pop() ?? "";
}

// The conversation a worktree belongs to (the latest one that worked in it), and its ticket.
export function ticketOf(w: Where, expedition?: string): string | undefined {
  const turns = allTurns();
  const hit = (expedition ? turns.find((t) => t.expedition === expedition) : undefined) ?? [...turns].reverse().find((t) => t.workspaces?.[w.link]?.path === w.path);
  return hit ? turns.find((t) => t.thread === hit.thread && t.jira)?.jira : undefined;
}

// ---------- The watch ----------
export const PRWATCH_PATH = "camp/prwatch.json";
const RECENT_MS = 21 * 86_400_000;
export type PrState = {
  conversation: string; link: string; path: string; branch: string;
  number: number; url: string; title: string; state: "OPEN" | "MERGED" | "CLOSED";
  failing: number; pending: number; comments: number;
  review: "approved" | "changes" | null;
  conflicts: boolean;          // it can't be merged into its base as it stands
  checked: string;
  firstSeen?: string;          // when the camp first saw this pull request (close to when it was opened)
  seen?: { failing: number; comments: number }; // what there was when you last brought the feedback in
};
// Something to look at that you haven't brought in yet.
export const needsYou = (p: PrState) => p.state === "OPEN" && (p.conflicts || p.failing > (p.seen?.failing ?? 0) || p.comments > (p.seen?.comments ?? 0) || (p.review === "changes" && !p.seen));

function loadWatch(): Record<string, PrState> {
  return (readJsonFile(PRWATCH_PATH, {}) as { prs?: Record<string, PrState> } | null)?.prs ?? {};
}
function saveWatch(prs: Record<string, PrState>) {
  writeJsonAtomic(PRWATCH_PATH, { prs });
}
export const prStates = (): PrState[] => Object.values(loadWatch());

// One worktree's pull request as it stands now, or null if its branch has none.
async function look(w: { conversation: string; link: string; path: string }, before?: PrState): Promise<PrState | null> {
  if (!existsSync(w.path)) return null;
  // A branch that was never pushed can't have a pull request: don't ask GitHub about it.
  if (!(await tryGit(w.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]))) return null;
  let pr: any;
  try { pr = JSON.parse(await ghIn(w.path, ["pr", "view", "--json", "number,url,title,state,mergeable,reviewDecision,statusCheckRollup,comments,reviews,headRefName"])); }
  catch { return before ?? null; } // no pull request, or GitHub couldn't be reached: keep what was known
  const rollup: any[] = pr.statusCheckRollup ?? [];
  return {
    conversation: w.conversation, link: w.link, path: w.path, branch: String(pr.headRefName ?? before?.branch ?? ""),
    number: pr.number, url: pr.url, title: String(pr.title ?? ""), state: pr.state === "MERGED" ? "MERGED" : pr.state === "CLOSED" ? "CLOSED" : "OPEN",
    failing: rollup.filter(checkFailed).length,
    pending: rollup.filter(checkPending).length,
    comments: (pr.comments ?? []).filter((c: any) => String(c.body ?? "").trim()).length + (pr.reviews ?? []).filter((r: any) => String(r.body ?? "").trim() || r.state === "CHANGES_REQUESTED").length,
    review: reviewOf(pr.reviewDecision),
    conflicts: pr.mergeable === "CONFLICTING",
    checked: new Date().toISOString(),
    firstSeen: (before && before.number === pr.number && before.firstSeen) || new Date().toISOString(),
    ...(before?.seen && before.number === pr.number ? { seen: before.seen } : {}),
  };
}

// Look at every recent conversation's worktrees once. A pull request that has been merged or
// closed is kept as it ended and not asked about again.
let looking = false;
export async function checkPullRequests(now = Date.now()): Promise<PrState[]> {
  if (looking) return prStates();
  looking = true;
  try {
    const before = loadWatch();
    const next: Record<string, PrState> = {};
    for (const c of history().conversations) {
      const recent = now - new Date(c.updated).getTime() < RECENT_MS;
      for (const [link, ws] of Object.entries(c.workspaces ?? {})) {
        const was = before[ws.path];
        if (was && was.state !== "OPEN") { next[ws.path] = { ...was, conversation: c.id }; continue; }
        if (!recent && !was) continue;
        const found = await look({ conversation: c.id, link, path: ws.path }, was);
        if (found) next[ws.path] = found;
        // Merged since the last look: say so on its ticket, if you've turned write-back on (jiramoments.ts).
        if (was?.state === "OPEN" && found?.state === "MERGED") {
          void pullMerged(c.id, ticketOf({ link, path: ws.path }), found.url).catch(() => { /* the ticket goes without */ });
          // An Outpost ticket's work merged: it's done.
          if (c.ticket && advanceTicket(c.ticket, "done")) emit({ type: "notice", who: "Tickets", emoji: "🎫", depth: 0, text: `${c.ticket} is done: its pull request was merged.` });
        }
      }
    }
    const same = (p: PrState) => JSON.stringify({ ...p, checked: "", firstSeen: "" });
    const changed = Object.keys(next).length !== Object.keys(before).length || Object.values(next).some((p) => !before[p.path] || same(p) !== same(before[p.path]));
    if (changed) { saveWatch(next); emit({ type: "changed", what: "prs" }); }
    return Object.values(changed ? next : before);
  } finally { looking = false; }
}

// You've brought this pull request's feedback into a reply: it stops asking for attention until there's more.
export function markSeen(path: string): boolean {
  const prs = loadWatch();
  const p = prs[path];
  if (!p) return false;
  prs[path] = { ...p, seen: { failing: p.failing, comments: p.comments } };
  saveWatch(prs);
  emit({ type: "changed", what: "prs" });
  return true;
}

// Every few minutes while mission control is open (and only while the setting is on).
export function startPrWatch(everyMs = 180_000): NodeJS.Timeout {
  const tick = () => { if (prWatchOn()) void checkPullRequests().catch(() => { /* next time */ }); };
  setTimeout(tick, 20_000).unref();
  const t = setInterval(tick, everyMs);
  t.unref();
  return t;
}

// ========== Your pull requests in the repositories you've linked, wherever their branches were made ==========
//
// The watch above follows the worktrees the camp made. This follows you: every pull request
// you opened in a linked repository over the last few weeks, whether its branch lives in a camp
// worktree or in your own checkout. One read (with the GitHub CLI, as you) brings back where each
// stands: what other people have said and which of it is still open, failing checks, conflicts,
// and how many rounds of review it has been through.
//
// It's what the rest of the camp's own initiative is built on: the pull-request trigger starts
// work when one gets new feedback (triggers.ts), the morning brief lists them (brief.ts), the
// retro reads what reviewers caught (reports.ts), and the scoreboard counts rounds and days
// (reports.ts). Nothing here writes to GitHub.
//
// What you said yourself is left out, and so is anything a bot said: the crew answers reviews
// under your name, so counting your own comments as news would have it answering itself.

export const PULLS_PATH = "camp/pulls.json";
const WINDOW_DAYS = 45;      // pull requests touched since then
const MAX_PULLS = 50;
const SAID_CHARS = 1500;     // of one comment
const HEARD = 30, HEARD_CHARS = 300;

// kind: a review's own summary, a comment on a line (where: the file and line), or a comment on the pull request.
export type Said = { who: string; when: string; kind: "review" | "line" | "comment"; where?: string; text: string };
export type Pull = {
  url: string; number: number; repo: string; link: string; title: string; branch: string; head: string;
  state: "OPEN" | "MERGED" | "CLOSED"; draft: boolean; created: string; merged?: string;
  review: "approved" | "changes" | null;
  conflicts: boolean;
  failing: string[];        // checks that failed on the latest commit, once none are still running
  pending: number;          // checks still running
  said: Said[];             // what's waiting on you: every open line comment, and whatever was said since your last push
  unresolved: number;       // review threads nobody has resolved
  earlier: number;          // things said before your last push that aren't repeated in `said`
  heard: Said[];            // the latest of everything other people said, resolved or not, each cut short (the retro reads these)
  rounds: number;           // rounds of review: feedback, then a push, is one round
  mark: string;             // changes when there's new feedback or newly failing checks; empty when nothing waits on you
};
export type Pulls = { fetched: string; login: string; pulls: Pull[]; error?: string };

// ---------- Reading ----------
const QUERY = `query($q: String!) {
  viewer { login }
  search(type: ISSUE, first: ${MAX_PULLS}, query: $q) {
    nodes {
      ... on PullRequest {
        number title url state isDraft createdAt mergedAt headRefName headRefOid reviewDecision mergeable
        repository { nameWithOwner }
        comments(last: 40) { nodes { author { login __typename } createdAt body } }
        reviews(last: 40) { nodes { author { login __typename } submittedAt state body } }
        reviewThreads(last: 60) { nodes { isResolved path line comments(last: 6) { nodes { author { login __typename } createdAt body } } } }
        commits(last: 60) { nodes { commit { committedDate statusCheckRollup { contexts(first: 60) { nodes { __typename ... on CheckRun { name conclusion status } ... on StatusContext { context state } } } } } } }
      }
    }
  }
}`;

// The GraphQL call itself (swapped out in tests).
export type Fetcher = (query: string, search: string) => Promise<any>;
export const ghFetcher: Fetcher = async (query, search) => {
  try {
    return JSON.parse(await gh(["api", "graphql", "-f", `query=${query}`, "-f", `q=${search}`], { maxBuffer: 32 * 1024 * 1024 }));
  } catch (e: any) {
    if (e?.code === "ENOENT") throw new Error("The GitHub CLI (gh) isn't installed, so your pull requests can't be read from here.");
    throw new Error(String(e?.stderr || e?.message || e).trim().split("\n").slice(-2).join(" ").slice(0, 300));
  }
};

// "owner/name" from a remote's address (https or ssh), or nothing if it isn't on github.com.
export function repoOf(remote: string): string | undefined {
  const m = remote.trim().match(/github\.com[:/]+([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return m?.[1];
}
// The repositories behind your linked folders: "owner/name" (lowercase) → the link's name.
export async function linkedRepositories(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const l of loadLinks()) {
    const repo = repoOf(await tryGit(l.path, ["remote", "get-url", "origin"]));
    if (repo && !out.has(repo.toLowerCase())) out.set(repo.toLowerCase(), l.name);
  }
  return out;
}

const NO_SUMMARY = "(no summary)"; // a review that asked for changes without saying anything itself
const clipSaid = (s: unknown, n = SAID_CHARS) => clip(s, n);

// One pull request as GitHub describes it, read into what the camp keeps. me: your login.
export function readPull(n: any, me: string, link: string): Pull {
  const other = (a: any) => !!a?.login && a.__typename !== "Bot" && a.login.toLowerCase() !== me.toLowerCase();
  const commits: string[] = (n.commits?.nodes ?? []).map((c: any) => String(c.commit?.committedDate ?? "")).filter(Boolean).sort();
  const pushed = commits[commits.length - 1] ?? "";
  const checks: any[] = n.commits?.nodes?.at(-1)?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const pending = checks.filter((c) => (c.__typename === "CheckRun" ? c.status !== "COMPLETED" : /^(PENDING|EXPECTED)$/.test(String(c.state)))).length;
  const failed = checks.filter(checkFailed).map((c) => String(c.name ?? c.context ?? "check"));

  const threads: any[] = n.reviewThreads?.nodes ?? [];
  const lines = (t: any): Said[] => (t.comments?.nodes ?? []).filter((c: any) => other(c.author))
    .map((c: any) => ({ who: c.author.login, when: c.createdAt, kind: "line" as const, where: `${t.path}${t.line ? `:${t.line}` : ""}`, text: clipSaid(c.body) }));
  const reviews: Said[] = (n.reviews?.nodes ?? []).filter((r: any) => other(r.author) && (String(r.body ?? "").trim() || r.state === "CHANGES_REQUESTED"))
    .map((r: any) => ({ who: r.author.login, when: r.submittedAt, kind: "review" as const, ...(r.state === "CHANGES_REQUESTED" ? { where: "changes requested" } : {}), text: clipSaid(r.body) || NO_SUMMARY }));
  const comments: Said[] = (n.comments?.nodes ?? []).filter((c: any) => other(c.author) && String(c.body ?? "").trim())
    .map((c: any) => ({ who: c.author.login, when: c.createdAt, kind: "comment" as const, text: clipSaid(c.body) }));

  // What's waiting on you: every line comment in a thread nobody has resolved, and whatever was said after your last push.
  const open = threads.filter((t) => !t.isResolved).flatMap(lines);
  const since = [...reviews, ...comments].filter((s) => s.when > pushed);
  const said = [...open, ...since].sort((a, b) => a.when.localeCompare(b.when));
  const everything = [...threads.flatMap(lines), ...reviews, ...comments];

  // A round of review: people say things, then you push. Counted from the two timelines.
  let rounds = 0, talking = false;
  for (const e of [...everything.map((s) => ({ at: s.when, said: true })), ...commits.map((at) => ({ at, said: false }))].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.said && !talking) rounds++;
    talking = e.said;
  }

  const isOpen = n.state === "OPEN";
  const failing = pending ? [] : failed;
  const latest = said.at(-1)?.when ?? "";
  const mark = isOpen && (said.length || failing.length)
    ? createHash("sha1").update(`${latest}|${failing.length ? `${n.headRefOid}:${[...failing].sort().join(",")}` : ""}`).digest("hex").slice(0, 10) : "";
  return {
    url: n.url, number: n.number, repo: n.repository?.nameWithOwner ?? "", link, title: String(n.title ?? ""), branch: String(n.headRefName ?? ""), head: String(n.headRefOid ?? ""),
    state: n.state === "MERGED" ? "MERGED" : isOpen ? "OPEN" : "CLOSED", draft: n.isDraft === true, created: n.createdAt, ...(n.mergedAt ? { merged: n.mergedAt } : {}),
    review: reviewOf(n.reviewDecision),
    conflicts: n.mergeable === "CONFLICTING",
    failing, pending, said, unresolved: threads.filter((t) => !t.isResolved && lines(t).length).length, earlier: everything.length - said.length,
    heard: [...everything].sort((a, b) => a.when.localeCompare(b.when)).slice(-HEARD).map((s) => ({ ...s, text: clipSaid(s.text, HEARD_CHARS) })), rounds, mark,
  };
}

// ---------- The camp's copy ----------
const none = (): Pulls => ({ fetched: "", login: "", pulls: [] });
export function pulls(): Pulls {
  const p = readJsonFile(PULLS_PATH, none()) as Pulls;
  return p && Array.isArray(p.pulls) ? p : none();
}

// Read them again now. A failed read keeps what was known and says why.
let reading: Promise<Pulls> | null = null;
export function checkPulls(fetcher: Fetcher = ghFetcher, now = new Date()): Promise<Pulls> {
  return (reading ??= (async () => {
    const before = pulls();
    try {
      const repos = await linkedRepositories();
      if (!repos.size) return savePulls({ fetched: now.toISOString(), login: before.login, pulls: [] }, before);
      const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      const data = await fetcher(QUERY, `is:pr author:@me ${[...repos.keys()].map((r) => `repo:${r}`).join(" ")} updated:>=${since} sort:updated-desc`);
      if (data?.errors?.length && !data?.data?.search) throw new Error(String(data.errors[0]?.message ?? "GitHub refused the request.").slice(0, 300));
      const me = String(data?.data?.viewer?.login ?? "");
      const list = ((data?.data?.search?.nodes ?? []) as any[]).filter((n) => n?.url && repos.has(String(n.repository?.nameWithOwner ?? "").toLowerCase()))
        .map((n) => readPull(n, me, repos.get(n.repository.nameWithOwner.toLowerCase())!));
      return savePulls({ fetched: now.toISOString(), login: me, pulls: list }, before);
    } catch (e: any) {
      return savePulls({ ...before, error: String(e?.message ?? e).slice(0, 300) }, before);
    }
  })().finally(() => { reading = null; }));
}
function savePulls(next: Pulls, before: Pulls): Pulls {
  const same = (p: Pulls) => JSON.stringify({ ...p, fetched: "" });
  writeJsonAtomic(PULLS_PATH, next);
  if (same(next) !== same(before)) emit({ type: "changed", what: "prs" });
  return next;
}
// What's known, read again first if it's older than `maxAgeMs`.
export async function freshPulls(maxAgeMs: number, fetcher: Fetcher = ghFetcher): Promise<Pulls> {
  const p = pulls();
  return p.fetched && Date.now() - new Date(p.fetched).getTime() < maxAgeMs ? p : checkPulls(fetcher);
}

// ---------- What stands where ----------
// Something on it is waiting for you.
export const waitsOnYou = (p: Pull) => p.state === "OPEN" && (!!p.mark || p.conflicts || p.review === "changes");
// It could be merged as it stands: approved, nothing failing or running, nothing open.
export const readyToMerge = (p: Pull) => p.state === "OPEN" && !p.draft && p.review === "approved" && !p.conflicts && !p.failing.length && !p.pending && !p.unresolved;
// Where it stands, in a few words.
export function pullSays(p: Pull): string {
  if (p.state !== "OPEN") return p.state.toLowerCase();
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  // Said on the pull request itself since your last push (a bare "changes requested" is already said above).
  const since = p.said.filter((s) => s.kind === "comment" || (s.kind === "review" && s.text !== NO_SUMMARY)).length;
  const bits = [
    p.conflicts ? "conflicts with its base" : "",
    p.failing.length ? n(p.failing.length, "failing check") : "",
    p.review === "changes" ? "changes requested" : "",
    p.unresolved ? n(p.unresolved, "open comment thread") : "",
    since ? n(since, "new comment") : "",
    !p.failing.length && p.pending ? "checks running" : "",
  ].filter(Boolean);
  if (bits.length) return bits.join(", ");
  return readyToMerge(p) ? "approved, ready to merge" : p.draft ? "a draft" : p.review === "approved" ? "approved" : "waiting for review";
}

// What's waiting on a pull request, written out for whoever will deal with it. Other people
// wrote every word of it: whoever reads it is told so where it's used (triggers.ts).
export function feedbackText(p: Pull): string {
  const parts: string[] = [];
  if (p.failing.length) parts.push("Failing checks on the latest commit:\n" + p.failing.map((c) => `- ${c}`).join("\n"));
  const of = (kind: Said["kind"]) => p.said.filter((s) => s.kind === kind);
  if (of("line").length) parts.push("Comments on lines, in threads nobody has resolved:\n" + of("line").map((s) => `- ${s.where} — ${s.who}: ${s.text}`).join("\n"));
  if (of("review").length) parts.push("Reviews since the last push:\n" + of("review").map((s) => `- ${s.who}${s.where ? ` (${s.where})` : ""}: ${s.text}`).join("\n"));
  if (of("comment").length) parts.push("Comments on the pull request since the last push:\n" + of("comment").map((s) => `- ${s.who}: ${s.text}`).join("\n"));
  if (p.conflicts) parts.push("It also conflicts with its base branch.");
  if (p.earlier) parts.push(`(${p.earlier} earlier ${p.earlier === 1 ? "comment isn't" : "comments aren't"} repeated here: they were made before the last push, in threads since resolved or already answered.)`);
  return parts.join("\n\n");
}

// The conversation that worked on a pull request, if there is one: it mentions the pull
// request's address, or it's working on the ticket the branch or title is named for. The latest
// one wins. expedition: its last run (what a follow-up replies to).
export function conversationOf(p: Pick<Pull, "url" | "branch" | "title">, turns: Turn[] = allTurns()): { thread: string; expedition: string } | undefined {
  const known = new Set(history().conversations.map((c) => c.id));
  const address = new RegExp(`${p.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`);
  const names = `${p.branch} ${p.title}`.toLowerCase();
  let hit: Turn | undefined;
  for (const t of turns) {
    if (!known.has(t.thread)) continue;
    if (address.test(t.task) || address.test(t.reply) || (t.jira && new RegExp(`(^|[^a-z0-9])${t.jira.toLowerCase()}(?![0-9])`).test(names))) hit = t;
  }
  if (!hit) return undefined;
  const mine = turns.filter((t) => t.thread === hit!.thread);
  const last = [...mine].reverse().find((t) => !t.aside) ?? mine[mine.length - 1];
  return { thread: hit.thread, expedition: last.expedition };
}
