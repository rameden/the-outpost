// Where each remembered line came from, and the one note the whole crew shares about you.
//
//   camp/memory-log.jsonl   one line per thing kept: where it went (a crew member's memory, a
//                           project's notes, the note about you), the run it came from, and how
//                           (the crew's own remember, your feedback, a suggestion you approved, you)
//   camp/about-you.md       what's true of you whoever you're working with: how you like answers,
//                           what to call things. Loaded into every crew member's prompt, so you
//                           don't teach each of them the same thing.
//
// This file depends on nothing else in the camp, so memory.ts and projects.ts can both use it.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { appendLine, readJsonl, writeAtomic } from "./atomic.js";
import { clipEntry, fitMemory } from "./memfit.js";
import { today } from "./helpers.js";
import { w } from "./words.js";

// A place things are kept: "agent:<id>", "project:<id>", or "about".
export type Where = string;
export type KeptHow = "remember" | "feedback" | "suggestion" | "you" | "tidy";
export type KeptLine = { time: string; where: Where; text: string; how: KeptHow; run?: string };

const LOG = join("camp", "memory-log.jsonl");
// A line by its words alone: no dash, date or pin, so it's the same line whether or not it's pinned.
export const norm = (text: string) => text.replace(/^-\s*(\d{4}-\d{2}-\d{2}\s+)?(📌\s*)?/u, "").replace(/\s+/g, " ").trim().toLowerCase();

export function logKept(where: Where, text: string, how: KeptHow, run?: string) {
  try {
    const line: KeptLine = { time: new Date().toISOString(), where, text: text.replace(/\s+/g, " ").trim().slice(0, 600), how, ...(run ? { run } : {}) };
    appendLine(LOG, JSON.stringify(line));
  } catch { /* a missing origin is no loss */ }
}

let cache: { key: string; lines: KeptLine[] } | null = null;
function all(): KeptLine[] {
  if (!existsSync(LOG)) return [];
  const st = statSync(LOG);
  const key = `${process.cwd()}|${st.mtimeMs}:${st.size}`;
  if (cache?.key === key) return cache.lines;
  const lines = readJsonl<KeptLine>(LOG);
  cache = { key, lines };
  return lines;
}
// For one place: what's known of each line's origin, by the line's own words (the newest wins).
export function originsOf(where: Where): Map<string, KeptLine> {
  const out = new Map<string, KeptLine>();
  for (const l of all()) if (l.where === where) out.set(norm(l.text), l);
  return out;
}

// ---------- About you ----------
export const ABOUT_PATH = join("camp", "about-you.md");
export const ABOUT_MAX = 2500; // characters loaded into a prompt

export function readAbout(): string {
  try { return readFileSync(ABOUT_PATH, "utf8").trim(); } catch { return ""; }
}
export function writeAbout(text: string) {
  writeAtomic(ABOUT_PATH, String(text).trim().slice(0, 20_000) + (String(text).trim() ? "\n" : ""));
}
export function addAbout(text: string, how: KeptHow = "remember", run?: string) {
  mkdirSync("camp", { recursive: true });
  const line = clipEntry(text);
  if (!line) return;
  const prior = existsSync(ABOUT_PATH) ? readFileSync(ABOUT_PATH, "utf8").replace(/\n+$/, "") : "";
  writeAtomic(ABOUT_PATH, (prior ? prior + "\n" : "") + `- ${today()} ${line}\n`);
  logKept("about", line, how, run);
}
// For every crew member's prompt. Empty until something's been noted.
// task: the request this run is for, so older lines that bear on it are kept when the note is long.
export function aboutBlock(task = ""): string {
  const text = readAbout();
  if (!text) return "";
  const body = fitMemory(text, ABOUT_MAX, task).text;
  return `## About the user (camp/about-you.md: shared by the whole ${w("crew")}; add to it with remember, about "user")\n` + body;
}
