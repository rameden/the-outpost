// Small helpers that several parts of the camp had each written out for themselves: cutting text
// to length, days and weeks, and reading JSON out of a model's reply.
//
// No imports from the rest of the camp, so anything can use it without import cycles.

import { existsSync, statSync } from "node:fs";

// ---------- Text ----------
// On one line (runs of whitespace closed up), cut to n characters with an ellipsis.
export const flat = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// The same, with no space left before the ellipsis.
export const flatTrim = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
// Cut to n characters with its lines kept (what someone wrote, shown as they wrote it).
export const clip = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\r\n/g, "\n").trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };

// The JSON list ("[") or object ("{") in a model's reply, whatever prose or code fence is around
// it. undefined if there's none, or it can't be parsed.
export function jsonIn(raw: string, open: "[" | "{"): unknown {
  const m = (open === "[" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/).exec(raw.replace(/```(?:json)?/gi, ""));
  if (!m) return undefined;
  try { return JSON.parse(m[0]); } catch { return undefined; }
}

// ---------- Days and weeks ----------
// A project's id, and a day or a week (named by its Monday) as YYYY-MM-DD: checked before either goes into a path.
export const SAFE_ID = /^[a-z0-9]{1,24}$/;
export const WEEK = /^\d{4}-\d{2}-\d{2}$/;
// The day a moment falls on in your local time, as YYYY-MM-DD.
export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Today's date as files are stamped with it (UTC).
export const today = () => new Date().toISOString().slice(0, 10);
// A week, from its Monday's midnight (local) to the next one's, in milliseconds.
export function weekSpan(week: string): { from: number; to: number } {
  const [y, m, d] = week.split("-").map(Number);
  return { from: new Date(y, m - 1, d).getTime(), to: new Date(y, m - 1, d + 7).getTime() };
}

// ---------- Numbers ----------
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// ---------- File stamps ----------
// A cache key for a path: cwd + mtime/size/ino (or "none"). Same idea as settings.ts.
export function fileStamp(path: string): string {
  try {
    const st = existsSync(path) ? statSync(path) : null;
    return `${process.cwd()}|${st ? `${st.mtimeMs}:${st.size}:${st.ino}` : "none"}`;
  } catch { return `${process.cwd()}|none`; }
}
// Directory stamp: mtime of the folder itself (enough to invalidate a wiki/skills listing).
export function dirStamp(path: string): string {
  try {
    const st = existsSync(path) ? statSync(path) : null;
    return `${process.cwd()}|${st ? `${st.mtimeMs}:${st.ino}` : "none"}`;
  } catch { return `${process.cwd()}|none`; }
}
