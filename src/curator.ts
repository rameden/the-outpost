// The curator: keeps the shelf of crew-written skills from growing without end.
//
// Every skill's use is counted (camp/skill-usage.json): each time its SKILL.md is read, and each
// time it's inlined into a prompt as always-on. From those counts a skill is active, stale (unused
// for staleDays) or archived (unused for archiveDays, and moved to skills/_archive/).
//
// What it will and won't do:
// - It only ever touches skills the crew wrote: ones whose front matter says `created_by` (the
//   forge writes that). A skill you wrote or installed is counted, never moved.
// - It never deletes. Archiving is a move to skills/_archive/<owner>/<name>/, and Restore moves it back.
// - A pinned skill is left alone, and so is one a crew member follows always.
// - It isn't a daemon. The server's minute tick asks curatorDue(): the camp is idle and the last
//   look was more than everyDays ago. Each look backs the skills up first (camp/skill-backups/).
// - It calls no model, so it costs nothing.
// Ported from Hermes Agent's curator (agent/curator.py, tools/skill_usage.py; MIT).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { posix, relative, sep } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { emit } from "./events.js";
import { alwaysSkills, learning } from "./settings.js";

const join = posix.join;
const SKILLS_DIR = "skills";
export const ARCHIVE_DIR = join(SKILLS_DIR, "_archive");
export const USAGE_PATH = join("camp", "skill-usage.json");
export const BACKUP_DIR = join("camp", "skill-backups");
export const KEEP_BACKUPS = 5;
const DAY = 86_400_000;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Whose skills: each folder under skills/ (or the archive) that isn't a pile of its own (_pending, _archive).
// Read from disk, not the roster, so this file needs nothing from the crew's tools (which count uses through it).
const OWNER_RE = /^[a-z0-9][a-z0-9-]*$/;
const ownersIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((o) => OWNER_RE.test(o)) : []);

export type SkillState = "active" | "stale" | "archived";
// reads: times its SKILL.md was opened. always: times it was inlined as always-on. last: the last
// of either. since: when it was first seen (or approved). restored: when you brought it back.
export type SkillRecord = { reads: number; always: number; last?: string; since: string; restored?: string; pinned?: boolean; state: SkillState; archived?: string };
export type CuratorPass = { at: string; checked: number; stale: string[]; archived: string[]; reactivated: string[]; backup: string | null };
type UsageFile = { skills: Record<string, SkillRecord>; lastPass?: string; last?: CuratorPass };

function load(): UsageFile {
  const kept = readJsonFile(USAGE_PATH, null) as UsageFile | null;
  const skills: Record<string, SkillRecord> = {};
  if (kept && typeof kept === "object" && kept.skills && typeof kept.skills === "object") {
    for (const [key, r] of Object.entries(kept.skills)) {
      if (!r || typeof r !== "object") continue;
      skills[key] = { ...r, reads: Number(r.reads) || 0, always: Number(r.always) || 0, since: typeof r.since === "string" ? r.since : new Date().toISOString(),
        state: r.state === "stale" || r.state === "archived" ? r.state : "active" };
    }
  }
  return { skills, ...(typeof kept?.lastPass === "string" ? { lastPass: kept.lastPass } : {}), ...(kept?.last ? { last: kept.last } : {}) };
}
const save = (f: UsageFile) => { mkdirSync("camp", { recursive: true }); writeJsonAtomic(USAGE_PATH, f); };
const fresh = (now: number): SkillRecord => ({ reads: 0, always: 0, since: new Date(now).toISOString(), state: "active" });

const livePath = (key: string) => join(SKILLS_DIR, key, "SKILL.md");
const archivedPath = (key: string) => join(ARCHIVE_DIR, key, "SKILL.md");
const front = (text: string, key: string) => text.match(/^---\n([\s\S]*?)\n---/)?.[1]?.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
// Who wrote the skill at this path, when the crew did ("" for one you wrote or installed).
export function createdBy(path: string): string {
  try { return front(readFileSync(path, "utf8"), "created_by"); } catch { return ""; }
}

// ---------- Counting ----------
// "skills/<owner>/<name>/SKILL.md" (as written, or absolute) → "<owner>/<name>". Anything else
// (a skill's other files, the waiting pile, the archive) isn't a use.
export function skillKeyOf(path: string): string | null {
  const rel = (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? relative(process.cwd(), path) : path).split(sep).join("/").replace(/^\.\//, "");
  const m = rel.match(/^skills\/([^/_.][^/]*)\/([^/]+)\/SKILL\.md$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// One use of a skill. Never throws: a run mustn't fail over a counter.
export function noteSkillUse(key: string, how: "read" | "always", now = Date.now()) {
  try {
    const f = load();
    const r = f.skills[key] ?? fresh(now);
    if (how === "read") r.reads++; else r.always++;
    r.last = new Date(now).toISOString();
    if (r.state === "stale") r.state = "active";
    f.skills[key] = r;
    save(f);
  } catch { /* the count is a nicety */ }
}
// Several at once (a run's always-on skills): one write.
export function noteSkillsInlined(keys: string[], now = Date.now()) {
  if (!keys.length) return;
  try {
    const f = load();
    for (const key of keys) {
      const r = f.skills[key] ?? fresh(now);
      r.always++;
      r.last = new Date(now).toISOString();
      if (r.state === "stale") r.state = "active";
      f.skills[key] = r;
    }
    save(f);
  } catch { /* as above */ }
}
// A skill just went live (approved): its clock starts now. What it was used before, as an earlier version, is kept.
export function noteSkillCreated(key: string, now = Date.now()) {
  try {
    const f = load();
    const was = f.skills[key];
    f.skills[key] = { ...(was ?? fresh(now)), since: new Date(now).toISOString(), state: "active", ...(was?.pinned ? { pinned: true } : {}) };
    delete f.skills[key].archived;
    save(f);
  } catch { /* as above */ }
}

// ---------- Where a skill stands ----------
const at = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);
// The last time anything happened to it: used, approved, or restored.
export const anchorOf = (r: Pick<SkillRecord, "last" | "since" | "restored">) => Math.max(at(r.last), at(r.since), at(r.restored));
// Pure: where a live skill stands by its dates alone. "archive" means it's due to be shelved.
export function standing(r: SkillRecord, now: number, o: { staleDays: number; archiveDays: number }): "active" | "stale" | "archive" {
  const idle = now - anchorOf(r);
  if (idle >= o.archiveDays * DAY) return "archive";
  if (idle >= o.staleDays * DAY) return "stale";
  return "active";
}
const isAlways = (key: string) => Object.values(alwaysSkills()).some((list) => list.includes(key)); // someone follows it in every prompt

export type SkillStanding = { uses: number; reads: number; always: number; last: string | null; state: SkillState; pinned: boolean; createdBy: string };
// What the skills pages show beside each live skill: one read of the usage file for the lot.
// A skill that isn't the crew's own is always active, and so is a pinned or always-on one.
export function standings(now = Date.now()): (owner: string, name: string) => SkillStanding {
  const records = load().skills;
  const cfg = learning();
  const followed = new Set(Object.values(alwaysSkills()).flat());
  return (owner, name) => {
    const key = `${owner}/${name}`;
    const r = records[key];
    const by = createdBy(livePath(key));
    const exempt = !by || r?.pinned === true || followed.has(key);
    const where = r && !exempt ? standing(r, now, cfg) : "active";
    return { uses: (r?.reads ?? 0) + (r?.always ?? 0), reads: r?.reads ?? 0, always: r?.always ?? 0, last: r?.last ?? null,
      state: where === "active" ? "active" : "stale", pinned: r?.pinned === true, createdBy: by };
  };
}

// ---------- Pin ----------
// A pinned skill is never marked stale or archived, however long it sits.
export function pinSkill(owner: string, name: string, pinned: boolean): { ok: true } | { ok: false; error: string } {
  const key = `${owner}/${name}`;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || !existsSync(livePath(key))) return { ok: false, error: `There's no skill ${key}.` };
  const f = load();
  const r = f.skills[key] ?? fresh(Date.now());
  if (pinned) { r.pinned = true; r.state = "active"; } else delete r.pinned;
  f.skills[key] = r;
  save(f);
  emit({ type: "changed", what: "skills" });
  return { ok: true };
}

// ---------- Archive and restore ----------
const stampOf = (now: number) => new Date(now).toISOString().replace(/[:.]/g, "-");
function prune(dir: string) { try { if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* an empty folder left behind is harmless */ } }

// Move a live skill to the archive. Nothing is deleted: an older archived copy of the same name
// is moved aside (its folder gets a time stamp) to make room.
function archive(key: string, now: number) {
  const from = join(SKILLS_DIR, key);
  const to = join(ARCHIVE_DIR, key);
  mkdirSync(join(ARCHIVE_DIR, key.split("/")[0]), { recursive: true });
  if (existsSync(to)) renameSync(to, `${to}.${stampOf(now)}`);
  renameSync(from, to);
  prune(join(SKILLS_DIR, key.split("/")[0]));
}

export type ArchivedSkill = { owner: string; name: string; description: string; path: string; archived: string | null; uses: number; last: string | null; createdBy: string };
export function archivedSkills(): ArchivedSkill[] {
  if (!existsSync(ARCHIVE_DIR)) return [];
  const records = load().skills;
  const out: ArchivedSkill[] = [];
  for (const owner of ownersIn(ARCHIVE_DIR)) {
    const dir = join(ARCHIVE_DIR, owner);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name, "SKILL.md");
      if (!NAME_RE.test(name) || !existsSync(path)) continue; // a copy moved aside (name.<stamp>) stays on disk, off the list
      const r = records[`${owner}/${name}`];
      const text = readFileSync(path, "utf8");
      out.push({ owner, name, description: front(text, "description"), path, archived: r?.archived ?? null,
        uses: (r?.reads ?? 0) + (r?.always ?? 0), last: r?.last ?? null, createdBy: front(text, "created_by") });
    }
  }
  return out;
}

// Bring an archived skill back. It counts as active again, with its clock started over, so the
// next look doesn't shelve it straight away.
export function restoreSkill(owner: string, name: string, now = Date.now()): { ok: true } | { ok: false; error: string } {
  const key = `${owner}/${name}`;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || !existsSync(archivedPath(key))) return { ok: false, error: `There's no archived skill ${key}.` };
  if (existsSync(join(SKILLS_DIR, key))) return { ok: false, error: `A skill named ${key} is in use now. Remove or rename it first, then restore this one.` };
  mkdirSync(join(SKILLS_DIR, owner), { recursive: true });
  renameSync(join(ARCHIVE_DIR, key), join(SKILLS_DIR, key));
  prune(join(ARCHIVE_DIR, owner));
  prune(ARCHIVE_DIR);
  const f = load();
  const r = f.skills[key] ?? fresh(now);
  r.state = "active";
  r.restored = new Date(now).toISOString();
  delete r.archived;
  f.skills[key] = r;
  save(f);
  emit({ type: "changed", what: "skills" });
  return { ok: true };
}

// ---------- Backup ----------
// The crew-written skills as they are, and the usage file, copied to camp/skill-backups/<stamp>/
// before a look changes anything. The newest KEEP_BACKUPS are kept.
export function backupSkills(keys: string[], now = Date.now()): string {
  let dir = join(BACKUP_DIR, stampOf(now));
  for (let n = 2; existsSync(dir); n++) dir = join(BACKUP_DIR, `${stampOf(now)}-${n}`);
  mkdirSync(dir, { recursive: true });
  for (const key of keys) cpSync(join(SKILLS_DIR, key), join(dir, "skills", key), { recursive: true });
  if (existsSync(USAGE_PATH)) cpSync(USAGE_PATH, join(dir, "skill-usage.json"));
  const all = readdirSync(BACKUP_DIR).sort(); // the stamps sort by time
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) rmSync(join(BACKUP_DIR, old), { recursive: true, force: true });
  return dir;
}

// ---------- The look ----------
// Every live skill the crew wrote: "<owner>/<name>".
export function managedSkills(): string[] {
  const out: string[] = [];
  for (const owner of ownersIn(SKILLS_DIR)) {
    const dir = join(SKILLS_DIR, owner);
    for (const name of readdirSync(dir)) if (createdBy(livePath(`${owner}/${name}`))) out.push(`${owner}/${name}`);
  }
  return out;
}

let looking = false; // one look at a time
// One pass over the crew-written skills. A skill seen for the first time only has its clock
// started; a pinned or always-on one is skipped; the rest go by their dates.
export function curate(now = Date.now(), o: { staleDays: number; archiveDays: number } = learning()): CuratorPass {
  const pass: CuratorPass = { at: new Date(now).toISOString(), checked: 0, stale: [], archived: [], reactivated: [], backup: null };
  if (looking) return pass;
  looking = true;
  try {
    const keys = managedSkills();
    if (keys.length) pass.backup = backupSkills(keys, now);
    const f = load();
    for (const key of keys) {
      pass.checked++;
      const r = f.skills[key];
      if (!r) { f.skills[key] = fresh(now); continue; } // first sight: it gets a full term before anything happens to it
      if (r.pinned || isAlways(key)) { r.state = "active"; continue; }
      const where = standing(r, now, o);
      if (where === "archive") {
        archive(key, now);
        r.state = "archived";
        r.archived = new Date(now).toISOString();
        pass.archived.push(key);
      } else if (where === "stale") {
        if (r.state !== "stale") pass.stale.push(key);
        r.state = "stale";
      } else {
        if (r.state === "stale") pass.reactivated.push(key);
        r.state = "active";
      }
    }
    f.lastPass = pass.at;
    f.last = pass;
    save(f);
  } finally {
    looking = false;
  }
  if (pass.archived.length || pass.stale.length || pass.reactivated.length) emit({ type: "changed", what: "skills" });
  return pass;
}

export const lastPass = (): CuratorPass | null => load().last ?? null;

// Pure: is it time for a look? On, nothing running or queued, nothing asked for a while, and the
// last look more than everyDays ago. `last` is null when there has never been one.
export function curatorDue(now: number, o: { on: boolean; busy: boolean; asked: number; idleFor: number; last: number | null; everyDays: number }): boolean {
  if (!o.on || o.busy || o.last == null) return false;
  if (now - o.asked < o.idleFor) return false;
  return now - o.last >= o.everyDays * DAY;
}

// Called from the server's minute tick. The first time it's ever asked it only notes the time, so
// a camp that has just been updated waits one full interval before its first look.
export function curatorTick(now: number, o: { busy: boolean; asked: number; idleFor: number }): CuratorPass | null {
  const cfg = learning();
  if (!cfg.curator) return null;
  const f = load();
  if (!f.lastPass) { f.lastPass = new Date(now).toISOString(); save(f); return null; }
  if (!curatorDue(now, { on: true, ...o, last: at(f.lastPass), everyDays: cfg.everyDays })) return null;
  const pass = curate(now, cfg);
  if (pass.archived.length) {
    emit({ type: "notice", who: "Curator", emoji: "🗄️", depth: 0,
      text: `🗄️ ${pass.archived.length === 1 ? "A skill nobody has used" : `${pass.archived.length} skills nobody has used`} in ${cfg.archiveDays} days moved to the archive: ${pass.archived.join(", ")}. Restore from Settings → Skills.` });
  }
  return pass;
}
