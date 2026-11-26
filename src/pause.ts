// Pause everything: while the file camp/PAUSE is there, nothing new starts. Scheduled jobs don't
// come due, triggers aren't polled, queued and chained requests stay in the queue, a goal sends no
// further round, and the outpost's own upkeep (retro, debriefs, the night shift) waits. Work
// that's already running is left to finish: this stops the next thing, not the current one (Stop
// does that).
//
// It's a file so that it works from anywhere: the switch in mission control, `/pause` in the
// terminal, or `touch camp/PAUSE` from a shell when the outpost is misbehaving and you want it to
// hold still. Delete the file (or `/resume`) and everything picks up where it was.
//
// The file may hold { since, reason } as JSON, for the page to show. Its contents are never
// needed: an empty or unreadable file pauses just the same, so a half-written one can't let work
// through.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { emit } from "./events.js";

export const PAUSE_PATH = "camp/PAUSE";

export type PauseState = { since?: string; reason?: string };

export const isPaused = (): boolean => existsSync(PAUSE_PATH);

export function pauseState(): PauseState | null {
  if (!isPaused()) return null;
  try {
    const held = JSON.parse(readFileSync(PAUSE_PATH, "utf8"));
    return {
      ...(typeof held?.since === "string" ? { since: held.since } : {}),
      ...(typeof held?.reason === "string" && held.reason.trim() ? { reason: held.reason.trim().slice(0, 300) } : {}),
    };
  } catch { return {}; } // touched by hand, or unreadable: paused all the same
}

// Both are safe to repeat: pausing twice keeps the first time and reason, resuming twice is nothing.
export function pause(reason?: string): PauseState {
  if (!isPaused()) {
    mkdirSync("camp", { recursive: true });
    const state: PauseState = { since: new Date().toISOString(), ...(reason?.trim() ? { reason: reason.trim().slice(0, 300) } : {}) };
    writeFileSync(PAUSE_PATH, JSON.stringify(state) + "\n");
    emit({ type: "changed", what: "pause" });
  }
  return pauseState() ?? {};
}

export function resume(): boolean {
  if (!isPaused()) return false;
  rmSync(PAUSE_PATH, { force: true });
  emit({ type: "changed", what: "pause" });
  return true;
}

// What to say to someone whose request can't start for now.
export function pausedNote(state: PauseState | null = pauseState()): string {
  if (!state) return "";
  const since = state.since && Number.isFinite(Date.parse(state.since)) ? ` since ${new Date(state.since).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}` : "";
  return `Outpost is paused${since}${state.reason ? ` (${state.reason})` : ""}: nothing new starts until you resume it.`;
}
