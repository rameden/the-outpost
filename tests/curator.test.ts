// The curator: counting each skill's use, marking the crew's own skills stale and then archiving
// them, and the rules that hold it back: pinned and always-on skills stay, skills you wrote are
// never touched, nothing is deleted, and every look backs the skills up first.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

const dir = enterSandbox("curator");
const cu = await import("../src/curator.ts");
const forge = await import("../src/forge.ts");
const { setLearning, setAlwaysSkills, learning } = await import("../src/settings.ts");
const { readFileFor, rl } = await import("../src/tools.ts");
after(() => rl.close());

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const days = (n: number) => T0 + n * DAY;
const RULES = { staleDays: 14, archiveDays: 30 };

// A skill as the forge leaves it once approved (created_by), or as you'd write one yourself (by: "").
function skill(key: string, by = "quartermaster", body = "1. Do the thing.") {
  mkdirSync(join("skills", key), { recursive: true });
  writeFileSync(join("skills", key, "SKILL.md"), `---\nname: ${key.split("/")[1]}\ndescription: How to do ${key}\n${by ? `created_by: ${by}\n` : ""}---\n\n${body}\n`);
}
const usage = () => JSON.parse(readFileSync(cu.USAGE_PATH, "utf8"));
const live = (key: string) => existsSync(join("skills", key, "SKILL.md"));
const shelved = (key: string) => existsSync(join(cu.ARCHIVE_DIR, key, "SKILL.md"));

// Each test starts with no counts, no archive, no backups, and only the skills it makes.
beforeEach(() => {
  for (const p of [cu.USAGE_PATH, cu.ARCHIVE_DIR, cu.BACKUP_DIR, "skills/_pending"]) rmSync(p, { recursive: true, force: true });
  for (const owner of readdirSync("skills")) for (const name of readdirSync(join("skills", owner)))
    if (cu.createdBy(join("skills", owner, name, "SKILL.md"))) rmSync(join("skills", owner, name), { recursive: true, force: true });
  setAlwaysSkills({});
  setLearning({ review: false, every: 10, curator: true, staleDays: 14, archiveDays: 30, everyDays: 7 });
});

test("only a skill's own SKILL.md counts as a use", () => {
  assert.equal(cu.skillKeyOf("skills/scout/find-owner/SKILL.md"), "scout/find-owner");
  assert.equal(cu.skillKeyOf("./skills/scout/find-owner/SKILL.md"), "scout/find-owner");
  assert.equal(cu.skillKeyOf(join(dir, "skills", "scout", "find-owner", "SKILL.md")), "scout/find-owner", "an absolute path inside the camp");
  assert.equal(cu.skillKeyOf("skills/scout/find-owner/references/notes.md"), null, "a skill's other files");
  assert.equal(cu.skillKeyOf("skills/_pending/scout/find-owner/SKILL.md"), null, "a draft that's waiting");
  assert.equal(cu.skillKeyOf("skills/_archive/scout/find-owner/SKILL.md"), null, "an archived skill");
  assert.equal(cu.skillKeyOf("camp/agents/scout/outputs/SKILL.md"), null);
});

test("a use is counted when a SKILL.md is read and when it's inlined as always-on", async () => {
  skill("scout/find-owner");
  await readFileFor("scout").run!({ path: "skills/scout/find-owner/SKILL.md" });
  await readFileFor("scout").run!({ path: "skills/scout/find-owner/SKILL.md" });
  cu.noteSkillsInlined(["scout/find-owner", "scribe/house-style"], days(1));
  cu.noteSkillsInlined([]);
  const kept = usage().skills;
  assert.deepEqual([kept["scout/find-owner"].reads, kept["scout/find-owner"].always], [2, 1]);
  assert.deepEqual([kept["scribe/house-style"].reads, kept["scribe/house-style"].always], [0, 1]);

  const at = cu.standings()("scout", "find-owner");
  assert.deepEqual([at.uses, at.reads, at.always, at.createdBy, at.state, at.pinned], [3, 2, 1, "quartermaster", "active", false]);
  assert.equal(cu.standings()("scribe", "house-style").createdBy, "", "a skill that came with the camp isn't the crew's");
});

test("standing goes by the last thing that happened: used, approved or restored", () => {
  const r = { reads: 0, always: 0, since: new Date(T0).toISOString(), state: "active" as const };
  assert.equal(cu.standing(r, days(13), RULES), "active");
  assert.equal(cu.standing(r, days(14), RULES), "stale");
  assert.equal(cu.standing(r, days(29), RULES), "stale");
  assert.equal(cu.standing(r, days(30), RULES), "archive");
  assert.equal(cu.standing({ ...r, last: new Date(days(20)).toISOString() }, days(30), RULES), "active", "used ten days ago");
  assert.equal(cu.standing({ ...r, restored: new Date(days(29)).toISOString() }, days(40), RULES), "active", "restored eleven days ago");
});

test("a look: first sight starts the clock, then stale, then the archive; a use brings a stale skill back", () => {
  skill("scout/find-owner");
  skill("scout/read-logs");
  const first = cu.curate(days(0));
  assert.deepEqual([first.checked, first.stale, first.archived], [2, [], []], "seen for the first time: nothing happens yet");
  assert.equal(usage().skills["scout/find-owner"].since, new Date(days(0)).toISOString());

  const second = cu.curate(days(15));
  assert.deepEqual(second.stale.sort(), ["scout/find-owner", "scout/read-logs"]);
  assert.equal(cu.standings(days(15))("scout", "find-owner").state, "stale");
  assert.ok(live("scout/find-owner"), "stale is a mark, not a move");

  cu.noteSkillUse("scout/read-logs", "read", days(16));
  assert.equal(usage().skills["scout/read-logs"].state, "active", "a use makes it active again at once");
  assert.deepEqual(cu.curate(days(17)).stale, [], "a skill already marked stale isn't reported again");

  const later = cu.curate(days(31));
  assert.deepEqual(later.archived, ["scout/find-owner"]);
  assert.deepEqual(later.stale, ["scout/read-logs"], "last used 15 days ago");
  assert.ok(!live("scout/find-owner") && shelved("scout/find-owner"));
  assert.ok(live("scout/read-logs"));
  assert.equal(usage().skills["scout/find-owner"].state, "archived");
  assert.deepEqual(cu.lastPass(), later);

  cu.noteSkillUse("scout/read-logs", "always", days(32));
  assert.deepEqual(cu.curate(days(33)).stale, []);
});

test("archiving never deletes: the folder moves whole, and an older archived copy is moved aside", () => {
  skill("scout/find-owner", "quartermaster", "1. The first version.");
  mkdirSync("skills/scout/find-owner/references", { recursive: true });
  writeFileSync("skills/scout/find-owner/references/notes.md", "kept too");
  cu.curate(days(0));
  cu.curate(days(30));
  assert.match(readFileSync(join(cu.ARCHIVE_DIR, "scout/find-owner/SKILL.md"), "utf8"), /The first version/);
  assert.equal(readFileSync(join(cu.ARCHIVE_DIR, "scout/find-owner/references/notes.md"), "utf8"), "kept too");

  // The same name is written again and goes unused again: both copies are in the archive afterwards.
  skill("scout/find-owner", "quartermaster", "1. The second version.");
  cu.noteSkillCreated("scout/find-owner", days(40));
  assert.deepEqual(cu.curate(days(60)).archived, [], "approved 20 days ago: stale, not archived");
  assert.deepEqual(cu.curate(days(70)).archived, ["scout/find-owner"]);
  const copies = readdirSync(join(cu.ARCHIVE_DIR, "scout"));
  assert.equal(copies.length, 2);
  const texts = copies.map((c) => readFileSync(join(cu.ARCHIVE_DIR, "scout", c, "SKILL.md"), "utf8")).join("\n");
  assert.match(texts, /The first version/);
  assert.match(texts, /The second version/);
  assert.deepEqual(cu.archivedSkills().map((s) => `${s.owner}/${s.name}`), ["scout/find-owner"], "the list shows the one that can be restored");
});

test("skills you wrote or installed are counted but never moved", () => {
  skill("scout/hand-written", "");
  cu.noteSkillUse("scout/hand-written", "read", days(0));
  cu.noteSkillUse("scribe/house-style", "read", days(0));
  const pass = cu.curate(days(400));
  assert.deepEqual([pass.checked, pass.archived, pass.stale, pass.backup], [0, [], [], null]);
  assert.ok(live("scout/hand-written") && live("scribe/house-style"));
  assert.equal(cu.standings(days(400))("scout", "hand-written").state, "active");
  rmSync("skills/scout/hand-written", { recursive: true, force: true });
});

test("a pinned skill is exempt, and so is one someone follows always", () => {
  skill("scout/pinned-one");
  skill("scout/always-one");
  skill("scout/plain-one");
  cu.curate(days(0));
  assert.deepEqual(cu.pinSkill("scout", "pinned-one", true), { ok: true });
  setAlwaysSkills({ scout: ["scout/always-one"] });

  const pass = cu.curate(days(90));
  assert.deepEqual(pass.archived, ["scout/plain-one"]);
  assert.ok(live("scout/pinned-one") && live("scout/always-one"));
  const at = cu.standings(days(90));
  assert.deepEqual([at("scout", "pinned-one").state, at("scout", "pinned-one").pinned], ["active", true]);
  assert.equal(at("scout", "always-one").state, "active");

  // Unpinned, it goes by its dates again.
  assert.deepEqual(cu.pinSkill("scout", "pinned-one", false), { ok: true });
  assert.equal(cu.standings(days(90))("scout", "pinned-one").pinned, false);
  assert.deepEqual(cu.curate(days(91)).archived, ["scout/pinned-one"]);

  assert.equal(cu.pinSkill("scout", "no-such-skill", true).ok, false);
  assert.equal(cu.pinSkill("../camp", "x", true).ok, false);
  assert.equal(cu.pinSkill("scout", "pinned-one", true).ok, false, "an archived skill isn't there to pin");
});

test("pinning a stale skill makes it active", () => {
  skill("scout/find-owner");
  cu.curate(days(0));
  cu.curate(days(20));
  assert.equal(usage().skills["scout/find-owner"].state, "stale");
  cu.pinSkill("scout", "find-owner", true);
  assert.equal(usage().skills["scout/find-owner"].state, "active");
});

test("restore puts a skill back whole and starts its clock over", () => {
  skill("scout/find-owner", "quartermaster", "1. Ask git who touched it last.");
  cu.noteSkillUse("scout/find-owner", "read", days(0));
  cu.curate(days(1));
  cu.curate(days(40));
  assert.ok(shelved("scout/find-owner"));
  const listed = cu.archivedSkills();
  assert.deepEqual(listed.map((s) => [s.owner, s.name, s.uses, s.createdBy, s.archived]), [["scout", "find-owner", 1, "quartermaster", new Date(days(40)).toISOString()]]);

  assert.deepEqual(cu.restoreSkill("scout", "find-owner", days(41)), { ok: true });
  assert.ok(live("scout/find-owner") && !shelved("scout/find-owner"));
  assert.match(readFileSync("skills/scout/find-owner/SKILL.md", "utf8"), /Ask git who touched it last/);
  assert.deepEqual(cu.archivedSkills(), []);
  assert.ok(!existsSync(cu.ARCHIVE_DIR), "an empty archive folder isn't left behind");
  const r = usage().skills["scout/find-owner"];
  assert.deepEqual([r.state, r.reads, r.archived], ["active", 1, undefined], "its count is kept");

  assert.deepEqual(cu.curate(days(42)).archived, [], "the next look doesn't shelve it straight away");
  assert.deepEqual(cu.curate(days(41 + 14)).stale, ["scout/find-owner"], "it goes stale again by the same rule");
});

test("restore refuses when a skill of that name is in use, and when there's nothing to restore", () => {
  skill("scout/find-owner", "quartermaster", "1. The old way.");
  cu.curate(days(0));
  cu.curate(days(30));
  skill("scout/find-owner", "", "1. The new way.");
  const no = cu.restoreSkill("scout", "find-owner");
  assert.equal(no.ok, false);
  assert.match((no as { error: string }).error, /in use now/);
  assert.match(readFileSync("skills/scout/find-owner/SKILL.md", "utf8"), /The new way/, "the live skill is untouched");
  assert.ok(shelved("scout/find-owner"), "and so is the archived one");

  assert.equal(cu.restoreSkill("scout", "never-existed").ok, false);
  assert.equal(cu.restoreSkill("..", "find-owner").ok, false);
  rmSync("skills/scout/find-owner", { recursive: true, force: true });
});

test("every look backs the crew's skills up first, and only the newest few backups are kept", () => {
  skill("scout/find-owner", "quartermaster", "1. Before the look.");
  skill("scout/hand-written", "");
  cu.curate(days(0));
  const pass = cu.curate(days(30));
  assert.deepEqual(pass.archived, ["scout/find-owner"]);
  assert.ok(pass.backup && pass.backup.startsWith(cu.BACKUP_DIR));
  assert.match(readFileSync(join(pass.backup!, "skills/scout/find-owner/SKILL.md"), "utf8"), /Before the look/, "the copy was made before it was archived");
  assert.ok(!existsSync(join(pass.backup!, "skills/scout/hand-written")), "only the skills a look could touch");
  assert.equal(JSON.parse(readFileSync(join(pass.backup!, "skill-usage.json"), "utf8")).skills["scout/find-owner"].state, "active", "the counts as they were");

  skill("scout/read-logs");
  for (let i = 0; i < cu.KEEP_BACKUPS + 3; i++) cu.curate(days(31) + i * 1000);
  const kept = readdirSync(cu.BACKUP_DIR).sort();
  assert.equal(kept.length, cu.KEEP_BACKUPS);
  assert.ok(!kept.includes(pass.backup!.split("/").pop()!), "the oldest are the ones dropped");

  // Two looks in the same millisecond get a folder each.
  const a = cu.backupSkills(["scout/read-logs"], days(50)), b = cu.backupSkills(["scout/read-logs"], days(50));
  assert.notEqual(a, b);
  rmSync("skills/scout/hand-written", { recursive: true, force: true });
});

test("it's due only when the camp is idle and the last look is older than the interval", () => {
  const base = { on: true, busy: false, asked: days(0), idleFor: 10 * 60_000, last: days(0), everyDays: 7 };
  assert.equal(cu.curatorDue(days(7), base), true);
  assert.equal(cu.curatorDue(days(6.9), base), false, "the interval hasn't passed");
  assert.equal(cu.curatorDue(days(7), { ...base, on: false }), false, "switched off");
  assert.equal(cu.curatorDue(days(7), { ...base, busy: true }), false, "something is running");
  assert.equal(cu.curatorDue(days(7), { ...base, asked: days(7) - 60_000 }), false, "you asked for something a minute ago");
  assert.equal(cu.curatorDue(days(7), { ...base, last: null }), false, "never looked: the tick starts the clock first");
});

test("the tick isn't a daemon: the first call only notes the time, later ones look when due", () => {
  skill("scout/find-owner");
  const idle = { busy: false, asked: 0, idleFor: 10 * 60_000 };
  assert.equal(cu.curatorTick(days(0), idle), null, "first ever call");
  assert.equal(usage().lastPass, new Date(days(0)).toISOString());
  assert.equal(cu.curatorTick(days(3), idle), null, "not a week yet");
  assert.equal(cu.curatorTick(days(7), { ...idle, busy: true }), null, "a run is out");
  assert.equal(cu.curatorTick(days(7), { ...idle, asked: days(7) - 1000 }), null, "you're in the middle of something");

  const pass = cu.curatorTick(days(7), idle);
  assert.equal(pass?.checked, 1);
  assert.ok(existsSync(cu.BACKUP_DIR));
  assert.equal(cu.curatorTick(days(8), idle), null, "it just looked");

  setLearning({ curator: false });
  assert.equal(cu.curatorTick(days(60), idle), null, "switched off");
  assert.ok(live("scout/find-owner"));
  setLearning({ curator: true, staleDays: 3, archiveDays: 5 });
  assert.deepEqual(cu.curatorTick(days(60), idle)?.archived, ["scout/find-owner"], "your own numbers are the ones used");
});

test("the settings stay in range, and a skill is always stale before it's archived", () => {
  assert.deepEqual(learning(), { review: false, every: 10, curator: true, staleDays: 14, archiveDays: 30, everyDays: 7 });
  const set = setLearning({ review: true, every: 1, staleDays: 40, archiveDays: 10, everyDays: 1000 });
  assert.equal(set.review, true);
  assert.equal(set.every, 2, "below the range: the nearest number that's allowed");
  assert.equal(set.staleDays, 40);
  assert.ok(set.archiveDays > set.staleDays);
  assert.equal(set.everyDays, 90);
});

test("the forge says who wrote a skill, and approval starts its clock", () => {
  assert.deepEqual(forge.draftSkill({ owner: "scout", name: "find-owner", description: "Find who owns a file", instructions: "1. Ask git.", reason: "Asked for twice." }), { ok: true, replaces: false });
  assert.match(readFileSync("skills/_pending/scout/find-owner/SKILL.md", "utf8"), /^created_by: quartermaster$/m);
  assert.equal(cu.managedSkills().includes("scout/find-owner"), false, "a draft isn't a skill yet");
  assert.equal(forge.approveSkill("scout", "find-owner"), true);
  assert.equal(cu.createdBy("skills/scout/find-owner/SKILL.md"), "quartermaster", "approval keeps the line");
  assert.ok(cu.managedSkills().includes("scout/find-owner"));
  assert.equal(usage().skills["scout/find-owner"].state, "active");

  forge.draftSkill({ owner: "scribe", name: "release-notes", description: "Write release notes", instructions: "1. Lead with users.", reason: "Came up again.", by: "scribe (learning review)" });
  assert.match(readFileSync("skills/_pending/scribe/release-notes/SKILL.md", "utf8"), /^created_by: scribe \(learning review\)$/m);
});
