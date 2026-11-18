// Your Claude plan's usage limits, as Claude Code reports them during subscription runs: the
// 5-hour and weekly windows, how full each is, and when it resets. When a window is used up the
// camp pauses instead of failing: queued expeditions and scheduled jobs wait for the reset.
// Kept in camp/limits.json so a restart (or a `watch --once` run) still knows about a pause.

import { existsSync, readFileSync, statSync } from "node:fs";
import { writeJsonAtomic } from "./atomic.js";
import { emit } from "./events.js";
import { campRuntime } from "./settings.js";

export const LIMITS_PATH = "camp/limits.json";
export type PlanLimit = {
  type: string;                                   // five_hour, seven_day, seven_day_opus…
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;                           // 0–1
  resetsAt?: number;                              // ms since epoch
  seen: number;                                   // when Claude Code last reported it
  measured?: number;                              // when its utilization was last read from your plan's own usage figures
};
// Extra usage: once a plan window is used up, Claude Code can carry on by drawing on credit.
// Amounts are in the currency's own units (dollars, not cents).
export type Credit = {
  enabled?: boolean;                              // whether your plan can draw on credit at all
  limit?: number | null;                          // the monthly cap (null: no cap)
  used?: number | null;                           // spent on credit this month
  currency?: string;                              // USD, EUR…
  measured?: number;                              // when these figures were last read from your plan
  inUse?: boolean;                                // the crew is running on credit right now
  until?: number;                                 // …until this (the reset of the window that ran out)
  out?: boolean;                                  // credit is used up (or can't cover more work)
  seen?: number;                                  // when Claude Code last said anything about it
};
type Saved = { limits: Record<string, PlanLimit>; resumed?: number; credit?: Credit };

// Kept until the file changes: `npm run watch` and mission control both write it, and each must
// see what the other noted (a pause one of them hit holds for both).
let cache: Saved | null = null;
let cacheKey = "";
const fileKey = () => { try { const st = statSync(LIMITS_PATH); return `${process.cwd()}|${st.mtimeMs}:${st.size}`; } catch { return `${process.cwd()}|none`; } };
function load(): Saved {
  const key = fileKey();
  if (cache && cacheKey === key) return cache;
  try { cache = existsSync(LIMITS_PATH) ? (JSON.parse(readFileSync(LIMITS_PATH, "utf8")) as Saved) : { limits: {} }; }
  catch { cache = { limits: {} }; }
  cache.limits ??= {};
  cacheKey = key;
  return cache;
}
function save(s: Saved) {
  writeJsonAtomic(LIMITS_PATH, s);
  cache = s;
  cacheKey = fileKey();
}

const LABELS: Record<string, string> = {
  five_hour: "5-hour limit", seven_day: "weekly limit", seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit", overage: "extra usage",
};
// "model:Fable" is a weekly limit of its own for one model.
export const limitLabel = (type: string) => LABELS[type] ?? (type.startsWith("model:") ? `weekly ${type.slice(6)} limit` : type.replace(/_/g, " "));

// From Claude Code's rate_limit_event. Times may arrive in seconds; utilization as 0–1 or 0–100.
const ms = (t: unknown) => typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : undefined;
export function noteRateLimit(info: { status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number; isUsingOverage?: boolean; overageStatus?: string; overageDisabledReason?: string }) {
  if (!info || (info.status !== "allowed" && info.status !== "allowed_warning" && info.status !== "rejected")) return;
  const type = info.rateLimitType ?? "five_hour";
  const resetsAt = ms(info.resetsAt);
  noteCreditEvent(info, resetsAt);
  const utilization = typeof info.utilization === "number" ? (info.utilization > 1 ? info.utilization / 100 : info.utilization) : undefined;
  // Still running on extra usage: the plan window is full, but work isn't blocked.
  const status = info.status === "rejected" && info.isUsingOverage ? "allowed_warning" : info.status;
  const s = load();
  const before = s.limits[type];
  // Most events say only "allowed", with no figure. The figure we have is kept only while it's
  // still about the same window, and never a "used up" that the window has since moved past:
  // otherwise a limit that reset shows as 100% used for the rest of the day.
  // (The two sources name a window's reset to different precision, so "the same" is within a minute.)
  const sameWindow = !!before && (resetsAt === undefined || (before.resetsAt !== undefined && Math.abs(before.resetsAt - resetsAt) < 60_000));
  const kept = sameWindow && !(before!.status === "rejected" && status !== "rejected") ? before!.utilization : undefined;
  const next: PlanLimit = { type, status, utilization: utilization ?? (status === "rejected" ? 1 : kept), resetsAt: resetsAt ?? before?.resetsAt, seen: Date.now(),
    ...(utilization === undefined && kept !== undefined && before?.measured ? { measured: before.measured } : {}) };
  const changed = !before || before.status !== next.status || !sameWindow ||
    Math.round((before.utilization ?? 0) * 100) !== Math.round((next.utilization ?? 0) * 100);
  save({ ...s, limits: { ...s.limits, [type]: next } });
  if (changed) emit({ type: "changed", what: "limits" });
}

// What a run event says about credit: whether this run is drawing on it, and whether it ran out.
function noteCreditEvent(info: { isUsingOverage?: boolean; overageStatus?: string; overageDisabledReason?: string }, resetsAt?: number) {
  const out = info.overageStatus === "rejected" || info.overageDisabledReason === "out_of_credits";
  if (info.isUsingOverage === undefined && !out) return;
  const s = load();
  const before = s.credit ?? {};
  const inUse = !!info.isUsingOverage && !out;
  const next: Credit = { ...before, inUse, until: inUse ? resetsAt ?? before.until : undefined, out, seen: Date.now() };
  if (before.inUse === next.inUse && !!before.out === out && before.until === next.until) return;
  save({ ...s, credit: next });
  emit({ type: "changed", what: "limits" });
}

// Extra usage as your plan reports it (Claude Code's usage read): amounts arrive in minor units
// (cents for USD), so they're turned into the currency's own units here.
export type ExtraUsage = { is_enabled?: boolean; monthly_limit?: number | null; used_credits?: number | null; currency?: string | null };
export function noteCredit(extra: ExtraUsage | null | undefined, now = Date.now()) {
  if (!extra || typeof extra !== "object") return;
  const currency = typeof extra.currency === "string" && /^[A-Z]{3}$/.test(extra.currency) ? extra.currency : "USD";
  let digits = 2;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* unknown code: cents */ }
  const unit = (n: unknown) => typeof n === "number" ? n / 10 ** digits : null;
  const s = load();
  const limit = unit(extra.monthly_limit), used = unit(extra.used_credits);
  const out = !!extra.is_enabled && limit !== null && used !== null && used >= limit;
  save({ ...s, credit: { ...s.credit, enabled: !!extra.is_enabled, limit, used, currency, measured: now, out: out || (s.credit?.out && !extra.is_enabled) || undefined } });
  emit({ type: "changed", what: "limits" });
}

// Credit as the UI shows it: null when your plan has none and isn't using any.
export function creditState(now = Date.now()) {
  const c = load().credit;
  if (!c) return null;
  const inUse = !!c.inUse && (!c.until || c.until > now);
  if (!c.enabled && !inUse && !c.out) return null;
  const left = c.limit != null && c.used != null ? Math.max(0, c.limit - c.used) : null;
  return { inUse, until: inUse ? c.until ?? null : null, out: !!c.out, limit: c.limit ?? null, used: c.used ?? null, left, currency: c.currency ?? "USD", measured: c.measured ?? null };
}

// Your plan's own usage figures (what `/usage` shows in Claude Code): each window, how full, and
// when it resets. These are the real numbers; the events above mostly say only "still allowed".
// A window you've been told is used up stays used up until the figures say there's room again.
export type UsageWindow = { type: string; utilization: number; resetsAt?: number }; // utilization 0–1
export function noteUsage(windows: UsageWindow[], now = Date.now()) {
  if (!windows.length) return;
  const s = load();
  const limits = { ...s.limits };
  for (const w of windows) {
    const before = limits[w.type];
    const u = Math.max(0, Math.min(1, w.utilization));
    const status: PlanLimit["status"] = before?.status === "rejected" && u >= 1 ? "rejected" : u >= 0.8 ? "allowed_warning" : "allowed";
    limits[w.type] = { type: w.type, status, utilization: u, resetsAt: w.resetsAt ?? before?.resetsAt, seen: now, measured: now };
  }
  // A used-up window with extra usage on means the crew is on credit until it resets; no used-up
  // window means it isn't on credit any more.
  const full = windows.filter((w) => w.utilization >= 1);
  const credit = s.credit && (full.length ? (s.credit.enabled ? { ...s.credit, inUse: true, until: Math.max(...full.map((w) => w.resetsAt ?? 0)) || s.credit.until } : s.credit) : { ...s.credit, inUse: false, until: undefined });
  save({ ...s, limits, ...(credit ? { credit } : {}) });
  emit({ type: "changed", what: "limits" });
}
// When the figures were last read (0: never).
export const usageMeasuredAt = () => Math.max(0, ...Object.values(load().limits).map((l) => l.measured ?? 0));

// Current windows (ones whose reset time has passed are dropped).
export function planLimits(now = Date.now()): PlanLimit[] {
  return Object.values(load().limits).filter((l) => !l.resetsAt || l.resetsAt > now);
}

// If a window is used up: when work can start again (ms). Otherwise null.
// A rejection with no reset time holds for 5 minutes. "Try anyway" (resumeNow) clears the pause
// until Claude Code reports the limit again.
export function pausedUntil(now = Date.now()): number | null {
  if (campRuntime() !== "claude-code") return null;
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
