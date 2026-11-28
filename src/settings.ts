// Per-agent model and effort, chosen from mission control (or /model in the terminal).
// Stored in camp/settings.json and read at the start of every run, so a change applies to
// that agent's next quest without restarting anything. Anything not set falls back to the
// defaults in code (roster.ts / quartermaster.ts).

import { statSync } from "node:fs";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { emit } from "./events.js";
import type { CrewId } from "./crew.js";
import { DEFAULT_PACK, isPack } from "./packs.js";

export const SETTINGS_PATH = "camp/settings.json";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
// maxTurns: how many replies (each with its tool calls) one run may take before it stops.
// helpers: this crew member may send helpers of its own while it works (see quartermaster.ts).
export type AgentSettings = { model?: string; effort?: Effort; maxTurns?: number; helpers?: boolean };
export const DEFAULT_TURNS = 20;
export const TURNS_MIN = 5;
export const TURNS_MAX = 200;
// A crew member's run that uses all its turns without finishing carries on, with its context
// intact, for up to this many more allowances of the same size before it stops and hands off.
// Briefing a fresh run instead meant it started cold and read the whole project again. (Scheduled
// jobs and the Quartermaster's own run don't carry on: see agent.ts.)
export const TURN_EXTENSIONS = 2;
// sandbox: on macOS, run commands with no network and writes limited to the working folder, without asking (see sandbox.ts).
// deny / ask: patterns (with * for anything) a command is checked against before anything else:
// a denied one never runs, whatever else would allow it; an "ask" one always waits for you, even
// in the sandbox. reviewer: the smallest model clears routine commands before you're asked (reviewer.ts).
// allowHosts: hosts a sandboxed command may reach, through the camp's proxy (netproxy.ts; macOS).
// god: every command runs without asking, outside the sandbox (your deny and ask rules still hold).
export type ShellSettings = { autoApprove?: boolean; allow?: string[]; exact?: string[]; sandbox?: boolean; god?: boolean; deny?: string[]; ask?: string[]; reviewer?: boolean; explain?: boolean; allowHosts?: string[] };
// Phone notifications through an ntfy server (see phone.ts). Off unless a topic is set.
export type PhoneSettings = { server?: string; topic?: string; approve?: string[] };
type Settings = {
  agents: Partial<Record<CrewId, AgentSettings>>;
  budgetUsd?: number;     // stop an expedition once it has spent this much (all agents together)
  shell?: ShellSettings;  // which shell commands run without asking (see shell.ts)
  runtime?: "claude-code" | "api";
  uploads?: { keepDays?: number }; // delete uploads nothing uses once they're this many days old (uploads.ts); never, unless set
  compactAt?: number;      // the share of a model's context (0.3 to 0.95) at which a long run's transcript is compacted (compaction.ts); 0.7 unless set, 0 for never
  refusalFallback?: boolean; // on the API: a request a model declines is carried on by another Claude model (on unless false)
  parallel?: number;      // how many expeditions mission control runs at once (the rest wait)
  questsAtOnce?: number;  // how many dispatched quests run at once, across every expedition
  selfEdit?: boolean;     // let agents edit the camp's own source (src/, tests/, evals/, package.json)
  autoTitles?: boolean;   // name new conversations with the smallest model (titles.ts)
  pack?: string;          // the theme pack: what the crew are called, in the page and in their own prompts (packs.ts)
  phone?: PhoneSettings;
  jiraFilter?: string;    // which Jira tickets are pulled in (JQL); see jira.ts
  fixAttempts?: number;   // how many times a quest is sent back to fix its own failing checks (0 = never)
  reviewChanges?: boolean; // have the Warden review what changed before the Quartermaster reports
  runFoundChecks?: boolean; // in a folder with no checks of its own, run the ones the camp finds there (verify.ts); off unless true
  prWatch?: boolean;       // look at the pull requests of recent worktrees now and then (pulls.ts); on unless false
  jiraWrite?: JiraWrite;   // what the camp may write to Jira (jira.ts); nothing unless "on"
  providersApproved?: string[];             // other providers you've said may be sent confidential projects' work (approved where you work, say)
  smallModel?: string;                      // what does the camp's own small jobs (titles, tidying a memory, suggestions): a Claude model, or "<provider>:<model>", or "auto"
  memoryCare?: { tidy?: boolean; suggest?: boolean }; // looking after what the crew remembers (see keeping.ts)
  // The learning loop: the review that proposes memory and skills while a run goes (review.ts), and the curator that shelves skills nobody uses (curator.ts).
  learning?: { review?: boolean; every?: number; curator?: boolean; staleDays?: number; archiveDays?: number; everyDays?: number };
  termActions?: TermAction[];               // the terminal's quick actions: your own commands, a click away (at most five)
  alwaysSkills?: Record<string, string[]>; // crew member → the skills ("<owner>/<name>") loaded into every one of their prompts, not just listed
  skillCommands?: Record<string, SkillCommand[]>; // "<owner>/<name>" → the scripts of an imported skill that run without asking (skillpacks.ts)
  drive?: { brief?: boolean; briefAt?: string; briefNews?: boolean; retro?: boolean; debrief?: boolean; night?: boolean; nightFrom?: string; nightTo?: string }; // what the camp does unasked: a brief each weekday morning (brief.ts), a retro each week (reports.ts), a debrief when a ticket is done (reports.ts)
  autoExclude?: string[];  // models (or id prefixes, like "openrouter:") Auto never picks (routing.ts); set in Settings → Models, or by hand
};
// Writing to Jira is off unless you turn it on. With it on, the camp comments on a ticket when
// work starts from it and when its pull request opens, and (if you name a status) moves it.
export const JIRA_MOMENTS = ["start", "review", "pr", "merged"] as const;
export type JiraMoment = (typeof JIRA_MOMENTS)[number];
// skip: the moments you've turned off (every moment is on until you do).
export type JiraWrite = { on?: boolean; startStatus?: string; reviewStatus?: string; prStatus?: string; doneStatus?: string; skip?: JiraMoment[] };
// A command an imported skill may run without asking. For one of the skill's own scripts: the
// command as it's typed, the script it runs, and that file's fingerprint when you approved it (a
// script that has changed since asks again). Otherwise just a command prefix, like "pnpm add".
export type SkillCommand = { prefix: string; file?: string; sha256?: string };

// The file is parsed once and kept until it changes: one refresh of the page asks for a setting
// dozens of times, every command asks again, and the file holds every "always allow" you've given.
// The file's stamp is taken on every call (before it's read, so a change in between is caught the
// next time), which is how an edit by hand or by another camp process is picked up. The folder is
// in the stamp too, so a camp somewhere else (each test file has its own) never sees this one's.
// A write that replaces the file (atomic.ts) is a new file, which is what the inode is there to tell.
let cache: { stamp: string; s: Settings } | null = null;
function stampOf(): string {
  let st;
  try { st = statSync(SETTINGS_PATH, { throwIfNoEntry: false }); } catch { /* can't be looked at: as good as missing */ }
  return `${process.cwd()}|${st ? `${st.mtimeMs}:${st.size}:${st.ino}` : "none"}`;
}
// What's kept is frozen all the way down, so nothing given it can change what the next caller reads.
function frozen<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) frozen(x); }
  return v;
}
// A part of the settings that's the caller's own, to keep or change as it likes.
const own = <T>(v: T): T => structuredClone(v);

// The settings as they are, to look at: shared, and frozen. Anything handed on from here that
// isn't a plain value goes through own().
function read(): Settings {
  const stamp = stampOf();
  if (cache?.stamp === stamp) return cache.s;
  // A settings file that can't be parsed is kept aside before the defaults take over (atomic.ts),
  // so a hand-edit typo never costs you your rules. The defaults ask before any command that isn't
  // plainly read-only, so losing the file never loosens what runs without you.
  const s = readJsonFile(SETTINGS_PATH, null) as Settings | null;
  const usable = !!s && typeof s === "object" && !Array.isArray(s);
  cache = { stamp, s: frozen(usable ? { ...s!, agents: s!.agents ?? {} } : { agents: {} }) };
  return cache.s;
}
// The settings to change and save: a copy, so a change that's never saved (or a save that fails) leaves no trace.
const load = (): Settings => own(read());

function save(s: Settings) {
  writeJsonAtomic(SETTINGS_PATH, s, { mode: 0o600 }); // it can hold your phone topic: yours to read, nobody else's
  cache = null; // read back from the file, so what's kept is always what's on disk
  emit({ type: "changed", what: "settings" });
}

export const budgetUsd = () => read().budgetUsd;
export function setBudgetUsd(value: number | null) {
  const s = load();
  if (value && value > 0) s.budgetUsd = Math.round(value * 100) / 100;
  else delete s.budgetUsd;
  save(s);
}

// How many expeditions (and direct chats, and jobs) mission control runs at the same time.
// More at once uses up a subscription's limits (or API spend) faster.
export const PARALLEL_DEFAULT = 3;
export const PARALLEL_MAX = 8;
export const parallelLimit = () => Math.min(PARALLEL_MAX, Math.max(1, Math.round(read().parallel ?? PARALLEL_DEFAULT)));
export function setParallelLimit(n: number) {
  const s = load();
  s.parallel = Math.min(PARALLEL_MAX, Math.max(1, Math.round(n)));
  save(s);
}

export const shellSettings = (): ShellSettings => own(read().shell ?? {});

// How long an upload nothing uses any more is kept, in days. Null: for good (the default).
export const UPLOAD_DAYS_MAX = 3650;
export const uploadKeepDays = (): number | null => { const d = read().uploads?.keepDays; return typeof d === "number" && d >= 1 ? Math.min(UPLOAD_DAYS_MAX, Math.round(d)) : null; };
export function setUploadKeepDays(days: number | null) {
  const s = load();
  if (days && days >= 1) s.uploads = { keepDays: Math.min(UPLOAD_DAYS_MAX, Math.round(days)) };
  else delete s.uploads;
  save(s);
}

// When a model declines a request (its safety checks, not an error), let another Claude model
// carry on instead of ending the run (agent.ts). On unless you set "refusalFallback": false.
export const refusalFallbackOn = () => read().refusalFallback !== false;
// The share of the model's context a run may fill before its transcript is compacted
// (compaction.ts). "compactAt": 0 turns it off; anything else is held between 0.3 and 0.95.
export const DEFAULT_COMPACT_AT = 0.7;
export function compactAt(): number {
  const v = read().compactAt;
  if (v === 0) return 0;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(0.95, Math.max(0.3, v)) : DEFAULT_COMPACT_AT;
}

// The theme pack (packs.ts). Anything unknown, or nothing, is the Guild. crew.ts puts it on the
// crew (setPack there is what the page calls): this only keeps the choice.
export const packId = (): string => { const id = read().pack; return isPack(id) ? id : DEFAULT_PACK; };
export function setPackId(id: string) {
  if (!isPack(id)) throw new Error(`No theme pack called "${id}".`);
  const s = load();
  if (id === DEFAULT_PACK) delete s.pack; else s.pack = id;
  save(s);
}

// "Always allow" on a shell approval: that exact command runs without asking from now on.
export function allowShellCommand(command: string) {
  const s = load();
  const exact = new Set(s.shell?.exact ?? []);
  exact.add(command.trim());
  s.shell = { ...(s.shell ?? {}), exact: [...exact] };
  save(s);
}

export function setShellSandbox(on: boolean) {
  const s = load();
  s.shell = { ...(s.shell ?? {}), sandbox: on };
  delete s.shell.god; // the sandbox switch chooses between the sandbox and asking
  save(s);
}

// Dispatched quests running at once, camp-wide. One Quartermaster can send several adventurers
// in a turn, and several expeditions can run side by side; this caps the total.
export const QUESTS_DEFAULT = 4;
export const questLimit = () => Math.min(16, Math.max(1, Math.round(read().questsAtOnce ?? QUESTS_DEFAULT)));

export const QUESTS_MAX = 16;
export function setQuestLimit(n: number) {
  const s = load();
  s.questsAtOnce = Math.min(QUESTS_MAX, Math.max(1, Math.round(n)));
  save(s);
}

// The Jira tickets the camp pulls in (the Jira page, and the attach menu's first list), as JQL.
export const JIRA_FILTER_DEFAULT = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
export const jiraFilter = () => read().jiraFilter?.trim() || JIRA_FILTER_DEFAULT;
export function setJiraFilter(jql: string) {
  const s = load();
  const clean = jql.trim();
  if (clean && clean !== JIRA_FILTER_DEFAULT) s.jiraFilter = clean.slice(0, 2000); else delete s.jiraFilter;
  save(s);
}

// When your checks fail after a quest, the same adventurer is sent back to fix them, this many times at most.
export const FIX_ATTEMPTS_DEFAULT = 1;
export const FIX_ATTEMPTS_MAX = 3;
export const fixAttempts = () => Math.min(FIX_ATTEMPTS_MAX, Math.max(0, Math.round(read().fixAttempts ?? FIX_ATTEMPTS_DEFAULT)));
export function setFixAttempts(n: number) {
  const s = load();
  s.fixAttempts = Math.min(FIX_ATTEMPTS_MAX, Math.max(0, Math.round(n)));
  save(s);
}
// A second pair of eyes on changes before they're reported. Off unless you turn it on: it's another quest's worth of usage.
export const reviewChangesOn = () => read().reviewChanges === true;
export function setReviewChanges(on: boolean) {
  const s = load();
  if (on) s.reviewChanges = true; else delete s.reviewChanges;
  save(s);
}
// A linked folder with no checks set up: the camp looks for likely ones there (its package.json
// scripts and the like) and says what it found. Running them is off unless you turn it on: unlike
// your own checks, these commands come from the folder's files, which a quest may just have changed.
export const runFoundChecksOn = () => read().runFoundChecks === true;
export function setRunFoundChecks(on: boolean) {
  const s = load();
  if (on) s.runFoundChecks = true; else delete s.runFoundChecks;
  save(s);
}

// What the camp does without being asked. brief: each weekday at briefAt (your local time) it
// writes down where things stand, from its own record and one look at GitHub and Jira: no model
// is called, so it's on unless you turn it off. retro: once a week the smallest model reads the
// week's requests and what reviewers said, and proposes things worth keeping, for you to approve.
// That one is a model call, so it follows "suggestions" (memoryCare) unless you set it yourself.
// debrief: when a ticket is done (an Outpost ticket reaching Done, a Jira ticket's pull request merging), the smallest model reads how the crew did on it and proposes
// lessons for the Quartermaster, the crew and the project (reports.ts). The same kind of call, the same default.
// night: the night shift (nightshift.ts). Between nightFrom and nightTo (your local time; the hours may
// cross midnight), once the camp has been idle a while, it drafts memory tidies and writes a report for
// the morning. It only drafts and reports, and it's off unless you turn it on. drive() always sets the
// three; they're optional in the type so a page written before the night shift is still a Drive.
// briefNews: the morning brief also has the smallest model search the web for AI news, features,
// best practices and trends that could help the outpost (briefnews.ts). A model call, so it's off
// unless you turn it on.
export type Drive = { brief: boolean; briefAt: string; briefNews?: boolean; retro: boolean; debrief: boolean; night?: boolean; nightFrom?: string; nightTo?: string };
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
export function drive(): Drive {
  const d = read().drive ?? {};
  return { brief: d.brief !== false, briefAt: typeof d.briefAt === "string" && CLOCK.test(d.briefAt) ? d.briefAt.padStart(5, "0") : "08:00", briefNews: d.briefNews === true, retro: typeof d.retro === "boolean" ? d.retro : memoryCare().suggest, debrief: typeof d.debrief === "boolean" ? d.debrief : memoryCare().suggest,
    night: d.night === true, nightFrom: clock(d.nightFrom, "01:00"), nightTo: clock(d.nightTo, "05:00") };
}
const clock = (t: unknown, otherwise: string) => (typeof t === "string" && CLOCK.test(t) ? t.padStart(5, "0") : otherwise);
export function setDrive(c: { brief?: unknown; briefAt?: unknown; briefNews?: unknown; retro?: unknown; debrief?: unknown; night?: unknown; nightFrom?: unknown; nightTo?: unknown }) {
  const s = load();
  const next = { ...(s.drive ?? {}) };
  if (typeof c.brief === "boolean") { if (c.brief) delete next.brief; else next.brief = false; }
  if (typeof c.briefAt === "string" && CLOCK.test(c.briefAt)) next.briefAt = c.briefAt.padStart(5, "0");
  if (typeof c.briefNews === "boolean") { if (c.briefNews) next.briefNews = true; else delete next.briefNews; }
  if (typeof c.retro === "boolean") next.retro = c.retro;
  if (typeof c.debrief === "boolean") next.debrief = c.debrief;
  if (typeof c.night === "boolean") { if (c.night) next.night = true; else delete next.night; }
  if (typeof c.nightFrom === "string" && CLOCK.test(c.nightFrom)) next.nightFrom = c.nightFrom.padStart(5, "0");
  if (typeof c.nightTo === "string" && CLOCK.test(c.nightTo)) next.nightTo = c.nightTo.padStart(5, "0");
  if (Object.keys(next).length) s.drive = next; else delete s.drive;
  save(s);
}

export const prWatchOn = () => read().prWatch !== false;
export function setPrWatch(on: boolean) {
  const s = load();
  if (on) delete s.prWatch; else s.prWatch = false;
  save(s);
}

export const jiraWrite = (): JiraWrite => own(read().jiraWrite ?? {});
export function setJiraWrite(w: { on?: unknown; startStatus?: unknown; reviewStatus?: unknown; prStatus?: unknown; doneStatus?: unknown; moments?: unknown }) {
  const s = load();
  const name = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const next: JiraWrite = { ...(w.on ? { on: true } : {}) };
  for (const k of ["startStatus", "reviewStatus", "prStatus", "doneStatus"] as const) if (name(w[k])) next[k] = name(w[k]);
  const moments = w.moments && typeof w.moments === "object" ? w.moments as Record<string, unknown> : {};
  const skip = JIRA_MOMENTS.filter((m) => moments[m] === false);
  if (skip.length) next.skip = skip;
  if (Object.keys(next).length) s.jiraWrite = next; else delete s.jiraWrite;
  save(s);
}

// Other providers you've cleared for confidential work. By default a project marked confidential
// (web: careful, or off) is never sent to another provider; one you've approved here is the exception.
// It's your statement about your own agreement with that provider: the camp can't check it.
export const providersApproved = (): string[] => own(read().providersApproved ?? []);
export const providerApproved = (id: string) => providersApproved().includes(id);
export function setProviderApproved(id: string, on: boolean) {
  const s = load();
  const next = new Set(s.providersApproved ?? []);
  if (on) next.add(id); else next.delete(id);
  if (next.size) s.providersApproved = [...next].sort(); else delete s.providersApproved;
  save(s);
}

// The camp's own small jobs (naming a conversation, tidying a memory, suggesting what to keep)
// go to the smallest Claude model unless you've pointed them somewhere else, such as a free model
// from a provider you've connected, or "auto" (Auto picks the cheapest model that's up to each one: small.ts). Null: the default.
export const autoExcluded = (): string[] => (Array.isArray(read().autoExclude) ? read().autoExclude!.filter((x) => typeof x === "string" && x) : []);
// Take a model out of Auto's choices (on: false), or give it back (on: true).
export function setAutoExcluded(model: string, on: boolean) {
  const s = load();
  const next = new Set(autoExcluded());
  if (on) next.delete(model); else next.add(model);
  if (next.size) s.autoExclude = [...next].sort(); else delete s.autoExclude;
  save(s);
}
export const smallModel = (): string | null => read().smallModel ?? null;
export function setSmallModel(model: string | null) {
  const s = load();
  if (model) s.smallModel = model; else delete s.smallModel;
  save(s);
}

// Looking after memory. tidy: when a memory or a project's notes near what a prompt can hold,
// have the smallest model draft a merged version for you to approve (on unless you turn it off;
// it runs rarely). suggest: after each run, have it propose up to three things worth keeping
// (off unless you turn it on: it's a small call on every run).
export const memoryCare = (): { tidy: boolean; suggest: boolean } => ({ tidy: read().memoryCare?.tidy !== false, suggest: read().memoryCare?.suggest === true });
export function setMemoryCare(c: { tidy?: unknown; suggest?: unknown }) {
  const s = load();
  const now = memoryCare();
  const next = { tidy: typeof c.tidy === "boolean" ? c.tidy : now.tidy, suggest: typeof c.suggest === "boolean" ? c.suggest : now.suggest };
  const kept = { ...(next.tidy ? {} : { tidy: false }), ...(next.suggest ? { suggest: true } : {}) };
  if (Object.keys(kept).length) s.memoryCare = kept; else delete s.memoryCare;
  save(s);
}

// The learning loop (review.ts, curator.ts).
// review: while a run goes, every `every` tool calls, a copy of it is asked what's worth keeping.
// It can only propose (memory suggestions, skill drafts): both wait for you. Off unless you turn
// it on: each review is a model call on the run's own model.
// curator: skills the crew wrote that nobody has opened for staleDays are marked stale, and after
// archiveDays moved to skills/_archive/ (never deleted; pinned ones are left alone). It looks once
// every everyDays, when the camp is idle. On unless you turn it off: it calls no model.
export const LEARNING_DEFAULTS = { review: false, every: 10, curator: true, staleDays: 14, archiveDays: 30, everyDays: 7 } as const;
export type Learning = { review: boolean; every: number; curator: boolean; staleDays: number; archiveDays: number; everyDays: number };
const LEARNING_RANGE = { every: [2, 200], staleDays: [1, 365], archiveDays: [2, 730], everyDays: [1, 90] } as const;
const within = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = Math.round(Number(v));
  return v != null && v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
export function learning(): Learning {
  const l = read().learning ?? {};
  const staleDays = within(l.staleDays, LEARNING_RANGE.staleDays, LEARNING_DEFAULTS.staleDays);
  return {
    review: l.review === true,
    every: within(l.every, LEARNING_RANGE.every, LEARNING_DEFAULTS.every),
    curator: l.curator !== false,
    staleDays,
    archiveDays: Math.max(staleDays + 1, within(l.archiveDays, LEARNING_RANGE.archiveDays, LEARNING_DEFAULTS.archiveDays)), // a skill is stale before it's shelved
    everyDays: within(l.everyDays, LEARNING_RANGE.everyDays, LEARNING_DEFAULTS.everyDays),
  };
}
export function setLearning(c: { [K in keyof Learning]?: unknown }): Learning {
  const s = load();
  const now = learning();
  const next: Learning = {
    review: typeof c.review === "boolean" ? c.review : now.review,
    curator: typeof c.curator === "boolean" ? c.curator : now.curator,
    every: within(c.every, LEARNING_RANGE.every, now.every),
    staleDays: within(c.staleDays, LEARNING_RANGE.staleDays, now.staleDays),
    archiveDays: within(c.archiveDays, LEARNING_RANGE.archiveDays, now.archiveDays),
    everyDays: within(c.everyDays, LEARNING_RANGE.everyDays, now.everyDays),
  };
  // Only what differs from the defaults is written, so a default that changes later reaches you.
  const kept = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== LEARNING_DEFAULTS[k as keyof Learning]));
  if (Object.keys(kept).length) s.learning = kept; else delete s.learning;
  save(s);
  return learning();
}

// The terminal's quick actions: chips in the terminal's header that run a command of yours.
// where: in a new terminal (which can start in a linked folder, or a folder inside one), or in the
// terminal you're looking at. commands: run in order, each only if the one before it succeeded.
// ask: type it in and leave Enter to you, for something you'd rather read before it runs.
// They live in camp/settings.json, which no crew member can read or write: only you set what runs.
export type TermAction = { label: string; commands: string[]; where: "new" | "current"; folder?: string; sub?: string; ask?: boolean };
export const TERM_ACTIONS_MAX = 5;
const TERM_LABEL_MAX = 14, TERM_COMMANDS_MAX = 8, TERM_COMMAND_MAX = 400;
// What you sent, checked and tidied. It throws (saying which action and why) rather than keep half of it.
export function cleanTermActions(raw: unknown): TermAction[] {
  if (!Array.isArray(raw)) throw new Error("Send the quick actions as a list.");
  if (raw.length > TERM_ACTIONS_MAX) throw new Error(`That's more than ${TERM_ACTIONS_MAX} quick actions. Remove one first.`);
  const seen = new Set<string>();
  return raw.map((a: any, i) => {
    const n = `Quick action ${i + 1}`;
    const label = String(a?.label ?? "").replace(/\s+/g, " ").trim();
    if (!label) throw new Error(`${n} needs a name.`);
    if (label.length > TERM_LABEL_MAX) throw new Error(`${n}: keep the name to ${TERM_LABEL_MAX} characters (it's a chip).`);
    if (seen.has(label.toLowerCase())) throw new Error(`Two quick actions are called "${label}". Give each its own name.`);
    seen.add(label.toLowerCase());
    const lines = (Array.isArray(a?.commands) ? a.commands : String(a?.commands ?? "").split("\n")).map((l: unknown) => String(l).trim()).filter(Boolean);
    if (!lines.length) throw new Error(`"${label}" needs a command.`);
    if (lines.length > TERM_COMMANDS_MAX) throw new Error(`"${label}": at most ${TERM_COMMANDS_MAX} commands in a chain.`);
    // Typed into a shell as they are, so nothing that isn't plain text (an escape or control character would act as a key press).
    if (lines.some((l: string) => l.length > TERM_COMMAND_MAX || /[\x00-\x1f\x7f]/.test(l))) throw new Error(`"${label}": each command is one line of plain text, up to ${TERM_COMMAND_MAX} characters.`);
    const where = a?.where === "current" ? "current" : "new";
    const folder = where === "new" ? String(a?.folder ?? "").trim() : "";
    if (folder && !/^[A-Za-z0-9_-]+$/.test(folder)) throw new Error(`"${label}": pick one of your linked folders.`);
    const sub = folder ? String(a?.sub ?? "").trim().replace(/^\.\//, "").replace(/\/+$/, "") : "";
    if (sub && (sub.startsWith("/") || sub.startsWith("~") || sub.split("/").includes("..") || sub.length > 200 || /[\x00-\x1f\x7f]/.test(sub))) throw new Error(`"${label}": the folder inside ${folder} is a path within it, like apps/web.`);
    return { label, commands: lines, where, ...(folder ? { folder } : {}), ...(sub ? { sub } : {}), ...(a?.ask ? { ask: true } : {}) };
  });
}
export const termActions = (): TermAction[] => { try { return cleanTermActions(read().termActions ?? []); } catch { return []; } };
export function setTermActions(raw: unknown): TermAction[] {
  const list = cleanTermActions(raw);
  const s = load();
  if (list.length) s.termActions = list; else delete s.termActions;
  save(s);
  return list;
}

// Skills a crew member always follows: their instructions go into every prompt in full, instead
// of waiting to be opened when a task seems to match.
export const alwaysSkills = (): Record<string, string[]> => own(read().alwaysSkills ?? {});
export function setAlwaysSkills(all: Record<string, string[]>) {
  const s = load();
  const clean: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(all)) if (list.length) clean[id] = [...new Set(list)];
  if (Object.keys(clean).length) s.alwaysSkills = clean; else delete s.alwaysSkills;
  save(s);
}

export const skillCommands = (): Record<string, SkillCommand[]> => own(read().skillCommands ?? {});
export function setSkillCommands(skill: string, commands: SkillCommand[] | null) {
  const s = load();
  const all = { ...(s.skillCommands ?? {}) };
  if (commands?.length) all[skill] = commands; else delete all[skill];
  if (Object.keys(all).length) s.skillCommands = all; else delete s.skillCommands;
  save(s);
}

export const autoTitlesOn = () => read().autoTitles === true;
export function setAutoTitles(on: boolean) {
  const s = load();
  if (on) s.autoTitles = true;
  else delete s.autoTitles;
  save(s);
}
export const selfEditAllowed = () => read().selfEdit === true;
export function setSelfEdit(on: boolean) {
  const s = load();
  if (on) s.selfEdit = true;
  else delete s.selfEdit;
  save(s);
}

export const phoneSettings = (): PhoneSettings => own(read().phone ?? {});
export function setPhoneSettings(p: PhoneSettings) {
  const s = load();
  if (p.topic || p.server || p.approve) s.phone = p;
  else delete s.phone;
  save(s);
}

// The approval level for shell commands, as the settings page shows it:
//   "ask"     every command waits for you (even ls)
//   "safe"    simple read-only commands run; the rest ask (the default)
//   "sandbox" read-only commands run; the rest run in the sandbox without asking (macOS, Linux)
//   "god"     every command runs without asking, outside the sandbox: the network, installs,
//             pushes, writes anywhere you can write. Your "never run" rules still stop a command
//             and your "always ask" rules still ask. Scheduled jobs, which run with nobody here,
//             get the sandbox instead (see sandboxOn in tools.ts).
export type ApprovalLevel = "ask" | "safe" | "sandbox" | "god";
export function approvalLevel(): ApprovalLevel {
  const sh = shellSettings();
  if (sh.autoApprove === false) return "ask";
  if (sh.god === true) return "god";
  return sh.sandbox ? "sandbox" : "safe";
}
export function setApprovalLevel(level: ApprovalLevel) {
  const s = load();
  const sh: ShellSettings = { ...(s.shell ?? {}) };
  delete sh.god;
  if (level === "ask") { sh.autoApprove = false; sh.sandbox = false; }
  else { delete sh.autoApprove; sh.sandbox = level === "sandbox"; if (level === "god") sh.god = true; }
  s.shell = sh;
  save(s);
}

// Your own allow-list (command prefixes that run without asking) and the "Always allow" commands.
export function setShellReviewer(on: boolean) {
  const s = load();
  s.shell = { ...(s.shell ?? {}), reviewer: on };
  if (!on) delete s.shell.reviewer;
  save(s);
}
// Approvals in plain words: the smallest model says what a command does, on its card (explain.ts).
export function setPlainApprovals(on: boolean) {
  const s = load();
  s.shell = { ...(s.shell ?? {}), explain: on };
  if (!on) delete s.shell.explain;
  save(s);
}
type ShellLists = { allow?: string[]; exact?: string[]; deny?: string[]; ask?: string[]; allowHosts?: string[] };
// The lists as they'd be kept. Prefixes are matched against the command with spaces collapsed;
// exact commands as typed (trimmed).
function cleanShellLists(patch: ShellLists): ShellLists {
  const clean = (l: string[], collapse: boolean) =>
    [...new Set(l.map((x) => { const t = String(x).trim(); return collapse ? t.replace(/\s+/g, " ") : t; }).filter(Boolean))].slice(0, 200);
  return {
    ...(patch.allow ? { allow: clean(patch.allow, true) } : {}),
    ...(patch.exact ? { exact: clean(patch.exact, false) } : {}),
    ...(patch.deny ? { deny: clean(patch.deny, true) } : {}),
    ...(patch.ask ? { ask: clean(patch.ask, true) } : {}),
    ...(patch.allowHosts ? { allowHosts: clean(patch.allowHosts, true).map((h) => h.toLowerCase()).filter((h) => /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) } : {}),
  };
}
export function setShellLists(patch: ShellLists) {
  const s = load();
  s.shell = { ...(s.shell ?? {}), ...cleanShellLists(patch) };
  save(s);
}

// Would a change let the crew's shell do more than it may now? Asked of a request from another
// machine (server.ts): it may make the rules stricter, never looser.
//   levels: ask < safe < sandbox < god, each running more without your OK than the one before.
//   lists:  a new line in the allow-list, the "Always allowed" commands or the sandbox's hosts
//           loosens; so does a line gone from "Never run" or "Always ask". A line changed is one
//           gone and one new, so rewording a rule counts as loosening too.
const LEVELS: ApprovalLevel[] = ["ask", "safe", "sandbox", "god"];
export const loosensApproval = (to: ApprovalLevel, from: ApprovalLevel = approvalLevel()) => LEVELS.indexOf(to) > LEVELS.indexOf(from);
export function loosensShell(patch: ShellLists): boolean {
  const now = shellSettings();
  const next = cleanShellLists(patch);
  const adds = (to: string[] | undefined, from: string[] = []) => !!to && to.some((x) => !from.includes(x));
  const drops = (to: string[] | undefined, from: string[] = []) => !!to && from.some((x) => !to.includes(x));
  return adds(next.allow, now.allow) || adds(next.exact, now.exact) || adds(next.allowHosts, now.allowHosts)
    || drops(next.deny, now.deny) || drops(next.ask, now.ask);
}

// What runs the crew: your Claude subscription through Claude Code (the default), or the API
// with an API key. CAMP_RUNTIME overrides the setting (the test suite uses "api" with a fake API).
export type Runtime = "claude-code" | "api";
export function campRuntime(): Runtime {
  const env = process.env.CAMP_RUNTIME;
  if (env === "api" || env === "claude-code") return env;
  return read().runtime ?? "claude-code";
}
export function setRuntime(runtime: Runtime) {
  const s = load();
  s.runtime = runtime;
  save(s);
}

export function agentSettings(id: CrewId): AgentSettings {
  return own(read().agents[id] ?? {});
}

// Set (or with an empty value, clear) an agent's model/effort/turn-limit override.
export function setAgentSettings(id: CrewId, patch: { model?: string | null; effort?: Effort | null; maxTurns?: number | null; helpers?: boolean | null }) {
  const s = load();
  const next: AgentSettings = { ...(s.agents[id] ?? {}) };
  if (patch.model !== undefined) patch.model ? (next.model = patch.model) : delete next.model;
  if (patch.effort !== undefined) patch.effort ? (next.effort = patch.effort) : delete next.effort;
  if (patch.helpers !== undefined) patch.helpers ? (next.helpers = true) : delete next.helpers;
  if (patch.maxTurns !== undefined) {
    if (patch.maxTurns) next.maxTurns = Math.min(TURNS_MAX, Math.max(TURNS_MIN, Math.round(patch.maxTurns)));
    else delete next.maxTurns;
  }
  if (Object.keys(next).length) s.agents[id] = next;
  else delete s.agents[id];
  save(s);
}
