// The feed on disk: mission control appends every event to camp/feed.jsonl, so the feed (what
// each expedition did, the approvals, the results) is still there after a restart.
// On start the newest events are loaded back. Anything that was still open when the camp went
// down is closed off: an unanswered approval is marked as lapsed, and an unfinished expedition as
// interrupted, so nothing in the reloaded feed looks like it's still waiting or running.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import type { CampEvent } from "./events.js";
import { appendLine, writeAtomic } from "./atomic.js";

export const FEED_PATH = "camp/feed.jsonl";
// History reads conversations back from this file, so it keeps a lot before trimming.
const MAX_FILE_BYTES = 40_000_000;

// Events worth keeping: not word-by-word streaming, and not "refresh this panel" pings.
export const keepInFeed = (e: CampEvent) => e.type !== "text_delta" && e.type !== "changed";

export function saveToFeed(e: CampEvent) {
  try {
    appendLine(FEED_PATH, JSON.stringify(e));
  } catch { /* the live feed still works */ }
}

export function loadFeed(limit: number): CampEvent[] {
  if (!existsSync(FEED_PATH)) return [];
  const events = readFileSync(FEED_PATH, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as CampEvent]; } catch { return []; }
  });
  // Don't start the reloaded feed in the middle of an expedition.
  let recent = events.slice(-limit);
  const firstStart = recent.findIndex((e) => e.type === "expedition_start");
  if (recent.length === limit && firstStart > 0) recent = recent.slice(firstStart);

  let seq = recent.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  const time = new Date().toISOString();
  const openAsks = new Map<string, CampEvent>();
  const openExps = new Set<string>();
  const openQuests = new Map<string, Extract<CampEvent, { type: "dispatch" }>>();
  for (const e of recent) {
    if (e.type === "ask") openAsks.set(e.id, e);
    else if (e.type === "answered") openAsks.delete(e.id);
    else if (e.type === "expedition_start") openExps.add(e.id);
    else if (e.type === "expedition_end") openExps.delete(e.id);
    else if (e.type === "dispatch" && e.questId) openQuests.set(e.questId, e);
    else if (e.type === "return" && e.questId) openQuests.delete(e.questId);
  }
  const closing: CampEvent[] = [];
  for (const a of openAsks.values()) closing.push({ type: "answered", id: (a as any).id, answer: "n", lapsed: true, expeditionId: a.expeditionId, time, seq: ++seq } as CampEvent);
  for (const q of openQuests.values()) closing.push({ type: "return", who: q.who, emoji: q.emoji, status: "interrupted", questId: q.questId, expeditionId: q.expeditionId, time, seq: ++seq } as CampEvent);
  for (const id of openExps) closing.push({ type: "expedition_end", id, status: "interrupted", text: "The camp was restarted while this was running.", expeditionId: id, time, seq: ++seq } as CampEvent);
  const all = [...recent, ...closing];

  // Keep the file from growing forever: once it's large, drop the older half. Conversations
  // whose events are dropped still show in History, from what was asked and the final answer.
  try {
    if (closing.length) appendLine(FEED_PATH, closing.map((e) => JSON.stringify(e)).join("\n"));
    trimFeed();
  } catch { /* fine */ }
  return all;
}

// Everything since a moment, oldest first, for playing the day back (Orbit's replay). The file is
// read from its end a stretch at a time until a line older than that turns up, so a long history
// costs nothing. It never starts part-way through an expedition: what belongs to one that set
// out earlier is left out. What was still open at the end is left open, as it was.
export function feedSince(since: number, limit = 6000): CampEvent[] {
  if (!existsSync(FEED_PATH)) return [];
  const parse = (l: string): CampEvent[] => { try { const e = JSON.parse(l) as CampEvent; return e && typeof e === "object" && e.time ? [e] : []; } catch { return []; } };
  const fd = openSync(FEED_PATH, "r");
  let got = Buffer.alloc(0), from = statSync(FEED_PATH).size;
  try {
    while (from > 0) {
      const to = from;
      from = Math.max(0, from - SINCE_CHUNK);
      const buf = Buffer.alloc(to - from);
      readSync(fd, buf, 0, buf.length, from);
      got = Buffer.concat([buf, got]);
      const start = from > 0 ? got.indexOf(10) + 1 : 0; // (the first line is cut short unless this is the start of the file)
      const end = got.indexOf(10, start);
      const [first] = parse(got.subarray(start, end < 0 ? got.length : end).toString("utf8"));
      if ((first && Date.parse(first.time) < since) || got.length > 24_000_000) break;
    }
  } finally { closeSync(fd); }
  const text = got.subarray(from > 0 ? got.indexOf(10) + 1 : 0).toString("utf8");
  let events = text.split("\n").flatMap((l) => (l ? parse(l) : [])).filter((e) => Date.parse(e.time) >= since);
  if (events.length > limit) events = events.slice(-limit);
  const began = new Set(events.flatMap((e) => (e.type === "expedition_start" ? [e.id] : [])));
  return events.filter((e) => e.type === "expedition_start" || !e.expeditionId || began.has(e.expeditionId));
}
const SINCE_CHUNK = 1_000_000;

// Once the file is large, drop its older half. Called at start-up and now and then while the
// camp runs (it can stay up for weeks). The new file is written beside the old one and renamed
// into place, so a crash part-way leaves the feed as it was. Returns whether it trimmed.
export function trimFeed(maxBytes = MAX_FILE_BYTES): boolean {
  try {
    if (statSync(FEED_PATH).size <= maxBytes) return false;
    const lines = readFileSync(FEED_PATH, "utf8").split("\n").filter(Boolean);
    writeAtomic(FEED_PATH, lines.slice(-Math.ceil(lines.length / 2)).join("\n") + "\n");
    index = null; // the file was rewritten: the next read indexes it again
    return true;
  } catch { return false; }
}

// ---------- Reading one expedition's events without reading the whole file ----------
// The file only grows (it's rewritten just when it's trimmed, at start-up), so the camp keeps
// where each expedition's lines are, and reads only what was added since it last looked. Opening
// a conversation then reads its own lines, not tens of megabytes of everyone else's.
type FeedIndex = { ino: number; size: number; lines: Map<string, [number, number][]> }; // expedition → [start, end) byte ranges
let index: FeedIndex | null = null;
const EXPEDITION_KEY = /"expeditionId":"([^"\\]+)"/g;
const CHUNK = 4_000_000;

function feedIndex(): FeedIndex | null {
  let st;
  try { st = statSync(FEED_PATH); } catch { index = null; return null; }
  if (!index || st.ino !== index.ino || st.size < index.size) index = { ino: st.ino, size: 0, lines: new Map() };
  if (st.size === index.size) return index;
  const fd = openSync(FEED_PATH, "r");
  try {
    let pos = index.size, carry = Buffer.alloc(0);
    while (pos < st.size) {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - pos));
      const got = readSync(fd, buf, 0, buf.length, pos);
      if (got <= 0) break;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, got)]) : buf.subarray(0, got);
      const base = pos - carry.length;
      let start = 0;
      for (let nl = data.indexOf(10); nl !== -1; nl = data.indexOf(10, start)) {
        const line = data.toString("utf8", start, nl);
        // Every expedition the line names (a text inside an event can't fake one: its quotes are escaped).
        for (const m of line.matchAll(EXPEDITION_KEY)) {
          const list = index.lines.get(m[1]) ?? [];
          list.push([base + start, base + nl]);
          index.lines.set(m[1], list);
        }
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start)); // a line still being written waits for next time
      pos += got;
      index.size = base + start;
    }
  } finally { closeSync(fd); }
  return index;
}

// The events of these expeditions, in the order they were written.
export function feedEventsOf(ids: Iterable<string>): CampEvent[] {
  const wanted = new Set(ids);
  const idx = feedIndex();
  if (!idx || !wanted.size) return [];
  const byStart = new Map<number, number>();
  for (const id of wanted) for (const [from, to] of idx.lines.get(id) ?? []) byStart.set(from, to);
  const ranges = [...byStart].sort((a, b) => a[0] - b[0]);
  const out: CampEvent[] = [];
  const fd = openSync(FEED_PATH, "r");
  try {
    for (const [from, to] of ranges) {
      const buf = Buffer.alloc(to - from);
      readSync(fd, buf, 0, buf.length, from);
      try {
        const e = JSON.parse(buf.toString("utf8")) as CampEvent;
        if (e.expeditionId && wanted.has(e.expeditionId)) out.push(e);
      } catch { /* a damaged line */ }
    }
  } finally { closeSync(fd); }
  return out;
}

// What the feed recorded of one expedition, as plain text: the plan, who was sent, what they
// said and did. Used to resume a run that was cut off, when there's no final answer to go on.
export function expeditionDigest(id: string, maxChars = 14_000): string {
  const lines: string[] = [];
  const asks = new Map<string, string>();
  for (const e of feedEventsOf([id]) as any[]) {
    const clip = (s: string, n: number) => (String(s).length > n ? String(s).slice(0, n) + "…" : String(s));
    if (e.type === "text") lines.push(`${e.who} said: ${clip(e.text, 1500)}`);
    else if (e.type === "tool") lines.push(`${e.who} used ${e.tool} ${clip(e.input, 160)}`);
    else if (e.type === "file") lines.push(`${e.who} ${e.change} ${e.path}.`);
    else if (e.type === "dispatch") lines.push(`${e.who} was sent on a quest.`);
    else if (e.type === "return") lines.push(`${e.who} came back (${e.status}).`);
    else if (e.type === "steer") lines.push(`The user added: ${clip(e.text, 600)}`);
    else if (e.type === "ask") { asks.set(e.id, e.kind); if (e.kind === "plan") lines.push(`Plan submitted:\n${clip(e.body, 2000)}`); }
    else if (e.type === "answered" && asks.get(e.id) === "plan" && !e.lapsed) lines.push(e.answer === "" || /^y$/i.test(e.answer) ? "The user approved that plan." : `The user's answer to the plan: ${e.answer}`);
  }
  const text = lines.join("\n");
  return text.length > maxChars ? "…(earlier steps left out)\n" + text.slice(-maxChars) : text;
}
