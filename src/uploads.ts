// Clearing out uploads nothing uses any more.
//
// Every file you attach is kept in camp/uploads/<batch>/, and nothing ever deleted them: fine for
// a week, a few gigabytes after a year of screenshots and PDFs. This removes a batch only when
// both of these are true:
//
//   - nothing still refers to it: no conversation in your history was sent it, no project pins
//     a file from it, and no wiki page mentions it;
//   - it's at least a day old (and at least as old as you say), so a file you've attached to a
//     message you haven't sent yet is never taken from under you.
//
// It only happens when you ask: the button in Settings, which says what will go before it does,
// or a number of days you set there ("uploads": {"keepDays": 30} in camp/settings.json), after
// which the camp tidies once a day. With neither, nothing is ever deleted. A deleted upload is
// gone for good: there's no bin.

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { UPLOADS_DIR } from "./attachments.js";
import { CONVERSATIONS_PATH, history } from "./conversations.js";
import { FEED_PATH } from "./feed.js";
import { allTurns } from "./threads.js";
import { WIKI_DIR } from "./wiki.js";

const DAY = 86_400_000;
export const MIN_AGE_DAYS = 1;
const BATCH = /^[\w-]{6,40}$/; // what saveUpload names a batch

export type Batch = { name: string; bytes: number; files: number; modified: number; inUse: boolean };

function measure(dir: string): { bytes: number; files: number; newest: number } {
  let bytes = 0, files = 0, newest = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isSymbolicLink()) continue; // never followed
      if (e.isDirectory()) { walk(abs); continue; }
      const st = statSync(abs);
      bytes += st.size; files++; newest = Math.max(newest, st.mtimeMs);
    }
  };
  try { walk(dir); newest = Math.max(newest, statSync(dir).mtimeMs); } catch { /* it went away meanwhile */ }
  return { bytes, files, newest };
}

// Every batch the camp's own records still point at.
function referenced(batches: string[]): Set<string> {
  const used = new Set<string>();
  if (!batches.length) return used;
  const mark = (text: string) => { for (const b of batches) if (!used.has(b) && text.includes(`uploads/${b}/`)) used.add(b); };
  // Conversations still in your history: what each of their runs was sent is in the feed.
  const live = new Set(history().conversations.map((c) => c.id));
  const threadOf = new Map(allTurns().map((t) => [t.expedition, t.thread]));
  try {
    for (const line of readFileSync(FEED_PATH, "utf8").split("\n")) {
      if (!line.includes("uploads/")) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const run = e.expeditionId ?? e.id;
      const thread = e.thread ?? threadOf.get(run);
      // A run with no conversation on record (a job, or one from before records were kept) counts: when in doubt, keep.
      if (!thread || live.has(thread)) mark(line.replace(/\\\\/g, "/").replace(/\\\//g, "/"));
    }
  } catch { /* no feed yet */ }
  // Files a project pins, and anything the wiki mentions.
  try { mark(readFileSync(CONVERSATIONS_PATH, "utf8").replace(/\\\\/g, "/")); } catch { /* none yet */ }
  const pages = (dir: string) => { try { for (const e of readdirSync(dir, { withFileTypes: true })) { const abs = join(dir, e.name); if (e.isDirectory()) pages(abs); else if (e.name.endsWith(".md")) mark(readFileSync(abs, "utf8")); } } catch { /* none yet */ } };
  pages(WIKI_DIR);
  return used;
}

export function uploadBatches(dir = UPLOADS_DIR): Batch[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && BATCH.test(e.name)).map((e) => e.name);
  const used = referenced(names);
  return names.map((name) => {
    const m = measure(join(dir, name));
    return { name, bytes: m.bytes, files: m.files, modified: m.newest, inUse: used.has(name) };
  });
}

// What's there, and what a clear-out would take (given how old a batch must be, in days).
export type UploadsUsage = { batches: number; files: number; bytes: number; clearable: { batches: number; files: number; bytes: number }; olderThanDays: number };
const clearable = (b: Batch, days: number, now: number) => !b.inUse && now - b.modified >= Math.max(MIN_AGE_DAYS, days) * DAY;
export function uploadsUsage(olderThanDays = MIN_AGE_DAYS, now = Date.now()): UploadsUsage {
  const all = uploadBatches();
  const sum = (list: Batch[]) => ({ batches: list.length, files: list.reduce((n, b) => n + b.files, 0), bytes: list.reduce((n, b) => n + b.bytes, 0) });
  return { ...sum(all), clearable: sum(all.filter((b) => clearable(b, olderThanDays, now))), olderThanDays: Math.max(MIN_AGE_DAYS, olderThanDays) };
}

// Delete the batches nothing uses that are at least this old. Returns what went.
export function pruneUploads(olderThanDays = MIN_AGE_DAYS, now = Date.now()): { batches: number; files: number; bytes: number } {
  const gone = { batches: 0, files: 0, bytes: 0 };
  for (const b of uploadBatches()) {
    if (!clearable(b, olderThanDays, now)) continue;
    try {
      rmSync(join(UPLOADS_DIR, b.name), { recursive: true, force: true });
      gone.batches++; gone.files += b.files; gone.bytes += b.bytes;
    } catch { /* in use by something else right now: next time */ }
  }
  return gone;
}
