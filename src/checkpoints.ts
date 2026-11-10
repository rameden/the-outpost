// Checkpoints: before an agent's file tools change a file, the original is saved under
// camp/checkpoints/<expedition id>/. That gives every expedition a diff of what it changed and an
// Undo that puts the files back. It covers write_file and edit_file (in the camp and in linked
// folders); changes made by shell commands are not tracked.
//
// It also keeps quests from overwriting each other: if another quest changed a file after this
// one last read it, the write is refused until the file has been read again.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { currentExpeditionId, currentRunKey } from "./context.js";

export const CHECKPOINTS_DIR = join("camp", "checkpoints");
const MAX_SNAPSHOT_BYTES = 5_000_000;
const KEEP = 60; // expeditions with checkpoints kept on disk

type Entry = { path: string; abs: string; existed: boolean; blob?: string; tooBig?: boolean };
type Manifest = { id: string; started: string; undone?: string; files: Entry[] };
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
  for (const d of dirs.slice(KEEP)) rmSync(join(CHECKPOINTS_DIR, d.name), { recursive: true, force: true });
}

// ---------- Who last touched a file (so parallel quests don't overwrite each other) ----------
const lastWrite = new Map<string, { by: string; at: number }>();
const lastSeen = new Map<string, number>(); // `${runKey}|${abs}` → when this run last read or wrote it

export function noteRead(abs: string) {
  lastSeen.set(`${currentRunKey()}|${abs}`, Date.now());
}

// Call before changing a file: refuses a stale write, then saves the original once per expedition.
export function beforeWrite(abs: string, shown: string) {
  const me = currentRunKey();
  const w = lastWrite.get(abs);
  if (w && w.by !== me && Date.now() - w.at < 3_600_000 && (lastSeen.get(`${me}|${abs}`) ?? 0) < w.at) {
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

export function afterWrite(abs: string) {
  const now = Date.now();
  lastWrite.set(abs, { by: currentRunKey(), at: now });
  lastSeen.set(`${currentRunKey()}|${abs}`, now + 1);
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
  return m.files.flatMap((f) => {
    const change = changeOf(dirFor(id), f);
    return change ? [{ path: f.path, change }] : [];
  });
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
  save({ ...m, undone: new Date().toISOString() });
  return { restored, skipped };
}
