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
import { fill, wordOf, withArticle, type Noun } from "./wordfill.js";

export { cap, many, type Noun } from "./wordfill.js";

export const w = (noun: Noun | Capitalize<Noun>): string => wordOf(activePack().words, noun);
export const a = (noun: Noun | Capitalize<Noun>): string => withArticle(activePack().words, noun);

// Fill {crew}, {Quest}, {a quest}, {An expedition}, {members}, {hq}… and put the pack's names in.
export const say = (text: string): string => inPack(fill(activePack().words, text));

// The pack for a static page the camp serves (the tour, docs/index.html), as JSON in the page:
// <script type="application/json" id="mae-pack">{ id, crew: { scout: { name, emoji }… }, words }</script>,
// just before </head>. It isn't run, only read, so the page's CSP doesn't come into it.
export function withPack(html: string): string {
  const p = activePack();
  const crew = Object.fromEntries(Object.entries(p.crew).map(([id, c]) => [id, { name: c.name, emoji: c.emoji }]));
  const json = JSON.stringify({ id: p.id, crew, words: p.words }).replace(/</g, "\\u003c");
  return html.replace("</head>", `<script type="application/json" id="mae-pack">${json}</script>\n</head>`);
}
