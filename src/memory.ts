// Each agent's own workspace: camp/agents/<id>/
//   identity.md   who they are (generated from crew.ts on every run; read-only reference)
//   memory.md     what they've learned that matters for THEIR role (only they write it)
//   sessions/     every conversation they've had: index.jsonl (one line each) + full transcripts
//   outputs/      their files and deliverables (only they write here)
// Agents can read each other's outputs, but never each other's memory or sessions.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, rmSync } from "node:fs";
import { posix, resolve, sep } from "node:path";
import { CREW, inPack, type CrewId } from "./crew.js";
import { currentExpeditionId, currentProjectId } from "./context.js";
import { emit } from "./events.js";
import { addAbout, logKept, type KeptHow } from "./memlog.js";
import type { Tool } from "./tools.js";
import { writeAtomic } from "./atomic.js";
import { PIN, alike, fitMemory, parseEntry } from "./memfit.js";
import { norm } from "./memlog.js";
// Paths inside the camp are written with forward slashes on every system (Windows takes them too),
// so what the crew and the page are shown reads the same everywhere.
const join = posix.join;

export const AGENTS_DIR = join("camp", "agents");
export const MEMORY_MAX_CHARS = 5000; // characters of memory loaded into a prompt (which lines, once it's longer than that: memfit.ts)
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

// What a prompt gets of an agent's memory. All of it while it fits; past that, the pinned lines,
// the newest, and the older ones that bear on `task` (the request this run is for).
export function readMemory(id: CrewId, task = ""): string {
  ensureWorkspace(id);
  const ws = workspace(id);
  if (!existsSync(ws.memory)) return "(empty)";
  const text = readFileSync(ws.memory, "utf8").replace(/^# .*\n+/, "").trim();
  if (!text) return "(empty)";
  return fitMemory(text, MEMORY_MAX_CHARS, task).text;
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
        `tidy up, and keep everything still true (a line that starts with ${PIN} after its date is pinned: keep the mark). ` +
        `When a new line corrects or updates an old one, give the old line's text in replaces, so the two don't sit side by side contradicting each other.`,
      input_schema: {
        type: "object",
        properties: {
          entry: { type: "string", description: "One line for 'append', or the full memory for 'rewrite'." },
          mode: { type: "string", enum: ["append", "rewrite"] },
          about: { type: "string", enum: ["me", "user"], description: "'me' (default): your own memory. 'user': the note about the user that every crew member is given (one line; append only)." },
          replaces: { type: "string", description: "With 'append': the text of a line already in your memory that this one corrects or updates. That line is taken out." },
          pin: { type: "boolean", description: "With 'append': keep this line in every prompt, however long your memory gets. Only for a standing rule that applies to all your work, whatever the task; most lines aren't." },
        },
        required: ["entry"],
      },
    },
    run: async ({ entry, mode = "append", about = "me", replaces, pin }) => {
      const ws = workspace(id);
      ensureWorkspace(id);
      if (about === "user") {
        addAbout(String(entry).split("\n")[0], "remember", currentExpeditionId());
        emit({ type: "changed", what: "memory" });
        return "Noted about the user: the whole crew will start with it.";
      }
      let said = "Memory rewritten.";
      if (mode === "rewrite") {
        writeAtomic(ws.memory, `# ${me.name}'s memory\n\n${String(entry).trim()}\n`); // a rewrite replaces everything: never leave it half done
      } else {
        const line = String(entry).replace(/\s+/g, " ").trim().replace(new RegExp(`^${PIN}\\s*`, "u"), "");
        if (!line) return "Nothing to remember.";
        const rows = existsSync(ws.memory) ? readFileSync(ws.memory, "utf8").replace(/\n+$/, "").split("\n") : [`# ${me.name}'s memory`, ""];
        const isNote = (r: string, text: string) => !!parseEntry(r) && norm(r) === norm(text);
        // The line this one corrects, taken out first (its pin carries over: a corrected rule is still a rule).
        let replaced = false, wasPinned = false;
        if (typeof replaces === "string" && replaces.trim()) {
          const at = rows.findIndex((r) => isNote(r, replaces));
          if (at >= 0) { wasPinned = !!parseEntry(rows[at])?.pinned; rows.splice(at, 1); replaced = true; }
        }
        const already = rows.some((r) => isNote(r, line));
        // Before it's added: lines already there that seem to say something on the same subject.
        const near = already ? [] : rows.flatMap((r) => { const e = parseEntry(r); const score = e ? alike(e.text, line) : 0; return e && score >= 0.5 ? [{ text: e.text, score }] : []; })
          .sort((a, b) => b.score - a.score).slice(0, 2);
        if (!already) rows.push(`- ${today()} ${pin === true || wasPinned ? `${PIN} ` : ""}${line}`);
        if (!already || replaced) writeAtomic(ws.memory, rows.join("\n") + "\n");
        if (!already) logKept(`agent:${id}`, line, "remember", currentExpeditionId());
        said = already ? (replaced ? "The old line is gone; the new one was already in your memory." : "That's already in your memory, word for word: nothing was added.")
          : replaced ? "Remembered, in place of the old line."
          : "Remembered." + (typeof replaces === "string" && replaces.trim() ? " (The line to replace wasn't found: copy its text exactly as it appears in your memory. Nothing was taken out.)" : "");
        if (near.length && !replaced) said += ` Already in your memory on what looks like the same subject:\n${near.map((n) => `- ${n.text}`).join("\n")}\nIf the new line corrects one of these, call remember again with the same entry and replaces set to that line's text, so the old one doesn't linger.`;
        const pinned = fullMemory(id).split("\n").filter((r) => parseEntry(r)?.pinned).join("\n").length;
        if ((pin === true || wasPinned) && pinned > MEMORY_MAX_CHARS * 0.4) said += ` Your pinned lines now come to ${pinned} characters, more than is kept for them in a prompt: the newest pinned ones load like any other line. Unpin what isn't a standing rule (mode 'rewrite', dropping the ${PIN}).`;
      }
      emit({ type: "changed", what: "memory" });
      const size = fullMemory(id).length;
      // Past what a prompt loads, older lines only come along when the task is about them. Say so before it happens.
      const nudge = size > MEMORY_NUDGE ? ` Your memory is getting long (${size} characters; a prompt loads about ${MEMORY_MAX_CHARS}: the pinned lines, the newest, and older ones only when a request is about them). When you have a moment, use mode 'rewrite' to merge it into fewer, still-true lines. recall can still find what isn't loaded.` : "";
      return said + nudge;
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
// The same length, with its lines kept: for what's shown back to you as it was written (a reply
// with a table or a list in it). Runs of blank lines are closed up.
const clipLines = (s: string, n: number) => {
  const text = s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text;
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
  const line: SessionLine = { time, source: s.source, task: clip(s.task, 600), result: clipLines(s.result, 1500), status: s.status, file, ...(project ? { project } : {}) };
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
  writeAtomic(workspace(id).memory, `# ${CREW[id].name}'s memory\n\n${text.trim()}\n`);
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
// task: the request this run is for, so an older memory line that bears on it is loaded too.
export function continuityBlock(id: CrewId, task = ""): string {
  const sessions = recentSessions(id);
  const digest = sessions
    .map((s, i) => {
      const recent = i >= sessions.length - 3;
      const when = new Date(s.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `- ${when}, ${inPack(SOURCE_LABEL[s.source] ?? s.source)}: "${clip(s.task, recent ? 400 : 140)}"\n  You replied (${s.status}): ${clip(s.result, recent ? 1200 : 200)}`;
    })
    .join("\n");
  return (
    `## Your memory (camp/agents/${id}/memory.md; save to it with remember)\n${readMemory(id, task)}\n\n` +
    `## Your recent sessions (build on these; full transcripts are in camp/agents/${id}/sessions/)\n` +
    (digest || "(none yet: this is your first session)") +
    `\nAnything older (earlier sessions, earlier conversations in this project, the wiki's text, memory that no longer fits above) can be searched with recall.` +
    `\n\n## Your workspace\nSave your own files to camp/agents/${id}/outputs/ unless you're given another path. ` +
    `You can read teammates' outputs (camp/agents/<name>/outputs/), but not their memory or sessions.`
  );
}
