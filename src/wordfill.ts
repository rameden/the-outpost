// The pack's words put into text, with no imports, so crew.ts (which words.ts needs) can use it too.
// words.ts is the way in for everything else: w(), a() and say() read the active pack from here.

export type Noun = "crew" | "quest" | "quests" | "camp" | "camps" | "expedition" | "expeditions"
  | "member" | "members" | "log" | "ready" | "close" | "closing" | "back" | "depart" | "hq";
type Words = Record<"crew" | "quest" | "quests" | "camp" | "expedition" | "member" | "log" | "ready" | "close" | "closing" | "back" | "depart" | "hq", string>;

export const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
// More than one of a word, as English usually has it: "voyage" → "voyages", "story" → "stories".
export const many = (word: string) => (/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

export function wordOf(words: Words, noun: Noun | Capitalize<Noun>): string {
  const key = noun.toLowerCase() as Noun;
  const word = key === "camps" ? many(words.camp) : key === "expeditions" ? many(words.expedition) : key === "members" ? many(words.member) : words[key];
  return noun[0] === noun[0].toUpperCase() ? cap(word) : word;
}

// a("Quest") starts a sentence: "A mission".
export function withArticle(words: Words, noun: Noun | Capitalize<Noun>): string {
  const word = wordOf(words, noun.toLowerCase() as Noun);
  const an = /^[aeiou]/i.test(word) ? "an" : "a";
  return `${noun[0] === noun[0].toUpperCase() ? cap(an) : an} ${word}`;
}

const NOUNS = "crew|quests?|camps?|expeditions?|members?|log|ready|close|closing|back|depart|hq";
const TOKEN = new RegExp(`\\{(an? |An? )?(${NOUNS}|${NOUNS.replace(/(^|\|)(\w)/g, (_m, bar, c) => bar + c.toUpperCase())})\\}`, "g");

// Fill {crew}, {Quest}, {a quest}, {An expedition}, {members}, {hq}… (names are inPack's, not this).
export function fill(words: Words, text: string): string {
  return text.replace(TOKEN, (_m, art: string | undefined, noun: string) =>
    art ? withArticle(words, (art[0] === "A" ? cap(noun) : noun) as Noun) : wordOf(words, noun as Noun));
}
