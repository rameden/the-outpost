// Your Claude plan's usage limits, as Claude Code reports them during subscription runs: the
// 5-hour and weekly windows, how full each is, and when it resets. When a window is used up the
// camp pauses instead of failing: queued expeditions and scheduled jobs wait for the reset.
// Kept in camp/limits.json so a restart (or a `watch --once` run) still knows about a pause.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { emit } from "./events.js";

export const LIMITS_PATH = "camp/limits.json";
export type PlanLimit = {
  type: string;                                   // five_hour, seven_day, seven_day_opus…
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;                           // 0–1
  resetsAt?: number;                              // ms since epoch
  seen: number;                                   // when Claude Code last reported it
};
type Saved = { limits: Record<string, PlanLimit>; resumed?: number };

let cache: Saved | null = null;
function load(): Saved {
  if (cache) return cache;
  try { cache = existsSync(LIMITS_PATH) ? (JSON.parse(readFileSync(LIMITS_PATH, "utf8")) as Saved) : { limits: {} }; }
  catch { cache = { limits: {} }; }
  cache.limits ??= {};
  return cache;
}
function save(s: Saved) {
  cache = s;
  mkdirSync("camp", { recursive: true });
  writeFileSync(LIMITS_PATH, JSON.stringify(s, null, 2) + "\n");
}

const LABELS: Record<string, string> = {
  five_hour: "5-hour limit", seven_day: "weekly limit", seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit", overage: "extra usage",
};
export const limitLabel = (type: string) => LABELS[type] ?? type.replace(/_/g, " ");

// From Claude Code's rate_limit_event. Times may arrive in seconds; utilization as 0–1 or 0–100.
export function noteRateLimit(info: { status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number; isUsingOverage?: boolean }) {
  if (!info || (info.status !== "allowed" && info.status !== "allowed_warning" && info.status !== "rejected")) return;
  const type = info.rateLimitType ?? "five_hour";
  const resetsAt = typeof info.resetsAt === "number" ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : undefined;
  const utilization = typeof info.utilization === "number" ? (info.utilization > 1 ? info.utilization / 100 : info.utilization) : undefined;
  // Still running on extra usage: the plan window is full, but work isn't blocked.
  const status = info.status === "rejected" && info.isUsingOverage ? "allowed_warning" : info.status;
  const s = load();
  const before = s.limits[type];
  const next: PlanLimit = { type, status, utilization: utilization ?? (status === "rejected" ? 1 : before?.utilization), resetsAt: resetsAt ?? before?.resetsAt, seen: Date.now() };
  const changed = !before || before.status !== next.status || before.resetsAt !== next.resetsAt ||
    Math.round((before.utilization ?? 0) * 100) !== Math.round((next.utilization ?? 0) * 100);
  save({ ...s, limits: { ...s.limits, [type]: next } });
  if (changed) emit({ type: "changed", what: "limits" });
}

// Current windows (ones whose reset time has passed are dropped).
export function planLimits(now = Date.now()): PlanLimit[] {
  return Object.values(load().limits).filter((l) => !l.resetsAt || l.resetsAt > now);
}

// If a window is used up: when work can start again (ms). Otherwise null.
// A rejection with no reset time holds for 5 minutes. "Try anyway" (resumeNow) clears the pause
// until Claude Code reports the limit again.
export function pausedUntil(now = Date.now()): number | null {
  const s = load();
  let until = 0;
  for (const l of Object.values(s.limits)) {
    if (l.status !== "rejected" || (s.resumed && s.resumed >= l.seen)) continue;
    const t = l.resetsAt ?? l.seen + 5 * 60_000;
    if (t > now) until = Math.max(until, t);
  }
  return until || null;
}

export function resumeNow() {
  save({ ...load(), resumed: Date.now() });
  emit({ type: "changed", what: "limits" });
}

export function pauseMessage(until: number): string {
  const blocked = planLimits().filter((l) => l.status === "rejected").map((l) => limitLabel(l.type));
  const at = new Date(until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return `Your Claude plan's ${blocked.join(" and ") || "usage limit"} is used up. It resets ${at}.`;
}

export function resetLimitsForTests() { cache = { limits: {} }; }
