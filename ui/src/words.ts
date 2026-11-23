// The theme pack's nouns: what this page calls the crew, a quest, the camp and an expedition.
// The Guild pack's are the originals; another pack (Settings → General → Theme pack) swaps them.
// The whole page reads from here: every label, hint, empty state and message that says crew, quest,
// expedition or camp as a noun goes through w() or a(), so a pack renames it everywhere. Fixed names
// (Outpost, the outpost's own name) and identifiers are not packs' to change. The crew's names, the
// Quartermaster's included, come from the pack too: leadName() and nameNow() in format.ts.
// An expedition is the whole request; a quest is one crew member's piece of it; the camp is the running thing.
// The pack's phrases go with them where one word won't do (src/packs.ts, PackPhrases): w("member")
// "adventurer", w("log") "quest log", w("ready") "The camp is set", w("close") "break camp",
// w("closing") "Breaking camp", w("back") "returns to camp", w("depart") "sets out", w("hq") "mission control".
//
// The page sets the pack when the camp's state loads or changes (App.tsx); until then it's Guild.

export type Words = {
  crew: string; quest: string; quests: string; camp: string; expedition: string;
  member: string; log: string; ready: string; close: string; closing: string; back: string; depart: string; hq: string;
};
type PackLine = { id: string; words: Pick<Words, "crew" | "quest" | "quests" | "camp" | "expedition"> & Partial<Words>; palette?: string };

const GUILD: Words = {
  crew: "crew", quest: "quest", quests: "quests", camp: "camp", expedition: "expedition",
  member: "adventurer", log: "quest log", ready: "The camp is set", close: "break camp", closing: "Breaking camp",
  back: "returns to camp", depart: "sets out", hq: "mission control",
};
let now: Words = GUILD;

export const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
// More than one of a word, as English usually has it: "voyage" → "voyages", "story" → "stories".
export const many = (word: string) => (/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

// The active pack, from the camp's state. An id the page doesn't know leaves the Guild's words.
export function setWords(pack: string | undefined, packs: PackLine[] = []) {
  const words = packs.find((p) => p.id === pack)?.words;
  now = words ? { ...GUILD, ...words } : GUILD; // a pack from an older camp may not have every phrase
}
export const wordsNow = (): Words => now;

// One of the nouns as the active pack says it: w("quest") → "mission"; w("Quest") → "Mission";
// w("quests") and w("Quests") for more than one; and the same for crew, camp and expedition
// ("expeditions" → "voyages").
export type Noun = "crew" | "quest" | "quests" | "camp" | "camps" | "expedition" | "expeditions"
  | "member" | "members" | "log" | "ready" | "close" | "closing" | "back" | "depart" | "hq";
export function w(noun: Noun | Capitalize<Noun>): string {
  const key = noun.toLowerCase() as Noun;
  const word = key === "camps" ? many(now.camp) : key === "expeditions" ? many(now.expedition) : key === "members" ? many(now.member) : now[key];
  return noun[0] === noun[0].toUpperCase() ? cap(word) : word;
}
// "an expedition", "a voyage": the noun with the article that goes with it. a("Quest") starts a
// sentence: "A mission".
export function a(noun: Noun | Capitalize<Noun>): string {
  const word = w(noun.toLowerCase() as Noun);
  const an = /^[aeiou]/i.test(word) ? "an" : "a";
  return `${noun[0] === noun[0].toUpperCase() ? cap(an) : an} ${word}`;
}
