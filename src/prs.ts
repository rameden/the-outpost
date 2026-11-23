// Pull requests for the worktrees the crew worked in.
//
// Two things. A description worth reading, drafted from the record (the ticket and its
// acceptance criteria, what changed, the commits, how your checks came out, what the crew
// reported, and what you changed by hand after the crew finished: handedits.ts) for you to edit
// before anything is pushed. And a watch: now and then the camp looks
// at the pull requests of recent worktrees (with the GitHub CLI, as you) and keeps where each
// stands: failing checks, review comments, conflicts with its base. The page shows that on the
// conversation, and brings the feedback into a reply when you ask. Nothing here answers a
// review, pushes, or merges by itself, and nothing an agent says can trigger any of it.

import { existsSync } from "node:fs";
import type { Workspace } from "./context.js";
import { history, titleOf } from "./conversations.js";
import { emit } from "./events.js";
import { jiraConnected, ticketDetail } from "./jira.js";
import { pullMerged } from "./jiramoments.js";
import { advanceTicket } from "./tickets.js";
import { handEdits, handEditsSection, notesAfterEdits } from "./handedits.js";
import type { askSmall } from "./small.js";
import { checked, fail, tryGit } from "./repos.js";
import { prWatchOn } from "./settings.js";
import { allTurns, shortened } from "./threads.js";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { clip } from "./helpers.js";
import { checkFailed, checkPending, gh as runGh } from "./github.js";

type Where = Pick<Workspace, "link" | "path">;

async function gh(dir: string, args: string[]): Promise<string> {
  try { return await runGh(args, { cwd: dir }); }
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
  parts.push("## Checks\n" + (checks.length ? checks.map((c) => `- ${c[0] === "✓" ? "Passed" : "FAILED"}: \`${c.slice(2)}\``).join("\n") + "\n\n(Run by the camp after the last change.)"
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
    const pr = JSON.parse(await gh(dir, ["pr", "view", "--json", "number,url,state"]));
    if (pr?.state === "OPEN") existing = { number: pr.number, url: pr.url };
  } catch { /* no pull request yet, or no gh: it's a new one */ }
  return { title, body: parts.join("\n\n") + "\n", branch, existing, ...(byHand.files.length ? { handEdits: { files: byHand.files.length, rewritten } } : {}) };
}

// Change the title and description of the pull request this branch already has.
export async function updatePullRequest(w: Where, title: string, body: string): Promise<string> {
  const dir = await checked(w);
  const out = await gh(dir, ["pr", "edit", "--title", title.trim() || "Untitled", "--body", body]);
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

function load(): Record<string, PrState> {
  return (readJsonFile(PRWATCH_PATH, {}) as { prs?: Record<string, PrState> } | null)?.prs ?? {};
}
function save(prs: Record<string, PrState>) {
  writeJsonAtomic(PRWATCH_PATH, { prs });
}
export const prStates = (): PrState[] => Object.values(load());

// One worktree's pull request as it stands now, or null if its branch has none.
async function look(w: { conversation: string; link: string; path: string }, before?: PrState): Promise<PrState | null> {
  if (!existsSync(w.path)) return null;
  // A branch that was never pushed can't have a pull request: don't ask GitHub about it.
  if (!(await tryGit(w.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]))) return null;
  let pr: any;
  try { pr = JSON.parse(await gh(w.path, ["pr", "view", "--json", "number,url,title,state,mergeable,reviewDecision,statusCheckRollup,comments,reviews,headRefName"])); }
  catch { return before ?? null; } // no pull request, or GitHub couldn't be reached: keep what was known
  const rollup: any[] = pr.statusCheckRollup ?? [];
  return {
    conversation: w.conversation, link: w.link, path: w.path, branch: String(pr.headRefName ?? before?.branch ?? ""),
    number: pr.number, url: pr.url, title: String(pr.title ?? ""), state: pr.state === "MERGED" ? "MERGED" : pr.state === "CLOSED" ? "CLOSED" : "OPEN",
    failing: rollup.filter(checkFailed).length,
    pending: rollup.filter(checkPending).length,
    comments: (pr.comments ?? []).filter((c: any) => String(c.body ?? "").trim()).length + (pr.reviews ?? []).filter((r: any) => String(r.body ?? "").trim() || r.state === "CHANGES_REQUESTED").length,
    review: pr.reviewDecision === "APPROVED" ? "approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? "changes" : null,
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
    const before = load();
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
          // A Mae ticket's work merged: it's done.
          if (c.ticket && advanceTicket(c.ticket, "done")) emit({ type: "notice", who: "Tickets", emoji: "🎫", depth: 0, text: `${c.ticket} is done: its pull request was merged.` });
        }
      }
    }
    const same = (p: PrState) => JSON.stringify({ ...p, checked: "", firstSeen: "" });
    const changed = Object.keys(next).length !== Object.keys(before).length || Object.values(next).some((p) => !before[p.path] || same(p) !== same(before[p.path]));
    if (changed) { save(next); emit({ type: "changed", what: "prs" }); }
    return Object.values(changed ? next : before);
  } finally { looking = false; }
}

// You've brought this pull request's feedback into a reply: it stops asking for attention until there's more.
export function markSeen(path: string): boolean {
  const prs = load();
  const p = prs[path];
  if (!p) return false;
  prs[path] = { ...p, seen: { failing: p.failing, comments: p.comments } };
  save(prs);
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
