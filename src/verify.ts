// Automatic checks: commands you list for a linked folder ("verify" in camp/links.json, or the
// folder's card under Connectors) run by themselves after a quest changes files there, and their
// results are attached to the quest's report. The Quartermaster sees a failing check right away
// and can send the adventurer back, instead of having to remember to ask for a test run.
//
// They're your commands, so they run without asking: inside the sandbox when it's on, plainly
// otherwise. They run in the folder the quest worked in (this expedition's worktree, if it has one).
//
// A folder with no checks set up: the camp doesn't stay silent about it. It looks for likely ones
// there (package.json scripts, a Makefile, Cargo, Go) and the report says that nothing was checked
// and what could be turned on. It runs what it found only with "run found checks" on in Settings,
// or in a project the camp started itself (start_project) when each of those commands would run
// without asking under your own approval choices: so a new build's "tests pass" is checked, not
// just said, without the camp running anything you haven't already let run.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { filesWrittenBy, snapshotBeforeShell } from "./checkpoints.js";
import { currentSignal } from "./context.js";
import { emit } from "./events.js";
import { linkRoot, linkedDisplayPath, loadLinks } from "./links.js";
import { runFoundChecksOn } from "./settings.js";
import { autoApproval, shellRule } from "./shell.js";
import { godOn, runShell, sandboxOn, sandboxPlanFor } from "./tools.js";
import { w } from "./words.js";

const CHECK_TIMEOUT_MS = 10 * 60_000;
const TAIL = 3000;

// Writing, not code: a change that is only these needs no checks and no review.
export const isDoc = (path: string) => /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(path);

// The checks a folder most likely has, read from its own files: the typecheck, lint and test
// scripts of its package.json (run with the package manager its lockfile names), the check, lint
// and test targets of its Makefile, and the standard ones for Cargo and Go. Only fixed command
// forms come out of this, never text taken from the files.
export function likelyChecks(dir: string): string[] {
  const has = (file: string) => existsSync(join(dir, file));
  const found: string[] = [];
  try {
    const scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))?.scripts ?? {};
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    for (const name of ["typecheck", "lint", "test"]) {
      const script = scripts[name];
      if (typeof script !== "string" || !script.trim()) continue;
      if (name === "test" && /no test specified/i.test(script)) continue; // what `npm init` leaves there
      found.push(name === "test" && pm === "npm" ? "npm test" : `${pm} run ${name}`);
    }
  } catch { /* no package.json, or not one that can be read */ }
  try {
    const makefile = readFileSync(join(dir, "Makefile"), "utf8");
    for (const target of ["check", "lint", "test"]) if (new RegExp(`^${target}\\s*:(?!=)`, "m").test(makefile)) found.push(`make ${target}`);
  } catch { /* no Makefile */ }
  if (has("Cargo.toml")) found.push("cargo check", "cargo test");
  if (has("go.mod")) found.push("go vet ./...", "go test ./...");
  return found.slice(0, 6);
}

// What is said when a quest changed files in a folder that has no checks: nothing ran, and what could.
// (No line of it starts with ✗: nothing failed, so nobody is sent back.)
// campMade: a project the camp started, where found checks run once they'd run without asking.
export function noChecksNote(link: string, found: string[], campMade = false): string {
  return `No automatic checks ran in links/${link}: none are set up for that folder.` + (found.length
    ? ` Likely ones found there: ${found.map((c) => "`" + c + "`").join(", ")}. Added as the folder's checks (on its project page), they run after every change.` +
      (campMade ? ` It's a project the ${w("camp")} started, so these also run by themselves with the sandbox on, or once they're on your allow list.` : "")
    : ` The ${w("camp")} found none there it could suggest.`);
}

// Whether a command would run without asking under your own choices: never past your deny or ask
// rules; otherwise in the sandbox, in god mode with you here, or when your allow list covers it.
export const runsUnasked = (command: string) => !shellRule(command) && (sandboxOn() || godOn() || autoApproval(command) === "yours");

// unchecked: the folders a quest changed that had no checks to run, each with the likely ones found there.
export type ChecksReport = { text: string; unchecked: { link: string; found: string[]; campMade?: boolean }[] };

export async function checkChanges(runKey: string, who: { who: string; emoji: string; questId?: string }): Promise<ChecksReport> {
  const touched = filesWrittenBy(runKey).map((abs) => linkedDisplayPath(abs) ?? "");
  const blocks: string[] = [];
  const unchecked: ChecksReport["unchecked"] = [];
  for (const link of loadLinks()) {
    const here = touched.filter((p) => p.startsWith(`links/${link.name}/`));
    if (!here.length) continue;
    const dir = linkRoot(link);
    let commands = link.verify ?? [];
    let header = `Automatic checks in links/${link.name} (run by the ${w("camp")} after the changes):`;
    if (!commands.length) {
      if (here.every(isDoc)) continue; // only writing changed: nothing to check
      const found = likelyChecks(dir);
      const own = !!link.campMade && found.length > 0 && found.every(runsUnasked);
      if ((!runFoundChecksOn() && !own) || !found.length) {
        unchecked.push({ link: link.name, found, ...(link.campMade ? { campMade: true } : {}) });
        blocks.push(noChecksNote(link.name, found, link.campMade));
        continue;
      }
      commands = found;
      header = link.campMade
        ? `Automatic checks in links/${link.name} (none are set up for it: these were found in the project the ${w("camp")} started, and run by it after the changes):`
        : `Automatic checks in links/${link.name} (none are set up for it: these were found there and run by the ${w("camp")} after the changes):`;
    }
    await snapshotBeforeShell(dir, linkedDisplayPath); // a check can change files too (a formatter, codegen)
    const lines: string[] = [];
    for (const command of commands) {
      if (currentSignal()?.aborted) break;
      emit({ type: "tool", ...who, depth: 1, tool: "check", input: `${command}  (links/${link.name})` });
      const out = await runShell(command, { signal: currentSignal(), cwd: dir, timeoutMs: CHECK_TIMEOUT_MS, sandbox: sandboxOn() ? sandboxPlanFor(dir) : undefined });
      const failed = /^(Exit code|Couldn't run|Stopped)/.test(out);
      lines.push(failed ? `✗ ${command}\n${out.length > TAIL ? "…" + out.slice(-TAIL) : out}` : `✓ ${command}`);
      emit({ type: "notice", ...who, depth: 1, text: `${failed ? "✗" : "✓"} check: ${command}` });
    }
    if (lines.length) blocks.push(`${header}\n${lines.join("\n")}`);
  }
  return { text: blocks.join("\n\n"), unchecked };
}

// The same, as the text that goes on the end of the quest's report.
export const runChecks = async (runKey: string, who: { who: string; emoji: string; questId?: string }): Promise<string> => (await checkChanges(runKey, who)).text;
