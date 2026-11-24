// Setup for new worktrees: commands you list for a linked repository ("setup" in camp/links.json,
// or the folder's card under Connectors), run once in each worktree the camp creates for it,
// before the crew starts work there. A new worktree has none of the checkout's installed
// dependencies or untracked config, so without this the first check (or the first test run)
// fails for a reason that has nothing to do with the change.
//
// They're your commands, so they run without asking. They run outside the shell sandbox, because
// installs need the network; that's the same trust as a command you approve. They run only in a
// worktree the camp just made (never in your linked checkout or a worktree you picked), and only
// once: the workspace is marked ready, and a follow-up in the same worktree doesn't run them again.

import { currentSignal } from "./context.js";
import type { Workspace } from "./context.js";
import { emit } from "./events.js";
import { findLink } from "./links.js";
import { runShell } from "./tools.js";
import { w as word } from "./words.js";

const SETUP_TIMEOUT_MS = 15 * 60_000;
const TAIL = 2000;
const failedOut = (out: string) => /^(Exit code|Couldn't run|Stopped|Not run)/.test(out);

// Runs the setup for every workspace that the camp created and hasn't set up yet. Returns a short
// note for the crew's prompt ("" when there was nothing to do), so they know what's installed and
// what failed. A failing command stops that worktree's setup; the rest still run.
export async function setUpWorkspaces(workspaces: Record<string, Workspace> | undefined, who: { who: string; emoji: string }): Promise<string> {
  const notes: string[] = [];
  for (const w of Object.values(workspaces ?? {})) {
    if (!w.created || w.ready) continue;
    const commands = findLink(w.link)?.setup ?? [];
    w.ready = true; // once, whatever happens: a failed setup is reported, not retried on every reply
    if (!commands.length) continue;
    const lines: string[] = [];
    for (const command of commands) {
      if (currentSignal()?.aborted) break;
      emit({ type: "tool", ...who, depth: 0, tool: "setup", input: `${command}  (new worktree of links/${w.link})` });
      const out = await runShell(command, { signal: currentSignal(), cwd: w.path, timeoutMs: SETUP_TIMEOUT_MS });
      const failed = failedOut(out);
      emit({ type: "notice", ...who, depth: 0, text: `${failed ? "✗" : "✓"} setup: ${command}` });
      lines.push(failed ? `✗ ${command}\n${out.length > TAIL ? "…" + out.slice(-TAIL) : out}` : `✓ ${command}`);
      if (failed) break;
    }
    if (lines.length) notes.push(`Setup of the new worktree for links/${w.link} (run by the ${word("camp")} before you started):\n${lines.join("\n")}`);
  }
  return notes.join("\n\n");
}
