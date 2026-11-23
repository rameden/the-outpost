// Theme packs: what the camp's own crew are called, and the few nouns and colours that go with
// the names. The Guild pack is the original. A pack only changes what things are called and how
// they look: ids ("quartermaster", "scout"…) never change, so memory, history, settings and
// skills stay filed where they were whichever pack is on.
// Pure data, no imports: the server, the crew and the page (through /api/state) all read it.
//
// Five packs come with the camp, here. You can make more (Settings → General → New pack…): those
// are kept in camp/packs.json, checked by packFrom below, and joined on after these five by
// crew.ts, which reads and writes the file.

import { OUTPOST } from "./outpost.js"; // the packs' places are named for the outpost (read as they're used, so a rename shows at once)

export const PACK_CREW = ["quartermaster", "scout", "scribe", "artificer", "warden"] as const;
export type PackCrewId = (typeof PACK_CREW)[number];

export type PackWords = {
  crew: string;        // the team
  quest: string;       // one piece of work sent to one crew member
  quests: string;
  camp: string;        // the place it all happens
  expedition: string;  // one request, planned and carried out
};

// What a pack calls someone. short: other one-word names they answer to (after @). was: what the
// Guild pack called them before it called them this (the Test Pilot came as the Wizard).
export type PackName = { name: string; emoji: string; short?: string[]; was?: string[] };

// Whether someone you added still has the name they came with: what the Guild pack calls them, or
// called them before. Only then do they wear each pack's name for them.
export const cameAs = (guild: PackName | undefined, name: string): boolean => !!guild && (guild.name === name || !!guild.was?.includes(name));

export type Pack = {
  id: string;
  name: string;
  about: string;                 // one line for the settings row
  crew: Record<PackCrewId, PackName>;   // what each of the five is called
  // What it calls a crew member you added, by their handle: the Test Pilot (@wizard), if you have
  // one. Worn only while they still have the name they came with (cameAs, above); give them a
  // name of your own and yours is kept under every pack.
  extras?: Record<string, PackName>;
  words: PackWords;
  place: string;                 // "You are the Scout of <place>."
  palette?: string;              // the colours this pack suggests (your own choice of colours still wins)
  orb?: boolean;                 // it recolours the orb (styles.css, under [data-pack="<id>"])
  custom?: boolean;              // one of yours (camp/packs.json): it can be changed and deleted, and never has orb colours
};

// The colours a pack may suggest (the page's palettes: ui/src/themes.ts).
export const PACK_PALETTES = ["camp", "harbor", "moss", "heather", "ochre"] as const;

export const DEFAULT_PACK = "guild";

export const PACKS: Pack[] = [
  {
    id: "guild",
    name: "Guild",
    about: "An adventurer's guild camp. The original.",
    crew: {
      quartermaster: { name: "Quartermaster", emoji: "🧭" },
      scout: { name: "Scout", emoji: "🏹" },
      scribe: { name: "Scribe", emoji: "🪶" },
      artificer: { name: "Artificer", emoji: "🔨" },
      warden: { name: "Warden", emoji: "🛡️" },
    },
    extras: { wizard: { name: "Test Pilot", emoji: "🛸", was: ["Wizard"] } },
    words: { crew: "crew", quest: "quest", quests: "quests", camp: "camp", expedition: "expedition" },
    place: "the Adventurer's Guild camp",
  },
  {
    id: "starship",
    name: "Starship",
    about: "A ship and its bridge crew.",
    crew: {
      quartermaster: { name: "Commander", emoji: "🚀" },
      scout: { name: "Navigator", emoji: "🔭", short: ["nav"] },
      scribe: { name: "Comms Officer", emoji: "📡", short: ["comms"] },
      artificer: { name: "Engineer", emoji: "🔧" },
      warden: { name: "Security Chief", emoji: "🛡️", short: ["security"] },
    },
    extras: { wizard: { name: "Test Pilot", emoji: "🛸", short: ["pilot"] } },
    words: { crew: "crew", quest: "mission", quests: "missions", camp: "ship", expedition: "voyage" },
    get place() { return `the starship ${OUTPOST.name}`; },
    palette: "harbor",
    orb: true,
  },
  {
    id: "newsroom",
    name: "Newsroom",
    about: "A paper going to press.",
    crew: {
      quartermaster: { name: "Editor", emoji: "📰" },
      scout: { name: "Reporter", emoji: "🔎" },
      scribe: { name: "Columnist", emoji: "✍️" },
      artificer: { name: "Typesetter", emoji: "🖨️" },
      warden: { name: "Fact Checker", emoji: "✅", short: ["checker"] },
    },
    extras: { wizard: { name: "Stringer", emoji: "⚡" } },
    words: { crew: "staff", quest: "story", quests: "stories", camp: "newsroom", expedition: "assignment" },
    get place() { return `the ${OUTPOST.name} newsroom`; },
    palette: "ochre",
    orb: true,
  },
  {
    id: "studio",
    name: "Studio",
    about: "A film crew on set.",
    crew: {
      quartermaster: { name: "Director", emoji: "🎬" },
      scout: { name: "Location Scout", emoji: "📍", short: ["locations"] },
      scribe: { name: "Screenwriter", emoji: "📝" },
      artificer: { name: "Set Builder", emoji: "🛠️", short: ["builder"] },
      warden: { name: "Script Supervisor", emoji: "📋", short: ["continuity"] },
    },
    extras: { wizard: { name: "Stunt Double", emoji: "🤸", short: ["stunt"] } },
    words: { crew: "crew", quest: "scene", quests: "scenes", camp: "studio", expedition: "shoot" },
    get place() { return `the ${OUTPOST.name} film studio`; },
    palette: "heather",
    orb: true,
  },
  {
    id: "lab",
    name: "Lab",
    about: "A research lab and its team.",
    crew: {
      quartermaster: { name: "Lab Lead", emoji: "🧪", short: ["lead"] },
      scout: { name: "Field Researcher", emoji: "🔬", short: ["field"] },
      scribe: { name: "Author", emoji: "📓" },
      artificer: { name: "Technician", emoji: "⚙️", short: ["tech"] },
      warden: { name: "Peer Reviewer", emoji: "🧐", short: ["peer"] },
    },
    extras: { wizard: { name: "Tinkerer", emoji: "⚗️" } },
    words: { crew: "team", quest: "experiment", quests: "experiments", camp: "lab", expedition: "study" },
    get place() { return `the ${OUTPOST.name} research lab`; },
    palette: "moss",
    orb: true,
  },
  {
    id: "pirate",
    name: "Pirate",
    about: "A pirate ship and her crew.",
    crew: {
      quartermaster: { name: "Commodore", emoji: "🏴‍☠️" },
      scout: { name: "Spyglass", emoji: "🔭" },
      scribe: { name: "Logkeeper", emoji: "📜" },
      artificer: { name: "Rigger", emoji: "🪢" },
      warden: { name: "First Mate", emoji: "⚓", short: ["mate"] },
    },
    extras: { wizard: { name: "Powder Monkey", emoji: "🧨", short: ["monkey"] } },
    words: { crew: "crew", quest: "raid", quests: "raids", camp: "ship", expedition: "voyage" },
    get place() { return `the pirate ship ${OUTPOST.name}`; },
    palette: "harbor",
    orb: true,
  },
];

// The six above, whatever has been joined on since.
const BUILT_IN_PACKS: readonly Pack[] = [...PACKS];
export const isBuiltInPack = (id: unknown) => BUILT_IN_PACKS.some((p) => p.id === id);
// Yours (camp/packs.json), after the camp's own. PACKS is the same array throughout, so everyone
// who imported it sees them.
export const customPacks = (): Pack[] => PACKS.slice(BUILT_IN_PACKS.length);
export function setCustomPacks(yours: Pack[]) { PACKS.splice(BUILT_IN_PACKS.length, PACKS.length, ...yours); }

export const isPack = (id: unknown): id is string => typeof id === "string" && PACKS.some((p) => p.id === id);
export const packById = (id: unknown): Pack => PACKS.find((p) => p.id === id) ?? PACKS[0];

// Every form of a pack name someone might type after @: "comms officer" as it's said,
// "commsofficer" run together, and the pack's short forms.
export function nameAliases(c: PackName): string[] {
  const said = c.name.toLowerCase();
  return [...new Set([said, said.replace(/[^a-z0-9]/g, ""), ...(c.short ?? [])])];
}
export const packAliases = (id: PackCrewId, pack: Pack): string[] => nameAliases(pack.crew[id]);

// ---------- Packs of your own ----------
// What was typed in the dialog, or written by hand in camp/packs.json.
export type PackInput = { id?: unknown; name?: unknown; about?: unknown; crew?: unknown; extras?: unknown; words?: unknown; place?: unknown; palette?: unknown };
// A name that's spoken for outside the packs: one of the five's own handles, someone you added,
// a reserved word. id: whose it is ("" for nobody's). why: the rest of the sentence, given the
// handle, e.g. "@dev already finds the Artificer".
export type Taken = { id: string; forms: string[]; why: (form: string) => string };

const line = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const oneWord = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const letters = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const PACK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HANDLE = /^[a-z][a-z0-9]{1,19}$/;
const WORDS: [keyof PackWords, string][] = [["crew", "the crew"], ["quest", "a quest"], ["quests", "more than one quest"], ["camp", "the camp"], ["expedition", "an expedition"]];

// Everything a name is found by: as it's said, run together, its short handles, and its letters
// alone (how the page files a colour under it, so "Agent 7" and "Agent 8" would be one name there).
const formsOf = (c: PackName) => [...new Set([...nameAliases(c), letters(c.name)])].filter(Boolean);
// What the camp calls someone when it has to say who it means: their Guild name.
const guildSays = (who: string) => { const c = (PACKS[0].crew as Record<string, PackName>)[who] ?? PACKS[0].extras?.[who]; return c ? `the ${c.name}` : `@${who}`; };
const everyoneIn = (p: Pack): [string, PackName][] => [...Object.entries(p.crew), ...Object.entries(p.extras ?? {})];

// Who each name belongs to already: form → whose, and how to say so.
function spokenFor(packs: Pack[], taken: Taken[]) {
  const claims = new Map<string, { who: string; why: string }>();
  const claim = (form: string, who: string, why: string) => { if (form && !claims.has(form)) claims.set(form, { who, why }); };
  for (const t of taken) for (const f of t.forms) { claim(f, t.id, t.why(f)); claim(letters(f), t.id, t.why(f)); }
  for (const p of packs) for (const [who, c] of everyoneIn(p)) {
    const why = p === PACKS[0] ? `that's ${guildSays(who)}'s own name` : `the ${p.name} pack calls ${guildSays(who)} ${c.name}`;
    for (const f of formsOf(c)) claim(f, who, why);
  }
  return claims;
}

// One crew member's name in a pack, as typed. label: "the Scout".
function nameFrom(raw: unknown, label: string, emoji: string): PackName {
  const r = obj(raw);
  const name = line(r.name, 24);
  const Label = label[0].toUpperCase() + label.slice(1);
  if (!name) throw new Error(`${Label} needs a name in this pack.`);
  if (!/^[a-z]/i.test(name) || letters(name).length < 2) throw new Error(`${Label} can't be called "${name}": a name starts with a letter (a to z) and has at least two, so it can be typed after @.`);
  const short = [...new Set((Array.isArray(r.short) ? r.short : String(r.short ?? "").split(/[,\s]+/)).map((x) => oneWord(String(x)).slice(0, 20)))]
    .filter((x) => HANDLE.test(x) && x !== oneWord(name)).slice(0, 4);
  return { name, emoji: [...String(r.emoji ?? "").trim()].slice(0, 4).join("") || emoji, ...(short.length ? { short } : {}) };
}

// Check a pack of your own and turn it into one the camp can wear. Throws with a message for the
// dialog (or for the log, when it's read from camp/packs.json).
//   packs: every pack it has to live beside (the camp's own, and yours);
//   taken: the names spoken for outside the packs (crew.ts knows them);
//   editing: the id of the pack this replaces, which stays its id.
export function packFrom(input: PackInput, opts: { packs: Pack[]; taken?: Taken[]; editing?: string }): Pack {
  const raw = obj(input);
  const name = line(raw.name, 24);
  if (!name) throw new Error("Give the pack a name.");
  const beside = opts.packs.filter((p) => p.id !== opts.editing);
  const twin = beside.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (twin) throw new Error(`There's already a pack called ${twin.name}. Give yours another name.`);
  const typed = line(raw.id, 60);
  const id = opts.editing ?? (typed || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  if (!id) throw new Error("Give the pack a name with a letter or a digit in it: its id is made from the name.");
  if (!PACK_ID.test(id) || id.length > 30) throw new Error(`A pack's id is lowercase letters, digits and dashes, 30 at most, like "pirate-ship". "${id}" isn't.`);
  if (isBuiltInPack(id)) throw new Error(`"${id}" is one of the packs the camp comes with. Give yours another ${typed ? "id" : "name"}.`);
  if (beside.some((p) => p.id === id)) throw new Error(`There's already a pack with the id "${id}". Give this one another ${typed ? "id" : "name"}.`);

  const guild = PACKS[0];
  const given = obj(raw.crew);
  const crew = Object.fromEntries(PACK_CREW.map((who) => [who, nameFrom(given[who], guildSays(who), guild.crew[who].emoji)])) as Record<PackCrewId, PackName>;
  const extras: Record<string, PackName> = {};
  for (const [who, r] of Object.entries(obj(raw.extras)).slice(0, 12)) {
    if (!line(obj(r).name, 24)) continue; // no name for them in this pack: they keep their own
    if ((PACK_CREW as readonly string[]).includes(who)) throw new Error(`${guildSays(who)[0].toUpperCase()}${guildSays(who).slice(1)} is one of the camp's own five: their name goes under "crew", not "extras".`);
    if (!HANDLE.test(who)) throw new Error(`"${who}" isn't a crew member's handle (what you type after @: 2 to 20 letters or digits, starting with a letter).`);
    extras[who] = nameFrom(r, guildSays(who), guild.extras?.[who]?.emoji ?? "✦");
  }

  // No name, run-together name or short handle may find two crew members: not in this pack, not
  // across packs, and never one that someone you added already has.
  const claims = spokenFor(beside, opts.taken ?? []);
  const mine = { id, name, about: "", crew, extras, words: guild.words, place: "" };
  for (const [who, c] of everyoneIn(mine)) {
    for (const f of formsOf(c)) {
      const has = claims.get(f);
      if (has && has.who !== who) {
        const what = (c.short ?? []).includes(f) ? `answer to @${f}` : `be called "${c.name}"`;
        throw new Error(`${guildSays(who)[0].toUpperCase()}${guildSays(who).slice(1)} can't ${what}: ${has.why}.`);
      }
      if (!has) claims.set(f, { who, why: `${guildSays(who)} is called ${c.name} in this pack` });
    }
  }

  const said = obj(raw.words);
  const words = {} as PackWords;
  for (const [key, what] of WORDS) {
    words[key] = line(said[key], 24);
    if (!words[key]) throw new Error(`Say what this pack calls ${what}.`);
  }
  const palette = line(raw.palette, 20);
  if (palette && !(PACK_PALETTES as readonly string[]).includes(palette)) throw new Error(`"${palette}" isn't one of the colours a pack can suggest: ${PACK_PALETTES.join(", ")}.`);
  return {
    id, name,
    about: line(raw.about, 80) || "A pack of your own.",
    crew,
    ...(Object.keys(extras).length ? { extras } : {}),
    words,
    place: line(raw.place, 60) || `the ${OUTPOST.name} ${words.camp}`,
    ...(palette && palette !== "camp" ? { palette } : {}),
    custom: true,
  };
}

// ---------- Names a pack of yours used to give ----------
// Change a name in a pack of yours, or delete the pack, and history is still written with the old
// name. So the old names are kept (camp/packs.json, "retired"), by crew id or handle, and go on
// finding who they meant, after @ and for the colour of an old message, until somebody is given
// the name again.
export type Retired = Record<string, string[]>;
export const RETIRED: Retired = {};

// What's kept after a change: the names in `was` (a pack as it stood before), and whatever was
// kept already, less any that a pack or a crew member has now.
export function setRetired(kept: unknown, was: Pack[], taken: Taken[] = []) {
  const claims = spokenFor(PACKS, taken);
  const all: Retired = {};
  for (const [who, names] of Object.entries(obj(kept))) if (Array.isArray(names)) all[who] = names.map((n) => line(n, 24));
  for (const p of was) for (const [who, c] of everyoneIn(p)) all[who] = [...(all[who] ?? []), c.name, ...(c.short ?? [])];
  for (const who of Object.keys(RETIRED)) delete RETIRED[who];
  const seen = new Set<string>();
  for (const [who, names] of Object.entries(all)) {
    if (!HANDLE.test(who)) continue;
    const free = names.filter((n) => {
      const forms = formsOf({ name: n, emoji: "" });
      if (!letters(n) || forms.some((f) => claims.has(f) || seen.has(f))) return false;
      for (const f of forms) seen.add(f);
      return true;
    });
    if (free.length) RETIRED[who] = free.slice(-24);
  }
}
export const retiredAliases = (who: string): string[] => (RETIRED[who] ?? []).flatMap((n) => nameAliases({ name: n, emoji: "" }));
