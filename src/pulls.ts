// Your pull requests in the repositories you've linked, wherever their branches were made.
//
// The watch in prs.ts follows the worktrees the camp made. This follows you: every pull request
// you opened in a linked repository over the last few weeks, whether its branch lives in a camp
// worktree or in your own checkout. One read (with the GitHub CLI, as you) brings back where each
// stands: what other people have said and which of it is still open, failing checks, conflicts,
// and how many rounds of review it has been through.
//
// It's what the rest of the camp's own initiative is built on: the pull-request trigger starts
// work when one gets new feedback (triggers.ts), the morning brief lists them (brief.ts), the
// retro reads what reviewers caught (retro.ts), and the scoreboard counts rounds and days
// (scoreboard.ts). Nothing here writes to GitHub.
//
// What you said yourself is left out, and so is anything a bot said: the crew answers reviews
// under your name, so counting your own comments as news would have it answering itself.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { history } from "./conversations.js";
import { emit } from "./events.js";
import { loadLinks } from "./links.js";
import { tryGit } from "./repos.js";
import { allTurns, type Turn } from "./threads.js";

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

// The GraphQL call itself (swapped out in tests). CAMP_GH points at another gh.
export type Fetcher = (query: string, search: string) => Promise<any>;
const run = promisify(execFile);
export const ghFetcher: Fetcher = async (query, search) => {
  try {
    const { stdout } = await run(process.env.CAMP_GH || "gh", ["api", "graphql", "-f", `query=${query}`, "-f", `q=${search}`],
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } });
    return JSON.parse(stdout);
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
const clip = (s: unknown, n = SAID_CHARS) => { const t = String(s ?? "").replace(/\r\n/g, "\n").trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };
const BAD = /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/;

// One pull request as GitHub describes it, read into what the camp keeps. me: your login.
export function readPull(n: any, me: string, link: string): Pull {
  const other = (a: any) => !!a?.login && a.__typename !== "Bot" && a.login.toLowerCase() !== me.toLowerCase();
  const commits: string[] = (n.commits?.nodes ?? []).map((c: any) => String(c.commit?.committedDate ?? "")).filter(Boolean).sort();
  const pushed = commits[commits.length - 1] ?? "";
  const checks: any[] = n.commits?.nodes?.at(-1)?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const pending = checks.filter((c) => (c.__typename === "CheckRun" ? c.status !== "COMPLETED" : /^(PENDING|EXPECTED)$/.test(String(c.state)))).length;
  const failed = checks.filter((c) => BAD.test(String(c.conclusion ?? c.state ?? ""))).map((c) => String(c.name ?? c.context ?? "check"));

  const threads: any[] = n.reviewThreads?.nodes ?? [];
  const lines = (t: any): Said[] => (t.comments?.nodes ?? []).filter((c: any) => other(c.author))
    .map((c: any) => ({ who: c.author.login, when: c.createdAt, kind: "line" as const, where: `${t.path}${t.line ? `:${t.line}` : ""}`, text: clip(c.body) }));
  const reviews: Said[] = (n.reviews?.nodes ?? []).filter((r: any) => other(r.author) && (String(r.body ?? "").trim() || r.state === "CHANGES_REQUESTED"))
    .map((r: any) => ({ who: r.author.login, when: r.submittedAt, kind: "review" as const, ...(r.state === "CHANGES_REQUESTED" ? { where: "changes requested" } : {}), text: clip(r.body) || NO_SUMMARY }));
  const comments: Said[] = (n.comments?.nodes ?? []).filter((c: any) => other(c.author) && String(c.body ?? "").trim())
    .map((c: any) => ({ who: c.author.login, when: c.createdAt, kind: "comment" as const, text: clip(c.body) }));

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
    review: n.reviewDecision === "APPROVED" ? "approved" : n.reviewDecision === "CHANGES_REQUESTED" ? "changes" : null,
    conflicts: n.mergeable === "CONFLICTING",
    failing, pending, said, unresolved: threads.filter((t) => !t.isResolved && lines(t).length).length, earlier: everything.length - said.length,
    heard: [...everything].sort((a, b) => a.when.localeCompare(b.when)).slice(-HEARD).map((s) => ({ ...s, text: clip(s.text, HEARD_CHARS) })), rounds, mark,
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
      if (!repos.size) return save({ fetched: now.toISOString(), login: before.login, pulls: [] }, before);
      const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      const data = await fetcher(QUERY, `is:pr author:@me ${[...repos.keys()].map((r) => `repo:${r}`).join(" ")} updated:>=${since} sort:updated-desc`);
      if (data?.errors?.length && !data?.data?.search) throw new Error(String(data.errors[0]?.message ?? "GitHub refused the request.").slice(0, 300));
      const me = String(data?.data?.viewer?.login ?? "");
      const list = ((data?.data?.search?.nodes ?? []) as any[]).filter((n) => n?.url && repos.has(String(n.repository?.nameWithOwner ?? "").toLowerCase()))
        .map((n) => readPull(n, me, repos.get(n.repository.nameWithOwner.toLowerCase())!));
      return save({ fetched: now.toISOString(), login: me, pulls: list }, before);
    } catch (e: any) {
      return save({ ...before, error: String(e?.message ?? e).slice(0, 300) }, before);
    }
  })().finally(() => { reading = null; }));
}
function save(next: Pulls, before: Pulls): Pulls {
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
