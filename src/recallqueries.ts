// What the crew searched for with recall, and what came back: the evidence for whether recall
// misses often enough to need more than words (searching by meaning was prototyped and parked).
//
//   camp/recall-queries.jsonl   one line per recall call:
//     { time, agent, run?, project, query, where, terms, mode, found, shown: [{ from, when?, score }] }
//
// found is how many records matched; shown is what was handed back, best first. mode is how the
// search was done ("words" until there's another way). The file keeps its newest QUERIES_MAX
// entries, and nothing here ever throws: a search is never held up for the sake of this log.
//
// summarizeQueries() reads it back as the numbers that matter: how often a search finds nothing,
// and how often an agent searches again in the same run straight after (it didn't get what it
// wanted), with the chains of searches that tell why. `npm run recall:report` prints them.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";

export type QueryShown = { from: string; when?: string; score: number };
export type RecallQuery = {
  time: string; agent: string; run?: string; project: string;
  query: string; where: string; terms: string[]; mode: "words";
  found: number; shown: QueryShown[];
};

export const QUERY_LOG = join("camp", "recall-queries.jsonl");
export const QUERIES_MAX = 5000;
const SLACK = 500;
const QUERY_CHARS = 300;

let count: number | undefined; // lines in the file, once read: so it's cut back now and then, not read on every search

export function readQueries(): RecallQuery[] {
  try {
    if (!existsSync(QUERY_LOG)) return [];
    return readFileSync(QUERY_LOG, "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try { const q = JSON.parse(l) as RecallQuery; return q && typeof q.query === "string" && typeof q.time === "string" && typeof q.agent === "string" ? [q] : []; } catch { return []; }
    });
  } catch { return []; }
}

// Write down one search. Never throws.
export function logQuery(q: Omit<RecallQuery, "time">): void {
  try {
    const entry: RecallQuery = {
      time: new Date().toISOString(), ...q,
      query: q.query.slice(0, QUERY_CHARS),
      shown: q.shown.map((s) => ({ from: s.from, ...(s.when ? { when: s.when.slice(0, 10) } : {}), score: Math.round(s.score * 100) / 100 })),
    };
    mkdirSync("camp", { recursive: true });
    count ??= readQueries().length;
    if (count + 1 > QUERIES_MAX + SLACK) {
      const kept = [...readQueries(), entry].slice(-QUERIES_MAX);
      writeAtomic(QUERY_LOG, kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
      count = kept.length;
    } else { appendFileSync(QUERY_LOG, JSON.stringify(entry) + "\n"); count++; }
  } catch { count = undefined; /* a search that isn't written down is no loss */ }
}

// For tests: forget what's been counted (a new sandbox, a file put in place by hand).
export function resetQueryCount() { count = undefined; }

// A search is "searched again" when the same agent searches again in the same run within this long.
export const AGAIN_WITHIN_MS = 5 * 60_000;

export type QuerySummary = {
  searches: number;
  empty: number;                 // found nothing
  again: number;                 // followed by another search (same agent, same run, soon after)
  againAfterEmpty: number;       // of the empty ones, how many were followed by another
  againAfterFound: number;       // of the ones that found something, how many were followed by another
  byAgent: Record<string, { searches: number; empty: number; again: number }>;
  chains: { agent: string; run: string; queries: { query: string; found: number }[] }[]; // runs with more than one search in a row, newest first
};

export function summarizeQueries(list: RecallQuery[] = readQueries(), within = AGAIN_WITHIN_MS): QuerySummary {
  const s: QuerySummary = { searches: list.length, empty: 0, again: 0, againAfterEmpty: 0, againAfterFound: 0, byAgent: {}, chains: [] };
  const sorted = [...list].sort((a, b) => a.time.localeCompare(b.time));
  // The next search by the same agent in the same run, for each one. No run (the terminal camp): never "again".
  const next = new Map<number, number>();
  const last = new Map<string, number>();
  sorted.forEach((q, i) => {
    if (!q.run) return;
    const k = `${q.agent}\n${q.run}`;
    const before = last.get(k);
    if (before !== undefined && Date.parse(q.time) - Date.parse(sorted[before].time) <= within) next.set(before, i);
    last.set(k, i);
  });
  for (const [i, q] of sorted.entries()) {
    const a = (s.byAgent[q.agent] ??= { searches: 0, empty: 0, again: 0 });
    a.searches++;
    const isEmpty = q.found === 0, isAgain = next.has(i);
    if (isEmpty) { s.empty++; a.empty++; }
    if (isAgain) { s.again++; a.again++; if (isEmpty) s.againAfterEmpty++; else s.againAfterFound++; }
  }
  // The chains: each search that wasn't a follow-up, and the ones that followed it.
  const followed = new Set(next.values());
  for (const [i, q] of sorted.entries()) {
    if (followed.has(i) || !next.has(i)) continue;
    const queries: { query: string; found: number }[] = [];
    for (let j: number | undefined = i; j !== undefined; j = next.get(j)) queries.push({ query: sorted[j].query, found: sorted[j].found });
    s.chains.push({ agent: q.agent, run: q.run!, queries });
  }
  s.chains.reverse();
  return s;
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "–");
export function formatSummary(s: QuerySummary, chainsShown = 10): string {
  if (!s.searches) return "No recall searches on record yet.";
  const found = s.searches - s.empty;
  const lines = [
    `${s.searches} recall searches.`,
    `Found nothing: ${s.empty} (${pct(s.empty, s.searches)}).`,
    `Searched again straight after: ${s.again} (${pct(s.again, s.searches)}) — after finding nothing ${s.againAfterEmpty} of ${s.empty} (${pct(s.againAfterEmpty, s.empty)}), after finding something ${s.againAfterFound} of ${found} (${pct(s.againAfterFound, found)}).`,
    "",
    "By agent:",
    ...Object.entries(s.byAgent).sort((a, b) => b[1].searches - a[1].searches).map(([id, a]) => `  ${id}: ${a.searches} searches, ${a.empty} empty, ${a.again} followed by another`),
  ];
  if (s.chains.length) {
    lines.push("", `Searches followed by another (newest ${Math.min(chainsShown, s.chains.length)} of ${s.chains.length}):`);
    for (const c of s.chains.slice(0, chainsShown)) lines.push(`  ${c.agent}: ${c.queries.map((q) => `"${q.query}" (${q.found})`).join(" → ")}`);
  }
  return lines.join("\n");
}
