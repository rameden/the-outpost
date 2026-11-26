// Scheduled jobs: expeditions that run on their own while the outpost is running.
// Jobs live in camp/jobs.json. The Quartermaster can add them (you confirm each one),
// and you can edit the file by hand too.

import { readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { campMode, type Tool } from "./tools.js";
import { ask } from "./ask.js";
import { emit } from "./events.js";
import { currentProjectId } from "./context.js";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { say } from "./words.js";
import { EFFORTS, TURNS_MAX, TURNS_MIN, type Effort } from "./settings.js";
import { cronMinGap, cronNext, looksLikeCron, parseCron, validTimeZone, type CronSpec } from "./cron.js";
import { isPaused } from "./pause.js";

export const JOBS_PATH = "camp/jobs.json";
export const QUIET_TOKEN = "NOTHING_NEW";

export type Job = {
  name: string;
  schedule: string;     // "every 30m", "every 2h", "daily 08:00", "weekdays 08:00", or a cron line: "*/15 9-17 * * 1-5"
  timezone?: string;    // the zone a time of day (daily, weekdays, cron) is read in, e.g. "Europe/London". Left out: this machine's.
  task: string;         // a self-contained request for the Quartermaster
  created: string;      // ISO time
  enabled: boolean;
  lastRun?: string;     // ISO time the last run started
  lastReport?: string;  // what it last told you, so the next run can tell what's new
  lastReportAt?: string; // ISO time of the run that said it (a quiet run since leaves it as it was)
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
  // A shell command that runs before the model each time (in the outpost's folder, two minutes at
  // most). What it prints is added to the task, so the run starts from fresh facts it didn't have
  // to go and fetch. When it prints nothing, or exits with `skipExit`, there's nothing to do and
  // the model isn't called at all. It only ever runs as you approved it (see scriptApproved).
  script?: string;
  noAgent?: boolean;    // the script is the whole job: what it prints is the report, and no model is called
  skipExit?: number;    // the exit code by which the script says "nothing to do this time" (1-255)
  contextFrom?: string[]; // other jobs whose latest report is given to this one's run
};

export type Schedule =
  | { kind: "every"; ms: number }
  | { kind: "daily"; hour: number; minute: number; weekdaysOnly: boolean }
  | { kind: "cron"; spec: CronSpec };

export const MIN_INTERVAL_MS = 5 * 60_000; // nothing more often than every 5 minutes, however it's written
export const SCHEDULE_HELP = "'every 30m', 'every 2h', 'daily 08:00', 'weekdays 08:00', or a 5-field cron line such as '*/15 9-17 * * 1-5' (at most every 5 minutes)";

// Read once per distinct text: this is asked for every job on every tick.
const parsed = new Map<string, Schedule | null>();
export function parseSchedule(s: string): Schedule | null {
  if (typeof s !== "string") return null;
  const key = s.trim().toLowerCase();
  if (!parsed.has(key)) { if (parsed.size > 500) parsed.clear(); parsed.set(key, readSchedule(key)); }
  return parsed.get(key)!;
}

// Why a schedule can't be used, in words for whoever wrote it. null: it's fine.
export function scheduleProblem(schedule: string, timezone?: string): string | null {
  if (timezone !== undefined && !validTimeZone(timezone)) return `Unknown time zone '${timezone}'. Use a name like 'Europe/London' or 'America/New_York'.`;
  if (parseSchedule(schedule)) return null;
  const cron = looksLikeCron(schedule) ? parseCron(schedule) : null;
  if (cron && cronMinGap(cron) < MIN_INTERVAL_MS) return `'${schedule}' would run more often than every 5 minutes, which is the most a job may.`;
  if (cron) return `'${schedule}' never comes round.`;
  return `Can't read schedule '${schedule}'. Use ${SCHEDULE_HELP}.`;
}

function readSchedule(t: string): Schedule | null {
  const every = t.match(/^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2][0];
    const ms = n * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
    return ms >= MIN_INTERVAL_MS ? { kind: "every", ms } : null;
  }
  const daily = t.match(/^(daily|weekdays)\s+(\d{1,2}):(\d{2})$/);
  if (daily) {
    const hour = Number(daily[2]);
    const minute = Number(daily[3]);
    if (hour > 23 || minute > 59) return null;
    return { kind: "daily", hour, minute, weekdaysOnly: daily[1] === "weekdays" };
  }
  if (looksLikeCron(t)) {
    const spec = parseCron(t);
    const gap = spec ? cronMinGap(spec) : 0;
    return spec && gap >= MIN_INTERVAL_MS && cronNext(spec, new Date(), "UTC") ? { kind: "cron", spec } : null;
  }
  return null;
}

// The first time after `after` a schedule comes round. A time of day is read in `zone` (the
// machine's own when there's none), by the same clock arithmetic as a cron line.
export function nextAfter(s: Schedule, after: Date, zone?: string): Date | null {
  if (s.kind === "every") return new Date(after.getTime() + s.ms);
  const spec = s.kind === "cron" ? s.spec : parseCron(`${s.minute} ${s.hour} * * ${s.weekdaysOnly ? "1-5" : "*"}`)!;
  return cronNext(spec, after, zone);
}

const jobZone = (job: Pick<Job, "timezone">) => (job.timezone && validTimeZone(job.timezone) ? job.timezone : undefined);
const dateOf = (iso?: string) => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d : null; };

// When a job next comes due. It follows from the schedule and the last time the job was handed
// out (lastRun), so there's one fact to keep right, and stamping lastRun is what moves it on.
// A job on an interval that has never run is due straight away; one set for a time of day waits
// for its first real slot after it was made. null: no readable schedule, or nothing to count from.
export function nextRunOf(job: Job): Date | null {
  const s = parseSchedule(job.schedule);
  if (!s) return null;
  const last = dateOf(job.lastRun);
  if (s.kind === "every") return last ? nextAfter(s, last) : (dateOf(job.created) ?? new Date(0));
  const since = last ?? dateOf(job.created);
  return since ? nextAfter(s, since, jobZone(job)) : null;
}

// A missed run (the watcher was off) fires once when it comes back, not once per miss.
export function isDue(job: Job, now = new Date()): boolean {
  if (!job.enabled) return false;
  const next = nextRunOf(job);
  return !!next && next.getTime() <= now.getTime();
}

// Hand a due job out to be run, once. The file is read again, the job checked to be still due,
// and its lastRun stamped before anything is started: so the next run time has already moved on
// when the run begins, and a crash (or a second process looking at the same moment) can't start
// the same slot twice. A slot whose run never got going is lost, not repeated. Returns the job as
// it was before the stamp (its last run and report are what the run compares against), or null
// when there's nothing to hand out: not due any more, switched off, gone, or everything is paused.
export function claimJob(name: string, now = new Date()): Job | null {
  if (isPaused()) return null;
  const jobs = loadJobs();
  const job = jobs.find((j) => j.name === name);
  if (!job || !isDue(job, now)) return null;
  saveJobs(jobs.map((j) => (j.name === name ? { ...j, lastRun: now.toISOString() } : j)));
  return job;
}

// ---------- A job's script, and your say-so ----------
// A script is a shell command that runs with nobody watching, so it runs only as you approved it:
// on the card when the crew proposes the job, or by saving the job yourself in mission control.
// What you approved is kept by job name in camp/job-scripts.json, which no crew member's file
// tools or sandboxed commands can touch (it's among the private camp files in tools.ts).
// camp/jobs.json itself is open to them and to hand edits, so a script that appears or changes
// there without your say-so simply doesn't run, and the job tells you why.
export const JOB_SCRIPTS_PATH = "camp/job-scripts.json";
const scriptHash = (script: string) => createHash("sha256").update(script.trim()).digest("hex");
const approvedScripts = (): Record<string, string> => {
  const held = readJsonFile(JOB_SCRIPTS_PATH, {});
  return held && typeof held === "object" && !Array.isArray(held) ? (held as Record<string, string>) : {};
};
export function scriptApproved(job: Pick<Job, "name" | "script">): boolean {
  return !!job.script?.trim() && approvedScripts()[job.name] === scriptHash(job.script);
}
// script undefined: the job has none (any more), and its entry is dropped.
export function approveScript(name: string, script?: string) {
  const { [name]: _was, ...rest } = approvedScripts();
  writeJsonAtomic(JOB_SCRIPTS_PATH, script?.trim() ? { ...rest, [name]: scriptHash(script) } : rest);
}

// The fields a job may carry beyond its name, schedule and task, read from whatever was sent (the
// schedule_job tool, mission control's form, or the file by hand, where no_agent and context_from
// are as welcome as noAgent and contextFrom). Anything unusable is an error in words, not a guess.
export type JobExtras = Pick<Job, "timezone" | "script" | "noAgent" | "skipExit" | "contextFrom">;
export function jobExtras(input: Record<string, unknown>, name: string, known: string[]): JobExtras | { error: string } {
  const out: JobExtras = {};
  const zone = input.timezone ?? input.tz;
  if (typeof zone === "string" && zone.trim()) out.timezone = zone.trim();
  if (typeof input.script === "string" && input.script.trim()) out.script = input.script.trim();
  if ((input.noAgent ?? input.no_agent) === true) out.noAgent = true;
  const exit = input.skipExit ?? input.skip_exit;
  if (exit !== undefined && exit !== null && exit !== "") {
    const n = Number(exit);
    if (!Number.isInteger(n) || n < 1 || n > 255) return { error: "The exit code that means 'nothing to do' must be a whole number from 1 to 255." };
    out.skipExit = n;
  }
  const from = input.contextFrom ?? input.context_from;
  const names = [...new Set((Array.isArray(from) ? from : typeof from === "string" ? from.split(",") : []).filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean))];
  if (names.includes(name)) return { error: "A job can't take its own output as context." };
  const missing = names.filter((n) => !known.includes(n));
  if (missing.length) return { error: `No job named ${missing.map((n) => `"${n}"`).join(", ")} to take output from.` };
  if (names.length) out.contextFrom = names;
  if (out.noAgent && !out.script) return { error: "A job with no agent needs a script: the script is the whole job." };
  if (out.skipExit !== undefined && !out.script) return { error: "An exit code to skip on only means something with a script." };
  if (out.timezone !== undefined && !validTimeZone(out.timezone)) return { error: `Unknown time zone '${out.timezone}'. Use a name like 'Europe/London' or 'America/New_York'.` };
  return out;
}

export function loadJobs(): Job[] {
  // The file invites hand edits, and this runs on a timer: a typo must not take the camp down.
  // An unreadable file is kept aside (atomic.ts) and no jobs run until it's fixed.
  const jobs = readJsonFile(JOBS_PATH, []);
  return Array.isArray(jobs) ? (jobs as Job[]).filter((j) => j && typeof j.name === "string").map(byHand) : [];
}
// Written by hand, the newer fields may be spelled the way other tools spell them.
function byHand(job: Job): Job {
  const { no_agent, context_from, skip_exit, tz, ...rest } = job as Job & { no_agent?: unknown; context_from?: unknown; skip_exit?: unknown; tz?: unknown };
  if (no_agent === undefined && context_from === undefined && skip_exit === undefined && tz === undefined) return job;
  return {
    ...rest,
    ...(rest.noAgent === undefined && no_agent === true ? { noAgent: true } : {}),
    ...(rest.contextFrom === undefined && (Array.isArray(context_from) || typeof context_from === "string") ? { contextFrom: (Array.isArray(context_from) ? context_from : [context_from]).filter((n): n is string => typeof n === "string") } : {}),
    ...(rest.skipExit === undefined && typeof skip_exit === "number" ? { skipExit: skip_exit } : {}),
    ...(rest.timezone === undefined && typeof tz === "string" ? { timezone: tz } : {}),
  };
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
      const script = j.script ? `, ${j.noAgent ? "script only" : "script first"}${scriptApproved(j) ? "" : " (not approved yet, so it won't run)"}` : "";
      const context = j.contextFrom?.length ? `, given the latest from ${j.contextFrom.join(", ")}` : "";
      return `- ${j.name} (${j.schedule}${j.timezone ? ` ${j.timezone}` : ""}, ${state}, ${last}${cost ? `, ${cost}` : ""}${watch}${script}${context}): ${j.task}`;
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

// A job saved by you, from mission control's form: a new one, or an edit, which keeps what the
// job has learned (when it last ran, what it last said). Your saving it is your say-so for its
// script. What isn't on the form (model, effort, turns) stays as the job had it.
export function saveJobByHand(input: Record<string, unknown>): { job: Job } | { error: string } {
  const name = String(input.name ?? "").trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return { error: `Job names are lower-case words joined by dashes, like "morning-digest" (got '${name}').` };
  const schedule = String(input.schedule ?? "").trim();
  const task = String(input.task ?? "").trim();
  const jobs = loadJobs();
  const was = jobs.find((j) => j.name === name);
  const extras = jobExtras(input, name, jobs.map((j) => j.name));
  if ("error" in extras) return extras;
  if (!task && !extras.noAgent) return { error: "Say what the job should do." };
  const problem = scheduleProblem(schedule, extras.timezone);
  if (problem) return { error: problem };
  const watch = typeof input.watch === "string" ? input.watch.split(",") : input.watch;
  const job: Job = {
    name, schedule, task: task || `Run the script and report what it prints.`,
    created: was?.created ?? new Date().toISOString(), enabled: was?.enabled ?? true,
    ...(was?.lastRun ? { lastRun: was.lastRun } : {}), ...(was?.lastReport ? { lastReport: was.lastReport } : {}), ...(was?.lastReportAt ? { lastReportAt: was.lastReportAt } : {}),
    ...(was?.project ? { project: was.project } : typeof input.project === "string" && input.project && input.project !== "general" ? { project: input.project } : {}),
    ...jobCost({ model: input.model ?? was?.model, effort: input.effort ?? was?.effort, maxTurns: input.maxTurns ?? was?.maxTurns }),
    ...jobWatch(watch), ...extras,
  };
  approveScript(name, job.script);
  saveJobs(was ? jobs.map((j) => (j.name === name ? job : j)) : [...jobs, job]);
  return { job };
}

export const scheduleJob: Tool = {
  get def(): Tool["def"] { return { // built as it's asked for: the words are the active pack's
    name: "schedule_job",
    description:
      say("Schedule {an expedition} to run on its own, on time, while the user's outpost is running. ") +
      "Each run starts fresh with only `task` to go on, so make it self-contained: what " +
      "to check or produce, where to save it, and what counts as worth reporting. Runs cannot " +
      "use the shell. The user confirms every new job. Schedules: 'every 30m', 'every 2h', " +
      "'daily 08:00', 'weekdays 08:00', or a standard 5-field cron line ('*/15 9-17 * * 1-5'); at " +
      "most every 5 minutes, in local time unless `timezone` says otherwise. A job may have a " +
      "`script`: one shell command run before each run, whose output is added to the task (and when " +
      "it prints nothing, the run is skipped at no cost), so use it to fetch or check the facts " +
      "a run starts from. The user sees the script and approves it with the job.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case, e.g. 'morning-brief'" },
        schedule: { type: "string", description: "'every 30m', 'every 2h', 'daily 08:00', 'weekdays 08:00', or a cron line: 'minute hour day-of-month month day-of-week'." },
        timezone: { type: "string", description: "Optional: the IANA time zone the schedule's time of day is read in, e.g. 'Europe/London'. Default: the user's own." },
        task: { type: "string" },
        model: { type: "string", description: "Optional: a cheaper model for this job (otherwise the defaults for jobs)." },
        effort: { type: "string", enum: [...EFFORTS], description: "Optional: how hard this job thinks (default: low)." },
        maxTurns: { type: "number", description: `Optional: turn cap for this job (${TURNS_MIN}–${TURNS_MAX}; default: 12).` },
        watch: { type: "array", items: { type: "string" }, description: "Optional: files or folders this job watches. When set, a run is skipped while nothing in them has changed since the last run. Only for jobs whose whole subject is those files; leave it out for anything that depends on the web, mail, the date or the time." },
        script: { type: "string", description: "Optional: a shell command run before each run, in the outpost's folder (2 minutes at most). Its output is added to the task. No output, or the exit code in skip_exit, means nothing to do: the run is skipped and no model is called. Any other failure is reported." },
        no_agent: { type: "boolean", description: "Optional, with script: the script is the whole job. Its output is the report, word for word, and no model is called." },
        skip_exit: { type: "number", description: "Optional, with script: the exit code (1-255) by which the script says there's nothing to do this time." },
        context_from: { type: "array", items: { type: "string" }, description: "Optional: names of other jobs whose latest report this job's run is given (a digest job reading what a collector job found, say)." },
      },
      required: ["name", "schedule", "task"],
    },
  }; },
  run: async (input) => {
    const { name, schedule, task, model, effort, maxTurns, watch } = input;
    if (campMode.unattended) return "Scheduled jobs can't create other jobs.";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return `Job names must be kebab-case (got '${name}').`;
    const extras = jobExtras(input, name, loadJobs().map((j) => j.name));
    if ("error" in extras) return extras.error;
    const problem = scheduleProblem(schedule, extras.timezone);
    if (problem) return problem;
    const cost = { ...jobCost({ model, effort, maxTurns }), ...jobWatch(watch), ...extras };
    const existing = loadJobs().some((j) => j.name === name);
    const ok = await ask({
      kind: "job",
      title: `⏰ ${existing ? "Replace" : "New"} scheduled job "${name}" (${schedule}${extras.timezone ? `, ${extras.timezone}` : ""}):`,
      body: [
        task,
        cost.watch && `Skipped while nothing changes in: ${cost.watch.join(", ")}`,
        // The script word for word: saying yes is what lets it run unattended.
        extras.script && `${extras.noAgent ? "Runs this command each time, and reports what it prints (no model is called)" : "Runs this command first, each time, and adds what it prints to the task"}:\n\n    ${extras.script.replace(/\n/g, "\n    ")}` +
          (extras.skipExit !== undefined ? `\n\nExit code ${extras.skipExit} from it means nothing to do.` : ""),
        extras.contextFrom && `Given the latest report from: ${extras.contextFrom.join(", ")}`,
      ].filter(Boolean).join("\n\n"),
    });
    if (ok.toLowerCase() !== "y") return "The user declined this job.";
    const project = currentProjectId();
    const job: Job = { name, schedule, task, created: new Date().toISOString(), enabled: true, ...cost, ...(project && project !== "general" ? { project } : {}) };
    approveScript(name, job.script);
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
    approveScript(name); // a later job of the same name starts with nothing approved
    return `Cancelled "${name}".`;
  },
};
