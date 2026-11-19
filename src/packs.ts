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

export type Pack = {
  id: string;
  name: string;
  about: string;                 // one line for the settings row
  // What each of the five is called. short: other one-word names they answer to (after @).
  crew: Record<PackCrewId, { name: string; emoji: string; short?: string[] }>;
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
    words: { crew: "crew", quest: "mission", quests: "missions", camp: "ship", expedition: "voyage" },
    place: "the starship Mae",
    palette: "harbor",
    orb: true,
  },
];

export const isPack = (id: unknown): id is string => typeof id === "string" && PACKS.some((p) => p.id === id);
export const packById = (id: unknown): Pack => PACKS.find((p) => p.id === id) ?? PACKS[0];

// Every one-word form of a pack name someone might type after @: "comms officer" as it's said,
// "commsofficer" run together, and the pack's short forms.
export function packAliases(id: PackCrewId, pack: Pack): string[] {
  const c = pack.crew[id];
  const said = c.name.toLowerCase();
  return [...new Set([said, said.replace(/[^a-z0-9]/g, ""), ...(c.short ?? [])])];
}
