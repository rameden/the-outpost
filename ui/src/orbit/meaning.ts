// What the picture says beyond who's working (Orbit.tsx draws it): a quest that's gone quiet,
// how long one has been out, what each of the crew has cost today, and what is holding at the
// edge of the system. All plain arithmetic on what the camp already reports, so it can be
// checked by itself.

import { statusLine, type CrewStatus, type QuestOut } from "../feed/reducer.ts";
import { money, plural, took } from "../format.ts";
import type { CampState } from "../types.ts";

// ---------- Quiet ----------
// A quest that has done nothing for this long is shown as quiet: it may be on a long command, or it may be stuck.
export const STALL_MS = 3 * 60_000;
type Pace = Pick<QuestOut, "last" | "waiting">;
// (One that's waiting for your OK isn't quiet: it's you it's waiting on, and it says so.)
export const stalled = (q: Pace, now: number) => !q.waiting && now - q.last >= STALL_MS;
export const quietFor = (q: Pace, now: number) => `Quiet for ${took(Math.floor((now - q.last) / 60_000) * 60).replace(" 00s", "")}`;

// What to say under a name: what they're doing, or that what they have out has gone quiet.
// quiet: everything they have out has (their planet dims).
export function sayOf(st: CrewStatus, out: QuestOut[], now: number): { text: string; quiet: boolean } {
  const gone = out.filter((q) => stalled(q, now));
  if (!gone.length) return { text: statusLine(st, out), quiet: false };
  if (out.length === 1) return { text: quietFor(out[0], now), quiet: true };
  const all = gone.length === out.length;
  return { text: `${statusLine(st, out)} · ${all ? "all quiet" : gone.length === 1 ? "one gone quiet" : `${gone.length} gone quiet`}`, quiet: all };
}

// ---------- Time out ----------
// A quest's moon grows the longer it's out (quickly at first, then hardly), and gains a ring at
// ten minutes and another at thirty, so a long one is known at a glance from across the system.
export const MOON_R = 1.9, MOON_GROWN = 3.6;
export function moonOf(ageMs: number): { r: number; rings: number } {
  const m = Math.max(0, ageMs) / 60_000;
  return { r: MOON_R + (MOON_GROWN - MOON_R) * Math.min(1, Math.log1p(m) / Math.log1p(60)), rings: m >= 30 ? 2 : m >= 10 ? 1 : 0 };
}

// ---------- Gauges ----------
// An arc round the middle, clockwise from twelve o'clock, for a share of the whole way round (0 to 1).
export function arc(r: number, share: number): string {
  const s = Math.min(0.9999, Math.max(0, share || 0));
  if (s < 0.004) return "";
  const a = s * 2 * Math.PI;
  return `M0 ${(-r).toFixed(2)}A${r} ${r} 0 ${s > 0.5 ? 1 : 0} 1 ${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
}
type Spend = { today: number; byAgent?: Record<string, number> } | null | undefined;
// What one of the crew has cost today, and what share of the camp's day that is.
export function spendOf(spend: Spend, name: string): { cost: number; share: number } {
  const cost = spend?.byAgent?.[name] ?? 0;
  return { cost, share: spend && spend.today > 0 ? Math.min(1, cost / spend.today) : 0 };
}
export const spendLine = (s: { cost: number; share: number }) => (s.cost > 0 ? `${money(s.cost)} · ${Math.round(s.share * 100)}% of the camp's day` : "Nothing yet");
// The plan limit that's nearest to full (the sun's gauge), if the camp is on a plan that has them.
export function tightest(limits: { label?: string; type: string; utilization?: number }[] | null | undefined): { label: string; used: number } | null {
  const known = (limits ?? []).filter((l) => typeof l.utilization === "number");
  if (!known.length) return null;
  const top = known.reduce((a, b) => (b.utilization! > a.utilization! ? b : a));
  return { label: top.label ?? top.type, used: Math.min(1, Math.max(0, top.utilization!)) };
}
export const NEAR_FULL = 0.8;

// ---------- Waypoints ----------
// A plan's steps sit round the sun, the first at twelve o'clock and on clockwise; a second plan's are a ring further out.
export const WAY_R = 38, WAY_APART = 9, WAYS = 3, WAY_SIZE = 4;
export function wayAt(j: number, total: number, ring: number): { x: number; y: number } {
  const a = (2 * Math.PI * j) / Math.max(1, total), r = WAY_R + WAY_APART * ring;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

// ---------- Holding ----------
// What's waiting at the edge of the system: requests in the queue, jobs on a schedule, and pull
// requests that are open (red, when their checks are failing).
export type Ship = { id: string; kind: "queued" | "job" | "pr"; name: string; detail: string; bad?: boolean; held?: boolean; ref?: string; url?: string };
export const SHIPS = 12;
type Holding = Partial<Pick<CampState, "queued" | "jobs" | "prs">> | null | undefined;
export function shipsOf(S: Holding): Ship[] {
  const queued: Ship[] = (S?.queued ?? []).map((w) => ({
    id: `ship:q:${w.id}`, kind: "queued", name: w.task || w.label, ref: w.id,
    detail: w.held ? "Held: what it was waiting on didn't finish" : w.after ? "Waiting for the run before it" : "In the queue", ...(w.held ? { held: true } : {}),
  }));
  const prs: Ship[] = (S?.prs ?? []).filter((p) => p.state === "OPEN").map((p) => ({
    id: `ship:pr:${p.url}`, kind: "pr", name: `#${p.number} ${p.title}`, url: p.url, ...(p.failing > 0 ? { bad: true } : {}),
    detail: p.failing > 0 ? `${p.failing} ${plural(p.failing, "check")} failing` : p.conflicts ? "Conflicts with its base" : p.pending > 0 ? "Checks running" : p.review === "approved" ? "Approved" : p.review === "changes" ? "Changes asked for" : "Checks passing",
  }));
  const jobs: Ship[] = (S?.jobs ?? []).filter((j) => j.enabled).map((j) => ({ id: `ship:job:${j.name}`, kind: "job", name: j.name, detail: j.schedule }));
  return [...queued, ...prs, ...jobs];
}
// Where they hold: along the rim to the upper left (clear of the panel, and of the bars), a few degrees apart.
// In degrees, clockwise from due right, as the planets' places are.
export const SHIP_OUT = 20, SHIP_APART = 7, SHIP_MID = 215;
export const shipAt = (j: number, n: number) => SHIP_MID + (j - (Math.min(n, SHIPS) - 1) / 2) * SHIP_APART;
