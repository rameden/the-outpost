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
    replace(tmp, path);
  } catch (err) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Put the new file in place of the old. On Windows the rename is refused while anything has the
// old file open (a virus scanner, the search indexer, another camp process reading it), which
// lasts a moment: so it's tried again, briefly, before giving up. Elsewhere it simply happens.
const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);
export function replace(from: string, to: string, rename: (a: string, b: string) => void = renameSync, tries = process.platform === "win32" ? 12 : 1) {
  for (let n = 1; ; n++) {
    try { return rename(from, to); }
    catch (err: any) {
      if (n >= tries || !BUSY.has(err?.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * n); // a short pause, a little longer each time
    }
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

// Read a log of one JSON value per line (feed, threads, quest log…), oldest first. No file: no
// lines. A blank line, or one that can't be parsed (torn by a crash mid-append), is skipped.
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* a torn line */ }
  }
  return out;
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
