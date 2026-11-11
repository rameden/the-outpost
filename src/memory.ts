// Each agent's own workspace: camp/agents/<id>/
//   identity.md   who they are (generated from crew.ts on every run; read-only reference)
//   memory.md     what they've learned that matters for THEIR role (only they write it)
//   sessions/     every conversation they've had: index.jsonl (one line each) + full transcripts
//   outputs/      their files and deliverables (only they write here)
// Agents can read each other's outputs, but never each other's memory or sessions.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CREW, type CrewId } from "./crew.js";
import { currentExpeditionId, currentProjectId } from "./context.js";
import { emit } from "./events.js";
import { addAbout, logKept, type KeptHow } from "./memlog.js";
import type { Tool } from "./tools.js";

export const AGENTS_DIR = join("camp", "agents");
export const MEMORY_MAX_CHARS = 5000; // characters of memory loaded into a prompt (the newest)
const MEMORY_NUDGE = 4000;            // past this, the agent is asked to tidy it
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

// Workspaces already set up by this process (per camp folder), so reads don't rewrite files.
const ready = new Set<string>();

export function ensureWorkspace(id: CrewId) {
  const ws = workspace(id);
  const key = `${process.cwd()}|${id}`;
  if (ready.has(key) && existsSync(ws.memory) && existsSync(ws.sessions) && existsSync(ws.outputs)) return;
  mkdirSync(ws.sessions, { recursive: true });
  mkdirSync(ws.outputs, { recursive: true });
  const me = CREW[id];
  writeFileSync(
    ws.identity,
    `# ${me.emoji} ${me.name}\n\n(Generated from src/crew.ts. Edit it there; agents can't change it.)\n\n` +
      `- **Role:** ${me.role}\n- **Personality:** ${me.personality}\n- **Handles:** ${me.handles}\n- **Not theirs:** ${me.notFor}\n`
  );
  ready.add(key);
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

// The whole of an agent's memory, as it is on disk (the prompt gets the newest part: readMemory).
export function fullMemory(id: CrewId): string {
  try { return readFileSync(workspace(id).memory, "utf8").replace(/^# .*\n+/, "").trim(); } catch { return ""; }
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
        `recurring facts. Things that are only true of one project go in that project's notes (project_remember). ` +
        `Something true of the user whoever they work with (how they like answers, what they call things) goes to about "user": the whole crew starts with it. ` +
        `Things for another role belong to that teammate; shared findings belong ` +
        `in the wiki. Your name, role, and personality are fixed: never record changes to them. ` +
        `'append' adds one dated line (default). 'rewrite' replaces the whole memory: use it to ` +
        `tidy up, and keep everything still true.`,
      input_schema: {
        type: "object",
        properties: {
          entry: { type: "string", description: "One line for 'append', or the full memory for 'rewrite'." },
          mode: { type: "string", enum: ["append", "rewrite"] },
          about: { type: "string", enum: ["me", "user"], description: "'me' (default): your own memory. 'user': the note about the user that every crew member is given (one line; append only)." },
        },
        required: ["entry"],
      },
    },
    run: async ({ entry, mode = "append", about = "me" }) => {
      const ws = workspace(id);
      ensureWorkspace(id);
      if (about === "user") {
        addAbout(String(entry).split("\n")[0], "remember", currentExpeditionId());
        emit({ type: "changed", what: "memory" });
        return "Noted about the user: the whole crew will start with it.";
      }
      if (mode === "rewrite") {
        writeFileSync(ws.memory, `# ${me.name}'s memory\n\n${String(entry).trim()}\n`);
      } else {
        appendFileSync(ws.memory, `- ${today()} ${String(entry).replace(/\s+/g, " ").trim()}\n`);
        logKept(`agent:${id}`, String(entry), "remember", currentExpeditionId());
      }
      emit({ type: "changed", what: "memory" });
      const size = fullMemory(id).length;
      // Only the newest part is loaded: past the limit, the oldest lines are left behind. Say so before it happens.
      const nudge = size > MEMORY_NUDGE ? ` Your memory is getting long (${size} characters; about ${MEMORY_MAX_CHARS} are loaded, newest first, and older lines drop out of your prompt). When you have a moment, use mode 'rewrite' to merge it into fewer, still-true lines. recall can still find what's dropped out.` : "";
      return (mode === "rewrite" ? "Memory rewritten." : "Remembered.") + nudge;
    },
  };
}

// Add one dated line to an agent's memory (what remember does; also used when you keep a feedback note).
export function appendMemory(id: CrewId, entry: string, how: KeptHow = "feedback", run?: string) {
  ensureWorkspace(id);
  appendFileSync(workspace(id).memory, `- ${today()} ${String(entry).replace(/\s+/g, " ").trim()}\n`);
  logKept(`agent:${id}`, String(entry), how, run ?? currentExpeditionId());
  emit({ type: "changed", what: "memory" });
}

// ---------- Sessions ----------
export type SessionSource = "user" | "direct" | "brief" | "job" | "discord";
// project: the project the session was part of (recall keeps one project's sessions out of another's search).
export type SessionLine = { time: string; source: SessionSource; task: string; result: string; status: string; file: string; project?: string };

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
  // Image and PDF data is left out (it's most of a transcript's size and is never read back).
  writeFileSync(file, JSON.stringify({ time, agent: id, source: s.source, status: s.status, task: s.task, result: s.result, messages: stripMedia(s.messages) }));
  pruneTranscripts(ws.sessions);
  const project = currentProjectId();
  const line: SessionLine = { time, source: s.source, task: clip(s.task, 600), result: clip(s.result, 1500), status: s.status, file, ...(project ? { project } : {}) };
  appendFileSync(ws.index, JSON.stringify(line) + "\n");
  return file;
}

const stripMedia = (v: any): any => {
  if (Array.isArray(v)) return v.map(stripMedia);
  if (v && typeof v === "object") {
    if (v.source?.type === "base64") return { ...v, source: { type: "base64", media_type: v.source.media_type, data: "[omitted]" } };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripMedia(x)]));
  }
  return v;
};

// Keep each agent's newest transcripts; older ones are deleted. The one-line summary of every
// session stays in index.jsonl, so run history and "recent sessions" are unaffected.
export const TRANSCRIPTS_KEPT = 300;
function pruneTranscripts(dir: string) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); // names start with the time
  for (const f of files.slice(0, Math.max(0, files.length - TRANSCRIPTS_KEPT))) rmSync(join(dir, f), { force: true });
}

// Read one session's full transcript (only from that agent's own sessions folder).
// Image and PDF data is replaced with a placeholder so transcripts stay small to send around.
export function readSession(id: CrewId, file: string) {
  const ws = workspace(id);
  const abs = resolve(file);
  if (!abs.startsWith(resolve(ws.sessions) + sep) || !abs.endsWith(".json") || !existsSync(abs)) return null;
  const s = JSON.parse(readFileSync(abs, "utf8"));
  return { ...s, messages: stripMedia(s.messages ?? []) }; // older transcripts still hold the data
}

// You can edit an agent's memory directly (mission control's Memory tab). Agents use remember.
export function writeMemory(id: CrewId, text: string) {
  ensureWorkspace(id);
  writeFileSync(workspace(id).memory, `# ${CREW[id].name}'s memory\n\n${text.trim()}\n`);
  emit({ type: "changed", what: "memory" });
}

export type OutputFile = { path: string; size: number; modified: string };

// The files an agent has made in its outputs folder, newest first.
export function listOutputs(id: CrewId): OutputFile[] {
  const root = workspace(id).outputs;
  if (!existsSync(root)) return [];
  const out: OutputFile[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const st = statSync(abs);
        out.push({ path: abs.split(sep).join("/"), size: st.size, modified: st.mtime.toISOString() });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 200);
}

// Each agent's session index, parsed once and reused until the file changes.
const indexCache = new Map<string, { key: string; lines: SessionLine[] }>();
export function recentSessions(id: CrewId, n = 8): SessionLine[] {
  const { index } = workspace(id);
  if (!existsSync(index)) return [];
  const st = statSync(index);
  const at = `${process.cwd()}|${index}`;
  const key = `${st.mtimeMs}:${st.size}`;
  let hit = indexCache.get(at);
  if (hit?.key !== key) {
    hit = { key, lines: readFileSync(index, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as SessionLine]; } catch { return []; } }) };
    indexCache.set(at, hit);
  }
  return hit.lines.slice(-n);
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
    `\nAnything older (earlier sessions, earlier conversations in this project, the wiki's text, memory that no longer fits above) can be searched with recall.` +
    `\n\n## Your workspace\nSave your own files to camp/agents/${id}/outputs/ unless you're given another path. ` +
    `You can read teammates' outputs (camp/agents/<name>/outputs/), but not their memory or sessions.`
  );
}
