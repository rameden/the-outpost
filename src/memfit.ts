// Which lines of a memory go into a prompt when they don't all fit.
//
// A memory (a crew member's, or a project's notes) is a list of dated one-line notes, and a
// prompt has room for only so much of it. The rule used to be "the newest": simple, but a
// lesson falls out of the prompt for no better reason than being old, however much it bears on
// the work in hand. Now three things earn a line its place, in this order:
//
//   - it's pinned (📌 after its date): a standing rule that applies whatever the task. Pinned
//     lines are always loaded, up to a share of the room, so pins can't crowd everything else out;
//   - it's among the newest: what was just learned is the likeliest to matter next, and a
//     follow-up ("make it shorter") says too little to judge relevance by;
//   - it bears on this task: it shares words with the request, rare words counting for more than
//     common ones. Older lines compete for the room that's left on that score alone.
//
// Any room still left goes to the next-newest lines. Lines keep the order they have in the file,
// and a note at the top says how many were left out (recall still finds those). A memory that
// fits whole is loaded whole, exactly as before: none of this applies until it outgrows the room.
//
// No model is asked and nothing is indexed: it's word matching, cheap enough to run for every
// prompt. It will miss a paraphrase that shares no words; that's what pinning and recall are for.
//
// No imports from the rest of the camp, so anything can use it without import cycles.

export const PIN = "📌";
const ENTRY = /^-\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(?:(📌)\s*)?(.*)$/u;

// One line of a memory, taken apart: null if it isn't a note (a heading, a blank, loose prose).
export function parseEntry(raw: string): { date?: string; pinned: boolean; text: string } | null {
  const m = raw.trim().match(ENTRY);
  return m ? { ...(m[1] ? { date: m[1] } : {}), pinned: !!m[2], text: m[3] } : null;
}
// The same line, pinned or not (anything that isn't a note comes back as it was).
export function withPin(raw: string, on: boolean): string {
  const e = parseEntry(raw);
  if (!e) return raw;
  return `- ${e.date ? `${e.date} ` : ""}${on ? `${PIN} ` : ""}${e.text}`;
}

// ---------- Words ----------
const STOP = new Set(("the and for with that this from have has had was were are not but you your our they them their what when where which who how why can could " +
  "should would will did does into about over than then there here also just any all one two get got use used using its it's user users always never when " +
  "make made need needs want wants please thing things some each every other more most very before after").split(" "));

// A word cut back to its root, roughly: plurals, -ing and -ed, so "deploys", "deployed" and
// "deploying" all meet at "deploy". It's applied to both sides of a comparison, so being the
// same on both matters more than being a real word.
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (/(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.at(-1) === w.at(-2) && !"lsz".includes(w.at(-1)!)) w = w.slice(0, -1); // runn(ing) → run
  if (w.length > 5 && w.endsWith("e")) w = w.slice(0, -1);                                      // configure(d) → configur
  return w;
}

// The words of a text worth matching on: three letters or more, not the common ones, as roots.
// A path or a dotted name counts whole and as its parts (src/agent.ts → that, and "agent").
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  const add = (w: string) => { if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(stem(w)); };
  for (const token of String(text).toLowerCase().match(/[a-z0-9]+(?:[._\-/][a-z0-9]+)*/g) ?? []) {
    if (/^[\d._\-/]+$/.test(token)) continue; // a date or a number says nothing about the subject
    if (/[._\-/]/.test(token)) { out.add(token); for (const part of token.split(/[._\-/]/)) add(part); }
    else add(token);
  }
  return out;
}

// How alike two notes are, by the words they share: 0 to 1 (1: one's words are all in the other).
// Zero unless they share at least two, so one word in common doesn't make a pair.
export function alike(a: string, b: string): number {
  return alikeWords(wordsOf(a), wordsOf(b));
}
// The same, for words already taken out with wordsOf (comparing every pair of many notes).
export function alikeWords(x: Set<string>, y: Set<string>): number {
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared >= 2 ? shared / Math.min(x.size, y.size) : 0;
}

// ---------- Fitting ----------
const PIN_SHARE = 0.4;     // of the room: the most that pinned lines take
const RECENT_SHARE = 0.5;  // of what's left after the pins: kept for the newest lines, whatever the task
const NOTE_ROOM = 170;     // the note at the top that says lines were left out

export type Fit = {
  text: string;          // what goes in the prompt
  whole: boolean;        // it all fitted: nothing was chosen or left out
  shown: Set<number>;    // the lines (by number, from 0, as the text splits on newlines) that were loaded
  always: Set<number>;   // of those, the ones loaded whatever the task: pinned, or among the newest
  left: number;          // how many notes were left out
  relevant: Map<number, number>; // of the lines loaded, the ones that bear on the task, each with its score (empty when no task was given)
};

// The lines that bear on a task, each with its score: the words it shares with the request, a word
// in few lines counting for more. Only scores worth acting on are kept: one word that at most half
// the lines share, or two commoner ones.
function bearing(rows: string[], lines: number[], task: string): Map<number, number> {
  const out = new Map<number, number>();
  const want = wordsOf(task.slice(0, 6000));
  if (!want.size) return out;
  const words = new Map(lines.map((i) => [i, wordsOf(rows[i])]));
  const seenIn = new Map<string, number>();
  for (const set of words.values()) for (const w of set) seenIn.set(w, (seenIn.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log(1 + lines.length / (seenIn.get(w) ?? 1)); // a word in few lines says more
  for (const i of lines) {
    let score = 0;
    for (const w of words.get(i)!) if (want.has(w)) score += weight(w);
    if (score >= Math.log(3)) out.set(i, score);
  }
  return out;
}

export function fitMemory(text: string, room: number, task = ""): Fit {
  const rows = text.split("\n");
  const real = rows.map((r, i) => (r.trim() ? i : -1)).filter((i) => i >= 0);
  const isHead = (i: number) => /^#{1,6}\s/.test(rows[i].trim());
  if (text.length <= room) return { text, whole: true, shown: new Set(real), always: new Set(real), left: 0, relevant: bearing(rows, real.filter((i) => !isHead(i)), task) };

  // A heading comes along with the first line kept from under it (and costs its length then).
  const headOf = new Map<number, number>();
  let head = -1;
  const lines: number[] = [];
  for (const i of real) {
    if (isHead(i)) { head = i; continue; }
    lines.push(i);
    if (head >= 0) headOf.set(i, head);
  }
  const shown = new Set<number>();
  const always = new Set<number>();
  const budget = Math.max(0, room - NOTE_ROOM);
  let used = 0;
  const cost = (i: number) => rows[i].length + 1 + (headOf.has(i) && !shown.has(headOf.get(i)!) ? rows[headOf.get(i)!].length + 1 : 0);
  const take = (i: number, limit: number): boolean => {
    const c = cost(i);
    if (used + c > limit) return false;
    used += c;
    shown.add(i);
    if (headOf.has(i)) shown.add(headOf.get(i)!);
    return true;
  };

  // 1. Pinned lines, oldest first (they were pinned first), up to their share.
  for (const i of lines) if (parseEntry(rows[i])?.pinned && take(i, budget * PIN_SHARE)) always.add(i);
  // 2. The newest lines, up to their share of what's left.
  const recentLimit = used + (budget - used) * RECENT_SHARE;
  for (let n = lines.length - 1; n >= 0; n--) {
    const i = lines[n];
    if (shown.has(i)) continue;
    if (!take(i, recentLimit)) break;
    always.add(i);
  }
  // 3. Older lines that bear on the task, best first.
  const bears = bearing(rows, lines, task);
  const scored = [...bears].filter(([i]) => !shown.has(i)).map(([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score || b.i - a.i);
  for (const { i } of scored) take(i, budget);
  // 4. Whatever room is left: the next-newest.
  for (let n = lines.length - 1; n >= 0; n--) {
    const i = lines[n];
    if (!shown.has(i) && !take(i, budget)) break;
  }

  const left = lines.filter((i) => !shown.has(i)).length;
  const kept = rows.filter((_, i) => shown.has(i)).join("\n");
  const note = `(${lines.length - left} of ${lines.length} lines are shown: the pinned ones, the newest, and older ones that bear on this request. recall finds the other ${left}.)`;
  return { text: left ? `${note}\n${kept}` : kept, whole: false, shown, always, left, relevant: new Map([...bears].filter(([i]) => shown.has(i))) };
}
