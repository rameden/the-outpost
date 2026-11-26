// What you can type in the message box that's for the outpost rather than the page or the crew:
// a goal for the conversation (/goal), and pausing everything (/pause, /resume). They're in the
// one command registry (src/commands.ts), so the / menu and the palette offer them; the message
// box reads what's typed after them itself (Composer.tsx), since "/goal <what>" is also a message.

import type { CampState } from "./types.ts";

export type Goal = CampState["goals"][number];

// A line that starts with one of these is read here, never as one of the page's own commands:
// "/resume the import" isn't /resume, it's a message.
export const ownLine = (text: string) => /^\/(goal|pause|resume)(\s|$)/.test(text.trim());

export type Typed =
  | { do: "goal"; goal: string; maxRounds?: number }
  | { do: "goal-clear" } | { do: "goal-resume"; maxRounds?: number } | { do: "goal-show" }
  | { do: "pause"; reason?: string } | { do: "resume" };

// "/goal 5 ship the importer" → a goal with at most 5 rounds. null: not one of these.
export function parseTyped(text: string): Typed | null {
  const m = text.trim().match(/^\/(goal|pause|resume)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const arg = (m[2] ?? "").trim();
  if (m[1] === "pause") return arg ? { do: "pause", reason: arg } : { do: "pause" };
  if (m[1] === "resume") return arg ? null : { do: "resume" }; // "/resume the import" is a message, not this
  if (!arg || /^status$/i.test(arg)) return { do: "goal-show" };
  if (/^(clear|stop|off|none)$/i.test(arg)) return { do: "goal-clear" };
  const again = arg.match(/^resume(?:\s+(\d+))?$/i);
  if (again) return { do: "goal-resume", ...(again[1] ? { maxRounds: Number(again[1]) } : {}) };
  const counted = arg.match(/^(\d+)\s+([\s\S]+)$/);
  return counted ? { do: "goal", goal: counted[2].trim(), maxRounds: Number(counted[1]) } : { do: "goal", goal: arg };
}

// Where a goal stands, in a few words (the goal bar's label, and what /goal answers).
export function goalStanding(goal: Goal, paused = false): string {
  if (goal.status === "done") return "Reached";
  if (goal.status === "blocked") return "Needs you";
  if (goal.status === "stopped") return "Stopped";
  if (goal.owed || paused) return `Held while paused · round ${goal.rounds} of ${goal.maxRounds}`;
  return goal.rounds ? `Round ${goal.rounds} of ${goal.maxRounds}` : `Working · up to ${goal.maxRounds} more ${goal.maxRounds === 1 ? "round" : "rounds"}`;
}
