// Auto in practice: a summary of this outpost's routing log.
//
//   npm run routing:report                 camp/routing.jsonl in this folder
//   npm run routing:report -- <file>       another log (an outpost's, or a saved copy)
//   npm run routing:report -- --json       the numbers as JSON
//   npm run routing:report -- --fixtures   also count runs an evaluation scripted
//
// It prints counts and dollar totals only: no task text, no file names. The work is in
// src/routing-summary.ts, which is pure.

import { existsSync, readFileSync } from "node:fs";
import { formatRoutingSummary, parseRoutingLog, summariseRouting } from "../src/routing-summary.ts";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) ?? "camp/routing.jsonl";
if (!existsSync(path)) {
  console.error(`No routing log at ${path}. It is written the first time a task runs with the model set to Auto.`);
  process.exit(1);
}
const summary = summariseRouting(parseRoutingLog(readFileSync(path, "utf8")), { includeFixtures: args.includes("--fixtures") });
console.log(args.includes("--json") ? JSON.stringify(summary, null, 2) : formatRoutingSummary(summary));
