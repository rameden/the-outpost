// A worktree per writing quest.
//
// One writer at a time in a linked folder (folderlock.ts) is safe, and slow: two quests that
// change code in the same repository run one after the other. So when two or more writing quests
// want the same git folder at once, each gets its own worktree of it, on its own branch
// (outpost/quest-<id>), and they work side by side. A quest alone in a folder works in it as it
// always did, and a folder that isn't a git repository keeps the lock.
//
// Cut: the worktree starts from the folder as it is at that moment (HEAD plus what isn't
// committed yet, as a commit of the camp's own on top of HEAD), so work an earlier step left
// uncommitted is there.
//
// Back: everything in the worktree is committed to the quest's branch, and that commit is kept on
// a private ref (refs/outpost/quests/<id>) whatever happens next, so nothing a quest did is lost.
// Then, when the quest finished and its checks didn't fail, its changes are merged into the
// folder as it is by then (a three-way merge against what the worktree was cut from) and arrive
// there as uncommitted changes, exactly as if the quest had worked in the folder. A merge that
// conflicts, a failed check, a stopped or failed quest: nothing lands, and the branch stays for
// you to merge. The worktree is removed either way, unless it still holds files no commit could
// take (secret files a quest made), in which case it is left where it is and you're told.

import { execFile } from "node:child_process";
import { existsSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { campGitEnv, SECRETS_OUT, workingTree } from "./checkpoints.js";
import { lockFolders } from "./folderlock.js";
import { OUTPOST } from "./outpost.js";

const TREES_SUFFIX = "-outpost-quests";
export const questBranch = (id: string) => `outpost/quest-${id.slice(0, 8)}`;
export const questRef = (id: string) => `refs/outpost/quests/${id}`;

type Ran = { ok: boolean; code: number; out: string; err: string };
const git = (cwd: string, args: string[]) => new Promise<Ran>((done) => {
  execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 200_000_000, env: campGitEnv() }, (error, stdout, stderr) => {
    const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
    done({ ok: !error, code, out: String(stdout ?? "").trim(), err: String(stderr ?? "").trim() || (error?.message ?? "") });
  });
});
const must = async (cwd: string, args: string[]): Promise<string> => {
  const r = await git(cwd, args);
  if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.err.split("\n")[0]}`);
  return r.out;
};
const real = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } };

// Whether a folder is the top of a git working tree with at least one commit: the only kind a
// worktree can be cut from. (A folder inside a repository, or a repository with no commit yet,
// keeps the folder lock.)
export async function isGitTop(root: string): Promise<boolean> {
  if (!existsSync(root)) return false;
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || real(top.out) !== real(root)) return false;
  return (await git(root, ["rev-parse", "--verify", "-q", "HEAD^{commit}"])).ok;
}

// ---------- Who wants a folder ----------
// Every writing quest says which folders it wants before it decides how to work in them, and
// quests sent in one turn all say so before any of them decides (see settle()). A folder wanted by
// more than one is worked in from worktrees; a quest alone in a folder, or one that arrives while
// another is working in the folder itself, works in the folder under its lock.
type Mode = "undecided" | "tree" | "place";
const wanting = new Map<string, Map<symbol, Mode>>();
export type Want = { decide: (canTree: (key: string) => boolean) => Map<string, "tree" | "place">; leave: () => void };
export function wantFolders(keys: string[]): Want {
  const me = Symbol("quest");
  const mine = [...new Set(keys)];
  for (const k of mine) (wanting.get(k) ?? wanting.set(k, new Map()).get(k)!).set(me, "undecided");
  return {
    // One step, nothing awaited: two quests deciding one after the other see each other's choice.
    decide: (canTree) => {
      const out = new Map<string, "tree" | "place">();
      for (const k of mine) {
        const others = [...(wanting.get(k) ?? [])].filter(([who]) => who !== me).map(([, mode]) => mode);
        const mode = canTree(k) && others.length > 0 && !others.includes("place") ? "tree" : "place";
        wanting.get(k)?.set(me, mode);
        out.set(k, mode);
      }
      return out;
    },
    leave: () => {
      for (const k of mine) {
        const at = wanting.get(k);
        at?.delete(me);
        if (at && !at.size) wanting.delete(k);
      }
    },
  };
}
// Long enough for every quest sent in the same turn to have said what it wants (they start within
// a few milliseconds of each other; through Claude Code, a little more), short beside a quest.
export const settle = () => new Promise<void>((ok) => setTimeout(ok, Number(process.env.OUTPOST_QUEST_SETTLE_MS ?? 120)));
export const questTreesForTests = { wanting: () => [...wanting].map(([key, at]) => ({ key, modes: [...at.values()] })) };

// ---------- Cut ----------
// link: the linked folder's name. root: the folder the quest would have worked in (the top of a
// git working tree). path, branch: its own worktree. base: the commit it was cut from.
// lockKey: what stands for the folder in the folder lock (the folder itself, or a quest's own hold on it).
export type QuestTree = { id: string; link: string; root: string; lockKey: string; path: string; branch: string; base: string };

// Beside the repository itself (never inside it, and not in <repo>-camp/, whose clean worktrees
// housekeeping offers to remove): <repo>-outpost-quests/<id>. A folder that is already a worktree
// (a conversation's own, or a sender's when a helper is cut from it) is traced back to its repository.
async function treePath(root: string, id: string): Promise<string> {
  const common = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repo = common.ok && basename(common.out) === ".git" ? dirname(common.out) : root;
  return join(dirname(repo), basename(repo) + TREES_SUFFIX, id.slice(0, 8));
}

// The folder as it is now, as a commit on top of `parent` (or `parent` itself when nothing differs).
async function commitOfFolder(root: string, parent: string, what: string): Promise<string> {
  const tree = await workingTree(root);
  if (tree === (await must(root, ["rev-parse", `${parent}^{tree}`]))) return parent;
  return must(root, ["commit-tree", tree, "-p", parent, "-m", `${OUTPOST.name}: ${what} (not a branch; safe to delete)`]);
}

// A worktree of `root` for one quest, cut from the folder as it is now. The folder is held while
// it's cut, so what it starts from is never half of someone's change. null: stopped while waiting.
export async function cutQuestTree(want: { id: string; link: string; root: string; lockKey: string; who: string }, signal?: AbortSignal): Promise<QuestTree | null> {
  const free = await lockFolders([want.lockKey], want.who, signal);
  if (!free) return null;
  try {
    const head = await must(want.root, ["rev-parse", "HEAD"]);
    const base = await commitOfFolder(want.root, head, "the folder as a worktree was cut from it");
    const path = await treePath(want.root, want.id), branch = questBranch(want.id);
    await must(want.root, ["worktree", "add", "-q", "-b", branch, path, base]);
    return { id: want.id, link: want.link, root: want.root, lockKey: want.lockKey, path: real(path), branch, base };
  } finally {
    free();
  }
}

// ---------- Back ----------
export type TreeEnd = { link: string; branch: string; state: "merged" | "kept" | "unchanged"; reason?: string;
  files: string[];      // what landed in the folder (paths inside it), when merged
  base: string;         // what the worktree was cut from
  final?: string;       // the quest's work as a commit (also on its private ref)
  left?: string };      // the worktree, when it couldn't be removed without losing something

// Everything in the worktree, committed to whatever it has checked out. Returns that commit.
async function commitAll(tree: QuestTree, who: string): Promise<string> {
  await must(tree.path, ["add", "-A", "--", ".", ...SECRETS_OUT]);
  if ((await git(tree.path, ["diff", "--cached", "--quiet"])).code === 1) {
    await must(tree.path, ["commit", "-q", "--no-verify", "--no-gpg-sign", "-m", `${who}'s work (${OUTPOST.name})`]);
  }
  return must(tree.path, ["rev-parse", "HEAD"]);
}

// The quest's changes, merged into the folder as it is now and left there uncommitted. Returns the
// files that changed, or why nothing was done (the folder is untouched then).
async function land(tree: QuestTree, final: string, beforeLanding?: () => Promise<void>): Promise<{ files: string[] } | { conflict: string }> {
  const { root } = tree;
  const now = await commitOfFolder(root, tree.base, "the folder as changes came back to it");
  let merged = final;
  if (now !== tree.base) {
    // Both moved since the cut: a three-way merge, worked out as a tree (nothing is checked out or staged).
    const m = await git(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", now, final]);
    if (m.code === 1) return { conflict: `it changed the same lines as work that got there first (${m.out.split("\n").slice(1).filter(Boolean).slice(0, 5).join(", ")})` };
    if (!m.ok) return { conflict: `git couldn't merge it (${m.err.split("\n")[0]})` };
    merged = m.out.split("\n")[0];
  }
  const names = (await must(root, ["diff", "--name-only", "--no-renames", "-z", now, merged])).split("\0").filter(Boolean);
  if (!names.length) return { files: [] };
  const patch = await must(root, ["diff", "--binary", "--no-renames", "--full-index", now, merged]);
  const file = join(tmpdir(), `outpost-tree-${randomUUID()}.patch`);
  try {
    writeFileSync(file, patch + "\n");
    const check = await git(root, ["apply", "--check", "--whitespace=nowarn", file]);
    if (!check.ok) return { conflict: `the folder changed while it was being brought back (${check.err.split("\n")[0]})` };
    await beforeLanding?.(); // the run's Diff and Undo cover what lands (a snapshot of the folder, taken once)
    const done = await git(root, ["apply", "--whitespace=nowarn", file]);
    if (!done.ok) return { conflict: `git couldn't apply it (${done.err.split("\n")[0]})` };
  } finally {
    rmSync(file, { force: true });
  }
  return { files: names };
}

// A quest is back from its worktree. bring: why its changes should stay on the branch (a failed
// check, a stopped quest), or nothing to merge them into the folder. beforeLanding runs just
// before the folder is changed, and only if it will be.
export async function closeQuestTree(tree: QuestTree, who: string, opts: { keep?: string; beforeLanding?: () => Promise<void>; signal?: AbortSignal } = {}): Promise<TreeEnd> {
  const end = (state: TreeEnd["state"], more: Partial<TreeEnd> = {}): TreeEnd => ({ link: tree.link, branch: tree.branch, state, files: [], base: tree.base, ...more });
  if (!existsSync(tree.path)) return end("kept", { reason: "its worktree was removed while it worked" });
  let final: string;
  try {
    final = await commitAll(tree, who);
    await must(tree.root, ["update-ref", questRef(tree.id), final]);
  } catch (e: any) {
    // Nothing could be recorded: the worktree stays exactly as it is.
    return end("kept", { reason: `its changes couldn't be recorded (${e.message}), so its worktree is left as it is`, left: tree.path });
  }
  // What no commit takes (secret files): the worktree stays, with them in it.
  const leftovers = (await git(tree.path, ["status", "--porcelain", "--untracked-files=all"])).out.split("\n").filter(Boolean);
  const left = leftovers.length ? { left: tree.path } : {};
  const remove = async (keepBranch: boolean) => {
    if (!leftovers.length) {
      await git(tree.root, ["worktree", "remove", "--force", tree.path]);
      try { if (!readdirSync(dirname(tree.path)).length) rmdirSync(dirname(tree.path)); } catch { /* still in use */ }
    }
    // The branch names the quest's work for as long as it's wanted (the quest may have moved it, or left it).
    if (keepBranch) { if (!leftovers.length) await git(tree.root, ["branch", "-f", tree.branch, final]); }
    else if (!leftovers.length) await git(tree.root, ["branch", "-D", tree.branch]);
  };
  const unchanged = (await must(tree.root, ["rev-parse", `${final}^{tree}`])) === (await must(tree.root, ["rev-parse", `${tree.base}^{tree}`]));
  if (unchanged) {
    await remove(false);
    if (!leftovers.length) await git(tree.root, ["update-ref", "-d", questRef(tree.id)]);
    return end("unchanged", { final, ...left });
  }
  if (opts.keep) { await remove(true); return end("kept", { reason: opts.keep, final, ...left }); }
  // The folder is held while the changes land, so they meet a folder nobody is half-way through changing.
  const free = await lockFolders([tree.lockKey], who, opts.signal);
  if (!free) { await remove(true); return end("kept", { reason: "the run was stopped before its changes were brought back", final, ...left }); }
  let landed: Awaited<ReturnType<typeof land>>;
  try {
    landed = await land(tree, final, opts.beforeLanding).catch((e: Error) => ({ conflict: e.message }));
  } finally {
    free();
  }
  if ("conflict" in landed) { await remove(true); return end("kept", { reason: landed.conflict, final, ...left }); }
  await remove(false);
  return end("merged", { files: landed.files.map((f) => join(tree.root, f)), final, ...left });
}
