// Checkpoints: before an agent's file tools change a file, the original is saved under
// camp/checkpoints/<expedition id>/. That gives every expedition a diff of what it changed and an
// Undo that puts the files back. It covers write_file and edit_file (in the camp and in linked
// folders).
//
// Shell commands are covered in linked git repositories: before the first command an expedition
// runs in one, the camp records the whole working tree as a git snapshot (a commit on a private
// ref, refs/satchel/checkpoints/…, that's never pushed or checked out), and again when the
// expedition ends. What changed between the two is the shell's share of the diff, and Undo puts
// those files back too, but only the ones nobody has changed since the expedition ended. Files git
// ignores (node_modules, build output) and secret files are left out of snapshots.
//
// It also keeps quests from overwriting each other: if another quest changed a file after this
// one last read it, the write is refused until the file has been read again.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { currentExpeditionId, currentRunKey } from "./context.js";

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

function load(id: string): Manifest | null {
  if (!SAFE_ID.test(id)) return null;
  const file = join(dirFor(id), "manifest.json");
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as Manifest; } catch { return null; }
}

function save(m: Manifest) {
  mkdirSync(dirFor(m.id), { recursive: true });
  writeFileSync(join(dirFor(m.id), "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

function prune() {
  if (!existsSync(CHECKPOINTS_DIR)) return;
  const dirs = readdirSync(CHECKPOINTS_DIR)
    .map((name) => ({ name, at: statSync(join(CHECKPOINTS_DIR, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const d of dirs.slice(KEEP)) {
    for (const snap of load(d.name)?.snapshots ?? []) dropRefs(snap, d.name);
    rmSync(join(CHECKPOINTS_DIR, d.name), { recursive: true, force: true });
  }
}

// ---------- Snapshots of a git working tree (for what shell commands change) ----------
const SECRET_GLOBS = [".env*", "*.pem", "*.key", "id_rsa*", "id_ed25519*", "id_ecdsa*", ".netrc", ".npmrc", ".pypirc", ".git-credentials", "credentials", "credentials.json", "*.p12", "*.pfx"];
const LEAVE_OUT = SECRET_GLOBS.map((g) => `:(exclude,glob)**/${g}`);
const ID_ENV = { GIT_AUTHOR_NAME: "Satchel", GIT_AUTHOR_EMAIL: "satchel@localhost", GIT_COMMITTER_NAME: "Satchel", GIT_COMMITTER_EMAIL: "satchel@localhost" };
const gitIn = (root: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 50_000_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } }).trim();

// The working tree as it is right now, as a git tree (and a commit holding it), without touching
// the repository's own index, HEAD, or branches. Starts from a copy of the real index, so only
// files that changed are read again.
function treeNow(root: string): string {
  const tmp = join(tmpdir(), `satchel-index-${randomUUID()}`);
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
function commitOf(root: string, tree: string, ref: string): string {
  const commit = gitIn(root, ["commit-tree", tree, "-m", "Satchel checkpoint (not a branch; safe to delete)"], ID_ENV);
  gitIn(root, ["update-ref", ref, commit]);
  return commit;
}
const refFor = (id: string, n: number, when: "before" | "after") => `refs/satchel/checkpoints/${id}/${n}-${when}`;
function dropRefs(snap: Snapshot, id: string) {
  try {
    for (const ref of gitIn(snap.root, ["for-each-ref", "--format=%(refname)", `refs/satchel/checkpoints/${id}/`]).split("\n").filter(Boolean)) gitIn(snap.root, ["update-ref", "-d", ref]);
  } catch { /* the repository is gone */ }
}

// Before a shell command runs in `dir`: if it's inside a git repository the crew sees as a linked
// folder (`shown` is its top, as the crew sees it), record the working tree once per expedition.
export function snapshotBeforeShell(dir: string, showTop: (abs: string) => string | undefined) {
  const id = currentExpeditionId();
  if (!id || !SAFE_ID.test(id)) return;
  let root: string;
  try { root = resolve(gitIn(dir, ["rev-parse", "--show-toplevel"])); } catch { return; } // not a repository
  const shown = showTop(root);
  if (!shown) return;
  const m = load(id) ?? { id, started: new Date().toISOString(), files: [] };
  const snaps = m.snapshots ?? [];
  if (snaps.some((x) => x.root === root)) return;
  if (!m.files.length && !snaps.length) prune();
  try {
    const before = commitOf(root, treeNow(root), refFor(id, snaps.length, "before"));
    save({ ...m, snapshots: [...snaps, { root, shown, before }] });
  } catch { /* an unusual repository: shell changes there just aren't tracked */ }
}

// When an expedition ends: record where each repository it ran commands in was left.
export function sealSnapshots(id: string) {
  const m = load(id);
  if (!m?.snapshots?.some((x) => !x.after)) return;
  m.snapshots = m.snapshots.map((x, n) => {
    if (x.after) return x;
    try { return { ...x, after: commitOf(x.root, treeNow(x.root), refFor(id, n, "after")) }; } catch { return x; }
  });
  save(m);
}

type ShellChange = { snap: Snapshot; rel: string; abs: string; change: ChangedFile["change"] };
// What changed in each repository between the snapshots (up to now, while it's still running),
// leaving out files the file tools changed (those have their own entry).
function shellChanges(m: Manifest): ShellChange[] {
  const byTools = new Set(m.files.map((f) => f.abs));
  const out: ShellChange[] = [];
  for (const snap of m.snapshots ?? []) {
    let lines: string[];
    try {
      const after = snap.after ?? gitIn(snap.root, ["commit-tree", treeNow(snap.root), "-m", "now"], ID_ENV);
      lines = gitIn(snap.root, ["diff", "--name-status", "--no-renames", "-z", snap.before, after]).split("\0").filter(Boolean);
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
    throw new Error(`${shown} was just changed by another quest. Read it again, then make your change on top of theirs.`);
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

export function changedFiles(id: string): ChangedFile[] {
  const m = load(id);
  if (!m) return [];
  if (m.undone) return []; // put back: what's there now isn't this expedition's any more
  return [
    ...m.files.flatMap((f) => {
      const change = changeOf(dirFor(id), f);
      return change ? [{ path: f.path, change }] : [];
    }),
    ...shellChanges(m).map((c) => ({ path: shownOf(c), change: c.change })),
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
      const after = snap.after ?? gitIn(snap.root, ["commit-tree", treeNow(snap.root), "-m", "now"], ID_ENV);
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
        const now = gitIn(snap.root, ["commit-tree", treeNow(snap.root), "-m", "now"], ID_ENV);
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
