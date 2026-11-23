// The theme pack's nouns: what this page calls the crew, a quest, the camp and an expedition.
// The Guild pack's are the originals; another pack (Settings → General → Theme pack) swaps them.
// The whole page reads from here: every label, hint, empty state and message that says crew, quest,
// expedition or camp as a noun goes through w() or a(), so a pack renames it everywhere. Fixed names
// (Quartermaster, mission control, Outpost, the crew members' roles) and identifiers are not packs' to change.
// An expedition is the whole request; a quest is one crew member's piece of it; the camp is the running thing.
//
// The page sets the pack when the camp's state loads or changes (App.tsx); until then it's Guild.

export type Words = { crew: string; quest: string; quests: string; camp: string; expedition: string };
type PackLine = { id: string; words: Words; palette?: string };

const GUILD: Words = { crew: "crew", quest: "quest", quests: "quests", camp: "camp", expedition: "expedition" };
let now: Words = GUILD;

export const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
// More than one of a word, as English usually has it: "voyage" → "voyages", "story" → "stories".
export const many = (word: string) => (/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

// The active pack, from the camp's state. An id the page doesn't know leaves the Guild's words.
export function setWords(pack: string | undefined, packs: PackLine[] = []) {
  now = packs.find((p) => p.id === pack)?.words ?? GUILD;
}

// One of the nouns as the active pack says it: w("quest") → "mission"; w("Quest") → "Mission";
// w("quests") and w("Quests") for more than one; and the same for crew, camp and expedition
// ("expeditions" → "voyages").
export type Noun = "crew" | "quest" | "quests" | "camp" | "camps" | "expedition" | "expeditions";
export function w(noun: Noun | Capitalize<Noun>): string {
  const key = noun.toLowerCase() as Noun;
  const word = key === "camps" ? many(now.camp) : key === "expeditions" ? many(now.expedition) : now[key];
  return noun[0] === noun[0].toUpperCase() ? cap(word) : word;
}
// "an expedition", "a voyage": the noun with the article that goes with it.
export function a(noun: Noun | Capitalize<Noun>): string {
  const word = w(noun);
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}
