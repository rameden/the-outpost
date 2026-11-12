// The feed on disk: mission control appends every event to camp/feed.jsonl, so the feed (what
// each expedition did, the approvals, the results) is still there after a restart.
// On start the newest events are loaded back. Anything that was still open when the camp went
// down is closed off: an unanswered approval is marked as lapsed, and an unfinished expedition as
// interrupted, so nothing in the reloaded feed looks like it's still waiting or running.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import type { CampEvent } from "./events.js";

export const FEED_PATH = "camp/feed.jsonl";
// History reads conversations back from this file, so it keeps a lot before trimming.
const MAX_FILE_BYTES = 40_000_000;

// Events worth keeping: not word-by-word streaming, and not "refresh this panel" pings.
export const keepInFeed = (e: CampEvent) => e.type !== "text_delta" && e.type !== "changed";

export function saveToFeed(e: CampEvent) {
  try {
    mkdirSync("camp", { recursive: true });
    appendFileSync(FEED_PATH, JSON.stringify(e) + "\n");
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
    if (statSync(FEED_PATH).size > MAX_FILE_BYTES) {
      writeFileSync(FEED_PATH, [...events.slice(-Math.ceil(events.length / 2)), ...closing].map((e) => JSON.stringify(e)).join("\n") + "\n");
      index = null; // the file was rewritten: the next read indexes it again
    }
    else if (closing.length) appendFileSync(FEED_PATH, closing.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch { /* fine */ }
  return all;
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
