// The quest log: one line of JSON per quest in camp/quest-log.jsonl.
// Who went, what they were asked, how it ended, which model, how long, and what it cost in tokens.
// Mission control reads it for run history, usage, and XP.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentResult } from "./agent.js";
import { emit } from "./events.js";
import { costOf, usd } from "./costs.js";
import { currentExpeditionId, currentProjectId } from "./context.js";
import { appendLine } from "./atomic.js";

export const QUEST_LOG_PATH = "camp/quest-log.jsonl";

export type QuestEntry = {
  time: string;                          // ISO time the quest started
  kind: "expedition" | "quest" | "job";  // Quartermaster run, adventurer dispatch, scheduled run
  character: string;
  job?: string;
  expedition?: string;                   // the expedition a dispatched quest belonged to
  project?: string;                      // the project its conversation is filed under
  task: string;                          // first 200 chars of the request or brief
  result: string;                        // first 300 chars of the report or summary
  status: AgentResult["status"] | "error";
  model: string;
  effort?: string;
  turns: number;
  seconds: number;
  usage: AgentResult["usage"];
  session?: string;                      // that run's full transcript (camp/agents/<id>/sessions/…)
  runtime?: "api" | "claude-code";       // API key, or your Claude subscription through Claude Code
  costUsd?: number;                      // Claude Code's own figure at API prices (subscription runs)
  // Auto: what you picked, and each model it ran on with the reason (model is the last of them).
  route?: { choice: string; steps: { model: string; effort?: string; trigger: string; reason: string }[] };
};

// What a quest cost: Claude Code's own figure when it ran on the subscription (an estimate at API
// prices, not a bill), otherwise computed from tokens and the model's price.
export function questCost(q: Pick<QuestEntry, "model" | "usage" | "costUsd">): number {
  return q.costUsd ?? costOf(q.model, q.usage);
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
};

export function logQuest(
  kind: QuestEntry["kind"],
  character: string,
  task: string,
  started: Date,
  result: AgentResult,
  job?: string,
  project: string | undefined = currentProjectId()
) {
  const entry: QuestEntry = {
    time: started.toISOString(),
    kind,
    character,
    ...(job ? { job } : {}),
    ...(currentExpeditionId() ? { expedition: currentExpeditionId() } : {}),
    ...(project && project !== "general" ? { project } : {}),
    task: clip(task, 200),
    result: clip(result.text, 300),
    status: result.status,
    model: result.model,
    ...(result.effort ? { effort: result.effort } : {}),
    turns: result.turns,
    seconds: Math.round((Date.now() - started.getTime()) / 1000),
    usage: result.usage,
    ...(result.session ? { session: result.session } : {}),
    ...(result.runtime ? { runtime: result.runtime } : {}),
    ...(result.costUsd != null ? { costUsd: result.costUsd } : {}),
    ...(result.route ? { route: { choice: result.route.choice, steps: result.route.steps.map(({ model, effort, trigger, reason }) => ({ model, ...(effort ? { effort } : {}), trigger, reason })) } } : {}),
  };
  appendLine(QUEST_LOG_PATH, JSON.stringify(entry));
  emit({ type: "changed", what: "log" });
}

// The whole log, parsed once and reused until the file changes (mission control asks for it on
// every refresh, and the log only ever grows).
let cache: { path: string; key: string; entries: QuestEntry[] } | null = null;
function allQuests(): QuestEntry[] {
  if (!existsSync(QUEST_LOG_PATH)) return [];
  const st = statSync(QUEST_LOG_PATH);
  const key = `${st.mtimeMs}:${st.size}`;
  const path = process.cwd() + "/" + QUEST_LOG_PATH;
  if (cache?.key === key && cache.path === path) return cache.entries;
  const entries = readFileSync(QUEST_LOG_PATH, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as QuestEntry]; } catch { return []; } // a half-written line
  });
  cache = { path, key, entries };
  return entries;
}

export function recentQuests(n = 15): QuestEntry[] {
  return allQuests().slice(-n);
}

// For /log: a compact view, newest last.
export function formatQuests(entries = recentQuests()): string {
  if (entries.length === 0) return "The quest log is empty.";
  return entries
    .map((e) => {
      const when = new Date(e.time).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
      const u = e.usage;
      const cached = u.input + u.cacheRead > 0 ? Math.round((100 * u.cacheRead) / (u.input + u.cacheRead + u.cacheWrite)) : 0;
      const tokens = `${((u.input + u.cacheRead + u.cacheWrite) / 1000).toFixed(1)}k in (${cached}% cached), ${(u.output / 1000).toFixed(1)}k out`;
      const who = e.job ? `${e.character} [job: ${e.job}]` : e.character;
      const cost = `${usd(questCost(e))}${e.runtime === "claude-code" ? " est. (subscription)" : ""} on ${e.model.replace(/^claude-/, "")}`;
      return `${when}  ${who.padEnd(14)} ${e.status.padEnd(12)} ${e.seconds}s, ${e.turns} turns, ${tokens}, ${cost}\n` +
        `      asked: ${e.task}\n      result: ${e.result}`;
    })
    .join("\n");
}

// The quests an expedition sent out, in the order they set out (one sent back to fix a failed check is a line of its own).
export const questsOf = (expedition: string) => allQuests().filter((q) => q.expedition === expedition && q.kind === "quest");
// What an expedition's quests cost, from their log lines (the Quartermaster's own run is logged
// outside the expedition, so whoever has its result adds that).
export const questsCostOf = (expedition: string) => questsOf(expedition).reduce((sum, q) => sum + questCost(q), 0);
