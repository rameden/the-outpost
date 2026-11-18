// The condensed feed: the behind-the-scenes work (tool calls, commands that were answered, the
// model being picked) folds into one line per stretch, saying what it added up to ("Read 9 files,
// ran 3 commands"). What you'd read or act on (messages, quests, the plan, files written, open
// approvals, notices) stays where it was. Detailed shows every line, as it always did.

import type { AskNode, FeedNode } from "./reducer.ts";

export type FeedDetail = "condensed" | "detailed";
export const DETAIL_KEY = "camp-feed-detail";
export const parseDetail = (saved: string | null): FeedDetail => (saved === "detailed" ? "detailed" : "condensed");

// A stretch of behind-the-scenes lines, drawn as one.
export type StepsNode = { kind: "steps"; id: string; nodes: FeedNode[] };
export type Shown = FeedNode | StepsNode;

// An answered command or tool call (not one still waiting on you, and not the plan).
const answered = (n: FeedNode): n is AskNode => n.kind === "ask" && n.outcome !== null && !n.listed && (n.askKind === "shell" || n.askKind === "tool");

export function isBehindTheScenes(n: FeedNode): boolean {
  return n.kind === "tool" || n.kind === "route" || answered(n);
}

// Runs of behind-the-scenes lines become one StepsNode each; everything else is left as it is.
export function condense(nodes: FeedNode[]): Shown[] {
  const out: Shown[] = [];
  let run: FeedNode[] = [];
  const flush = () => { if (run.length) out.push({ kind: "steps", id: `steps-${run[0].id}`, nodes: run }); run = []; };
  for (const n of nodes) {
    if (isBehindTheScenes(n)) run.push(n);
    else { flush(); out.push(n); }
  }
  flush();
  return out;
}

// What a tool call was, by its name: the camp's own tools, Claude Code's, and MCP ones (mcp__x__y).
type Sort = "read" | "search" | "list" | "edit" | "command" | "web" | "other";
export function sortOf(tool: string): Sort {
  const t = tool.toLowerCase().replace(/^mcp__[^_]+__/, "");
  if (/^(bash|shell|run|exec|terminal)/.test(t)) return "command";
  if (/(write|edit|patch|create_file|multiedit|notebookedit)/.test(t)) return "edit";
  if (/^(web_search|web_fetch|webfetch|websearch|fetch|browse|navigate)/.test(t)) return "web";
  if (/(grep|search|find|recall)/.test(t)) return "search";
  if (/(list_dir|ls|glob|tree)/.test(t)) return "list";
  if (/(read|view|cat|open)/.test(t)) return "read";
  return "other";
}

const PHRASE: Record<Sort, (n: number) => string> = {
  read: (n) => `read ${n} ${n === 1 ? "file" : "files"}`,
  search: (n) => `${n} ${n === 1 ? "search" : "searches"}`,
  list: (n) => `looked in ${n} ${n === 1 ? "folder" : "folders"}`,
  edit: (n) => `${n} ${n === 1 ? "edit" : "edits"}`,
  command: (n) => `ran ${n} ${n === 1 ? "command" : "commands"}`,
  web: (n) => `${n} web ${n === 1 ? "lookup" : "lookups"}`,
  other: (n) => `${n} other ${n === 1 ? "step" : "steps"}`,
};
const ORDER: Sort[] = ["read", "search", "list", "command", "edit", "web", "other"];

export type StepsSummary = { text: string; allowed: number; declined: number; who: string[]; last?: string };

// One line for a stretch: what was done, what you let through or turned down, and who did it.
export function summarize(nodes: FeedNode[]): StepsSummary {
  const counts = new Map<Sort, number>();
  const who = new Set<string>();
  let allowed = 0, declined = 0, switched = 0;
  let last: string | undefined;
  for (const n of nodes) {
    if (n.kind === "tool") {
      const s = sortOf(n.tool);
      counts.set(s, (counts.get(s) ?? 0) + 1);
      who.add(n.who);
      last = `${n.tool} ${n.input}`;
    } else if (n.kind === "route") { if (n.switched) switched++; who.add(n.who); }
    else if (n.kind === "ask") { if (n.outcome?.startsWith("✕")) declined++; else allowed++; who.add(n.who); }
  }
  const parts = ORDER.filter((s) => counts.get(s)).map((s) => PHRASE[s](counts.get(s)!));
  if (switched) parts.push(`switched model${switched > 1 ? ` ${switched}×` : ""}`);
  const text = parts.length ? parts.join(", ") : nodes.some((n) => n.kind === "route") ? "picked a model" : "approvals";
  return { text: text[0].toUpperCase() + text.slice(1), allowed, declined, who: [...who], last };
}
