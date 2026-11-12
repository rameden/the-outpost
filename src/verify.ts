// Automatic checks: commands you list for a linked folder ("verify" in camp/links.json, or the
// folder's card under Connectors) run by themselves after a quest changes files there, and their
// results are attached to the quest's report. The Quartermaster sees a failing check right away
// and can send the adventurer back, instead of having to remember to ask for a test run.
//
// They're your commands, so they run without asking: inside the sandbox when it's on, plainly
// otherwise. They run in the folder the quest worked in (this expedition's worktree, if it has one).

import { filesWrittenBy, snapshotBeforeShell } from "./checkpoints.js";
import { currentSignal } from "./context.js";
import { emit } from "./events.js";
import { linkRoot, linkedDisplayPath, loadLinks } from "./links.js";
import { runShell, sandboxOn, sandboxPlanFor } from "./tools.js";

const CHECK_TIMEOUT_MS = 10 * 60_000;
const TAIL = 3000;

export async function runChecks(runKey: string, who: { who: string; emoji: string; questId?: string }): Promise<string> {
  const touched = filesWrittenBy(runKey).map((abs) => linkedDisplayPath(abs) ?? "");
  const blocks: string[] = [];
  for (const link of loadLinks()) {
    if (!link.verify?.length || !touched.some((p) => p.startsWith(`links/${link.name}/`))) continue;
    const dir = linkRoot(link);
    snapshotBeforeShell(dir, linkedDisplayPath); // a check can change files too (a formatter, codegen)
    const lines: string[] = [];
    for (const command of link.verify) {
      if (currentSignal()?.aborted) break;
      emit({ type: "tool", ...who, depth: 1, tool: "check", input: `${command}  (links/${link.name})` });
      const out = await runShell(command, { signal: currentSignal(), cwd: dir, timeoutMs: CHECK_TIMEOUT_MS, sandbox: sandboxOn() ? sandboxPlanFor(dir) : undefined });
      const failed = /^(Exit code|Couldn't run|Stopped)/.test(out);
      lines.push(failed ? `✗ ${command}\n${out.length > TAIL ? "…" + out.slice(-TAIL) : out}` : `✓ ${command}`);
      emit({ type: "notice", ...who, depth: 1, text: `${failed ? "✗" : "✓"} check: ${command}` });
    }
    if (lines.length) blocks.push(`Automatic checks in links/${link.name} (run by the camp after the changes):\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}
