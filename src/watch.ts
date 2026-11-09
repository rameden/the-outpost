// The watch: runs scheduled jobs from the terminal while you're away.
//   npm run watch                    keep running; check for due jobs every 30 seconds
//   npm run watch -- --once          run whatever is due now, then exit (for cron or launchd)
//   npm run watch -- --run <name>    run one job right now, due or not (to try it out)
// Mission control (`npm run ui`) runs jobs too, so run one or the other, not both.

import { rl } from "./tools.js";
import { attachConsole } from "./events.js";
import { loadJobs } from "./jobs.js";
import { dueJobs, runJob } from "./scheduler.js";

const TICK_MS = 30_000;
attachConsole();

async function runDue() {
  for (const job of dueJobs()) await runJob(job); // one at a time
}

async function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  if (runIdx >= 0) {
    const job = loadJobs().find((j) => j.name === args[runIdx + 1]);
    if (!job) console.log(`No job named "${args[runIdx + 1]}".`);
    else await runJob(job);
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
