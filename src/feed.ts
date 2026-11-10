// The feed on disk: mission control appends every event to camp/feed.jsonl, so the feed (what
// each expedition did, the approvals, the results) is still there after a restart.
// On start the newest events are loaded back. Anything that was still open when the camp went
// down is closed off: an unanswered approval is marked as lapsed, and an unfinished expedition as
// interrupted, so nothing in the reloaded feed looks like it's still waiting or running.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { CampEvent } from "./events.js";

export const FEED_PATH = "camp/feed.jsonl";
const MAX_FILE_BYTES = 8_000_000;

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

  // Keep the file from growing forever: once it's large, rewrite it with just what was loaded.
  try {
    if (statSync(FEED_PATH).size > MAX_FILE_BYTES) writeFileSync(FEED_PATH, all.map((e) => JSON.stringify(e)).join("\n") + "\n");
    else if (closing.length) appendFileSync(FEED_PATH, closing.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch { /* fine */ }
  return all;
}

// What the feed recorded of one expedition, as plain text: the plan, who was sent, what they
// said and did. Used to resume a run that was cut off, when there's no final answer to go on.
export function expeditionDigest(id: string, maxChars = 14_000): string {
  if (!existsSync(FEED_PATH)) return "";
  const lines: string[] = [];
  const asks = new Map<string, string>();
  for (const l of readFileSync(FEED_PATH, "utf8").split("\n")) {
    if (!l.includes(id)) continue;
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.expeditionId !== id) continue;
    const clip = (s: string, n: number) => (String(s).length > n ? String(s).slice(0, n) + "…" : String(s));
    if (e.type === "text") lines.push(`${e.who} said: ${clip(e.text, 1500)}`);
    else if (e.type === "tool") lines.push(`${e.who} used ${e.tool} ${clip(e.input, 160)}`);
    else if (e.type === "dispatch") lines.push(`${e.who} was sent on a quest.`);
    else if (e.type === "return") lines.push(`${e.who} came back (${e.status}).`);
    else if (e.type === "steer") lines.push(`The user added: ${clip(e.text, 600)}`);
    else if (e.type === "ask") { asks.set(e.id, e.kind); if (e.kind === "plan") lines.push(`Plan submitted:\n${clip(e.body, 2000)}`); }
    else if (e.type === "answered" && asks.get(e.id) === "plan" && !e.lapsed) lines.push(e.answer === "" || /^y$/i.test(e.answer) ? "The user approved that plan." : `The user's answer to the plan: ${e.answer}`);
  }
  const text = lines.join("\n");
  return text.length > maxChars ? "…(earlier steps left out)\n" + text.slice(-maxChars) : text;
}
