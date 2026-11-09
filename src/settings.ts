// Per-agent model and effort, chosen from mission control (or /model in the terminal).
// Stored in camp/settings.json and read at the start of every run, so a change applies to
// that agent's next quest without restarting anything. Anything not set falls back to the
// defaults in code (roster.ts / quartermaster.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emit } from "./events.js";
import type { CrewId } from "./crew.js";

export const SETTINGS_PATH = "camp/settings.json";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export type AgentSettings = { model?: string; effort?: Effort };
export type ShellSettings = { autoApprove?: boolean; allow?: string[] };
type Settings = {
  agents: Partial<Record<CrewId, AgentSettings>>;
  budgetUsd?: number;     // stop an expedition once it has spent this much (all agents together)
  shell?: ShellSettings;  // which shell commands run without asking (see shell.ts)
};

function load(): Settings {
  if (!existsSync(SETTINGS_PATH)) return { agents: {} };
  try {
    const s = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    return { ...s, agents: s.agents ?? {} };
  } catch {
    return { agents: {} };
  }
}

function save(s: Settings) {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n");
  emit({ type: "changed", what: "settings" });
}

export const budgetUsd = () => load().budgetUsd;
export function setBudgetUsd(value: number | null) {
  const s = load();
  if (value && value > 0) s.budgetUsd = Math.round(value * 100) / 100;
  else delete s.budgetUsd;
  save(s);
}

export const shellSettings = (): ShellSettings => load().shell ?? {};

export function agentSettings(id: CrewId): AgentSettings {
  return load().agents[id] ?? {};
}

// Set (or with an empty value, clear) an agent's model/effort override.
export function setAgentSettings(id: CrewId, patch: { model?: string | null; effort?: Effort | null }) {
  const s = load();
  const next: AgentSettings = { ...(s.agents[id] ?? {}) };
  if (patch.model !== undefined) patch.model ? (next.model = patch.model) : delete next.model;
  if (patch.effort !== undefined) patch.effort ? (next.effort = patch.effort) : delete next.effort;
  if (Object.keys(next).length) s.agents[id] = next;
  else delete s.agents[id];
  save(s);
}
