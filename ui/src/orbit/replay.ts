// The day, played back (Orbit.tsx): the feed's own events laid along a line you can scrub, with
// the long stretches where nothing happened cut short, so a day of expeditions is watched in half
// a minute. Pure: (events) → where each falls on the line, and back.

import type { CampEvent } from "../types.ts";

export const GAP_MS = 90_000;  // a stretch with nothing in it is cut down to this
export const TAIL_MS = 4000;   // and the line runs on a little past the last event, so its ending is seen
export const REEL_S = 30;      // played at its usual speed, the whole line takes this long

// events: renumbered from one, so they can be played into a feed of their own from the start.
// at: where each falls on the line (ms from its start). real: when each really happened.
// marks: where an expedition set out, or something waited on you.
export type Mark = { at: number; kind: "start" | "ask"; label: string };
export type Reel = { events: CampEvent[]; at: number[]; real: number[]; span: number; marks: Mark[] };

export function reelOf(events: CampEvent[], gap = GAP_MS): Reel {
  const timed = events.map((e) => ({ e, t: Date.parse(e.time) })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t || a.e.seq - b.e.seq);
  const at: number[] = [], real: number[] = [], marks: Mark[] = [];
  const out = timed.map(({ e, t }, i) => {
    at.push(i ? at[i - 1] + Math.min(gap, t - real[i - 1]) : 0);
    real.push(t);
    if (e.type === "expedition_start") marks.push({ at: at[i], kind: "start", label: e.task });
    else if (e.type === "ask") marks.push({ at: at[i], kind: "ask", label: e.title });
    return { ...e, seq: i + 1 };
  });
  return { events: out, at, real, marks, span: out.length ? at[at.length - 1] + TAIL_MS : 0 };
}

// How many of its events have happened by a point on the line.
export function countAt(reel: Reel, offset: number): number {
  let lo = 0, hi = reel.at.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (reel.at[mid] <= offset) lo = mid + 1; else hi = mid; }
  return lo;
}
// The real time at a point on the line (within a stretch that was cut short, it runs on from the event before).
export function realAt(reel: Reel, offset: number): number {
  const n = countAt(reel, offset);
  if (!n) return reel.real[0] ?? 0;
  return reel.real[n - 1] + Math.max(0, Math.min(offset, reel.span) - reel.at[n - 1]);
}
// How fast the line plays (line-ms a real ms) for the whole of it to take REEL_S, times whatever you've asked for.
export const paceOf = (reel: Reel, times = 1) => Math.max(1, reel.span / (REEL_S * 1000)) * times;
