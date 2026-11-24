// Checkpoints: before an agent's file tools change a file, the original is saved under
// camp/checkpoints/<expedition id>/. That gives every expedition a diff of what it changed and an
// Undo that puts the files back. It covers write_file and edit_file (in the camp and in linked
// folders).
//
// Shell commands are covered in linked git repositories: before the first command an expedition
// runs in one, the camp records the whole working tree as a git snapshot (a commit on a private
// ref, refs/mae/checkpoints/…, that's never pushed or checked out), and again when the
// expedition ends. What changed between the two is the shell's share of the diff, and Undo puts
// those files back too, but only the ones nobody has changed since the expedition ended. Files git
// ignores (node_modules, build output) and secret files are left out of snapshots.
//
// It also keeps quests from overwriting each other: if another quest changed a file after this
// one last read it, the write is refused until the file has been read again.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync, utimesSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { currentExpeditionId, currentRunKey } from "./context.js";
import { writeJsonAtomic } from "./atomic.js";
import { gitSafeEnv } from "./sandbox.js";
import { OUTPOST } from "./outpost.js";

export const CHECKPOINTS_DIR = join("camp", "checkpoints");
const MAX_SNAPSHOT_BYTES = 5_000_000;
const KEEP = 60; // expeditions with checkpoints kept on disk

type Entry = { path: string; abs: string; existed: boolean; blob?: string; tooBig?: boolean };
// A git repository the expedition ran shell commands in: its working tree before the first
// command (before), and when the expedition ended (after). Both are commits on private refs.
// shown: how the crew sees the repository's top (links/web).
type Snapshot = { root: string; shown: string; before: string; after?: string };
type Manifest = { id: string; started: string; undone?: string; files: Entry[]; snapshots?: Snapshot[] };
export type ChangedFile = { path: string; change: "created" | "modified" | "deleted" };

const SAFE_ID = /^[a-zA-Z0-9-]{1,80}$/;
const dirFor = (id: string) => join(CHECKPOINTS_DIR, id);

// Kept in memory for the expedition's lifetime so every write_file doesn't re-parse manifest.json.
const manifestCache = new Map<string, Manifest>();

function load(id: string): Manifest | null {
  if (!SAFE_ID.test(id)) return null;
  const hit = manifestCache.get(id);
  if (hit) return hit;
  const file = join(dirFor(id), "manifest.json");
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as Manifest;
    manifestCache.set(id, m);
    return m;
  } catch { return null; }
}

function save(m: Manifest) {
  mkdirSync(dirFor(m.id), { recursive: true });
  writeJsonAtomic(join(dirFor(m.id), "manifest.json"), m);
  manifestCache.set(m.id, m);
}

function prune() {
  if (!existsSync(CHECKPOINTS_DIR)) return;
  const dirs = readdirSync(CHECKPOINTS_DIR)
    .map((name) => ({ name, at: statSync(join(CHECKPOINTS_DIR, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const d of dirs.slice(KEEP)) {
    for (const snap of load(d.name)?.snapshots ?? []) dropRefs(snap, d.name);
    rmSync(join(CHECKPOINTS_DIR, d.name), { recursive: true, force: true });
    manifestCache.delete(d.name);
  }
}

// ---------- Snapshots of a git working tree (for what shell commands change) ----------
const SECRET_GLOBS = [".env*", "*.pem", "*.key", "id_rsa*", "id_ed25519*", "id_ecdsa*", ".netrc", ".npmrc", ".pypirc", ".git-credentials", "credentials", "credentials.json", "*.p12", "*.pfx"];
const LEAVE_OUT = SECRET_GLOBS.map((g) => `:(exclude,glob)**/${g}`);
// Who a checkpoint commit is by: the outpost, by the name it has now.
const idEnv = () => ({ GIT_AUTHOR_NAME: OUTPOST.name, GIT_AUTHOR_EMAIL: "mae@localhost", GIT_COMMITTER_NAME: OUTPOST.name, GIT_COMMITTER_EMAIL: "mae@localhost" });
// These run in the crew's working folders, whose git config a command of theirs may have
// written: gitSafeEnv switches off what a config can make git run by itself (a file-system
// monitor, hooks). The repository's own filters stay on, so files are recorded as git stores them.
const gitIn = (root: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 50_000_000, stdio: ["ignore", "pipe", "pipe"], env: { ...gitSafeEnv(), ...env } }).trim();

const run = promisify(execFile);
const gitAsync = async (root: string, args: string[], env: Record<string, string> = {}) =>
  (await run("git", args, { cwd: root, encoding: "utf8", maxBuffer: 50_000_000, env: { ...gitSafeEnv(), ...env } })).stdout.trim();

// The working tree as it is right now, as a git tree (and a commit holding it), without touching
// the repository's own index, HEAD, or branches. Starts from a copy of the real index, so only
// files that changed are read again. The async form is for the snapshots taken while work is
// going (on a large repository they take a fifth of a second, and the camp shouldn't stall);
// the plain one is for View changes and Undo, which you're waiting on anyway.
async function treeNowAsync(root: string): Promise<string> {
  const git = gitAsync;
  const tmp = join(tmpdir(), `mae-index-${randomUUID()}`);
  try {
    const index = resolve(root, await git(root, ["rev-parse", "--git-path", "index"]));
    if (existsSync(index)) { copyFileSync(index, tmp); const st = statSync(index); utimesSync(tmp, st.atime, st.mtime); }
    const env = { GIT_INDEX_FILE: tmp };
    await git(root, ["add", "-A", "--", ".", ...LEAVE_OUT], env);
    const tracked = (await git(root, ["ls-files", "-z", "--", ...SECRET_GLOBS.map((g) => `:(glob)**/${g}`)], env)).split("\0").filter(Boolean);
    if (tracked.length) await git(root, ["rm", "-q", "--cached", "--", ...tracked], env);
    return await git(root, ["write-tree"], env);
  } finally {
    rmSync(tmp, { force: true });
  }
}
async function commitOfAsync(root: string, tree: string, ref: string): Promise<string> {
  const commit = await gitAsync(root, ["commit-tree", tree, "-m", `${OUTPOST.name} checkpoint (not a branch; safe to delete)`], idEnv());
  await gitAsync(root, ["update-ref", ref, commit]);
  return commit;
}
function treeNow(root: string): string {
  const tmp = join(tmpdir(), `mae-index-${randomUUID()}`);
  try {
    const index = resolve(root, gitIn(root, ["rev-parse", "--git-path", "index"]));
    // The copy keeps the index's own times: git trusts a file's cached details only when the file
    // is older than the index, and a copy made now would look newer than a file changed a moment ago.
    if (existsSync(index)) { copyFileSync(index, tmp); const st = statSync(index); utimesSync(tmp, st.atime, st.mtime); }
    const env = { GIT_INDEX_FILE: tmp };
    gitIn(root, ["add", "-A", "--", ".", ...LEAVE_OUT], env);
    // Secret files the real index already tracks are dropped from the copy too.
    const tracked = gitIn(root, ["ls-files", "-z", "--", ...SECRET_GLOBS.map((g) => `:(glob)**/${g}`)], env).split("\0").filter(Boolean);
    if (tracked.length) gitIn(root, ["rm", "-q", "--cached", "--", ...tracked], env);
    return gitIn(root, ["write-tree"], env);
  } finally {
    rmSync(tmp, { force: true });
  }
}
const refFor = (id: string, n: number, when: "before" | "after") => `refs/mae/checkpoints/${id}/${n}-${when}`;
// (refs/satchel/…: where snapshots were kept under the app's old name. Those are dropped here too.)
function dropRefs(snap: Snapshot, id: string) {
  try {
    for (const ref of gitIn(snap.root, ["for-each-ref", "--format=%(refname)", `refs/mae/checkpoints/${id}/`, `refs/satchel/checkpoints/${id}/`]).split("\n").filter(Boolean)) gitIn(snap.root, ["update-ref", "-d", ref]);
  } catch { /* the repository is gone */ }
}

// Before a shell command runs in `dir`: if it's inside a git repository the crew sees as a linked
// folder (`shown` is its top, as the crew sees it), record the working tree once per expedition.
// Two quests starting commands in the same repository at once share one snapshot.
const taking = new Map<string, Promise<void>>();
export function snapshotBeforeShell(dir: string, showTop: (abs: string) => string | undefined): Promise<void> {
  const id = currentExpeditionId();
  if (!id || !SAFE_ID.test(id)) return Promise.resolve();
  const key = `${id}|${dir}`;
  const busy = taking.get(key);
  if (busy) return busy;
  const job = (async () => {
    let root: string;
    try { root = resolve(await gitAsync(dir, ["rev-parse", "--show-toplevel"])); } catch { return; } // not a repository
    const shown = showTop(root);
    if (!shown || load(id)?.snapshots?.some((x) => x.root === root)) return;
    const rootKey = `${id}|root:${root}`;
    const other = taking.get(rootKey);
    if (other) return other; // the same repository, reached from another folder inside it
    const snap = (async () => {
      try {
        const n = load(id)?.snapshots?.length ?? 0;
        const before = await commitOfAsync(root, await treeNowAsync(root), refFor(id, n, "before"));
        // Read the record again: the file tools may have added to it while git was working.
        const m = load(id) ?? { id, started: new Date().toISOString(), files: [] };
        if (!m.files.length && !m.snapshots?.length) prune();
        save({ ...m, snapshots: [...(m.snapshots ?? []), { root, shown, before }] });
      } catch { /* an unusual repository: shell changes there just aren't tracked */ }
    })();
    taking.set(rootKey, snap);
    try { await snap; } finally { taking.delete(rootKey); }
  })();
  taking.set(key, job);
  return job.finally(() => taking.delete(key));
}

// When an expedition ends: record where each repository it ran commands in was left.
export async function sealSnapshots(id: string): Promise<void> {
  const first = load(id);
  if (!first?.snapshots?.some((x) => !x.after)) return;
  const after = new Map<string, string>();
  for (const [n, x] of first.snapshots.entries()) {
    if (x.after) continue;
    try { after.set(x.root, await commitOfAsync(x.root, await treeNowAsync(x.root), refFor(id, n, "after"))); } catch { /* left open: shown as it is now */ }
  }
  const m = load(id) ?? first;
  save({ ...m, snapshots: (m.snapshots ?? []).map((x) => (after.has(x.root) ? { ...x, after: after.get(x.root) } : x)) });
}

// How an expedition left a repository it ran commands in: the commit recorded when it ended
// (nothing, if it ran none there or its checkpoint has since been cleared out). root: the
// repository's top, as git names it.
export function leftAt(id: string, root: string): string | undefined {
  return load(id)?.snapshots?.find((x) => x.root === root)?.after;
}

type ShellChange = { snap: Snapshot; rel: string; abs: string; change: ChangedFile["change"] };
// What changed in each repository between the snapshots (up to now, while it's still running),
// leaving out files the file tools changed (those have their own entry).
// sealedOnly: leave out a repository whose expedition hasn't ended (or ended without getting to
// record how it left things). Working that out means reading the whole working tree, with git,
// while everything else waits: fine for the one run you opened, not for a page that lists many.
// A finished run's answer never changes (both ends are commits), so it's worked out once and kept.
const sealedDiffs = new Map<string, string[]>();
function shellChanges(m: Manifest, sealedOnly = false): ShellChange[] {
  const byTools = new Set(m.files.map((f) => f.abs));
  const out: ShellChange[] = [];
  for (const snap of m.snapshots ?? []) {
    if (sealedOnly && !snap.after) continue;
    let lines: string[];
    try {
      const key = snap.after ? `${snap.root}|${snap.before}|${snap.after}` : "";
      const kept = key ? sealedDiffs.get(key) : undefined;
      if (kept) lines = kept;
      else {
        const after = snap.after ?? gitIn(snap.root, ["commit-tree", treeNow(snap.root), "-m", "now"], idEnv());
        lines = gitIn(snap.root, ["diff", "--name-status", "--no-renames", "-z", snap.before, after]).split("\0").filter(Boolean);
        if (key) {
          if (sealedDiffs.size >= 300) sealedDiffs.delete(sealedDiffs.keys().next().value!);
          sealedDiffs.set(key, lines);
        }
      }
    } catch { continue; }
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const rel = lines[i + 1], abs = join(snap.root, rel);
      if (byTools.has(abs)) continue;
      out.push({ snap, rel, abs, change: lines[i] === "A" ? "created" : lines[i] === "D" ? "deleted" : "modified" });
    }
  }
  return out;
}
const shownOf = (c: ShellChange) => `${c.snap.shown}/${c.rel.split(sep).join("/")}`;

// ---------- Who last touched a file (so parallel quests don't overwrite each other) ----------
// Order is kept with a counter, not the clock: two quests can touch a file in the same millisecond.
let tick = 0;
const lastWrite = new Map<string, { by: string; at: number; order: number }>();
const lastSeen = new Map<string, number>(); // `${runKey}|${abs}` → the counter when this run last read or wrote it

export function noteRead(abs: string) {
  lastSeen.set(`${currentRunKey()}|${abs}`, ++tick);
}

// Call before changing a file: refuses a stale write, then saves the original once per expedition.
export function beforeWrite(abs: string, shown: string) {
  const me = currentRunKey();
  const w = lastWrite.get(abs);
  if (w && w.by !== me && Date.now() - w.at < 3_600_000 && (lastSeen.get(`${me}|${abs}`) ?? 0) < w.order) {
    throw new Error(`${shown} was just changed by other work going on at the same time. Read it again, then make your change on top of theirs.`);
  }
  const id = currentExpeditionId();
  if (!id || !SAFE_ID.test(id)) return;
  const m = load(id) ?? { id, started: new Date().toISOString(), files: [] };
  if (m.files.some((f) => f.abs === abs)) return; // the first version is the one to go back to
  if (!m.files.length) prune();
  const entry: Entry = { path: shown, abs, existed: existsSync(abs) };
  if (entry.existed) {
    if (statSync(abs).size > MAX_SNAPSHOT_BYTES) entry.tooBig = true;
    else {
      entry.blob = `${m.files.length}.orig`;
      mkdirSync(dirFor(id), { recursive: true });
      copyFileSync(abs, join(dirFor(id), entry.blob));
    }
  }
  m.files.push(entry);
  save(m);
}

// Files this run (a quest, or an expedition's own agent) has written and nobody has since.
export function filesWrittenBy(runKey: string): string[] {
  return [...lastWrite].filter(([, w]) => w.by === runKey).map(([abs]) => abs);
}

export function afterWrite(abs: string) {
  const order = ++tick;
  lastWrite.set(abs, { by: currentRunKey(), at: Date.now(), order });
  lastSeen.set(`${currentRunKey()}|${abs}`, order);
}

// ---------- What an expedition changed ----------
function changeOf(dir: string, f: Entry): ChangedFile["change"] | null {
  const now = existsSync(f.abs);
  if (!f.existed) return now ? "created" : null;
  if (!now) return "deleted";
  if (!f.blob) return "modified";
  return readFileSync(join(dir, f.blob)).equals(readFileSync(f.abs)) ? null : "modified";
}

export function changedFiles(id: string, opts: { sealedOnly?: boolean } = {}): ChangedFile[] {
  const m = load(id);
  if (!m) return [];
  if (m.undone) return []; // put back: what's there now isn't this expedition's any more
  return [
    ...m.files.flatMap((f) => {
      const change = changeOf(dirFor(id), f);
      return change ? [{ path: f.path, change }] : [];
    }),
    ...shellChanges(m, opts.sealedOnly).map((c) => ({ path: shownOf(c), change: c.change })),
  ];
}

// A unified diff of everything the expedition changed (uses git's diff; works outside a repo).
export function checkpointDiff(id: string): { files: ChangedFile[]; diff: string; undone: boolean } {
  const m = load(id);
  if (!m) return { files: [], diff: "", undone: false };
  const dir = dirFor(id);
  const parts: string[] = [];
  for (const f of m.files) {
    const change = changeOf(dir, f);
    if (!change) continue;
    if (f.tooBig) { parts.push(`--- ${f.path}\n(too large to keep a copy; no diff or undo for this file)\n`); continue; }
    const before = f.blob ? join(dir, f.blob) : "/dev/null";
    const after = existsSync(f.abs) ? f.abs : "/dev/null";
    let out = "";
    try {
      out = execFileSync("git", ["diff", "--no-index", "--no-color", "--", before, after], { encoding: "utf8", maxBuffer: 20_000_000 });
    } catch (e: any) {
      out = e?.status === 1 ? String(e.stdout ?? "") : `(couldn't diff ${f.path}: ${e?.message ?? e})\n`; // exit 1 = differences found
    }
    // Show the file's own name instead of the checkpoint copy's path.
    const body = out.split("\n").filter((l) => !/^(diff --git|index |new file mode|deleted file mode)/.test(l))
      .map((l) => (l.startsWith("--- ") ? `--- ${f.existed ? f.path : "/dev/null"}` : l.startsWith("+++ ") ? `+++ ${change === "deleted" ? "/dev/null" : f.path}` : l));
    parts.push(body.join("\n"));
  }
  // What shell commands changed, from the snapshots (only before an undo: after it they're history).
  if (!m.undone) for (const snap of m.snapshots ?? []) {
    const mine = shellChanges({ ...m, snapshots: [snap] });
    if (!mine.length) continue;
    try {
      const after = snap.after ?? gitIn(snap.root, ["commit-tree", treeNow(snap.root), "-m", "now"], idEnv());
      const out = gitIn(snap.root, ["diff", "--no-color", "--no-renames", `--src-prefix=${snap.shown}/`, `--dst-prefix=${snap.shown}/`, snap.before, after, "--", ...mine.map((c) => c.rel)]);
      parts.push(`# Changed by shell commands in ${snap.shown}\n` + out.split("\n").filter((l) => !/^(diff --git|index |new file mode|deleted file mode)/.test(l)).join("\n"));
    } catch { parts.push(`# Changed by shell commands in ${snap.shown}: ${mine.map(shownOf).join(", ")} (couldn't show the diff)`); }
  }
  return { files: changedFiles(id), diff: parts.join("\n").slice(0, 400_000), undone: !!m.undone };
}

// Put every file back the way it was before the expedition touched it.
export function undoCheckpoint(id: string): { restored: string[]; skipped: string[] } {
  const m = load(id);
  const restored: string[] = [], skipped: string[] = [];
  if (!m) return { restored, skipped };
  const dir = dirFor(id);
  for (const f of m.files) {
    if (!changeOf(dir, f)) continue;
    if (f.tooBig) { skipped.push(f.path); continue; }
    if (!f.existed) rmSync(f.abs, { force: true });
    else {
      mkdirSync(dirname(f.abs), { recursive: true });
      copyFileSync(join(dir, f.blob!), f.abs);
    }
    lastWrite.delete(f.abs);
    restored.push(f.path);
  }
  // Then what shell commands changed: each file goes back to how it was before the first command,
  // unless something else has changed it since the expedition ended (that's someone else's work).
  for (const snap of m.snapshots ?? []) {
    const mine = shellChanges({ ...m, snapshots: [snap] });
    if (!mine.length) continue;
    let since = new Set<string>();
    try {
      if (snap.after) {
        const now = gitIn(snap.root, ["commit-tree", treeNow(snap.root), "-m", "now"], idEnv());
        since = new Set(gitIn(snap.root, ["diff", "--name-only", "--no-renames", "-z", snap.after, now]).split("\0").filter(Boolean));
      }
    } catch { since = new Set(mine.map((c) => c.rel)); }
    for (const c of mine) {
      if (since.has(c.rel)) { skipped.push(`${shownOf(c)} (changed again since)`); continue; }
      try {
        if (c.change === "created") rmSync(c.abs, { force: true });
        else gitIn(snap.root, ["restore", `--source=${snap.before}`, "--worktree", "--", c.rel]);
        restored.push(shownOf(c));
      } catch { skipped.push(shownOf(c)); }
    }
  }
  save({ ...m, undone: new Date().toISOString() });
  return { restored, skipped };
}
