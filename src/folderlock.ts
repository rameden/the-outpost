// One writer at a time in a linked folder.
//
// Quests sent in one turn run side by side, and in one conversation they work in the same folder
// (the conversation's worktree, or the linked folder itself): one working tree, one git index, one
// set of checks. Two of them changing files there at once step on each other: a shell command of
// one rewrites what the other just edited, a `git add` picks up half of the other's change, and
// the checks run against a mix of both. So a quest that can change files in a linked folder takes
// that folder first, and the next one waits until it is back (its checks and fixes included).
// Quests that only read (the Scout, the Warden) take nothing and stay side by side.

import type { AgentSpec } from "./agent.js";
import { inScope } from "./context.js";
import { linkRoot, loadLinks } from "./links.js";
import { resolve } from "node:path";

const held = new Map<string, string>();            // folder → who is working in it
const waiting = new Map<string, (() => void)[]>(); // folder → those waiting for it, first come first

// Takes every folder asked for, all at once, when all of them are free (nobody holds one while
// waiting for another, so two quests can never wait on each other). Gives back the call that
// frees them, or null when the run was stopped while it waited.
// onWait: called once, the first time it has to wait, with who holds the folder it waits for.
export async function lockFolders(folders: string[], who: string, signal?: AbortSignal, onWait?: (holder: string, folder: string) => void): Promise<(() => void) | null> {
  const want = [...new Set(folders)];
  let told = false;
  for (;;) {
    if (signal?.aborted) return null;
    const busy = want.find((f) => held.has(f));
    if (!busy) break;
    if (!told) { told = true; onWait?.(held.get(busy)!, busy); }
    await new Promise<void>((ok) => {
      const line = waiting.get(busy) ?? waiting.set(busy, []).get(busy)!;
      // Woken when the folder is freed or by Stop; either way it leaves the line and looks again.
      const wake = () => {
        signal?.removeEventListener("abort", wake);
        const at = line.indexOf(wake);
        if (at >= 0) line.splice(at, 1);
        if (!line.length && waiting.get(busy) === line) waiting.delete(busy);
        ok();
      };
      line.push(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }
  for (const f of want) held.set(f, who);
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    for (const f of want) held.delete(f);
    // Everyone waiting on one of them looks again, in the order they came: the first takes it,
    // the rest see it taken and get back in line in the same order.
    for (const f of want) for (const wake of [...(waiting.get(f) ?? [])]) wake();
  };
}

// Whether this crew member can change files in a linked folder: it edits files, runs shell
// commands, or has the write_file that isn't kept to its own outputs folder.
export function canChangeFolders(spec: Pick<AgentSpec, "tools">): boolean {
  return spec.tools.some((t) => {
    const name = (t.def as { name?: string }).name;
    return name === "edit_file" || name === "bash" || (name === "write_file" && !t.outputsOnly);
  });
}

// The folders a quest by this crew member could change, in the run it is called from: the linked
// folders of this conversation that were linked with edit access, each where this run works in it.
export function foldersToLock(spec: Pick<AgentSpec, "tools">): { name: string; root: string }[] {
  if (!canChangeFolders(spec)) return [];
  return loadLinks().filter((l) => l.access === "write" && inScope(l.name)).map((l) => ({ name: l.name, root: resolve(linkRoot(l)) }));
}

// For the tests: who holds which folder, and how many wait for one.
export const folderLocksForTests = { now: () => ({ held: Object.fromEntries(held), waiting: [...waiting.values()].reduce((n, l) => n + l.length, 0) }) };
