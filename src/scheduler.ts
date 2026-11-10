// Running scheduled jobs. Shared by `npm run watch` (terminal) and mission control (`npm run ui`).
// Results land in camp/inbox.md (and as a macOS notification). When a run finds nothing
// new, it stays quiet: nothing is written and nothing pings you.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { runExpedition } from "./quartermaster.js";
import { isDue, loadJobs, saveJobs, QUIET_TOKEN, type Job } from "./jobs.js";
import { emit } from "./events.js";
import { pausedUntil } from "./limits.js";

// Only one process runs scheduled jobs at a time, so mission control, `npm run watch`, and a
// background `watch --once` can all be around without the same job running twice. The lock is a
// small file holding the owner's process id; a lock left by a process that has died is taken over.
export const SCHEDULER_LOCK = "camp/scheduler.lock";
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}
export function claimScheduler(owner: string): boolean {
  mkdirSync("camp", { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(SCHEDULER_LOCK, JSON.stringify({ pid: process.pid, owner, since: new Date().toISOString() }) + "\n", { flag: "wx" });
      process.once("exit", releaseScheduler);
      return true;
    } catch {
      let held: { pid?: number } = {};
      try { held = JSON.parse(readFileSync(SCHEDULER_LOCK, "utf8")); } catch { /* unreadable: treat as stale */ }
      if (held.pid === process.pid) return true;
      if (held.pid && alive(held.pid)) return false;
      rmSync(SCHEDULER_LOCK, { force: true }); // its owner is gone
    }
  }
  return false;
}
export function schedulerOwner(): { pid: number; owner: string } | null {
  try {
    const held = JSON.parse(readFileSync(SCHEDULER_LOCK, "utf8"));
    return held.pid && alive(held.pid) ? held : null;
  } catch { return null; }
}
export function releaseScheduler() {
  try { if (JSON.parse(readFileSync(SCHEDULER_LOCK, "utf8")).pid === process.pid) rmSync(SCHEDULER_LOCK, { force: true }); } catch { /* not ours */ }
}

export const INBOX_PATH = "camp/inbox.md";

function updateJob(name: string, patch: Partial<Job>) {
  // Re-read first: the camp may have added or changed jobs meanwhile.
  saveJobs(loadJobs().map((j) => (j.name === name ? { ...j, ...patch } : j)));
}

function jobBrief(job: Job): string {
  return (
    `This is the scheduled job "${job.name}" (${job.schedule}). Nobody is at the keyboard: ` +
    `don't ask questions, and the shell is unavailable.\n\n` +
    `Task:\n${job.task}\n\n` +
    (job.lastReport
      ? `What you reported last time (${job.lastRun ? new Date(job.lastRun).toLocaleString() : "unknown"}):\n${job.lastReport}\n\n`
      : "") +
    `Finish with the report the user should read. If there is nothing new or worth their ` +
    `attention since last time, reply with exactly ${QUIET_TOKEN} and nothing else, so they ` +
    `aren't pinged for nothing.`
  );
}

// Quiet if the reply is just the token, or ends with it on its own line.
export function isQuiet(text: string): boolean {
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length === 0 || lines[lines.length - 1] === QUIET_TOKEN;
}

function notify(title: string, message: string) {
  if (process.platform !== "darwin") return;
  const clean = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").slice(0, 180));
  execFile("osascript", ["-e", `display notification ${clean(message)} with title ${clean(title)}`], () => {});
}

function toInbox(heading: string, body: string) {
  mkdirSync("camp", { recursive: true });
  appendFileSync(INBOX_PATH, `\n## ${heading}\n\n${body}\n`);
  emit({ type: "changed", what: "inbox" });
}

export async function runJob(job: Job, signal?: AbortSignal, id?: string) {
  const started = new Date();
  const previousRun = job.lastRun;
  emit({ type: "job", name: job.name, outcome: "running" });
  updateJob(job.name, { lastRun: started.toISOString() }); // mark first, so a crash doesn't loop
  try {
    // Unattended: no shell, no prompts, nobody at the keyboard (for this run only).
    // A job scheduled in a project runs with that project's folders, notes, and defaults.
    const result = await runExpedition(jobBrief(job), { job: job.name, displayTask: job.task, signal, id, unattended: true, ...(job.project ? { project: job.project } : {}) });
    if (result.status === "stopped") {
      emit({ type: "job", name: job.name, outcome: "failed", text: "stopped by you" });
      return; // a half-finished run isn't a report
    }
    if (isQuiet(result.text)) {
      emit({ type: "job", name: job.name, outcome: "quiet" });
      return;
    }
    const report = result.text.trim();
    toInbox(`${started.toLocaleString()} · ${job.name}`, report);
    updateJob(job.name, { lastReport: report.slice(0, 3000) });
    notify(`Satchel: ${job.name}`, report);
    emit({ type: "job", name: job.name, outcome: "reported", text: report });
  } catch (err: any) {
    // Out of plan usage: not a failure worth a report. Put the job back so it runs after the reset.
    if (pausedUntil()) {
      updateJob(job.name, { lastRun: previousRun });
      emit({ type: "job", name: job.name, outcome: "failed", text: `${err.message} It will run after the reset.` });
      return;
    }
    toInbox(`${started.toLocaleString()} · ${job.name} (failed)`, err.message);
    emit({ type: "job", name: job.name, outcome: "failed", text: err.message });
  }
}

// While your plan's usage limit is used up, nothing is due: jobs wait for the reset.
export function dueJobs(): Job[] {
  if (pausedUntil()) return [];
  return loadJobs().filter((j) => isDue(j));
}

// The inbox as separate entries, newest first.
export function inboxEntries(limit = 30): { heading: string; body: string }[] {
  if (!existsSync(INBOX_PATH)) return [];
  return readFileSync(INBOX_PATH, "utf8")
    .split(/^## /m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [heading, ...rest] = chunk.split("\n");
      return { heading: heading.trim(), body: rest.join("\n").trim() };
    })
    .reverse()
    .slice(0, limit);
}
