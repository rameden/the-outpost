// Git for linked folders: which linked folders are repositories, the worktrees they already have,
// starting an expedition in its own worktree and branch, and (when you ask) committing that
// branch or opening a pull request for it.
//
// Nothing here runs on an agent's say-so. Worktrees are chosen by you when you send a request;
// commit, push, and pull requests happen only from your own buttons or commands.

import { execFile } from "node:child_process";
import { samePath } from "./platform.js";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { findLink, loadLinks, type Link } from "./links.js";
import type { Workspace } from "./context.js";
import { checkFailed, gh } from "./github.js";
import { w } from "./words.js";

const run = promisify(execFile);
export async function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  const { stdout } = await run("git", args, { cwd, timeout, maxBuffer: 20_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return stdout.trim();
}
export const tryGit = (cwd: string, args: string[]) => git(cwd, args).catch(() => "");
export const fail = (e: any) => new Error(String(e?.stderr || e?.message || e).trim().split("\n").slice(-3).join(" "));

export type Worktree = { path: string; branch: string; head: string; main: boolean };
// branches: the repository's local branches, the most recently committed-to first.
export type RepoInfo = { link: string; access: Link["access"]; branch: string; worktrees: Worktree[]; branches: string[] };
const MAX_BRANCHES = 40;

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  const out = await tryGit(repo, ["worktree", "list", "--porcelain"]);
  const list: Worktree[] = [];
  for (const block of out.split("\n\n")) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path || /^(bare|prunable)/m.test(block)) continue;
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "(detached)";
    list.push({ path: resolve(path), branch, head: (block.match(/^HEAD (\w+)$/m)?.[1] ?? "").slice(0, 10), main: list.length === 0 });
  }
  return list;
}

// Every linked folder that is a git repository, with its worktrees (the linked checkout first).
export async function linkedRepos(): Promise<RepoInfo[]> {
  const out: RepoInfo[] = [];
  for (const l of loadLinks()) {
    if (!existsSync(l.path)) continue;
    const top = await tryGit(l.path, ["rev-parse", "--show-toplevel"]);
    if (!top || !samePath(top, l.path)) continue; // only when the link is the repo itself
    const worktrees = await listWorktrees(l.path);
    const here = worktrees.find((w) => samePath(w.path, l.path));
    const branches = (await tryGit(l.path, ["for-each-ref", "--sort=-committerdate", `--count=${MAX_BRANCHES}`, "--format=%(refname:short)", "refs/heads"])).split("\n").filter(Boolean);
    out.push({ link: l.name, access: l.access, branch: here?.branch ?? "(detached)", worktrees: worktrees.filter((w) => !samePath(w.path, l.path)), branches });
  }
  return out;
}

export const slugify = (s: string, max = 40) =>
  s.toLowerCase().replace(/^@\w+\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "work";

// What you picked for one linked repo when sending a request.
export type WorkspaceChoice = { mode: "new"; branch?: string } | { mode: "existing"; path: string };

// Turn your choices into workspaces: create a new worktree and branch, or check that the one you
// picked really is a worktree of that repo. New worktrees sit beside the repo, in
// <repo>-camp/<branch>, on a branch named camp/<task>, starting from the repo's current commit.
export async function prepareWorkspaces(choices: Record<string, WorkspaceChoice> | undefined, task: string, id: string): Promise<Record<string, Workspace>> {
  const out: Record<string, Workspace> = {};
  for (const [name, choice] of Object.entries(choices ?? {})) {
    const link = findLink(name);
    if (!link) throw new Error(`No linked folder named "${name}".`);
    const worktrees = await listWorktrees(link.path);
    if (!worktrees.length) throw new Error(`links/${name} isn't a git repository, so it can't have a worktree.`);
    if (choice.mode === "existing") {
      const w = worktrees.find((x) => samePath(x.path, String(choice.path)));
      if (!w) throw new Error(`${choice.path} isn't a worktree of links/${name}.`);
      if (samePath(w.path, link.path)) continue; // the linked checkout itself: nothing to redirect
      out[name] = { link: name, path: w.path, branch: w.branch, base: await tryGit(w.path, ["rev-parse", "HEAD"]) };
      continue;
    }
    if (link.access !== "write") throw new Error(`links/${name} is linked read-only, so the ${w("crew")} couldn't change a new worktree. Re-link it with edit access.`);
    const wanted = (choice.branch ?? "").trim().replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/^[-/.]+|[-/.]+$/g, "");
    let branch = wanted || `camp/${slugify(task)}-${id.slice(0, 4)}`;
    const taken = new Set((await tryGit(link.path, ["branch", "--format=%(refname:short)"])).split("\n"));
    for (let i = 2; taken.has(branch); i++) branch = `${wanted || `camp/${slugify(task)}-${id.slice(0, 4)}`}-${i}`;
    const dir = join(dirname(link.path), `${basename(link.path)}-camp`, branch.replace(/\//g, "-"));
    if (existsSync(dir)) throw new Error(`${dir} already exists.`);
    mkdirSync(dirname(dir), { recursive: true });
    const base = await tryGit(link.path, ["rev-parse", "HEAD"]);
    try { await git(link.path, ["worktree", "add", "-b", branch, dir, "HEAD"], 180_000); } catch (e) { throw fail(e); }
    out[name] = { link: name, path: dir, branch, base, created: true };
  }
  return out;
}

// ahead: commits on the branch that aren't on its upstream yet (0 when it has no upstream: it was never pushed).
export type WorkspaceStatus = Workspace & { changed: number; commits: number; exists: boolean; ahead: number };

// Where a workspace stands: uncommitted files, and commits made since the expedition started.
export async function workspaceStatus(w: Workspace): Promise<WorkspaceStatus> {
  if (!existsSync(w.path)) return { ...w, changed: 0, commits: 0, exists: false, ahead: 0 };
  const dirty = await tryGit(w.path, ["status", "--porcelain"]);
  const commits = w.base ? Number(await tryGit(w.path, ["rev-list", "--count", `${w.base}..HEAD`])) || 0 : 0;
  const branch = (await tryGit(w.path, ["rev-parse", "--abbrev-ref", "HEAD"])) || w.branch;
  const ahead = Number(await tryGit(w.path, ["rev-list", "--count", "@{u}..HEAD"])) || 0;
  return { ...w, branch, changed: dirty ? dirty.split("\n").length : 0, commits, exists: true, ahead };
}

// A workspace must be a real worktree of a linked repo before anything below touches it.
export async function checked(w: Pick<Workspace, "link" | "path">): Promise<string> {
  const link = findLink(w.link);
  if (!link) throw new Error(`No linked folder named "${w.link}".`);
  const hit = (await listWorktrees(link.path)).find((x) => samePath(x.path, w.path));
  if (!hit) throw new Error(`${w.path} isn't a worktree of links/${w.link}.`);
  return hit.path;
}

// Commit everything in the workspace (your own git hooks run as usual).
export async function commitWorkspace(w: Pick<Workspace, "link" | "path">, message: string): Promise<string> {
  const dir = await checked(w);
  if (!message.trim()) throw new Error("A commit needs a message.");
  try {
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-m", message.trim()], 300_000);
    return await git(dir, ["log", "-1", "--format=%h %s"]);
  } catch (e) { throw fail(e); }
}

// Push new commits to where the branch already goes (its upstream): what you do after
// answering a pull request's feedback. A branch that was never pushed has nowhere to go yet;
// opening its pull request is what pushes it the first time.
export async function pushWorkspace(w: Pick<Workspace, "link" | "path">): Promise<string> {
  const dir = await checked(w);
  const upstream = await tryGit(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) throw new Error("This branch hasn't been pushed before. Open its pull request first: that pushes it.");
  try { await git(dir, ["push"], 300_000); } catch (e) { throw fail(e); }
  return `${await git(dir, ["log", "-1", "--format=%h"])} to ${upstream}`;
}

// Push the branch and open a pull request with the GitHub CLI. Returns the PR's address.
export async function openPullRequest(w: Pick<Workspace, "link" | "path">, title: string, body: string): Promise<string> {
  const dir = await checked(w);
  const branch = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (await tryGit(dir, ["status", "--porcelain"])) throw new Error("There are uncommitted changes. Commit them first.");
  try {
    await git(dir, ["push", "-u", "origin", branch], 300_000);
    const stdout = await gh(["pr", "create", "--head", branch, "--title", title.trim() || branch, "--body", body], { cwd: dir, timeout: 120_000 });
    return stdout.trim().split("\n").pop() ?? "";
  } catch (e: any) {
    if (e?.code === "ENOENT") throw new Error("Pushed the branch, but the GitHub CLI (gh) isn't installed, so open the pull request yourself.");
    throw fail(e);
  }
}

// Remove a worktree the camp made. Git refuses if it has uncommitted changes; that's left alone.
// Your own checkout of a linked repository, switched to another branch, or to a new one made
// from where it stands. This is `git switch`, so it never throws work away: git refuses if
// uncommitted changes would be overwritten (and says which files), or if the branch is checked
// out in a worktree. Only ever done when you ask from the page; no agent has a tool for it.
export async function switchBranch(linkName: string, name: string, create: boolean): Promise<string> {
  const link = findLink(linkName);
  if (!link) throw new Error(`No linked folder named "${linkName}".`);
  const top = await tryGit(link.path, ["rev-parse", "--show-toplevel"]);
  if (!top || !samePath(top, link.path)) throw new Error(`links/${linkName} isn't a git repository of its own.`);
  const branch = name.trim();
  if (!branch || branch.startsWith("-")) throw new Error("Give the branch a name.");
  try { await git(link.path, ["check-ref-format", "--branch", branch]); }
  catch { throw new Error(`"${branch}" isn't a name git allows for a branch (no spaces, "..", or ~ ^ : ? * [ \\).`); }
  try { await git(link.path, create ? ["switch", "-c", branch] : ["switch", branch], 60_000); }
  catch (e) { throw fail(e); }
  return branch;
}

// What reviewers and the checks have said on the pull request for a worktree's branch: failing
// checks, reviews, comments on lines, and comments on the pull request. Returned as text for you
// to read and send on; none of it is acted on by itself, since anyone who can comment on the
// pull request wrote it.
export type PrFeedback = { url: string; number: number; title: string; failing: number; comments: number; text: string };
export async function pullRequestFeedback(w: Pick<Workspace, "link" | "path">): Promise<PrFeedback> {
  const dir = await checked(w);
  const read = async (args: string[]) => {
    try { return await gh(args, { cwd: dir }); }
    catch (e: any) {
      if (e?.code === "ENOENT") throw new Error("The GitHub CLI (gh) isn't installed, so the pull request can't be read from here.");
      throw fail(e);
    }
  };
  let pr: any;
  try { pr = JSON.parse(await read(["pr", "view", "--json", "number,url,title,reviews,comments,statusCheckRollup"])); }
  catch (e: any) { throw new Error(/no pull requests? found/i.test(e.message) ? "There's no pull request for this branch yet." : e.message); }
  let inline: any[] = [];
  try { inline = JSON.parse(await read(["api", `repos/{owner}/{repo}/pulls/${pr.number}/comments`, "--paginate"])); } catch { /* reviews and checks still say a lot */ }
  const clip = (s: unknown, n = 1500) => { const t = String(s ?? "").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const failing = (pr.statusCheckRollup ?? []).filter(checkFailed);
  const reviews = (pr.reviews ?? []).filter((r: any) => String(r.body ?? "").trim() || r.state === "CHANGES_REQUESTED");
  const general = (pr.comments ?? []).filter((c: any) => String(c.body ?? "").trim());
  const parts: string[] = [];
  if (failing.length) parts.push("Failing checks:\n" + failing.map((c: any) => `- ${c.name ?? c.context ?? "check"} (${String(c.conclusion ?? c.state).toLowerCase()})${c.detailsUrl || c.targetUrl ? ` ${c.detailsUrl ?? c.targetUrl}` : ""}`).join("\n"));
  if (reviews.length) parts.push("Reviews:\n" + reviews.map((r: any) => `- ${r.author?.login ?? "someone"} (${String(r.state ?? "").toLowerCase().replace(/_/g, " ")}): ${clip(r.body) || "(no comment)"}`).join("\n"));
  if (inline.length) parts.push("Comments on lines:\n" + inline.map((c: any) => `- ${c.path}${c.line ?? c.original_line ? `:${c.line ?? c.original_line}` : ""} — ${c.user?.login ?? "someone"}: ${clip(c.body)}`).join("\n"));
  if (general.length) parts.push("Comments on the pull request:\n" + general.map((c: any) => `- ${c.author?.login ?? "someone"}: ${clip(c.body)}`).join("\n"));
  return { url: pr.url, number: pr.number, title: pr.title, failing: failing.length, comments: reviews.length + inline.length + general.length, text: parts.join("\n\n") };
}

export async function removeWorkspace(w: Pick<Workspace, "link" | "path">): Promise<void> {
  const dir = await checked(w);
  const link = findLink(w.link)!;
  if (samePath(dir, link.path)) throw new Error("That's the linked folder itself, not a worktree.");
  try { await git(link.path, ["worktree", "remove", dir]); } catch (e) { throw fail(e); }
}
