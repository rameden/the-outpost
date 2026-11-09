// Each agent's own workspace: camp/agents/<id>/
//   identity.md   who they are (generated from crew.ts on every run; read-only reference)
//   memory.md     what they've learned that matters for THEIR role (only they write it)
//   sessions/     every conversation they've had: index.jsonl (one line each) + full transcripts
//   outputs/      their files and deliverables (only they write here)
// Agents can read each other's outputs, but never each other's memory or sessions.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { CREW, type CrewId } from "./crew.js";
import { emit } from "./events.js";
import type { Tool } from "./tools.js";

export const AGENTS_DIR = join("camp", "agents");
const MEMORY_MAX_CHARS = 5000;
const LEGACY_LEDGER = join("camp", "ledger.md");

export function workspace(id: CrewId) {
  const root = join(AGENTS_DIR, id);
  return {
    root,
    identity: join(root, "identity.md"),
    memory: join(root, "memory.md"),
    sessions: join(root, "sessions"),
    index: join(root, "sessions", "index.jsonl"),
    outputs: join(root, "outputs"),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export function ensureWorkspace(id: CrewId) {
  const ws = workspace(id);
  mkdirSync(ws.sessions, { recursive: true });
  mkdirSync(ws.outputs, { recursive: true });
  const me = CREW[id];
  writeFileSync(
    ws.identity,
    `# ${me.emoji} ${me.name}\n\n(Generated from src/crew.ts. Edit it there; agents can't change it.)\n\n` +
      `- **Role:** ${me.role}\n- **Personality:** ${me.personality}\n- **Handles:** ${me.handles}\n- **Not theirs:** ${me.notFor}\n`
  );
  if (!existsSync(ws.memory)) {
    let seed = "";
    // The old camp ledger was the Quartermaster's memory all along: carry it over once.
    if (id === "quartermaster" && existsSync(LEGACY_LEDGER)) {
      seed = readFileSync(LEGACY_LEDGER, "utf8").trim() + "\n";
      renameSync(LEGACY_LEDGER, LEGACY_LEDGER + ".migrated");
    }
    writeFileSync(ws.memory, `# ${me.name}'s memory\n\n${seed}`);
  }
}

export function readMemory(id: CrewId): string {
  ensureWorkspace(id);
  const ws = workspace(id);
  if (!existsSync(ws.memory)) return "(empty)";
  const text = readFileSync(ws.memory, "utf8").replace(/^# .*\n+/, "").trim();
  if (!text) return "(empty)";
  return text.length > MEMORY_MAX_CHARS ? "…\n" + text.slice(-MEMORY_MAX_CHARS) : text;
}

// The memory tool, bound to one agent. It can only ever touch that agent's memory.md.
export function rememberTool(id: CrewId): Tool {
  const me = CREW[id];
  return {
    def: {
      name: "remember",
      description:
        `Save something to YOUR memory (${me.name}) so future sessions start with it. Only keep what ` +
        `helps you in your role (${me.handles}): user preferences for your kind of work, lessons, ` +
        `recurring facts. Things for another role belong to that teammate; shared findings belong ` +
        `in the wiki. Your name, role, and personality are fixed: never record changes to them. ` +
        `'append' adds one dated line (default). 'rewrite' replaces the whole memory: use it to ` +
        `tidy up, and keep everything still true.`,
      input_schema: {
        type: "object",
        properties: {
          entry: { type: "string", description: "One line for 'append', or the full memory for 'rewrite'." },
          mode: { type: "string", enum: ["append", "rewrite"] },
        },
        required: ["entry"],
      },
    },
    run: async ({ entry, mode = "append" }) => {
      const ws = workspace(id);
      ensureWorkspace(id);
      if (mode === "rewrite") {
        writeFileSync(ws.memory, `# ${me.name}'s memory\n\n${String(entry).trim()}\n`);
      } else {
        appendFileSync(ws.memory, `- ${today()} ${String(entry).replace(/\s+/g, " ").trim()}\n`);
      }
      emit({ type: "changed", what: "memory" });
      return mode === "rewrite" ? "Memory rewritten." : "Remembered.";
    },
  };
}

// ---------- Sessions ----------
export type SessionSource = "user" | "direct" | "brief" | "job" | "discord";
export type SessionLine = { time: string; source: SessionSource; task: string; result: string; status: string; file: string };

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
};

export function recordSession(
  id: CrewId,
  s: { source: SessionSource; task: string; result: string; status: string; messages: unknown[] }
) {
  const ws = workspace(id);
  ensureWorkspace(id);
  const time = new Date().toISOString();
  // Random suffix: parallel quests for the same agent can finish in the same millisecond.
  const file = join(ws.sessions, `${time.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}.json`);
  writeFileSync(file, JSON.stringify({ time, agent: id, source: s.source, status: s.status, task: s.task, result: s.result, messages: s.messages }, null, 2));
  const line: SessionLine = { time, source: s.source, task: clip(s.task, 600), result: clip(s.result, 1500), status: s.status, file };
  appendFileSync(ws.index, JSON.stringify(line) + "\n");
}

export function recentSessions(id: CrewId, n = 8): SessionLine[] {
  const { index } = workspace(id);
  if (!existsSync(index)) return [];
  return readFileSync(index, "utf8").split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l) as SessionLine);
}

const SOURCE_LABEL: Record<SessionSource, string> = {
  user: "the user asked",
  direct: "the user messaged you directly",
  brief: "the Quartermaster briefed you",
  job: "a scheduled job ran",
  discord: "the user messaged you on Discord",
};

// What goes in the prompt: memory plus a digest of recent sessions, newest last.
// The last three get more room, so follow-ups ("make it shorter") have the context they need.
export function continuityBlock(id: CrewId): string {
  const sessions = recentSessions(id);
  const digest = sessions
    .map((s, i) => {
      const recent = i >= sessions.length - 3;
      const when = new Date(s.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `- ${when}, ${SOURCE_LABEL[s.source] ?? s.source}: "${clip(s.task, recent ? 400 : 140)}"\n  You replied (${s.status}): ${clip(s.result, recent ? 1200 : 200)}`;
    })
    .join("\n");
  return (
    `## Your memory (camp/agents/${id}/memory.md; save to it with remember)\n${readMemory(id)}\n\n` +
    `## Your recent sessions (build on these; full transcripts are in camp/agents/${id}/sessions/)\n` +
    (digest || "(none yet: this is your first session)") +
    `\n\n## Your workspace\nSave your own files to camp/agents/${id}/outputs/ unless you're given another path. ` +
    `You can read teammates' outputs (camp/agents/<name>/outputs/), but not their memory or sessions.`
  );
}
