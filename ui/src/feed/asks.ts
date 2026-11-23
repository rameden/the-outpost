// Approval cards: the wording for each kind of question the camp asks, and for how it ended.

import type { AskKind } from "../types.ts";

import { w } from "../words.ts";
export const ASK_LABELS: Record<AskKind, { note: string; yes?: string; done?: string }> = {
  plan: { get note() { return `Nobody leaves ${w("camp")} until you approve.`; }, yes: "Approve and start" },
  shell: { note: "This runs on your machine.", yes: "Run command", done: "✓ Command allowed" },
  job: { note: "It runs on schedule while mission control is open.", yes: "Schedule it", done: "✓ Job scheduled" },
  tool: { get note() { return `This connector tool makes changes outside the ${w("camp")}.`; }, yes: "Allow", done: "✓ Allowed" },
  question: { note: "The Quartermaster is waiting for your answer before planning." },
  describe: { note: "This replaces the pull request's description on GitHub, under your name, with exactly what's written here. Nothing else about the pull request changes.", yes: "Update as me", done: "✓ Updated as you" },
  post: { note: "This goes on GitHub under your name, exactly as written here, where everyone on the pull request can read it. It is a comment only: it doesn't approve or block.", yes: "Post as me", done: "✓ Posted as you" },
};

export const ASK_NOTIFY_TITLES: Record<AskKind, string> = {
  plan: "Plan to approve",
  shell: "Shell command waiting",
  job: "New scheduled job",
  tool: "Connector call waiting",
  question: "The Quartermaster has a question",
  post: "A review to post as you",
  describe: "A pull request description to approve",
};

// The answer that approves a plan to start later (the camp's START_LATER), and the two that
// approve one in place of a plan from its conversation that was already waiting to start.
export const START_LATER = "later";
export const REPLACE_START = "y+replace";
export const REPLACE_LATER = "later+replace";
export const heldAnswer = (answer: string) => [START_LATER, REPLACE_LATER].includes(answer.trim().toLowerCase());

// What to show once an approval has been answered (from the page, the terminal, or a phone).
export function askOutcome(kind: AskKind, answer: string, lapsed?: boolean): string {
  if (lapsed) return `Not answered (the ${w("camp")} was restarted)`;
  const a = answer.toLowerCase();
  if (kind === "plan") {
    if (a === REPLACE_START) return "✓ Plan approved, in place of the one that was waiting";
    if (a === REPLACE_LATER) return "⏸ Plan approved, to start later, in place of the one that was waiting";
    return answer === "" || a === "y" ? "✓ Plan approved" : a === "n" ? "✕ Plan stopped" : heldAnswer(answer) ? "⏸ Plan approved, to start later" : `↺ Changes requested: ${answer}`;
  }
  if (kind === "question") return answer ? `You answered: ${answer}` : "Skipped: left to the Quartermaster";
  if (kind === "describe") return a === "y" ? "✓ Updated as you" : a === "n" || a === "" ? "✕ Not updated" : `↺ Changes requested: ${answer}`;
  if (kind === "post") return a === "y" ? "✓ Posted as you" : a === "n" || a === "" ? "✕ Not posted" : `↺ Changes requested: ${answer}`;
  if (a === "always" || a === "a") return "✓ Allowed, and won't ask again for this command";
  return a === "y" ? ASK_LABELS[kind]?.done ?? "✓ Allowed" : "✕ Declined";
}
