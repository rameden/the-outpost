// The active theme pack's words, for text the camp writes: prompts, tool descriptions, errors,
// notices, the terminal. The page has the same helpers (ui/src/words.ts); these read the pack the
// camp has on (crew.ts), so they're right the moment Settings changes it.
//
// Three ways in:
//   w("quest") → "mission"; w("Quest") → "Mission"; w("quests"), w("expeditions") and so on;
//     w("member"), w("log"), w("hq")… for the pack's phrases (packs.ts, PackPhrases).
//   a("expedition") → "a voyage": the noun with its article.
//   say(text): text written once, with the Guild's names in it and {tokens} for the words, as the
//     active pack has them: say("Send {a member} on {a quest}. The Scout goes first.") →
//     "Send an officer on a mission. The Navigator goes first." Use it on text kept in a constant
//     (a persona, a rule, a tool description), at the moment it's used, never at import.
// Ids, file paths (camp/…), event names and JSON keys are never words: leave them as they are.

import { activePack, inPack } from "./crew.js";

export type Noun = "crew" | "quest" | "quests" | "camp" | "camps" | "expedition" | "expeditions"
  | "member" | "members" | "log" | "ready" | "close" | "closing" | "back" | "depart" | "hq";

export const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
// More than one of a word, as English usually has it: "voyage" → "voyages", "story" → "stories".
export const many = (word: string) => (/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

export function w(noun: Noun | Capitalize<Noun>): string {
  const words = activePack().words;
  const key = noun.toLowerCase() as Noun;
  const word = key === "camps" ? many(words.camp) : key === "expeditions" ? many(words.expedition) : key === "members" ? many(words.member) : words[key];
  return noun[0] === noun[0].toUpperCase() ? cap(word) : word;
}

// a("Quest") starts a sentence: "A mission".
export function a(noun: Noun | Capitalize<Noun>): string {
  const word = w(noun.toLowerCase() as Noun);
  const an = /^[aeiou]/i.test(word) ? "an" : "a";
  return `${noun[0] === noun[0].toUpperCase() ? cap(an) : an} ${word}`;
}

const NOUNS = "crew|quests?|camps?|expeditions?|members?|log|ready|close|closing|back|depart|hq";
const TOKEN = new RegExp(`\\{(an? |An? )?(${NOUNS}|${NOUNS.replace(/(^|\|)(\w)/g, (_m, bar, c) => bar + c.toUpperCase())})\\}`, "g");

// Fill {crew}, {Quest}, {a quest}, {An expedition}, {members}, {hq}… and put the pack's names in.
export function say(text: string): string {
  const filled = text.replace(TOKEN, (_m, art: string | undefined, noun: string) => (art ? a((art[0] === "A" ? cap(noun) : noun) as Noun) : w(noun as Noun)));
  return inPack(filled);
}

// The pack for a static page the camp serves (the tour, docs/index.html), as JSON in the page:
// <script type="application/json" id="mae-pack">{ id, crew: { scout: { name, emoji }… }, words }</script>,
// just before </head>. It isn't run, only read, so the page's CSP doesn't come into it.
export function withPack(html: string): string {
  const p = activePack();
  const crew = Object.fromEntries(Object.entries(p.crew).map(([id, c]) => [id, { name: c.name, emoji: c.emoji }]));
  const json = JSON.stringify({ id: p.id, crew, words: p.words }).replace(/</g, "\\u003c");
  return html.replace("</head>", `<script type="application/json" id="mae-pack">${json}</script>\n</head>`);
}
