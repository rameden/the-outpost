// Feedback: a thumbs up or down, and optionally a note, on a finished expedition or direct chat.
// It is how you teach the camp what a good answer looks like for you.
//
// What happens to it:
//   - Every rating is kept in camp/feedback.jsonl (the latest one per run counts).
//   - The agent that answered sees its recent feedback at the top of its next prompts: the notes
//     you wrote, every thumbs-down, and how its last rated answers went overall. Feedback given
//     inside a project is shown only in that project; feedback given outside one is shown everywhere.
//   - A note you choose to keep becomes a standing note straight away, with no model in between:
//     in the project's notes if the conversation is filed under a project, otherwise in the
//     memory of whoever answered. It then stays for good instead of ageing out of the recent list.

import { existsSync, readFileSync, statSync } from "node:fs";
import { appendLine } from "./atomic.js";
import { GENERAL, getProject, projectOf } from "./conversations.js";
import { CREW } from "./crew.js";
import { emit } from "./events.js";
import { appendMemory } from "./memory.js";
import { addProjectNote } from "./projects.js";
import { allTurns } from "./threads.js";
import { flat as clip } from "./helpers.js";

export const FEEDBACK_PATH = "camp/feedback.jsonl";
const SHOWN = 8;        // items in a prompt
const TALLY = 20;       // rated answers counted in the "overall" line

export type Rating = "up" | "down";
export type Feedback = {
  time: string; expedition: string; thread: string; agent: string; project?: string;
  rating: Rating; note?: string;
  kept?: string;        // where the note was saved as a standing note ("mi-web-app's notes", "the Scout's memory")
  task: string;         // what was asked, shortened
};

let cache: { key: string; items: Feedback[] } | null = null;
// Every rating on record, oldest first, one per run (the latest wins).
export function allFeedback(): Feedback[] {
  if (!existsSync(FEEDBACK_PATH)) return [];
  const st = statSync(FEEDBACK_PATH);
  const key = `${process.cwd()}:${st.mtimeMs}:${st.size}`;
  if (cache?.key === key) return cache.items;
  const last = new Map<string, Feedback>();
  for (const line of readFileSync(FEEDBACK_PATH, "utf8").split("\n")) {
    if (!line) continue;
    try { const f = JSON.parse(line) as Feedback; last.delete(f.expedition); last.set(f.expedition, f); } catch { /* a half-written line */ }
  }
  cache = { key, items: [...last.values()] };
  return cache.items;
}
export const feedbackFor = (expedition: string) => allFeedback().find((f) => f.expedition === expedition);


// Rate a finished run. keep: also save the note as a standing note (see the top of this file).
export function giveFeedback(expedition: string, o: { rating: unknown; note?: unknown; keep?: unknown }): Feedback {
  if (o.rating !== "up" && o.rating !== "down") throw new Error("Feedback is a thumbs up or a thumbs down.");
  const turn = allTurns().find((t) => t.expedition === expedition);
  if (!turn) throw new Error("That run isn't on record, so there's nothing to attach feedback to.");
  if (turn.status === "running") throw new Error("That one is still running. Give feedback once it has finished.");
  const note = String(o.note ?? "").trim().slice(0, 2000);
  const project = projectOf(turn.thread);
  const inProject = project.id !== GENERAL;
  const before = feedbackFor(expedition);
  const f: Feedback = {
    time: new Date().toISOString(), expedition, thread: turn.thread, agent: turn.agent, ...(inProject ? { project: project.id } : {}),
    rating: o.rating, ...(note ? { note } : {}), task: clip(turn.task, 160),
  };
  // Keep the note as a standing note, once: saving the same note again doesn't add it twice.
  if (note && before?.kept && before.note === note) f.kept = before.kept; // the same note, already kept (say, only the thumb changed)
  else if (note && o.keep) {
    const who = CREW[turn.agent] ?? CREW.quartermaster;
    const entry = `Feedback from the user (${o.rating === "up" ? "this worked well" : "do this differently"}): ${note.replace(/\s+/g, " ")}`;
    if (inProject) { addProjectNote(project.id, entry, "feedback", expedition); f.kept = `${project.name}'s notes`; }
    else { appendMemory(who.id, entry, "feedback", expedition); f.kept = `the ${who.name}'s memory`; }
  }
  appendLine(FEEDBACK_PATH, JSON.stringify(f));
  emit({ type: "feedback", id: expedition, rating: f.rating, note: f.note, kept: f.kept, expeditionId: expedition });
  return f;
}

// For an agent's prompt: what the user has said about its recent answers, here or in general.
export function feedbackBlock(agent: string, project: string | undefined): string {
  const here = getProject(project);
  const mine = allFeedback().filter((f) => f.agent === agent && (!f.project || f.project === here?.id));
  if (!mine.length) return "";
  const recent = mine.slice(-TALLY);
  const up = recent.filter((f) => f.rating === "up").length;
  // Worth spelling out: anything with a note that isn't already a standing note, and every thumbs-down.
  const told = mine.filter((f) => (f.note && !f.kept) || (f.rating === "down" && !f.note)).slice(-SHOWN);
  const lines = told.map((f) => {
    const when = new Date(f.time).toLocaleDateString([], { month: "short", day: "numeric" });
    return `- ${when}, ${f.rating === "up" ? "👍" : "👎"} on "${clip(f.task, 90)}"${f.note ? `: ${clip(f.note, 400)}` : " (no note: the answer or the way of getting there missed)"}`;
  });
  return `## The user's feedback on your recent work\n` +
    `Of your last ${recent.length} rated ${recent.length === 1 ? "answer" : "answers"}${here && here.id !== GENERAL ? " (here and in general)" : ""}: ${up} 👍, ${recent.length - up} 👎. ` +
    `Let this shape how you work now: do more of what earned a 👍, and don't repeat what earned a 👎.` +
    (lines.length ? `\n${lines.join("\n")}` : "") +
    (mine.some((f) => f.kept) ? `\n(Notes the user chose to keep are in your memory or the project's notes, above.)` : "");
}
