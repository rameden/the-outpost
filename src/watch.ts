// The watch: runs scheduled jobs when mission control isn't open. Most people never run this by
// hand: an open outpost runs its own jobs, and `npm run watch:install` covers the rest.
//   npm run watch                    keep running; check for due jobs every 30 seconds
//   npm run watch -- --once          run whatever is due now, then exit (for cron or launchd)
//   npm run watch -- --run <name>    run one job right now, due or not (to try it out)
//   npm run watch:install            (macOS) run due jobs in the background every minute, even with
//                                    nothing open; npm run watch:uninstall removes it
// Mission control (`npm run ui`) runs jobs too. Only one of them runs jobs at a time (a lock in
// camp/scheduler.lock), so it's safe to have both going.

import { rl } from "./tools.js";
import { attachConsole } from "./events.js";
import { CREW } from "./crew.js";
import { say, w } from "./words.js";
import { claimJob, loadJobs } from "./jobs.js";
import { isPaused, pausedNote } from "./pause.js";
import { claimScheduler, dueJobs, runJob, schedulerOwner } from "./scheduler.js";

const TICK_MS = 30_000;
attachConsole(() => ({ lead: CREW.quartermaster.name, back: w("back"), say }));

// Mission control (or another watcher) may already be running jobs: then this one stands by.
let standingBy = false;
async function runDue() {
  if (!claimScheduler("watch")) {
    if (!standingBy) console.log(`⏸  ${schedulerOwner()?.owner === "ui" ? w("Hq") : "Another watcher"} is running the scheduled jobs; standing by.`);
    standingBy = true;
    return;
  }
  standingBy = false;
  // One at a time. Each is claimed first (its next run time moves on before it starts), so a crash
  // part-way, or a second watcher, never runs the same slot again.
  for (const due of dueJobs()) {
    const job = claimJob(due.name);
    if (job) await runJob(job, undefined, undefined, { claimed: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  if (runIdx >= 0) {
    const job = loadJobs().find((j) => j.name === args[runIdx + 1]);
    if (!job) console.log(`No job named "${args[runIdx + 1]}".`);
    else if (isPaused()) console.log(`⏸  ${pausedNote()}`);
    else await runJob(job, undefined, undefined, { asked: true });
    return;
  }
  if (args.includes("--once")) return runDue();

  const jobs = loadJobs();
  console.log(`🔭 Watching ${jobs.length} job${jobs.length === 1 ? "" : "s"}. Ctrl+C to stop.`);
  for (;;) {
    await runDue();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => {
    rl.close();
    if (process.argv.includes("--once") || process.argv.includes("--run")) process.exit(0);
  });
