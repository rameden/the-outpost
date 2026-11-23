// The night shift: a few safe chores done while the camp is idle overnight, and a short report
// for the morning.
//
// It's off unless you turn it on (Settings → What Mae does unasked). When it's on, once a night,
// inside the hours you set and only after the camp has sat idle for half an hour, it does three
// things:
//
//   - memory tidies: for up to three memories that are past 60% of what a prompt loads and have no
//     tidy already waiting, the smallest model drafts a merged version (keeping.ts). A draft waits
//     in the same queue as every other proposal: nothing in memory changes until you approve it;
//   - old lines worth a look: lines that aren't pinned and are more than 90 days old are listed in
//     the night's record. No model is called and nothing is touched: it's a list for you to read;
//   - housekeeping: the report only (housekeeping.ts), never the clean. What could be cleared, and
//     how much room it would give back, is written down.
//
// That's all of it. The night shift never applies, deletes or changes anything: everything it
// leaves behind is a proposal or a line in its own record (camp/night/<day>.json). It makes at
// most three model calls a night, and none while your plan's usage limit is used up. Each chore
// stands alone: one that fails is noted in plain words and the others still run.
//
// "Idle" is: nothing running or queued, and you haven't asked for anything in the last half hour.
// When you last asked is kept in camp/night/asked.json, so a restart doesn't forget it.
//
// Next morning Today shows a "While you were away" card built from the nights you haven't seen
// yet (nightPage). A night that found nothing new shows no card.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { writeJsonAtomic } from "./atomic.js";
import { dayOf } from "./helpers.js";
import { emit } from "./events.js";
import { findings, size, type Finding, type Step } from "./housekeeping.js";
import { memoryOverview, nameOf, proposals, proposeTidy, type MemoryLine } from "./keeping.js";
import { pausedUntil } from "./limits.js";
import { norm } from "./memlog.js";
import { drive, type Drive } from "./settings.js";
import { askSmall } from "./small.js";

export const NIGHT_DIR = posix.join("camp", "night");
const ASKED = posix.join(NIGHT_DIR, "asked.json");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const IDLE_FOR = 30 * 60_000;   // this long with nothing asked, running or queued is "idle"
export const MAX_CALLS = 3;            // model calls in one night, whatever there is to tidy
const MAX_TIDIES = 3;                  // memories a night drafts a tidy for
const TIDY_AT = 0.6;                   // of what a prompt loads: past this, a memory is worth a draft overnight
const OLD_AFTER = 90 * 86_400_000;     // a line this old that isn't pinned is worth a look
const MAX_STALE = 50;                  // old lines one night lists (the rest come up on later nights)
const LOOK_BACK = 30;                  // nights read back for what's already been listed or tried

export type StaleLine = { where: string; text: string; date: string };
export type HouseLine = { step: Step; title: string; count: number; bytes: number };
// tidied: the memories a tidy was drafted for (their place, like "agent:scout"). stale: old lines
// listed for the first time. housekeeping: what the report found (null if it couldn't be made).
// notes: what couldn't be done, in plain words. calls: model calls made. tried: each memory a tidy
// was attempted for and its size then, so the same text isn't sent again night after night.
// seen: when you dismissed the morning card.
export type NightRecord = { day: string; started: string; finished: string; tidied: string[]; stale: StaleLine[]; housekeeping: HouseLine[] | null; notes: string[];
  calls: number; tried?: Record<string, number>; seen?: string };

const fileOf = (day: string) => posix.join(NIGHT_DIR, `${day}.json`);
const said = (e: unknown) => String((e as any)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

// ---------- When you last asked for something ----------
let asked: { at: number; cwd: string } | null = null;
export function lastAsked(): number {
  if (!asked || asked.cwd !== process.cwd()) {
    let at = 0;
    try { at = Number(JSON.parse(readFileSync(ASKED, "utf8")).at) || 0; } catch { /* never, as far as the record goes */ }
    asked = { at, cwd: process.cwd() };
  }
  return asked.at;
}
// Called where a request of yours comes in. Never throws: a request mustn't fail over a timestamp.
export function noteAsked(now = Date.now()) {
  asked = { at: now, cwd: process.cwd() };
  try { mkdirSync(NIGHT_DIR, { recursive: true }); writeJsonAtomic(ASKED, { at: now }); } catch { /* it's still held in memory */ }
}

// ---------- When it's due ----------
const minutes = (clock: string) => { const [h, m] = clock.split(":").map(Number); return h * 60 + m; };
const hours = (d: Drive) => ({ on: d.night === true, from: d.nightFrom ?? "01:00", to: d.nightTo ?? "05:00" });
// Inside the night's hours? They may cross midnight (23:00 to 05:00). The same time twice is no hours at all.
export function inWindow(now: Date, from: string, to: string): boolean {
  const at = now.getHours() * 60 + now.getMinutes(), f = minutes(from), t = minutes(to);
  return f < t ? at >= f && at < t : f > t ? at >= f || at < t : false;
}
// The day a night is filed under: the day its hours began. So 02:00 on the 14th, in hours that
// run 23:00 to 05:00, is still the night of the 13th. Outside the hours it's simply today.
export function nightOf(now: Date, from: string, to: string): string {
  const early = minutes(from) > minutes(to) && now.getHours() * 60 + now.getMinutes() < minutes(to);
  return dayOf(early ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now);
}

// Is tonight's shift due? Switched on, inside its hours, the camp idle, your usage limit not used
// up, and not already done for this night. busy: something is running or queued (the server knows).
// Everything it reads can be handed in, which is how the tests ask it about any moment.
export function nightDue(now = new Date(), o: { drive?: Drive; busy?: boolean; asked?: number; paused?: number | null; ran?: (day: string) => boolean } = {}): boolean {
  const h = hours(o.drive ?? drive());
  if (!h.on || !inWindow(now, h.from, h.to)) return false;
  if (o.busy || now.getTime() - (o.asked ?? lastAsked()) < IDLE_FOR) return false;
  if (o.paused === undefined ? pausedUntil(now.getTime()) : o.paused) return false;
  return !(o.ran ?? ((day: string) => !!readNight(day)))(nightOf(now, h.from, h.to));
}

// ---------- The record ----------
export function readNight(day: string): NightRecord | null {
  if (!DAY.test(day) || !existsSync(fileOf(day))) return null;
  try {
    const r = JSON.parse(readFileSync(fileOf(day), "utf8")) as NightRecord;
    return { ...r, tidied: Array.isArray(r.tidied) ? r.tidied : [], stale: Array.isArray(r.stale) ? r.stale : [], housekeeping: Array.isArray(r.housekeeping) ? r.housekeeping : null, notes: Array.isArray(r.notes) ? r.notes : [] };
  } catch { return null; }
}
// The latest nights on record, newest first.
export function nights(limit = LOOK_BACK): NightRecord[] {
  let days: string[] = [];
  try { days = readdirSync(NIGHT_DIR).filter((f) => f.endsWith(".json") && DAY.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort().reverse().slice(0, limit); } catch { /* no night yet */ }
  return days.flatMap((d) => readNight(d) ?? []);
}

// Which lines are worth a look: dated, not pinned, and old. This is the one place that decides it,
// so "and never recalled since" can be added here once there's a record of what gets recalled.
export function worthALook(line: Pick<MemoryLine, "date" | "pinned">, now: number): boolean {
  if (!line.date || line.pinned) return false;
  const written = new Date(`${line.date}T00:00:00`).getTime();
  return Number.isFinite(written) && now - written > OLD_AFTER;
}
const lineKey = (s: { where: string; text: string }) => `${s.where}|${norm(s.text)}`;

// ---------- The shift ----------
type Ask = (system: string, prompt: string, maxTokens?: number) => Promise<string>;
export type NightOptions = {
  now?: Date;
  ask?: Ask;                              // the model call (swapped out in tests)
  report?: () => Promise<Finding[]>;      // the housekeeping report (swapped out in tests)
  paused?: number | null;                 // your usage limit, if it's used up (read from limits.ts otherwise)
};

// Do the night's chores and write its record. Only one runs at a time: a second ask while one is
// under way gets the same night back.
let working: Promise<NightRecord> | null = null;
export function runNight(o: NightOptions = {}): Promise<NightRecord> {
  return (working ??= shift(o).finally(() => { working = null; }));
}

async function shift(o: NightOptions): Promise<NightRecord> {
  const now = o.now ?? new Date();
  const started = new Date().toISOString();
  const h = hours(drive());
  const day = nightOf(now, h.from, h.to);
  const earlier = readNight(day);                       // run again for the same night: it's done afresh
  const before = nights().filter((r) => r.day !== day);
  const notes: string[] = [];

  // a. Drafts of memory tidies, the fullest memory first. Every model call goes through `counted`,
  // which hands back nothing once the night's calls are spent: the draft so far is what's proposed.
  let calls = 0;
  const counted = (ask: Ask): Ask => async (system, prompt, max) => { if (calls >= MAX_CALLS) return ""; calls++; return ask(system, prompt, max); };
  const tidied: string[] = [], tried: Record<string, number> = {};
  try {
    const paused = o.paused === undefined ? pausedUntil() : o.paused;
    const waiting = new Set(proposals().flatMap((p) => (p.kind === "tidy" ? [p.where] : [])));
    const lastTried = (where: string) => before.find((r) => r.tried?.[where] !== undefined)?.tried?.[where];
    const full = memoryOverview()
      .filter((p) => p.size > p.limit * TIDY_AT && p.lines.length >= 4 && !waiting.has(p.where) && lastTried(p.where) !== p.size)
      .sort((a, b) => b.size / b.limit - a.size / a.limit).slice(0, MAX_TIDIES);
    if (full.length && paused) notes.push(`Your usage limit was used up, so no shorter version was drafted for ${full.map((p) => p.name).join(", ")}.`);
    else for (const p of full) {
      if (calls >= MAX_CALLS) { notes.push(`${p.name} wasn't looked at: the night's ${MAX_CALLS} model calls were used up. It comes up again another night.`); continue; }
      tried[p.where] = p.size;
      const project = p.kind === "project" ? p.where.slice("project:".length) : undefined;
      try {
        await proposeTidy(p.where, counted(o.ask ?? ((s, q, max = 1500) => askSmall(s, q, max, { project }))));
        tidied.push(p.where);
      } catch (e) { notes.push(`No shorter version was drafted for ${p.name}: ${said(e)}`); }
    }
  } catch (e) { notes.push(`The memories couldn't be read for tidying: ${said(e)}`); }

  // b. Old lines worth a look: listed here and nowhere else. One already listed on an earlier night isn't listed again.
  let stale: StaleLine[] = [];
  try {
    const listed = new Set(before.flatMap((r) => r.stale.map(lineKey)));
    stale = memoryOverview()
      .flatMap((p) => p.lines.filter((l) => worthALook(l, now.getTime())).map((l) => ({ where: p.where, text: l.text, date: l.date! })))
      .filter((s) => !listed.has(lineKey(s)))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_STALE);
  } catch (e) { notes.push(`The old lines couldn't be listed: ${said(e)}`); }

  // c. Housekeeping: what could be cleared. The report only; cleaning is yours to ask for.
  let housekeeping: HouseLine[] | null = null;
  try {
    housekeeping = (await (o.report ?? (() => findings(undefined, now.getTime())))()).map((f) => ({ step: f.step, title: f.title, count: f.count, bytes: f.bytes }));
  } catch (e) { notes.push(`The housekeeping report couldn't be made: ${said(e)}`); }

  const record: NightRecord = { day, started, finished: new Date().toISOString(), tidied: [...new Set([...(earlier?.tidied ?? []), ...tidied])], stale, housekeeping, notes, calls,
    ...(Object.keys(tried).length ? { tried } : {}) };
  mkdirSync(NIGHT_DIR, { recursive: true });
  writeJsonAtomic(fileOf(day), record);
  emit({ type: "changed", what: "memory" });
  return record;
}

// ---------- The morning ----------
// One line on a night: what the Settings row says about the last one.
export function nightLine(r: NightRecord): string {
  const found = r.housekeeping ?? [];
  const did = [
    r.tidied.length ? `drafted ${r.tidied.length === 1 ? "a shorter version of 1 memory" : `shorter versions of ${r.tidied.length} memories`}` : "",
    r.stale.length ? `listed ${many(r.stale.length, "old line")} worth a look` : "",
    found.length ? `found ${many(found.length, "thing")} housekeeping could clear` : "",
  ].filter(Boolean);
  const line = did.length ? `${did.join(", ")}.` : "nothing needed doing.";
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}${r.notes.length ? ` ${many(r.notes.length, "thing")} couldn't be done.` : ""}`;
}

// What the "While you were away" card shows: the nights you haven't dismissed, as one. A tidy you've
// already settled isn't mentioned, and a housekeeping report that says what the last one you saw
// said isn't news.
export type NightCard = { day: string; finished: string; nights: number;
  tidied: { where: string; name: string }[]; stale: (StaleLine & { name: string })[]; housekeeping: HouseLine[]; frees: string; notes: string[] };
const named = <T extends { where: string }>(list: T[]): (T & { name: string })[] => list.flatMap((x) => { try { return [{ ...x, name: nameOf(x.where) }]; } catch { return []; } });
const sameReport = (a: HouseLine[] | null | undefined, b: HouseLine[] | null | undefined) =>
  JSON.stringify((a ?? []).map((f) => [f.step, f.count]).sort()) === JSON.stringify((b ?? []).map((f) => [f.step, f.count]).sort());

export function nightCard(all: NightRecord[] = nights()): NightCard | null {
  const unseen = all.filter((r) => !r.seen);
  if (!unseen.length) return null;
  const latest = unseen[0];
  const waiting = new Set(proposals().flatMap((p) => (p.kind === "tidy" ? [p.where] : [])));
  const tidied = named([...new Set(unseen.flatMap((r) => r.tidied))].filter((w) => waiting.has(w)).map((where) => ({ where })));
  const keys = new Set<string>();
  const stale = named(unseen.flatMap((r) => r.stale).filter((s) => !keys.has(lineKey(s)) && !!keys.add(lineKey(s)))).sort((a, b) => a.date.localeCompare(b.date));
  const housekeeping = sameReport(latest.housekeeping, all.find((r) => r.seen)?.housekeeping) ? [] : latest.housekeeping ?? [];
  const bytes = housekeeping.reduce((n, f) => n + f.bytes, 0);
  if (!tidied.length && !stale.length && !housekeeping.length && !latest.notes.length) return null;
  return { day: latest.day, finished: latest.finished, nights: unseen.length, tidied, stale, housekeeping, frees: bytes ? size(bytes) : "", notes: latest.notes };
}

// For Today and Settings: the card (if there's anything you haven't seen) and a line on the last night.
export function nightPage(): { night?: NightCard; lastNight?: { day: string; finished: string; line: string } } {
  try {
    const all = nights();
    const card = nightCard(all);
    return { ...(card ? { night: card } : {}), ...(all[0] ? { lastNight: { day: all[0].day, finished: all[0].finished, line: nightLine(all[0]) } } : {}) };
  } catch { return {}; }
}

// You've read the card: every night up to now is marked seen. Returns how many were.
export function markNightSeen(now = new Date()): number {
  const unseen = nights().filter((r) => !r.seen);
  for (const r of unseen) writeJsonAtomic(fileOf(r.day), { ...r, seen: now.toISOString() });
  if (unseen.length) emit({ type: "changed", what: "memory" });
  return unseen.length;
}
