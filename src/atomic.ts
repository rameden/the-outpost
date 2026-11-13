// Writing the camp's state files so a crash can't leave one half-written.
//
// writeFileSync straight over the live file empties it first: if the process dies (or the disk
// fills) part-way, what's left is a torn file, and the next read falls back to defaults and
// then saves those over it. Here the new contents go to a temp file beside the real one, are
// flushed to disk, and are renamed into place: a reader sees the old file or the new one, never
// a piece of either.
//
// No imports from the rest of the camp, so anything can use it without import cycles.

import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export function writeAtomic(path: string, text: string | Buffer, opts: { mode?: number } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "w", opts.mode ?? 0o644);
    writeSync(fd, text as any);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
  } catch (err) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { force: true });
    throw err;
  }
}

export const writeJsonAtomic = (path: string, value: unknown, opts: { mode?: number } = {}) =>
  writeAtomic(path, JSON.stringify(value, null, 2) + "\n", opts);

// A state file that's there but can't be parsed (a hand-edit typo, or damage from before writes
// were atomic). The caller carries on with its defaults, and its next save would replace the
// file: so a copy is set aside first, once per damaged version, and the terminal says where.
const setAside = new Map<string, string>(); // path → "<mtime>:<size>" of the copy already made
function keepDamaged(path: string, why: unknown) {
  try {
    const st = statSync(path);
    const key = `${st.mtimeMs}:${st.size}`;
    const at = `${process.cwd()}|${path}`;
    if (setAside.get(at) === key) return;
    setAside.set(at, key);
    const copy = `${path}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, copy);
    console.error(`⚠️  ${path} couldn't be read (${(why as Error)?.message ?? why}). Carrying on with defaults; the file as it was is kept at ${copy}.`);
  } catch { /* it went away meanwhile: nothing to keep */ }
}

// Read a JSON state file. Missing: the fallback. Unreadable: the fallback, with the damaged file kept aside.
export function readJsonFile<T>(path: string, fallback: T): T | unknown {
  if (!existsSync(path)) return fallback;
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return fallback; }
  try {
    return JSON.parse(text);
  } catch (err) {
    keepDamaged(path, err);
    return fallback;
  }
}

// Append one line to a log (feed, threads, quest log). If the camp died mid-append, the file ends
// without a newline and the next line would run into the torn one, losing both: so the first
// append to each file in this process checks the last byte and closes the line off first.
const checked = new Set<string>();
export function appendLine(path: string, line: string) {
  const at = `${process.cwd()}|${path}`;
  let lead = "";
  if (!checked.has(at)) {
    checked.add(at);
    try {
      const size = statSync(path).size;
      if (size > 0) {
        const fd = openSync(path, "r");
        try {
          const last = Buffer.alloc(1);
          readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 10) lead = "\n";
        } finally { closeSync(fd); }
      }
    } catch { /* no file yet */ }
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lead + line + "\n");
}
