// A guard: no sentence in the code says "quest", "crew", "camp" or "expedition" outright. Those are
// the theme pack's words, so they're written with w() / a() (or as a {token} in text that's kept and
// filled when it's shown). A sentence with one baked in reads wrong on the starship, and if it's
// stored, it reads wrong forever. Words inside a ${…} or {…} are fine, and so are comments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WORD = /\b(quests?|expeditions?|adventurers?|crew|camps?|quest log|mission control)\b/i;

// Whole files that are about the words themselves: the packs, the page's own copy of the Guild's
// words, and the dialog where you write a pack.
const ABOUT_WORDS = new Set(["src/packs.ts", "ui/src/words.ts", "ui/src/components/PackDialog.tsx"]);
// Files another piece of work is changing (backend merges): what they still bake in is listed in
// that pull request's notes, and they're left alone here.
const ELSEWHERE = new Set(["chronicle", "retro", "debrief", "scoreboard", "payoff", "prs", "pulls", "nightshift"].map((f) => `src/${f}.ts`));
// Sentences that mean what they say whatever the pack: file, and the text as the scan sees it.
const ALLOWED = new Set([
  "src/briefnews.ts: is a multi-agent harness built on Claude: a planner (the Quartermaster) plans and dispatches a crew of agents (research, writing, coding, review, test", // describes the app to a news search
  "src/events.ts: returns to camp", // the default before a pack is known (the Guild's own words)
  "src/links.ts: the camp folder", // the working folder, to the model
  "src/reviewer.ts: the camp folder",
  "src/server.ts: Missing or wrong camp token", // the x-camp-token header, by name
  "src/ui-files.ts: Mission control", // a default; its caller passes word("Hq")
  "ui/src/components/Crew.tsx: ${quests.length ?", // code, not a sentence
]);

function* files(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) yield p;
  }
}

// Each string literal and each run of JSX text with a pack word in it, as "file: text".
function scan(dir: string): string[] {
  const hits: string[] = [];
  for (const path of files(join(ROOT, dir))) {
    const file = relative(ROOT, path);
    if (ABOUT_WORDS.has(file) || ELSEWHERE.has(file)) continue;
    // Comments blanked out (a "//" inside a string, as in a URL, is kept).
    const src = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
    const literal = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|(?<![=-])>([^<>{}=;()|&]*[A-Za-z][^<>{}=;()|&]*)</g;
    for (const m of src.matchAll(literal)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4];
      const plain = s.replace(/\$\{[^}]*\}/g, " ").replace(/\{[^}]*\}/g, " ").replace(/camp\/[\w./-]*/g, " ");
      if (!/\s/.test(plain.trim())) continue; // one word: an id, a key, a class
      if (/^[\w\s-]+$/.test(plain) && /-/.test(plain)) continue; // class names
      if (/[;=]|=>|\?\.|\)\s*\{/.test(plain)) continue; // code
      if (WORD.test(plain)) hits.push(`${file}: ${plain.replace(/\s+/g, " ").trim().slice(0, 150)}`);
    }
  }
  return hits;
}

test("no sentence in the code bakes in a theme pack's word", () => {
  const found = [...scan("src"), ...scan("ui/src")].filter((h) => !ALLOWED.has(h));
  assert.deepEqual(found, [], "Write these with w() / a() from words.ts, or as a {token} in text that's kept (shown() fills it on the page)");
});

test("every allow-list entry is still found (so it can be dropped when it goes)", () => {
  const all = [...scan("src"), ...scan("ui/src")];
  for (const allowed of ALLOWED) assert.ok(all.includes(allowed), `stale allow-list entry: ${allowed}`);
});
