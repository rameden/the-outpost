// Scheduled jobs: expeditions that run on their own while the outpost is running.
// Jobs live in camp/jobs.json. The Quartermaster can add them (you confirm each one),
// and you can edit the file by hand too.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { campMode, type Tool } from "./tools.js";
import { ask } from "./ask.js";
import { emit } from "./events.js";
import { currentProjectId } from "./context.js";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { say } from "./words.js";
import { EFFORTS, TURNS_MAX, TURNS_MIN, type Effort } from "./settings.js";

export const JOBS_PATH = "camp/jobs.json";
export const QUIET_TOKEN = "NOTHING_NEW";

export type Job = {
  name: string;
  schedule: string;     // "every 30m", "every 2h", "daily 08:00", "weekdays 08:00"
  task: string;         // a self-contained request for the Quartermaster
  created: string;      // ISO time
  enabled: boolean;
  lastRun?: string;     // ISO time the last run started
  lastReport?: string;  // what it last told you, so the next run can tell what's new
  project?: string;     // the project it was scheduled in: its runs see that project's folders and notes
  // What this job's runs use, set when it's scheduled or by hand in camp/jobs.json. Each one comes
  // ahead of how the Quartermaster is set in mission control; left out, that setting is used, and
  // JOB_DEFAULTS (quartermaster.ts) when there's none.
  model?: string;
  effort?: Effort;
  maxTurns?: number;
  // Files or folders this job is about and nothing else. When set, a run is skipped while nothing
  // in them has changed since the last run. Unset (the usual case): every run happens.
  watch?: string[];
};

type Schedule =
  | { kind: "every"; ms: number }
  | { kind: "daily"; hour: number; minute: number; weekdaysOnly: boolean };

export function parseSchedule(s: string): Schedule | null {
  const t = s.trim().toLowerCase();
  const every = t.match(/^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2][0];
    const ms = n * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
    return ms >= 5 * 60_000 ? { kind: "every", ms } : null; // nothing more often than every 5 minutes
  }
  const daily = t.match(/^(daily|weekdays)\s+(\d{1,2}):(\d{2})$/);
  if (daily) {
    const hour = Number(daily[2]);
    const minute = Number(daily[3]);
    if (hour > 23 || minute > 59) return null;
    return { kind: "daily", hour, minute, weekdaysOnly: daily[1] === "weekdays" };
  }
  return null;
}

// The most recent time (at or before `now`) a daily/weekday schedule should have fired.
function lastOccurrence(s: Extract<Schedule, { kind: "daily" }>, now: Date): Date {
  const d = new Date(now);
  d.setHours(s.hour, s.minute, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  while (s.weekdaysOnly && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() - 1);
  return d;
}

// A missed run (the watcher was off) fires once when it comes back, not once per miss.
export function isDue(job: Job, now = new Date()): boolean {
  if (!job.enabled) return false;
  const s = parseSchedule(job.schedule);
  if (!s) return false;
  const last = job.lastRun ? new Date(job.lastRun) : null;
  if (s.kind === "every") return !last || now.getTime() - last.getTime() >= s.ms;
  const occurrence = lastOccurrence(s, now);
  const since = last ?? new Date(job.created); // a new job waits for its first real slot
  return occurrence > since;
}

export function loadJobs(): Job[] {
  // The file invites hand edits, and this runs on a timer: a typo must not take the camp down.
  // An unreadable file is kept aside (atomic.ts) and no jobs run until it's fixed.
  const jobs = readJsonFile(JOBS_PATH, []);
  return Array.isArray(jobs) ? (jobs as Job[]).filter((j) => j && typeof j.name === "string") : [];
}

export function saveJobs(jobs: Job[]) {
  writeJsonAtomic(JOBS_PATH, jobs);
  emit({ type: "changed", what: "jobs" });
}

export function describeJobs(jobs = loadJobs()): string {
  if (jobs.length === 0) return "No scheduled jobs.";
  return jobs
    .map((j) => {
      const state = j.enabled ? "on" : "off";
      const last = j.lastRun
        ? `last ran ${new Date(j.lastRun).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
        : "never run";
      const cost = [j.model, j.effort && `${j.effort} effort`, j.maxTurns != null && `${j.maxTurns} turns`].filter(Boolean).join(", ");
      const watch = j.watch?.length ? `, skipped while ${j.watch.join(", ")} unchanged` : "";
      return `- ${j.name} (${j.schedule}, ${state}, ${last}${cost ? `, ${cost}` : ""}${watch}): ${j.task}`;
    })
    .join("\n");
}

// The newest change under a path: a file's own time, or for a folder the newest of everything in
// it, however deep (a folder's own time only moves when something is added to or removed from it
// directly, so it can't be trusted by itself). null when the path is missing or too big to check.
const WATCH_MAX_ENTRIES = 5000;
const WATCH_SKIP = new Set([".git", "node_modules"]);
function newestChange(path: string, budget: { left: number }): number | null {
  let st;
  try { st = statSync(path); } catch { return null; }
  if (--budget.left < 0) return null;
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  let names: string[];
  try { names = readdirSync(path); } catch { return null; }
  for (const name of names) {
    if (WATCH_SKIP.has(name)) continue;
    const inner = newestChange(join(path, name), budget);
    if (inner === null) return null;
    if (inner > newest) newest = inner;
  }
  return newest;
}
const watchPath = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

// A job is only ever skipped when it asks to be: it lists what it watches (`watch`), and a run is
// passed over while nothing there has changed since the last one. A job with no `watch` always
// runs, whatever paths its task happens to mention, because most jobs are about something outside
// the camp's files (the web, mail, the date). Anything uncertain (no earlier report, a path that's
// gone, a folder too big to check) means run.
export function nothingChanged(job: Pick<Job, "watch" | "lastReport"> & { task?: string }, since?: string): boolean {
  if (!since || !job.lastReport || !job.watch?.length) return false;
  const at = new Date(since).getTime();
  if (!Number.isFinite(at)) return false;
  const budget = { left: WATCH_MAX_ENTRIES };
  for (const p of job.watch) {
    const newest = newestChange(watchPath(p), budget);
    if (newest === null || newest > at) return false;
  }
  return true;
}

function jobWatch(input: unknown): Pick<Job, "watch"> {
  if (!Array.isArray(input)) return {};
  const watch = [...new Set(input.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean))];
  return watch.length ? { watch } : {};
}

function jobCost(input: { model?: unknown; effort?: unknown; maxTurns?: unknown }): Pick<Job, "model" | "effort" | "maxTurns"> {
  const out: Pick<Job, "model" | "effort" | "maxTurns"> = {};
  if (typeof input.model === "string" && input.model.trim()) out.model = input.model.trim();
  if (typeof input.effort === "string" && (EFFORTS as string[]).includes(input.effort)) out.effort = input.effort as Effort;
  if (typeof input.maxTurns === "number" && Number.isFinite(input.maxTurns)) {
    out.maxTurns = Math.max(TURNS_MIN, Math.min(TURNS_MAX, Math.round(input.maxTurns)));
  }
  return out;
}

export const scheduleJob: Tool = {
  get def(): Tool["def"] { return { // built as it's asked for: the words are the active pack's
    name: "schedule_job",
    description:
      say("Schedule {an expedition} to run on its own, on time, while the user's outpost is running. ") +
      "Each run starts fresh with only `task` to go on, so make it self-contained: what " +
      "to check or produce, where to save it, and what counts as worth reporting. Runs cannot " +
      "use the shell. The user confirms every new job. Schedules: 'every 30m', 'every 2h', " +
      "'daily 08:00', 'weekdays 08:00' (local time, at most every 5 minutes).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case, e.g. 'morning-brief'" },
        schedule: { type: "string" },
        task: { type: "string" },
        model: { type: "string", description: "Optional: a cheaper model for this job (otherwise the camp's job defaults)." },
        effort: { type: "string", enum: [...EFFORTS], description: "Optional: how hard this job thinks (default: low)." },
        maxTurns: { type: "number", description: `Optional: turn cap for this job (${TURNS_MIN}–${TURNS_MAX}; default: 12).` },
        watch: { type: "array", items: { type: "string" }, description: "Optional: files or folders this job watches. When set, a run is skipped while nothing in them has changed since the last run. Only for jobs whose whole subject is those files; leave it out for anything that depends on the web, mail, the date or the time." },
      },
      required: ["name", "schedule", "task"],
    },
  }; },
  run: async ({ name, schedule, task, model, effort, maxTurns, watch }) => {
    if (campMode.unattended) return "Scheduled jobs can't create other jobs.";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return `Job names must be kebab-case (got '${name}').`;
    if (!parseSchedule(schedule)) {
      return `Can't read schedule '${schedule}'. Use 'every 30m', 'every 2h', 'daily 08:00', or 'weekdays 08:00'.`;
    }
    const cost = { ...jobCost({ model, effort, maxTurns }), ...jobWatch(watch) };
    const existing = loadJobs().some((j) => j.name === name);
    const ok = await ask({
      kind: "job",
      title: `⏰ ${existing ? "Replace" : "New"} scheduled job "${name}" (${schedule}):`,
      body: cost.watch ? `${task}\n\nSkipped while nothing changes in: ${cost.watch.join(", ")}` : task,
    });
    if (ok.toLowerCase() !== "y") return "The user declined this job.";
    const project = currentProjectId();
    const job: Job = { name, schedule, task, created: new Date().toISOString(), enabled: true, ...cost, ...(project && project !== "general" ? { project } : {}) };
    // Read again: the answer can be minutes in coming, and meanwhile the watcher has marked runs
    // and other jobs may have been added or cancelled. What was approved is this job under this
    // name, so it takes that name's place if one is there now, and is added if not.
    const jobs = loadJobs();
    saveJobs(jobs.some((j) => j.name === name) ? jobs.map((j) => (j.name === name ? job : j)) : [...jobs, job]);
    return `Scheduled "${name}" (${schedule}). It runs on schedule while the outpost is running.`;
  },
};

export const listJobs: Tool = {
  get def(): Tool["def"] { return {
    name: "list_jobs",
    description: say("List the {camp}'s scheduled jobs."),
    input_schema: { type: "object", properties: {} },
  }; },
  run: async () => describeJobs(),
};

export const cancelJob: Tool = {
  def: {
    name: "cancel_job",
    description: "Remove a scheduled job by name.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  run: async ({ name }) => {
    if (campMode.unattended) return "Scheduled jobs can't cancel jobs.";
    const jobs = loadJobs();
    if (!jobs.some((j) => j.name === name)) return `No job named "${name}".`;
    saveJobs(jobs.filter((j) => j.name !== name));
    return `Cancelled "${name}".`;
  },
};
