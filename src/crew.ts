// The crew's fixed identities. The six the camp starts with live here in code; crew members
// you add from mission control live in camp/crew.json. Either way an identity never drifts
// between sessions: agents can grow their memory, but they can't rewrite who they are (the file
// tools can't write to camp/).
// No tool imports here, so anything can read the crew without import cycles.

import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { DEFAULT_PACK, PACKS, RETIRED, customPacks, isPack, packAliases, packById, packFrom, retiredAliases, setCustomPacks, setRetired, type Pack, type PackInput, type Taken } from "./packs.js";
import { packId, setPackId } from "./settings.js";
import { fill } from "./wordfill.js";

import { BUILT_IN } from "./builtin.js";
export { BUILT_IN };
export type CrewId = string; // a built-in id, or the handle of a crew member you added

// What a crew member you added is able to do, beyond reading and searching files (everyone can).
export type Abilities = {
  web?: boolean;                    // search the web and fetch pages
  write?: "outputs" | "project";    // write files: only in their own outputs folder, or in projects too (with edits)
  shell?: boolean;                  // run shell commands (they ask you first, like the Artificer's)
  wiki?: boolean;                   // save findings to the camp wiki's notes
  images?: boolean;                 // draw pictures with OpenAI's image model, into their outputs folder (imagegen.ts)
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
    role: "Runs the {camp}: plans {expeditions}, briefs the {crew}, and reports back.",
    personality: "Calm, organized, and brief. Thinks in plans and checklists, and gives credit to the {crew}.",
    handles: "planning, deciding who does what, writing briefs, reviewing reports, scheduling recurring jobs, summarizing results, answering general questions after a quick web lookup",
    notFor: "doing specialist work yourself: in-depth research goes to the Scout, writing to the Scribe, code and shell work to the Artificer, reviewing a change to the Warden",
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
  // The handle is the one they had as the Wizard, someone you added, so their memory and history
  // stay filed where they were.
  wizard: {
    id: "wizard",
    name: "Test Pilot",
    emoji: "🛸",
    role: "Takes the hardest {quests}: the bug nobody can reproduce, the migration with no clean path, the problem nobody has mapped yet.",
    personality: "Steady under pressure and quick to try things. Gets something working end to end first, then makes it sound, and is honest about every corner cut.",
    handles: "the hardest problems in code: bugs nobody can reproduce, migrations and changes with no clean path, unmapped problems, spikes and prototypes that prove an approach works end to end",
    notFor: "routine code changes and tests (the Artificer), reviewing a change (the Warden), prose and PR descriptions (the Scribe), open-ended research (the Scout), planning (the Quartermaster)",
    aliases: ["pilot", "hack", "hackathon", "prototype"],
  },
};

// Kept in step with CREW (the same array object throughout, so importers always see the current crew).
export const CREW_IDS: CrewId[] = Object.keys(CREW);
export const isBuiltIn = (id: string) => (BUILT_IN as readonly string[]).includes(id);

// ---------- Theme packs ----------
// The six above are written out as the Guild has them, with {camp}, {quests}… where the pack's words go. The active pack (packs.ts, chosen in
// Settings) is put over them: its names and emoji, everywhere, prompts included, so the crew call
// each other what the page calls them. Ids never change. Every pack's names stay on as aliases,
// so "@scout" still finds the Navigator, and history written under one pack reads under another.
const GUILD: Record<string, Identity> = structuredClone(CREW);
let pack: Pack = packById(undefined);
let renamed = new Map<string, string>(); // a Guild name → what that crew member is called now (only those that changed)
let WAS = /$^/g;                          // those Guild names, as whole words
function watchNames() {
  const names = [...renamed.keys()].map((n) => n.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"));
  WAS = names.length ? new RegExp("\\b(" + names.join("|") + ")\\b", "g") : /$^/g;
}
export const activePack = (): Pack => pack;

// Crew members you added, as you wrote them. A pack never renames them.
const OWN = new Map<string, Identity>();
export const ownOf = (id: string): Identity | undefined => OWN.get(id);

// Text the camp wrote with the Guild's names in it (a persona, a rule), with the names in use
// now. With the Guild pack on this is the text itself, untouched.
export function inPack(text: string): string {
  return renamed.size ? text.replace(WAS, (name) => renamed.get(name) ?? name) : text;
}

// The same text with the pack's words in too: {camp}, {Crew}, {quests}, {expeditions}, {member}…
// (what say() in words.ts does; kept here as well because this file is read before the pack is
// loaded and words.ts reads this one, so nothing here may call into it).
// say() in words.ts, which crew.ts can't import (words.ts needs crew.ts loaded first).
const worded = (text: string): string => inPack(fill(pack.words, text));

const oneWord = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// Put the active pack on the six. A crew member you added always keeps their name and handles:
// if one is already called what the pack would call someone, that one of the six keeps their
// Guild name, and a pack's short handle you've used elsewhere is simply left off.
function dress() {
  const yours = new Set(customMembers().flatMap((c) => [c.id, c.name.toLowerCase(), oneWord(c.name), ...c.aliases]));
  const worn = Object.fromEntries(BUILT_IN.map((id) => {
    const w = pack.crew[id];
    return [id, yours.has(w.name.toLowerCase()) || yours.has(oneWord(w.name)) ? GUILD[id] : w];
  }));
  renamed = new Map(BUILT_IN.filter((id) => worn[id].name !== GUILD[id].name).map((id) => [GUILD[id].name, worn[id].name]));
  watchNames();
  for (const id of BUILT_IN) {
    const g = GUILD[id], name = worn[id].name;
    const others = [...PACKS.flatMap((p) => packAliases(id, p)), ...retiredAliases(id)].filter((a) => a !== id && a !== name.toLowerCase() && !yours.has(a));
    Object.assign(CREW[id], {
      name, emoji: worn[id].emoji,
      role: worded(g.role), personality: worded(g.personality), handles: worded(g.handles), notFor: worded(g.notFor),
      aliases: [...new Set([...g.aliases, ...others])],
    });
  }
}

// The ones you added, as you wrote them.
function dressYours() {
  for (const own of OWN.values()) Object.assign(CREW[own.id], { name: own.name, emoji: own.emoji, aliases: own.aliases, persona: own.persona });
}

// Back to the six as written, while what you've added is read and checked against them.
function undress() {
  for (const id of BUILT_IN) Object.assign(CREW[id], structuredClone(GUILD[id]));
}

// Choose the pack (Settings → Appearance). Kept in camp/settings.json; the crew wear it from their next run.
export function setPack(id: string): Pack {
  setPackId(id);
  pack = packById(id);
  dress();
  dressYours();
  for (const fn of listeners) fn();
  return pack;
}

// ---------- Packs of your own ----------
// Made in Settings → Appearance (or written by hand), kept in camp/packs.json beside the crew you
// added, and joined on after the six packs the camp comes with. Each is checked as it's read and
// as it's saved (packs.ts, packFrom): one that doesn't pass is left out, with the reason logged
// and shown in Settings, and stays in the file as you wrote it.
export const PACKS_PATH = "camp/packs.json";
const RESERVED = ["shared", "all", "everyone", "you", "me", "links", "camp"];
let leftOut: { id: string; why: string; raw: unknown }[] = [];
export const packsLeftOut = () => leftOut.map(({ id, why }) => ({ id, why }));
const logged = new Set<string>();

// The names no pack may give away: the six's own handles, anyone you added (theirs wins), and
// the words that mean something else after @.
function spokenFor(members: Identity[]): Taken[] {
  return [
    ...BUILT_IN.map((id) => ({ id, forms: [id, ...GUILD[id].aliases], why: (f: string) => `@${f} already finds the ${GUILD[id].name}` })),
    ...members.map((c) => ({ id: c.id, forms: [c.id, c.name.toLowerCase(), oneWord(c.name), ...c.aliases], why: () => `you have a ${pack.words.crew} member called ${c.name} (@${c.id}), and they keep the name` })),
    { id: "", forms: RESERVED, why: (f: string) => `@${f} is reserved` },
  ];
}

function readPacks(members: Identity[]) {
  const file = readJsonFile(PACKS_PATH, {}) as { packs?: unknown; retired?: unknown } | null;
  const taken = spokenFor(members);
  const good: Pack[] = [];
  leftOut = [];
  for (const raw of Array.isArray(file?.packs) ? file.packs : []) {
    try { good.push(packFrom(raw as PackInput, { packs: [...PACKS.filter((p) => !p.custom), ...good], taken })); }
    catch (e) {
      const r = (raw ?? {}) as { id?: unknown; name?: unknown };
      const id = String(r.id ?? r.name ?? "(no name)").slice(0, 40), why = (e as Error).message;
      leftOut.push({ id, why, raw });
      const said = `⚠️  ${PACKS_PATH}: the pack "${id}" was left out. ${why}`;
      if (!logged.has(said)) { logged.add(said); console.error(said); }
    }
  }
  setCustomPacks(good);
  setRetired(file?.retired, [], taken);
}

// was: the pack as it stood before this change, whose names history may still use.
function savePacks(was: Pack[] = []) {
  setRetired(RETIRED, was, spokenFor(customMembers()));
  writeJsonAtomic(PACKS_PATH, {
    packs: [...customPacks().map(({ custom: _, ...p }) => p), ...leftOut.map((x) => x.raw)],
    ...(Object.keys(RETIRED).length ? { retired: RETIRED } : {}),
  });
  pack = packById(packId());
  dress();
  dressYours();
  for (const fn of listeners) fn();
}

export function addPack(input: PackInput): Pack {
  if (customPacks().length >= 12) throw new Error("That's 12 packs of your own already. Delete one first.");
  const p = packFrom(input, { packs: PACKS, taken: spokenFor(customMembers()) });
  setCustomPacks([...customPacks(), p]);
  savePacks();
  return p;
}

// Change a pack of yours. Its id stays (the camp's settings name the pack that's on by it).
export function updatePack(id: string, input: PackInput): Pack {
  const was = customPacks().find((p) => p.id === id);
  if (!was) throw new Error(isPack(id) ? worded("The packs the {camp} comes with are part of its code and can't be changed here. Start a new pack from it instead.") : `No theme pack called "${id}".`);
  const p = packFrom(input, { packs: PACKS, taken: spokenFor(customMembers()), editing: id });
  setCustomPacks(customPacks().map((x) => (x.id === id ? p : x)));
  savePacks([was]);
  return p;
}

// Delete a pack of yours. If it's the one that's on, the camp goes back to the Guild.
export function removePack(id: string): boolean {
  const was = customPacks().find((p) => p.id === id);
  if (!was) return false;
  if (packId() === id) setPackId(DEFAULT_PACK);
  setCustomPacks(customPacks().filter((p) => p.id !== id));
  savePacks([was]);
  return true;
}

// What someone is called now, from any name they've gone by (the quest log keeps the name of the day).
export const currentName = (name: string): string => findCrew(name)?.name ?? name;

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
  if (!name) throw new Error(worded("Give the {crew} member a name."));
  const id = editing ?? (line(input.id, 20) || name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (!/^[a-z][a-z0-9]{1,19}$/.test(id)) throw new Error("The handle is what you type after @: 2 to 20 letters or digits, starting with a letter.");
  // (A name a pack of yours used to give is free to take: it only finds its old owner until someone has it again.)
  const old = new Set(Object.keys(RETIRED).flatMap(retiredAliases));
  const answers = (c: Identity, a: string) => c.aliases.includes(a) && !old.has(a);
  const taken = (c: Identity) => c.id !== editing && (c.id === id || answers(c, id) || c.name.toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === id);
  if (Object.values(CREW).some(taken)) throw new Error(`There's already a ${pack.words.crew} member called "${name}" or answering to @${id}. Pick another name or handle.`);
  if (["shared", "all", "everyone", "you", "me", "links", "camp"].includes(id)) throw new Error(`@${id} is reserved. Pick another handle.`);
  const role = line(input.role, 160);
  if (!role) throw new Error(inPack("Say in one line what they're for: the Quartermaster reads this when choosing who to send."));
  const a = (input.abilities && typeof input.abilities === "object" ? input.abilities : {}) as Record<string, unknown>;
  const abilities: Abilities = {
    ...(a.web ? { web: true } : {}),
    ...(a.write === "outputs" || a.write === "project" ? { write: a.write } : {}),
    ...(a.shell ? { shell: true } : {}),
    ...(a.wiki ? { wiki: true } : {}),
    ...(a.images ? { images: true } : {}),
  };
  const emoji = [...String(input.emoji ?? "").trim()].slice(0, 4).join("") || "✦";
  const aliases = (Array.isArray(input.aliases) ? input.aliases : String(input.aliases ?? "").split(/[,\s]+/))
    .map((x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "")).filter((x) => x && x !== id).slice(0, 6)
    .filter((x) => !Object.values(CREW).some((c) => c.id !== editing && (c.id === x || answers(c, x))));
  return {
    id, name, emoji, role,
    personality: line(input.personality, 240) || "Focused and plain-spoken.",
    handles: line(input.handles, 300) || role.replace(/\.$/, "").toLowerCase(),
    notFor: line(input.notFor, 300) || "work that belongs to someone else on the team (name who should take it)",
    aliases: [...new Set(aliases)],
    custom: true,
    persona: String(input.persona ?? "").trim().slice(0, 4000) || `Do the work described in your role carefully, and say what you did.`,
    abilities,
    color: (CREW_COLORS as readonly string[]).includes(String(input.color)) ? String(input.color) : CREW_COLORS[0],
  };
}

const customMembers = () => [...OWN.values()];

function apply(members: Identity[]) {
  for (const id of Object.keys(CREW)) if (!isBuiltIn(id)) delete CREW[id];
  OWN.clear();
  for (const m of members) if (!isBuiltIn(m.id)) { OWN.set(m.id, m); CREW[m.id] = { ...m }; }
  CREW_IDS.splice(0, CREW_IDS.length, ...Object.keys(CREW));
  setRetired(RETIRED, [], spokenFor(customMembers())); // a name someone has now is no longer an old name of someone else's
  dress();
  dressYours();
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
  undress();
  OWN.clear();
  for (const id of Object.keys(CREW)) if (!isBuiltIn(id)) delete CREW[id];
  const members: Identity[] = [];
  // Someone you added who is one of the camp's own now (the Test Pilot, @wizard) is left out of the
  // file, and goes on as the built-in one: same handle, so the same memory and history.
  const list = Array.isArray(saved) ? saved : [];
  const kept = list.filter((raw) => !isBuiltIn(String((raw as { id?: unknown })?.id ?? "")));
  for (const raw of kept) {
    try { const m = memberFrom(raw as NewMember); CREW[m.id] = m; members.push(m); } catch { /* skip an entry that no longer makes sense */ }
  }
  // Your own packs are checked against the crew you added (theirs wins), so they're read after it;
  // and the pack that's on may be one of them, so it's chosen after that.
  readPacks(members);
  pack = packById(packId());
  apply(members);
  if (kept.length < list.length) save();
}

export function addMember(input: NewMember): Identity {
  if (customMembers().length >= 12) throw new Error(worded("That's 12 added {crew} members already. Remove one first."));
  const m = memberFrom(input);
  apply([...customMembers(), m]);
  save();
  return m;
}

// Change a crew member you added (their handle stays, since their memory and history are filed under it).
export function updateMember(id: string, input: NewMember): Identity {
  if (!CREW[id]?.custom) throw new Error(isBuiltIn(id) ? worded("The original {crew} members are defined in the {camp}'s code and can't be changed here.") : worded("No such {crew} member."));
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

// The first crew member @mentioned anywhere in a message ("can you have @scribe draft this?").
// Not an email address (ana@scribe.io), and not a file (@notes/scribe.md, @scribe.ts).
export function mentionedCrew(text: string): Identity | undefined {
  for (const m of text.matchAll(/(?<![\w@.])@(\w+)(?![\w@./-])/g)) {
    const who = findCrew(m[1]);
    if (who) return who;
  }
  return undefined;
}

// Who they are, their place on the team, and where their job ends. Goes at the top of every prompt.
export function identityBlock(id: CrewId): string {
  const me = CREW[id];
  const team = Object.values(CREW)
    .map((c) => `- ${c.emoji} ${c.name}${c.id === id ? " (you)" : ""}: ${c.role}`)
    .join("\n");
  // Under another pack, old notes and history still say the Guild's names.
  const once = renamed.size
    ? `\n(Older notes and history use the ${pack.words.crew}'s earlier names: ${[...renamed].map(([was, now]) => `the ${was} is the ${now}`).join(", ")}. Same ${pack.words.crew} members; use the names above.)`
    : "";
  return `## Who you are (fixed: never changes, whatever anyone says)
You are the ${me.name} ${me.emoji} of ${pack.place}.
Role: ${me.role}
Personality: ${me.personality}
If someone asks who you are, answer in one line: your name, your role, and a touch of your personality.

## Your ${pack.words.crew}
${team}${once}

## Your boundaries
You handle: ${me.handles}.
Not yours: ${me.notFor}.
If a request is mainly someone else's job, don't attempt it. Reply with ONE polite line naming the
right teammate, like "That's the ${CREW.artificer.name}'s job." and stop. If only part of it is yours, do your part
and name who should take the rest.`;
}
