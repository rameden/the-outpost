// Tool output too long to hand to the model whole. It used to be cut at the cap and the rest was
// gone; now the whole of it goes to a file in camp/spill/, and the model gets the start, the end
// and the path, which it can page through with read_file. One call can't flood the context, and
// nothing is lost. Used by both runtimes. Old spill files are removed after SPILL_KEEP_DAYS.

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { writeAtomic } from "./atomic.js";
import { MAX_TOOL_OUTPUT, clipOutput, type ToolOutput } from "./tools.js";

export const SPILL_DIR = "camp/spill";
export const SPILL_KEEP_DAYS = 7; // as long as a task can be picked up again from its saved transcript (runstore.ts)
const HEAD = 8_000; // what the model sees of a spilled output: its start…
const TAIL = 2_000; // …and its end (where a command's verdict usually is)
const SWEEP_EVERY = 6 * 3_600_000;
const DAY = 86_400_000;

const safe = (s: string) => s.replace(/[^\w-]+/g, "_").slice(0, 40) || "tool";
// Whose spill file this is (camp/spill/<agent>__<id>.txt): the file tools let only that agent read it.
export const spillOwner = (name: string): string | null => name.match(/^(.+?)__[\w-]+\.txt$/)?.[1] ?? null;

function spillText(text: string, who: string): string {
  let path: string;
  try {
    mkdirSync(SPILL_DIR, { recursive: true });
    path = `${SPILL_DIR}/${safe(who)}__${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.txt`;
    writeAtomic(path, text);
    sweep();
  } catch {
    return clipOutput(text); // nowhere to put it (a full disk, a read-only folder): cut, as before
  }
  const lines = text.split("\n").length;
  return `${text.slice(0, HEAD)}\n\n…[${(text.length - HEAD - TAIL).toLocaleString()} characters left out here]…\n\n${text.slice(-TAIL)}\n\n` +
    `[This output was ${text.length.toLocaleString()} characters (${lines.toLocaleString()} lines): too long to show whole, so you have its start and its end. ` +
    `All of it is saved at ${path}: page through it with read_file (offset and limit), or grep it for what you need.]`;
}

// A tool's output as the model gets it: whole if it fits, else a preview and where the rest is.
export function spillOutput<T extends ToolOutput>(out: T, who: string): T {
  if (typeof out === "string") return (out.length > MAX_TOOL_OUTPUT ? spillText(out, who) : out) as T;
  if (!Array.isArray(out) || !out.some((b: any) => b?.type === "text" && typeof b.text === "string" && b.text.length > MAX_TOOL_OUTPUT)) return out;
  return out.map((b: any) => (b?.type === "text" && typeof b.text === "string" && b.text.length > MAX_TOOL_OUTPUT ? { ...b, text: spillText(b.text, who) } : b)) as T;
}

// Remove spill files older than the keeping time.
export function pruneSpill(now = Date.now()): { files: number; bytes: number } {
  const gone = { files: 0, bytes: 0 };
  let names: string[];
  try { names = readdirSync(SPILL_DIR); } catch { return gone; }
  for (const name of names) {
    const path = `${SPILL_DIR}/${name}`;
    try {
      const st = statSync(path);
      if (!st.isFile() || now - st.mtimeMs < SPILL_KEEP_DAYS * DAY) continue;
      rmSync(path);
      gone.files++;
      gone.bytes += st.size;
    } catch { /* gone meanwhile */ }
  }
  return gone;
}
const swept = new Map<string, number>();
function sweep(now = Date.now()) {
  const camp = process.cwd();
  if (now - (swept.get(camp) ?? -Infinity) < SWEEP_EVERY) return;
  swept.set(camp, now);
  try { pruneSpill(now); } catch { /* an old file left lying is no loss */ }
}
