// Prompt snippets: reusable requests you can drop into the composer (camp/snippets.json).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { emit } from "./events.js";
import { writeJsonAtomic } from "./atomic.js";

export const SNIPPETS_PATH = "camp/snippets.json";
export type Snippet = { id: string; title: string; text: string };

const STARTERS: Snippet[] = [
  { id: "research-writeup", title: "Research, then write it up", text: "Have the Scout research {topic}, then the Scribe write a one-page summary with sources." },
  { id: "review-attachment", title: "Review what I attached", text: "Review what I attached and tell me the three most important things to fix, most important first." },
  { id: "morning-check", title: "Weekday morning check", text: "Every weekday at 08:00, check for anything new about {topic} and report only what's new." },
];

export function loadSnippets(): Snippet[] {
  if (!existsSync(SNIPPETS_PATH)) return STARTERS;
  try {
    return JSON.parse(readFileSync(SNIPPETS_PATH, "utf8")) as Snippet[];
  } catch {
    return STARTERS;
  }
}

function save(list: Snippet[]) {
  writeJsonAtomic(SNIPPETS_PATH, list);
  emit({ type: "changed", what: "snippets" });
}

export function addSnippet(title: string, text: string): Snippet {
  const s = { id: randomBytes(4).toString("hex"), title: title.trim().slice(0, 80) || text.trim().slice(0, 40), text: text.trim() };
  save([...loadSnippets(), s]);
  return s;
}

export function deleteSnippet(id: string): boolean {
  const list = loadSnippets();
  if (!list.some((s) => s.id === id)) return false;
  save(list.filter((s) => s.id !== id));
  return true;
}
