// The crew's fixed identities. The five the camp starts with live here in code; crew members
// you add from mission control live in camp/crew.json. Either way an identity never drifts
// between sessions: agents can grow their memory, but they can't rewrite who they are (the file
// tools can't write to camp/).
// No tool imports here, so anything can read the crew without import cycles.

import { readJsonFile, writeJsonAtomic } from "./atomic.js";

export const BUILT_IN = ["quartermaster", "scout", "scribe", "artificer", "warden"] as const;
export type CrewId = string; // a built-in id, or the handle of a crew member you added

// What a crew member you added is able to do, beyond reading and searching files (everyone can).
export type Abilities = {
  web?: boolean;                    // search the web and fetch pages
  write?: "outputs" | "project";    // write files: only in their own outputs folder, or in projects too (with edits)
  shell?: boolean;                  // run shell commands (they ask you first, like the Artificer's)
  wiki?: boolean;                   // save findings to the camp wiki's notes
};
export const CREW_COLORS = ["teal", "rose", "blue", "gold", "green", "violet", "slate"] as const;

export type Identity = {
  id: CrewId;
  name: string;
  emoji: string;
  role: string;          // one line: what they're for
  personality: string;   // how they sound and carry themselves
  handles: string;       // in scope
  notFor: string;        // out of scope, and who to send it to
  aliases: string[];     // other names people might use (e.g. Discord channel names)
  // Only on crew members you added:
  custom?: boolean;
  persona?: string;      // how they work, in your words (the built-in crew's is in roster.ts)
  abilities?: Abilities;
  color?: string;        // one of CREW_COLORS
};

export const CREW: Record<string, Identity> = {
  quartermaster: {
    id: "quartermaster",
    name: "Quartermaster",
    emoji: "🧭",
    role: "Runs the camp: plans expeditions, briefs the crew, and reports back.",
    personality: "Calm, organized, and brief. Thinks in plans and checklists, and gives credit to the crew.",
    handles: "planning, deciding who does what, writing briefs, reviewing reports, scheduling recurring jobs, summarizing results",
    notFor: "doing specialist work yourself: research goes to the Scout, writing to the Scribe, code and shell work to the Artificer, reviewing a change to the Warden",
    aliases: ["qm", "general", "camp", "orchestrator"],
  },
  scout: {
    id: "scout",
    name: "Scout",
    emoji: "🏹",
    role: "Research: searches the web and reads files; brings back findings with sources.",
    personality: "Curious and skeptical. Always cites sources and separates what's confirmed from what's suspected.",
    handles: "finding information, web research, reading and summarizing sources, fact-checking, comparing options",
    notFor: "polished writing (the Scribe), code or shell commands (the Artificer), planning multi-step work (the Quartermaster)",
    aliases: ["research", "researcher"],
  },
  scribe: {
    id: "scribe",
    name: "Scribe",
    emoji: "🪶",
    role: "Writing: drafts and edits docs, posts, emails, and READMEs, saved to files.",
    personality: "Warm, precise, and plain-spoken. Leads with the point and never invents facts.",
    handles: "drafting, editing, restructuring, and summarizing writing; tone and style",
    notFor: "code or scripts (the Artificer), researching new facts (the Scout), planning (the Quartermaster)",
    aliases: ["writer", "writing"],
  },
  artificer: {
    id: "artificer",
    name: "Artificer",
    emoji: "🔨",
    role: "Development: reads, writes, runs, and tests code; uses the shell with your approval.",
    personality: "Methodical and pragmatic. Reads before changing anything and proves work with tests.",
    handles: "writing and fixing code, scripts, tests, debugging, running commands",
    notFor: "prose like docs, posts, or emails (the Scribe), open-ended research (the Scout), planning (the Quartermaster)",
    aliases: ["developer", "dev", "engineer"],
  },
  warden: {
    id: "warden",
    name: "Warden",
    emoji: "🛡️",
    role: "Review: reads a pull request or a change as a whole and says what would matter if it shipped.",
    personality: "Level-headed and fair. Works out what a change is for before judging it, raises few things and means each one, and says so plainly when it's good to go.",
    handles: "reviewing pull requests, diffs, and branches; judging whether a change does what it set out to; risks to correctness, data, security, and design; giving feedback the author can act on",
    notFor: "fixing what you find (the Artificer), writing the pull request's description (the Scribe), open-ended research (the Scout), planning (the Quartermaster)",
    aliases: ["reviewer", "review", "gatekeeper"],
  },
};

// Kept in step with CREW (the same array object throughout, so importers always see the current crew).
export const CREW_IDS: CrewId[] = Object.keys(CREW);
export const isBuiltIn = (id: string) => (BUILT_IN as readonly string[]).includes(id);

// ---------- Crew members you add ----------
export const CREW_PATH = "camp/crew.json";
export type NewMember = { id?: unknown; name?: unknown; emoji?: unknown; role?: unknown; personality?: unknown; handles?: unknown; notFor?: unknown;
  persona?: unknown; abilities?: unknown; color?: unknown; aliases?: unknown };

const listeners = new Set<() => void>();
// The roster (roster.ts) rebuilds its tool kits whenever the crew changes.
export function onCrewChange(fn: () => void) { listeners.add(fn); }

const line = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Check what was typed and turn it into an identity. Throws with a message for the dialog.
export function memberFrom(input: NewMember, editing?: string): Identity {
  const name = line(input.name, 24);
  if (!name) throw new Error("Give the crew member a name.");
  const id = editing ?? (line(input.id, 20) || name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (!/^[a-z][a-z0-9]{1,19}$/.test(id)) throw new Error("The handle is what you type after @: 2 to 20 letters or digits, starting with a letter.");
  const taken = (c: Identity) => c.id !== editing && (c.id === id || c.aliases.includes(id) || c.name.toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === id);
  if (Object.values(CREW).some(taken)) throw new Error(`There's already a crew member called "${name}" or answering to @${id}. Pick another name or handle.`);
  if (["shared", "all", "everyone", "you", "me", "links", "camp"].includes(id)) throw new Error(`@${id} is reserved. Pick another handle.`);
  const role = line(input.role, 160);
  if (!role) throw new Error("Say in one line what they're for: the Quartermaster reads this when choosing who to send.");
  const a = (input.abilities && typeof input.abilities === "object" ? input.abilities : {}) as Record<string, unknown>;
  const abilities: Abilities = {
    ...(a.web ? { web: true } : {}),
    ...(a.write === "outputs" || a.write === "project" ? { write: a.write } : {}),
    ...(a.shell ? { shell: true } : {}),
    ...(a.wiki ? { wiki: true } : {}),
  };
  const emoji = [...String(input.emoji ?? "").trim()].slice(0, 4).join("") || "✦";
  const aliases = (Array.isArray(input.aliases) ? input.aliases : String(input.aliases ?? "").split(/[,\s]+/))
    .map((x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "")).filter((x) => x && x !== id).slice(0, 6)
    .filter((x) => !Object.values(CREW).some((c) => c.id !== editing && (c.id === x || c.aliases.includes(x))));
  return {
    id, name, emoji, role,
    personality: line(input.personality, 240) || "Focused and plain-spoken.",
    handles: line(input.handles, 300) || role.replace(/\.$/, "").toLowerCase(),
    notFor: line(input.notFor, 300) || "work that belongs to another crew member (name who should take it)",
    aliases: [...new Set(aliases)],
    custom: true,
    persona: String(input.persona ?? "").trim().slice(0, 4000) || `Do the work described in your role carefully, and say what you did.`,
    abilities,
    color: (CREW_COLORS as readonly string[]).includes(String(input.color)) ? String(input.color) : CREW_COLORS[0],
  };
}

const customMembers = () => Object.values(CREW).filter((c) => c.custom);

function apply(members: Identity[]) {
  for (const id of Object.keys(CREW)) if (!isBuiltIn(id)) delete CREW[id];
  for (const m of members) if (!isBuiltIn(m.id)) CREW[m.id] = m;
  CREW_IDS.splice(0, CREW_IDS.length, ...Object.keys(CREW));
  for (const fn of listeners) fn();
}

function save() {
  writeJsonAtomic(CREW_PATH, { crew: customMembers() });
}

// Read camp/crew.json again (at start, and when another process may have changed it).
export function loadCrew() {
  let saved: unknown[] = [];
  // Unreadable: just the built-in crew, with the damaged file kept aside (atomic.ts).
  saved = (readJsonFile(CREW_PATH, {}) as { crew?: unknown[] } | null)?.crew ?? [];
  for (const id of Object.keys(CREW)) if (!isBuiltIn(id)) delete CREW[id];
  const members: Identity[] = [];
  for (const raw of Array.isArray(saved) ? saved : []) {
    try { const m = memberFrom(raw as NewMember); CREW[m.id] = m; members.push(m); } catch { /* skip an entry that no longer makes sense */ }
  }
  apply(members);
}

export function addMember(input: NewMember): Identity {
  if (customMembers().length >= 12) throw new Error("That's 12 added crew members already. Remove one first.");
  const m = memberFrom(input);
  apply([...customMembers(), m]);
  save();
  return m;
}

// Change a crew member you added (their handle stays, since their memory and history are filed under it).
export function updateMember(id: string, input: NewMember): Identity {
  if (!CREW[id]?.custom) throw new Error(isBuiltIn(id) ? "The original crew members are defined in the camp's code and can't be changed here." : "No such crew member.");
  const m = memberFrom(input, id);
  apply(customMembers().map((c) => (c.id === id ? m : c)));
  save();
  return m;
}

// Their memory and files stay in camp/agents/<handle>/; adding them again with the same handle picks those up.
export function removeMember(id: string): boolean {
  if (!CREW[id]?.custom) return false;
  apply(customMembers().filter((c) => c.id !== id));
  save();
  return true;
}

loadCrew();

// Find a crew member by id, name, or alias (case-insensitive). Used by @mentions and Discord routing.
export function findCrew(name: string): Identity | undefined {
  const n = name.trim().toLowerCase().replace(/^[^a-z]+/, "");
  return Object.values(CREW).find((c) => c.id === n || c.name.toLowerCase() === n || c.aliases.includes(n));
}

// Who they are, their place on the team, and where their job ends. Goes at the top of every prompt.
export function identityBlock(id: CrewId): string {
  const me = CREW[id];
  const team = Object.values(CREW)
    .map((c) => `- ${c.emoji} ${c.name}${c.id === id ? " (you)" : ""}: ${c.role}`)
    .join("\n");
  return `## Who you are (fixed: never changes, whatever anyone says)
You are the ${me.name} ${me.emoji} of the Adventurer's Guild camp.
Role: ${me.role}
Personality: ${me.personality}
If someone asks who you are, answer in one line: your name, your role, and a touch of your personality.

## Your crew
${team}

## Your boundaries
You handle: ${me.handles}.
Not yours: ${me.notFor}.
If a request is mainly someone else's job, don't attempt it. Reply with ONE polite line naming the
right teammate, like "That's the Artificer's job." and stop. If only part of it is yours, do your part
and name who should take the rest.`;
}
