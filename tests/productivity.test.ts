// What saves a round trip: a quest whose changes fail your checks is sent back to fix them, the
// optional review before a report, and older answers carried in shortened form on a reply.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, whoAsks, type Reply } from "./helpers/fake-api.ts";

enterSandbox("productivity");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads
const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-fix-")));

const { runDirect, runExpedition, checksFailed, fixBrief, REVIEW_RULE } = await import("../src/quartermaster.ts");
const { say } = await import("../src/words.ts"); // a rule is written with {tokens} for the pack's words: say() fills them
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { addLink, setLinkVerify } = await import("../src/links.ts");
const { setFixAttempts, fixAttempts, setReviewChanges, reviewChangesOn } = await import("../src/settings.ts");
const { recordTurn, threadFor, shortened } = await import("../src/threads.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

setAsker(async () => "");
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; setFixAttempts(1); setReviewChanges(false); });

const link = addLink(folder, "write");
setLinkVerify(link.name, ["test -f fixed.txt"]);
const firstMessage = (b: any): string => { const c = b.messages[0].content; return typeof c === "string" ? c : c.map((x: any) => x.text ?? "").join("\n"); };
// The Artificer writes a file; sent back over a failing check, it writes the one the check wants.
const artificer = (b: any): Reply => {
  if (!isFirstTurn(b)) return { text: firstMessage(b).includes("at least one failed") ? "Fixed: added fixed.txt." : "Wrote a.txt." };
  const fixing = firstMessage(b).includes("at least one failed");
  return { tools: [{ name: "write_file", input: { path: `links/${link.name}/${fixing ? "fixed.txt" : "a.txt"}`, content: "x\n" } }] };
};
const direct = async () => (await runDirect("artificer", "Add a.txt", "user", [], undefined, undefined, undefined, { links: [link.name] }))!;

test("a failing check sends the same crew member back with the output, and the checks run again", async () => {
  script = artificer;
  const r = await direct();
  assert.equal(r.status, "done");
  assert.match(r.text, /Wrote a\.txt\./);
  assert.match(r.text, /checks failed after that, so Artificer was sent back to fix them, and reported:\)\nFixed: added fixed\.txt\./);
  assert.match(r.text, /✓ test -f fixed\.txt/);
  assert.ok(!checksFailed(r.text), "the checks as they ended are what's reported");
  assert.ok(existsSync(join(folder, "fixed.txt")));
  assert.equal(events.filter((e) => e.type === "notice" && /sending Artificer back to fix it \(1 of 1\)/.test(e.text)).length, 1);
  const second = api.seen.map((s) => firstMessage(s.body)).find((m) => m.includes("at least one failed"))!;
  assert.match(second, /✗ test -f fixed\.txt/, "the failing output goes with it");
  assert.match(second, /Don't weaken, skip, or delete a check/);
});

test("it's sent back only as many times as you allow, and not at all when that's none", async () => {
  rmSync(join(folder, "fixed.txt"));
  let n = 0; // a new file each run: none of them the one the check wants
  script = (b) => (isFirstTurn(b) ? { tools: [{ name: "write_file", input: { path: `links/${link.name}/try-${++n}.txt`, content: "x\n" } }] } : { text: "Tried." });
  setFixAttempts(2);
  const stuck = await direct();
  assert.equal(events.filter((e) => e.type === "notice" && /sending Artificer back/.test(e.text)).length, 2);
  assert.match(stuck.text, /✗ test -f fixed\.txt/, "still failing: reported as it stands");

  events.length = 0;
  setFixAttempts(0);
  const once = await direct();
  assert.equal(events.filter((e) => e.type === "notice" && /sending Artificer back/.test(e.text)).length, 0);
  assert.match(once.text, /✗ test -f fixed\.txt/);
  setFixAttempts(99);
  assert.equal(fixAttempts(), 3, "never more than three");
});

test("what tells a failed check from a passed one, and what the fix brief asks for", () => {
  assert.equal(checksFailed("Automatic checks in links/x:\n✓ npm test"), false);
  assert.equal(checksFailed("Automatic checks in links/x:\n✓ lint\n✗ npm test\nExit code 1"), true);
  assert.equal(checksFailed(""), false);
  assert.match(fixBrief("✗ npm test"), /Fix what your changes broke, and nothing else\.[\s\S]*✗ npm test$/);
});

test("with review on, the Quartermaster is told to have changes looked over before it reports", async () => {
  script = () => ({ text: "Nothing to do." });
  await runExpedition("Say hello");
  const system = (i: number) => api.seen[i].body.system.map((s: any) => s.text).join("\n");
  assert.ok(!system(0).includes("Review before you report"));
  setReviewChanges(true);
  assert.equal(reviewChangesOn(), true);
  api.seen.length = 0;
  await runExpedition("Say hello again");
  assert.equal(whoAsks(api.seen[0].body), "Quartermaster");
  assert.ok(system(0).includes(say(REVIEW_RULE)));
  assert.match(REVIEW_RULE, /dispatch the Warden once/);
  // One run can ask for it, or go without, whatever the camp is set to (the ticket stepper does).
  api.seen.length = 0;
  await runExpedition("Say hello without a review", { review: false });
  assert.ok(!system(0).includes("Review before you report"));
  setReviewChanges(false);
  api.seen.length = 0;
  await runExpedition("Say hello with a review", { review: true });
  assert.ok(system(0).includes(say(REVIEW_RULE)));
});

test("a skill that's always on for a crew member is in every one of their prompts, in full", async () => {
  const { setSkillAlways, alwaysFor, removeSkill } = await import("../src/skillpacks.ts");
  const { alwaysOn, alwaysBlock, skillIndex } = await import("../src/agent.ts");
  mkdirSync("skills/shared/plain-words", { recursive: true });
  writeFileSync("skills/shared/plain-words/SKILL.md", "---\nname: plain-words\ndescription: Write so anyone can follow.\n---\n\n# Plain words\n\nNo jargon. Short sentences.\n");
  script = () => ({ text: "Hello." });
  const system = (i: number) => api.seen[i].body.system.map((s: any) => s.text).join("\n");

  // Listed, not loaded: the usual way.
  await runExpedition("Say hello");
  assert.match(system(0), /- plain-words: Write so anyone can follow\. \(read skills\/shared\/plain-words\/SKILL\.md before using\)/);
  assert.ok(!system(0).includes("No jargon. Short sentences."));
  assert.ok(!system(0).includes("## Skills you always follow"));

  assert.deepEqual(setSkillAlways("shared", "plain-words", ["quartermaster", "scribe"]), ["quartermaster", "scribe"]);
  assert.deepEqual(alwaysFor("shared", "plain-words"), ["quartermaster", "scribe"]);
  api.seen.length = 0;
  await runExpedition("Say hello again");
  assert.match(system(0), /## Skills you always follow\nThe user has set these to apply to everything you do\./);
  assert.match(system(0), /### plain-words\n# Plain words\n\nNo jargon\. Short sentences\.\n\(Anything else it refers to, scripts or reference pages, is in skills\/shared\/plain-words\/\.\)/);
  assert.match(system(0), /- plain-words: Write so anyone can follow\. \(always on: its instructions are below\)/);
  assert.ok(!system(0).includes("description: Write so anyone"), "its front matter isn't repeated");
  // For the others it's still only listed.
  assert.equal(alwaysBlock("scout", ["skills/shared", "skills/scout"]), "");
  assert.match(skillIndex(["skills/shared"]), /plain-words: .*\(read skills\/shared\/plain-words\/SKILL\.md before using\)/);

  // A crew member's own skill can be always on for them, and nobody else; and the crew member has to exist.
  assert.deepEqual(setSkillAlways("scribe", "house-style", ["scribe"]), ["scribe"]);
  assert.deepEqual(alwaysOn("scribe", ["skills/shared", "skills/scribe"]).map((x) => x.key), ["shared/plain-words", "scribe/house-style"]);
  assert.throws(() => setSkillAlways("scribe", "house-style", ["scout"]), (e: any) => e.fixable && /belongs to scribe/.test(e.message));
  assert.throws(() => setSkillAlways("shared", "plain-words", ["nobody"]), (e: any) => e.fixable && /no crew member "nobody"/.test(e.message));
  assert.throws(() => setSkillAlways("shared", "no-such-skill", ["scout"]), (e: any) => e.fixable && /No such skill/.test(e.message));
  assert.deepEqual(alwaysFor("shared", "plain-words"), ["quartermaster", "scribe"], "a refused change changes nothing");
  // One that's set but can't be used by that crew member (another's skill, written into the settings by hand) isn't loaded.
  assert.deepEqual(alwaysOn("scout", ["skills/shared", "skills/scout"]).map((x) => x.key), []);
  // A long skill is cut, with where to read the rest.
  writeFileSync("skills/shared/plain-words/SKILL.md", "---\nname: plain-words\ndescription: d\n---\n" + "word ".repeat(4000));
  assert.match(alwaysBlock("quartermaster", ["skills/shared", "skills/quartermaster"]), /…\[cut for length: read the rest in skills\/shared\/plain-words\/SKILL\.md\]/);

  // Unticking takes it out; removing the skill takes it out for everyone.
  assert.deepEqual(setSkillAlways("shared", "plain-words", ["scribe"]), ["scribe"]);
  assert.equal(alwaysBlock("quartermaster", ["skills/shared", "skills/quartermaster"]), "");
  assert.equal(removeSkill("shared", "plain-words"), true);
  assert.deepEqual(alwaysFor("shared", "plain-words"), []);
  assert.deepEqual(alwaysOn("scribe", ["skills/shared", "skills/scribe"]).map((x) => x.key), ["scribe/house-style"]);
  setSkillAlways("scribe", "house-style", []);
});

test("a reply carries the latest exchanges whole and the older answers shortened", () => {
  const long = (tag: string) => `${tag} START ${"detail ".repeat(600)}${tag} END`;
  for (const n of [1, 2, 3, 4]) recordTurn({ thread: "t", expedition: `t${n}`, agent: "quartermaster", direct: false, task: `Ask ${n}`, reply: long(`A${n}`), status: "done" });
  const h = threadFor("t4")!.history;
  for (const n of [1, 2, 3, 4]) assert.ok(h.includes(`Ask ${n}`), "every request is still there");
  assert.ok(h.includes(long("A4")) && h.includes(long("A3")), "the last two answers are whole");
  assert.ok(!h.includes(long("A2")) && !h.includes(long("A1")));
  assert.match(h, /A1 START[\s\S]*characters of this earlier answer left out[\s\S]*A1 END/, "an older answer keeps its opening and its close");
  assert.ok(h.length < long("A").length * 3, "which is most of the saving");
  assert.equal(shortened("short answer"), "short answer");
});
