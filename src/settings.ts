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
// maxTurns: how many replies (each with its tool calls) one run may take before it stops.
export type AgentSettings = { model?: string; effort?: Effort; maxTurns?: number };
export const DEFAULT_TURNS = 20;
export const TURNS_MIN = 5;
export const TURNS_MAX = 200;
// sandbox: on macOS, run commands with no network and writes limited to the working folder, without asking (see sandbox.ts).
export type ShellSettings = { autoApprove?: boolean; allow?: string[]; exact?: string[]; sandbox?: boolean };
// Phone notifications through an ntfy server (see phone.ts). Off unless a topic is set.
export type PhoneSettings = { server?: string; topic?: string; approve?: string[] };
type Settings = {
  agents: Partial<Record<CrewId, AgentSettings>>;
  budgetUsd?: number;     // stop an expedition once it has spent this much (all agents together)
  shell?: ShellSettings;  // which shell commands run without asking (see shell.ts)
  runtime?: "claude-code" | "api";
  parallel?: number;      // how many expeditions mission control runs at once (the rest wait)
  questsAtOnce?: number;  // how many dispatched quests run at once, across every expedition
  selfEdit?: boolean;     // let agents edit the camp's own source (src/, tests/, evals/, package.json)
  phone?: PhoneSettings;
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

// How many expeditions (and direct chats, and jobs) mission control runs at the same time.
// More at once uses up a subscription's limits (or API spend) faster.
export const PARALLEL_DEFAULT = 3;
export const PARALLEL_MAX = 8;
export const parallelLimit = () => Math.min(PARALLEL_MAX, Math.max(1, Math.round(load().parallel ?? PARALLEL_DEFAULT)));
export function setParallelLimit(n: number) {
  const s = load();
  s.parallel = Math.min(PARALLEL_MAX, Math.max(1, Math.round(n)));
  save(s);
}

export const shellSettings = (): ShellSettings => load().shell ?? {};

// "Always allow" on a shell approval: that exact command runs without asking from now on.
export function allowShellCommand(command: string) {
  const s = load();
  const exact = new Set(s.shell?.exact ?? []);
  exact.add(command.trim());
  s.shell = { ...(s.shell ?? {}), exact: [...exact] };
  save(s);
}

export function setShellSandbox(on: boolean) {
  const s = load();
  s.shell = { ...(s.shell ?? {}), sandbox: on };
  save(s);
}

// Dispatched quests running at once, camp-wide. One Quartermaster can send several adventurers
// in a turn, and several expeditions can run side by side; this caps the total.
export const QUESTS_DEFAULT = 4;
export const questLimit = () => Math.min(16, Math.max(1, Math.round(load().questsAtOnce ?? QUESTS_DEFAULT)));

export const QUESTS_MAX = 16;
export function setQuestLimit(n: number) {
  const s = load();
  s.questsAtOnce = Math.min(QUESTS_MAX, Math.max(1, Math.round(n)));
  save(s);
}

export const selfEditAllowed = () => load().selfEdit === true;
export function setSelfEdit(on: boolean) {
  const s = load();
  if (on) s.selfEdit = true;
  else delete s.selfEdit;
  save(s);
}

export const phoneSettings = (): PhoneSettings => load().phone ?? {};
export function setPhoneSettings(p: PhoneSettings) {
  const s = load();
  if (p.topic || p.server || p.approve) s.phone = p;
  else delete s.phone;
  save(s);
}

// The approval level for shell commands, as the settings page shows it:
//   "ask"     every command waits for you (even ls)
//   "safe"    simple read-only commands run; the rest ask (the default)
//   "sandbox" read-only commands run; the rest run in the sandbox without asking (macOS)
export type ApprovalLevel = "ask" | "safe" | "sandbox";
export function approvalLevel(): ApprovalLevel {
  const sh = shellSettings();
  if (sh.autoApprove === false) return "ask";
  return sh.sandbox ? "sandbox" : "safe";
}
export function setApprovalLevel(level: ApprovalLevel) {
  const s = load();
  const sh: ShellSettings = { ...(s.shell ?? {}) };
  if (level === "ask") { sh.autoApprove = false; sh.sandbox = false; }
  else { delete sh.autoApprove; sh.sandbox = level === "sandbox"; }
  s.shell = sh;
  save(s);
}

// Your own allow-list (command prefixes that run without asking) and the "Always allow" commands.
export function setShellLists(patch: { allow?: string[]; exact?: string[] }) {
  const s = load();
  // Prefixes are matched against the command with spaces collapsed; exact commands as typed (trimmed).
  const clean = (l: string[], collapse: boolean) =>
    [...new Set(l.map((x) => { const t = String(x).trim(); return collapse ? t.replace(/\s+/g, " ") : t; }).filter(Boolean))].slice(0, 200);
  const sh: ShellSettings = { ...(s.shell ?? {}) };
  if (patch.allow) sh.allow = clean(patch.allow, true);
  if (patch.exact) sh.exact = clean(patch.exact, false);
  s.shell = sh;
  save(s);
}

// What runs the crew: your Claude subscription through Claude Code (the default), or the API
// with an API key. CAMP_RUNTIME overrides the setting (the test suite uses "api" with a fake API).
export type Runtime = "claude-code" | "api";
export function campRuntime(): Runtime {
  const env = process.env.CAMP_RUNTIME;
  if (env === "api" || env === "claude-code") return env;
  return load().runtime ?? "claude-code";
}
export function setRuntime(runtime: Runtime) {
  const s = load();
  s.runtime = runtime;
  save(s);
}

export function agentSettings(id: CrewId): AgentSettings {
  return load().agents[id] ?? {};
}

// Set (or with an empty value, clear) an agent's model/effort/turn-limit override.
export function setAgentSettings(id: CrewId, patch: { model?: string | null; effort?: Effort | null; maxTurns?: number | null }) {
  const s = load();
  const next: AgentSettings = { ...(s.agents[id] ?? {}) };
  if (patch.model !== undefined) patch.model ? (next.model = patch.model) : delete next.model;
  if (patch.effort !== undefined) patch.effort ? (next.effort = patch.effort) : delete next.effort;
  if (patch.maxTurns !== undefined) {
    if (patch.maxTurns) next.maxTurns = Math.min(TURNS_MAX, Math.max(TURNS_MIN, Math.round(patch.maxTurns)));
    else delete next.maxTurns;
  }
  if (Object.keys(next).length) s.agents[id] = next;
  else delete s.agents[id];
  save(s);
}
