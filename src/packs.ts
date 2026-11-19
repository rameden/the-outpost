// Theme packs: what the camp's own crew are called, and the few nouns and colours that go with
// the names. The Guild pack is the original. A pack only changes what things are called and how
// they look: ids ("quartermaster", "scout"…) never change, so memory, history, settings and
// skills stay filed where they were whichever pack is on.
// Pure data, no imports: the server, the crew and the page (through /api/state) all read it.

export const PACK_CREW = ["quartermaster", "scout", "scribe", "artificer", "warden"] as const;
export type PackCrewId = (typeof PACK_CREW)[number];

export type PackWords = {
  crew: string;        // the team
  quest: string;       // one piece of work sent to one crew member
  quests: string;
  camp: string;        // the place it all happens
  expedition: string;  // one request, planned and carried out
};

// What a pack calls someone. short: other one-word names they answer to (after @).
export type PackName = { name: string; emoji: string; short?: string[] };

export type Pack = {
  id: string;
  name: string;
  about: string;                 // one line for the settings row
  crew: Record<PackCrewId, PackName>;   // what each of the five is called
  // What it calls a crew member you added, by their handle: the Wizard (@wizard), if you have
  // one. Worn only while they still have the name the Guild pack gives here; give them a name
  // of your own and yours is kept under every pack.
  extras?: Record<string, PackName>;
  words: PackWords;
  place: string;                 // "You are the Scout of <place>."
  palette?: string;              // the colours this pack suggests (your own choice of colours still wins)
  orb?: boolean;                 // it recolours the orb (styles.css, under [data-pack="<id>"])
};

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
    extras: { wizard: { name: "Wizard", emoji: "🪄" } },
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
    place: "the starship Mae",
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
    place: "the Mae newsroom",
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
    place: "the Mae film studio",
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
    place: "the Mae research lab",
    palette: "moss",
    orb: true,
  },
];

export const isPack = (id: unknown): id is string => typeof id === "string" && PACKS.some((p) => p.id === id);
export const packById = (id: unknown): Pack => PACKS.find((p) => p.id === id) ?? PACKS[0];

// Every form of a pack name someone might type after @: "comms officer" as it's said,
// "commsofficer" run together, and the pack's short forms.
export function nameAliases(c: PackName): string[] {
  const said = c.name.toLowerCase();
  return [...new Set([said, said.replace(/[^a-z0-9]/g, ""), ...(c.short ?? [])])];
}
export const packAliases = (id: PackCrewId, pack: Pack): string[] => nameAliases(pack.crew[id]);
