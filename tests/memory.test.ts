// Identity, per-agent memory and sessions, the wiki, skills, settings, schedules, and costs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("memory");
writeFileSync("camp/ledger.md", "- 2026-11-09 An old ledger lesson.\n");
const { identityBlock, findCrew } = await import("../src/crew.ts");
const { rememberTool, readMemory, recordSession, recentSessions, continuityBlock, readSession, writeMemory, listOutputs } = await import("../src/memory.ts");
const { wikiWrite, wikiIndex } = await import("../src/wiki.ts");
const { proposeSkill, pendingSkills, approveSkill, rejectSkill, skillCatalog } = await import("../src/forge.ts");
const { setAgentSettings, agentSettings, setBudgetUsd, budgetUsd } = await import("../src/settings.ts");
const { resolveModel, resolveTurns } = await import("../src/agent.ts");
const { parseSchedule, isDue } = await import("../src/jobs.ts");
const { costOf } = await import("../src/costs.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

test("identity: fixed, with the whole crew and clear boundaries", () => {
  const block = identityBlock("scribe");
  assert.match(block, /You are the Scribe/);
  assert.match(block, /Scribe \(you\)/);
  for (const name of ["Quartermaster", "Scout", "Artificer"]) assert.match(block, new RegExp(name));
  assert.match(block, /ONE polite line naming the\s+right teammate/);
});

test("aliases find the right crew member", () => {
  assert.equal(findCrew("writer")?.id, "scribe");
  assert.equal(findCrew("dev")?.id, "artificer");
  assert.equal(findCrew("@Scout")?.id, "scout");
  assert.equal(findCrew("bard"), undefined);
});

test("memory: each agent's own; the old ledger becomes the Quartermaster's", async () => {
  assert.match(readMemory("quartermaster"), /old ledger lesson/);
  assert.ok(existsSync("camp/ledger.md.migrated"));
  await rememberTool("scribe").run!({ entry: "User likes a TL;DR first." });
  assert.match(readMemory("scribe"), /TL;DR/);
  assert.doesNotMatch(readMemory("scout"), /TL;DR/);
});

test("sessions: recorded per agent and carried into the next prompt", () => {
  recordSession("scout", { source: "direct", task: "Find the release date", result: "It's March 3.", status: "done", messages: [] });
  assert.equal(recentSessions("scout").length, 1);
  assert.equal(recentSessions("scribe").length, 0);
  const block = continuityBlock("scout");
  assert.match(block, /Find the release date/);
  assert.match(block, /March 3/);
});

test("sessions: a prompt's digest is of the run's own project, never another's", async () => {
  const { withExpedition } = await import("../src/context.ts");
  const record = (project: string | undefined, task: string) => withExpedition({ project }, async () => { recordSession("warden", { source: "brief", task, result: `Done: ${task}`, status: "done", messages: [] }); });
  await record(undefined, "An old review from before projects");
  await record("alpha", "Review the alpha importer");
  for (let i = 1; i <= 9; i++) await record("beta", `Review beta change ${i}`);
  // Nine newer sessions in another project don't push this project's out of its digest, or get into it.
  const alpha = await withExpedition({ project: "alpha" }, async () => continuityBlock("warden"));
  assert.match(alpha, /Review the alpha importer/);
  assert.match(alpha, /An old review from before projects/, "a session recorded with no project is anyone's to look back on");
  assert.doesNotMatch(alpha, /Review beta change/);
  const beta = await withExpedition({ project: "beta" }, async () => continuityBlock("warden"));
  assert.match(beta, /Review beta change 9/);
  assert.doesNotMatch(beta, /alpha importer/);
  assert.equal(beta.match(/Review beta change \d"/g)?.length, 8, "the newest eight");
  // Somewhere the agent has never worked: nothing to build on here, and it's told that's what it is.
  await withExpedition({ project: "alpha" }, async () => { recordSession("scribe", { source: "brief", task: "Write the alpha notes", result: "Written.", status: "done", messages: [] }); });
  const fresh = await withExpedition({ project: "gamma" }, async () => continuityBlock("scribe"));
  assert.doesNotMatch(fresh, /alpha notes/);
  assert.match(fresh, /\(none yet in this project\)/);
});

test("transcripts: readable from the agent's own folder only, with image data left out", () => {
  const file = recordSession("scribe", {
    source: "direct", task: "Describe this", result: "A dot.", status: "done",
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA".repeat(1000) } }, { type: "text", text: "Describe this" }] }],
  });
  const s = readSession("scribe", file);
  assert.equal(s.result, "A dot.");
  assert.equal(s.messages[0].content[0].source.data, "[omitted]");
  assert.equal(readSession("scout", file), null, "another agent's page can't read it");
  assert.equal(readSession("scribe", "../../package.json"), null);
});

test("memory edits and the outputs list", async () => {
  writeMemory("scout", "- 2026-11-09 Prefers primary sources.");
  assert.match(readMemory("scout"), /primary sources/);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("camp/agents/scout/outputs/notes", { recursive: true });
  writeFileSync("camp/agents/scout/outputs/notes/findings.md", "# Findings\n");
  assert.deepEqual(listOutputs("scout").map((f) => f.path), ["camp/agents/scout/outputs/notes/findings.md"]);
});

test("wiki: notes need sources; only facts-writers can write facts", async () => {
  assert.match(String(await wikiWrite(["notes"]).run!({ section: "facts", page: "x", summary: "s", content: "c" })), /can't write/);
  assert.match(String(await wikiWrite(["notes"]).run!({ section: "notes", page: "x", summary: "s", content: "c" })), /need sources/);
  await wikiWrite(["notes"]).run!({ section: "notes", page: "harness-memory", summary: "How harnesses remember", content: "Files and DBs.", sources: ["https://example.com"] });
  assert.match(wikiIndex(), /harness-memory\.md: How harnesses remember/);
});

test("skills: proposals wait for approval", async () => {
  await proposeSkill.run!({ owner: "scout", name: "narrow-searches", description: "When research is broad.", instructions: "Split it.", reason: "Budget ran out." });
  await proposeSkill.run!({ owner: "scribe", name: "bad-idea", description: "No.", instructions: "No.", reason: "Test." });
  assert.equal(pendingSkills().length, 2);
  assert.doesNotMatch(skillCatalog(), /narrow-searches/);
  assert.ok(approveSkill("scout", "narrow-searches"));
  assert.ok(rejectSkill("scribe", "bad-idea"));
  assert.match(skillCatalog(), /scout\/narrow-searches/);
  assert.doesNotMatch(readFileSync("skills/scout/narrow-searches/SKILL.md", "utf8"), /reason:/);
});

test("settings: per-agent model and effort override the defaults; budget saves", () => {
  assert.equal(resolveModel({ id: "scout", effort: "medium" }).model, "claude-sonnet-5-5");
  setAgentSettings("scout", { model: "claude-haiku-5-5", effort: "low" });
  assert.deepEqual(resolveModel({ id: "scout", effort: "medium" }), { model: "claude-haiku-5-5", effort: "low" });
  setAgentSettings("scout", { model: null, effort: null });
  assert.deepEqual(agentSettings("scout"), {});
  // Turn limits: override, else the code default, else 20; kept within 5–200.
  assert.equal(resolveTurns({ id: "artificer", maxTurns: 60 }), 60);
  assert.equal(resolveTurns({ id: "scout" }), 20);
  setAgentSettings("artificer", { maxTurns: 120 });
  assert.equal(resolveTurns({ id: "artificer", maxTurns: 60 }), 120);
  setAgentSettings("artificer", { maxTurns: 5000 });
  assert.equal(agentSettings("artificer").maxTurns, 200);
  setAgentSettings("artificer", { maxTurns: null });
  assert.deepEqual(agentSettings("artificer"), {});
  setBudgetUsd(2.5);
  assert.equal(budgetUsd(), 2.5);
  setBudgetUsd(null);
  assert.equal(budgetUsd(), undefined);
});

test("schedules: parsing and when jobs are due", () => {
  assert.deepEqual(parseSchedule("every 30m"), { kind: "every", ms: 1_800_000 });
  assert.equal(parseSchedule("every 1m"), null, "nothing more often than 5 minutes");
  assert.equal(parseSchedule("daily 25:00"), null);
  const job = (schedule: string, created: string, lastRun?: string) => ({
    name: "t", schedule, task: "x", enabled: true, created: new Date(created).toISOString(), ...(lastRun ? { lastRun: new Date(lastRun).toISOString() } : {}),
  });
  assert.equal(isDue(job("daily 08:00", "2026-11-09T09:00"), new Date("2026-11-09T12:00")), false, "a new job waits for its first slot");
  assert.equal(isDue(job("daily 08:00", "2026-11-09T09:00"), new Date("2026-11-10T08:00")), true);
  assert.equal(isDue(job("weekdays 08:00", "2026-11-01T00:00", "2026-11-13T08:00"), new Date("2026-11-14T09:00")), false, "Saturday");
  assert.equal(isDue(job("weekdays 08:00", "2026-11-01T00:00", "2026-11-13T08:00"), new Date("2026-11-16T08:01")), true, "Monday");
});

test("costs: from token usage and model prices", () => {
  const u = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 };
  assert.equal(costOf("claude-sonnet-5-5", u), 2 + 1);
  assert.equal(costOf("claude-opus-5-5", u), 4 + 2);
  assert.equal(costOf("claude-haiku-4-5-20251001", u), 1 + 0.5, "dated ids use their family's price");
  assert.equal(costOf("claude-unknown-9", u), 0);
});

test("wiki: you can add a page of your own, change it, and take it away", async () => {
  const wiki = await import("../src/wiki.ts");
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const fixable = (re: RegExp) => (e: any) => e.fixable === true && re.test(e.message);
  assert.equal(wiki.pageName("  Release process (2026)! "), "release-process-2026");
  assert.equal(wiki.pageName("Ünïcode & symbols"), "unicode-symbols");
  assert.equal(wiki.pageName("???"), "");

  // A fact: yours to state, so no sources are asked for. It gets its title as a heading.
  const added = wiki.saveWikiPage({ create: true, section: "facts", title: "Release process", summary: "  How releases   go out. ", text: "Tag the commit, then deploy from main.\r\n" });
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(added, { section: "facts", path: "camp/wiki/facts/release-process.md", summary: "How releases go out.", updated: today });
  assert.equal(readFileSync(added.path, "utf8"), `---\nsummary: How releases go out.\nupdated: ${today}\n---\n\n# Release process\n\nTag the commit, then deploy from main.\n`);
  // The crew sees it in the index like any other page.
  assert.match(wikiIndex(), /camp\/wiki\/facts\/release-process\.md: How releases go out\./);
  assert.ok(wiki.wikiPages().some((p) => p.path === added.path && p.section === "facts" && p.updated === today));

  // What a new page needs, and what it can't be.
  const base = { create: true, section: "notes", title: "Vite upgrade", summary: "What changed in Vite 8.", text: "# Vite 8\n\nNotes." };
  assert.throws(() => wiki.saveWikiPage({ ...base, title: "Release process", section: "facts" }), fixable(/already a fact called release-process/));
  assert.throws(() => wiki.saveWikiPage({ ...base, title: "!!!" }), fixable(/Give the page a title/));
  assert.throws(() => wiki.saveWikiPage({ ...base, section: "secrets" }), fixable(/whether it's a fact or a note/));
  assert.throws(() => wiki.saveWikiPage({ ...base, summary: "  " }), fixable(/one-line summary/));
  assert.throws(() => wiki.saveWikiPage({ ...base, text: "\n \n" }), fixable(/Write something/));
  assert.throws(() => wiki.saveWikiPage({ ...base, text: "x".repeat(100_001) }), fixable(/split it into pages/));
  assert.equal(existsSync("camp/wiki/notes/vite-upgrade.md"), false, "a refused page isn't written");
  // A title is only ever a name: one that looks like a path becomes a plain file in the wiki.
  assert.equal(wiki.saveWikiPage({ ...base, title: "../../../etc/passwd" }).path, "camp/wiki/notes/etc-passwd.md");
  wiki.removeWikiPage("camp/wiki/notes/etc-passwd.md");
  // A note of your own; a heading you wrote yourself is kept as the page's title.
  const note = wiki.saveWikiPage(base);
  assert.equal(note.path, "camp/wiki/notes/vite-upgrade.md");
  assert.equal(readFileSync(note.path, "utf8"), `---\nsummary: What changed in Vite 8.\nupdated: ${today}\n---\n\n# Vite 8\n\nNotes.\n`);

  // Changing a page: its summary and text; its name and kind stay.
  const changed = wiki.saveWikiPage({ path: added.path, summary: "How releases go out, and who signs off.", text: "# Release process\n\nTag, get sign-off, then deploy." });
  assert.equal(changed.path, added.path);
  assert.match(readFileSync(added.path, "utf8"), /^---\nsummary: How releases go out, and who signs off\.\n[\s\S]*get sign-off, then deploy\.\n$/);
  // Only pages of the wiki, by the path the list gave.
  mkdirSync("camp/agents/scout", { recursive: true });
  writeFileSync("camp/settings-copy.md", "x");
  for (const bad of ["camp/settings-copy.md", "camp/wiki/facts/../../settings-copy.md", "camp/wiki/facts/Release.md", "/etc/hosts", "camp/wiki/other/x.md", "camp/wiki/facts/no-such-page.md", ""]) {
    assert.throws(() => wiki.saveWikiPage({ path: bad, summary: "s", text: "t" }), fixable(/isn't a page of the wiki|isn't in the wiki any more/), bad);
    assert.throws(() => wiki.removeWikiPage(bad), fixable(/isn't a page of the wiki|isn't in the wiki any more/), bad);
  }
  assert.equal(readFileSync("camp/settings-copy.md", "utf8"), "x");

  assert.equal(wiki.removeWikiPage(note.path), true);
  assert.equal(existsSync(note.path), false);
  assert.throws(() => wiki.removeWikiPage(note.path), fixable(/isn't in the wiki any more/));
  assert.ok(!wikiIndex().includes("vite-upgrade"));
});
