// Approval cards: the wording for each kind of question the camp asks, and for how it ended.

import type { AskKind } from "../types.ts";

export const ASK_LABELS: Record<AskKind, { note: string; yes?: string; done?: string }> = {
  plan: { note: "Nobody leaves camp until you approve.", yes: "Approve plan" },
  shell: { note: "This runs on your machine.", yes: "Run command", done: "✓ Command allowed" },
  job: { note: "It runs on schedule while mission control (or npm run watch) is open.", yes: "Schedule it", done: "✓ Job scheduled" },
  tool: { note: "This connector tool makes changes outside the camp.", yes: "Allow", done: "✓ Allowed" },
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

// What to show once an approval has been answered (from the page, the terminal, or a phone).
export function askOutcome(kind: AskKind, answer: string, lapsed?: boolean): string {
  if (lapsed) return "Not answered (the camp was restarted)";
  const a = answer.toLowerCase();
  if (kind === "plan") return answer === "" || a === "y" ? "✓ Plan approved" : a === "n" ? "✕ Plan stopped" : `↺ Changes requested: ${answer}`;
  if (kind === "question") return answer ? `You answered: ${answer}` : "Skipped: left to the Quartermaster";
  if (kind === "describe") return a === "y" ? "✓ Updated as you" : a === "n" || a === "" ? "✕ Not updated" : `↺ Changes requested: ${answer}`;
  if (kind === "post") return a === "y" ? "✓ Posted as you" : a === "n" || a === "" ? "✕ Not posted" : `↺ Changes requested: ${answer}`;
  if (a === "always" || a === "a") return "✓ Allowed, and won't ask again for this command";
  return a === "y" ? ASK_LABELS[kind]?.done ?? "✓ Allowed" : "✕ Declined";
}
