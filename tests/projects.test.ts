// Projects decide what the crew sees: a run in a project reaches that project's folders and no
// others, starts with what the project's page says (your description, the survey, the crew's own
// notes, pinned files), and follows the project's defaults. Runs are tagged with their project.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, whoAsks } from "./helpers/fake-api.ts";

enterSandbox("projects");
const api = await startFakeApi((body) => script(body));
let script: (body: any) => any = () => ({ text: "ok" });
process.env.ANTHROPIC_BASE_URL = api.url;
process.env.CAMP_APPROVE_PLANS = "0";

const mk = (name: string, files: Record<string, string>) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `satchel-${name}-`)));
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), text); }
  return dir;
};
const work = mk("work", { "AGENTS.md": "WORK RULES: use pnpm.\n", "src/app.ts": "export const app = 1;\n", "docs/arch.md": "# Architecture\nThree services.\n" });
const home = mk("home", { "AGENTS.md": "HOME RULES: metric units.\n", "plan.md": "Fix the shed.\n" });

const { addLink, linksBlock, projectInstructions } = await import("../src/links.ts");
const { withExpedition } = await import("../src/context.ts");
const c = await import("../src/conversations.ts");
const p = await import("../src/projects.ts");
const { readFileFor, bashFor, rl } = await import("../src/tools.ts");
const { grepFor } = await import("../src/codetools.ts");
const { isAutoApproved, approvalNow } = await import("../src/shell.ts");
const { runExpedition, runDirect, placeOf } = await import("../src/quartermaster.ts");
const { recentQuests } = await import("../src/questlog.ts");
const { threadFor, recordTurn } = await import("../src/threads.ts");
const { setBudgetUsd, setAutoTitles } = await import("../src/settings.ts");
const { cleanTitle } = await import("../src/titles.ts");
const { scheduleJob, loadJobs } = await import("../src/jobs.ts");
const { setAsker } = await import("../src/ask.ts");
after(async () => { rl.close(); await api.close(); });
setAsker(async () => "y");

const W = addLink(work, "write").name, H = addLink(home, "read").name;
const projects = () => c.history().projects;
const workP = () => projects().find((x) => x.links?.includes(W))!;
const homeP = () => projects().find((x) => x.links?.includes(H))!;
const read = (path: string) => readFileFor("scout").run!({ path }).then(String);

test("a run in a project reaches that project's folders and no others", async () => {
  await withExpedition({ id: "e1", project: workP().id, scope: [W] }, async () => {
    assert.match(await read(`links/${W}/src/app.ts`), /export const app/);
    await assert.rejects(() => read(`links/${H}/plan.md`), /isn't part of this conversation: it belongs to another project/);
    assert.match(await grepFor("scout").run!({ pattern: "shed", path: "." }).then(String), /^No matches/);
    await assert.rejects(() => bashFor("artificer").run!({ command: "ls", cwd: `links/${H}` }) as Promise<unknown>, /isn't part of this conversation/);
    assert.match(linksBlock(), new RegExp(`links/${W}/`));
    assert.doesNotMatch(linksBlock(), new RegExp(`links/${H}/`));
    assert.match(projectInstructions(), /WORK RULES/);
    assert.doesNotMatch(projectInstructions(), /HOME RULES/, "another project's instructions aren't loaded");
  });
  // No project and nothing attached: no linked folders at all.
  await withExpedition({ id: "e2", scope: [] }, async () => {
    await assert.rejects(() => read(`links/${W}/src/app.ts`), /isn't part of this conversation/);
    assert.equal(linksBlock(), "");
    assert.doesNotMatch(projectInstructions(), /RULES/);
  });
  // The terminal camp, and jobs outside any project, still see everything.
  assert.match(await read(`links/${H}/plan.md`), /shed/);
  assert.match(projectInstructions(), /WORK RULES[\s\S]*HOME RULES/);
});

test("the project's page is in every agent's prompt there: description, survey, notes, pinned files", async () => {
  const id = workP().id;
  c.updateProject(id, { description: "The work app. Never push.", pins: [`links/${W}/docs/arch.md`, "https://example.com/api", `links/${H}/plan.md`], settings: { web: "careful" } });
  p.setProjectBrief(id, "Stack: TypeScript. Test with `pnpm test`.");
  await withExpedition({ id: "e3", project: id, scope: [W] }, async () => {
    assert.equal(await p.projectRemember.run!({ entry: "Tests   live next to\nthe code." }), `Noted for ${W}.`);
    const block = p.projectBlock("artificer");
    assert.match(block, new RegExp(`^## Project: ${W}\\n`));
    assert.match(block, /This project is confidential\. Never put its name/);
    assert.match(block, /### What the user wrote about this project[^\n]*\nThe work app\. Never push\./);
    assert.match(block, /### Survey of the project[^\n]*\nStack: TypeScript/);
    assert.match(block, /### What the crew has learned[^\n]*\n- \d{4}-\d\d-\d\d Tests live next to the code\./);
    assert.match(block, new RegExp(`### links/${W}/docs/arch\\.md\\n# Architecture\\nThree services\\.`), "a pinned file is shown in full");
    assert.match(block, /### Pinned links[^\n]*\n- https:\/\/example\.com\/api/);
    assert.match(block, new RegExp(`### links/${H}/plan\\.md\\n\\(couldn't be read:[^)]*isn't part of this conversation`), "a pin can't reach outside the project");
    assert.match(String(await p.projectRemember.run!({ entry: "# Survey\nNew.", mode: "brief" })), /Saved the survey/);
  });
  assert.equal(p.projectBrief(id), "# Survey\nNew.");
  await withExpedition({ id: "e4", project: homeP().id, scope: [H] }, async () => {
    assert.doesNotMatch(p.projectBlock("scout"), /Tests live next to the code|Never push/, "one project's notes never show up in another");
  });
  await withExpedition({ id: "e5", scope: [] }, async () => {
    assert.match(String(await p.projectRemember.run!({ entry: "x" })), /isn't filed under a project/);
  });
});

test("a project's defaults: web off, its own models, budget, and approval level", async () => {
  const id = homeP().id;
  c.updateProject(id, { settings: { web: "off", budgetUsd: 0.75, approval: "ask", agents: { scout: { model: "claude-haiku-5-5", effort: "low" }, nobody: { model: "x" } }, bogus: 1 } });
  assert.deepEqual(c.getProject(id)!.settings, { web: "off", budgetUsd: 0.75, approval: "ask", agents: { scout: { model: "claude-haiku-5-5", effort: "low" } } }, "only what's valid is kept");
  setBudgetUsd(5);
  let seen: any = null;
  script = (b) => { seen = b; return { text: "Looked." }; };
  const r = await runDirect("scout", "What needs doing?", "direct", undefined, undefined, "run-home", undefined, { project: id, links: [] });
  assert.equal(r?.model, "claude-haiku-5-5");
  assert.equal(r?.effort, "low");
  const tools = seen.tools.map((t: any) => t.name);
  assert.ok(!tools.includes("web_search") && !tools.includes("web_fetch"), "no web tools in this project");
  assert.ok(tools.includes("project_remember"));
  assert.match(seen.system[0].text, /## Project: [^\n]+\n[\s\S]*Web search and fetch are turned off for this project/);
  assert.match(seen.system[0].text, /HOME RULES/);
  assert.doesNotMatch(seen.system[0].text, /WORK RULES/);
  // The same Scout, outside the project, is back on its usual model with the web.
  const out = await runDirect("scout", "And in general?", "direct", undefined, undefined, "run-general", undefined, { links: [] });
  assert.notEqual(out?.model, "claude-haiku-5-5");
  assert.ok(seen.tools.some((t: any) => t.name === "web_search"));
  assert.ok(!seen.tools.some((t: any) => t.name === "project_remember"));

  await withExpedition({ id: "e6", project: id, scope: [H] }, async () => {
    assert.equal(approvalNow(), "ask");
    assert.ok(!isAutoApproved("ls"), "this project asks about every command");
  });
  assert.equal(approvalNow(), "safe");
  assert.ok(isAutoApproved("ls"));
  setBudgetUsd(null);
});

test("runs, conversations, and jobs carry their project; a follow-up keeps what was attached", async () => {
  const id = workP().id;
  script = (b) => (whoAsks(b) === "Quartermaster" ? { text: "Done." } : { text: "ok" });
  await runExpedition("Tidy the readme", { id: "run-work", project: id, links: [H] });
  const q = recentQuests(1)[0];
  assert.equal(q.project, id);
  assert.equal(recentQuests(10).find((x) => x.task.includes("in general"))?.project, undefined, "General isn't a project tag");
  assert.deepEqual(threadFor("run-work")!.links, [H], "the folder attached in the first message stays attached");

  await withExpedition({ id: "e7", project: id, scope: [W] }, async () => {
    assert.match(String(await scheduleJob.run!({ name: "nightly-check", schedule: "daily 08:00", task: "Check the build." })), /^Scheduled/);
  });
  assert.equal(loadJobs().find((j) => j.name === "nightly-check")!.project, id);

  c.fileConversation("run-work", id);
  const page = p.projectPage(id)!;
  assert.equal(page.usage.runs, 1);
  assert.deepEqual(page.jobs.map((j) => j.name), ["nightly-check"]);
  assert.match(page.notes, /Tests live next to the code/);
  assert.equal(p.projectPage("nope"), null);
});

test("history: pinned projects first, a filing suggestion, search inside conversations, titles", () => {
  const mine = c.addProject({ name: "Zeta", pinned: true });
  assert.deepEqual(projects().map((x) => x.name).slice(0, 2), ["General", "Zeta"]);
  c.updateProject(mine.id, { pinned: false });
  assert.notEqual(projects()[1].name, "Zeta");

  // In General, but it used the home project's folder: suggest moving it there.
  recordTurn({ thread: "g1", expedition: "g1", agent: "quartermaster", direct: false, task: "What's in the shed plan?", reply: "It says to fix the roof first.", status: "done", links: [H] });
  recordTurn({ thread: "g2", expedition: "g2", agent: "quartermaster", direct: false, task: "Unrelated question", reply: "An answer about gardening tools.", status: "done" });
  const h = c.history();
  assert.equal(h.conversations.find((x) => x.id === "g1")!.suggest, homeP().id);
  assert.equal(h.conversations.find((x) => x.id === "g2")!.suggest, undefined);

  assert.deepEqual(c.searchConversations("roof first").map((r) => r.id), ["g1"], "found in an answer, not just a title");
  assert.match(c.searchConversations("gardening")[0].snippet, /An answer about gardening tools\./);
  assert.deepEqual(c.searchConversations("x"), [], "one letter isn't a search");

  assert.equal(cleanTitle('"Shed roof repair plan."\nMore text'), "Shed roof repair plan");
  assert.equal(cleanTitle("Here is a very long reply that is clearly not a title at all, sorry"), "");
  assert.ok(c.autoTitle("g1", "Shed roof repair plan"));
  assert.equal(c.history().conversations.find((x) => x.id === "g1")!.title, "Shed roof repair plan");
  c.renameConversation("g2", "My own name");
  assert.ok(!c.autoTitle("g2", "A model's idea"), "a title you gave is never replaced");
  setAutoTitles(false);
});

test("a conversation can be started without its project's folder: the crew is given nothing from it, and replies stay that way", async () => {
  const id = workP().id;
  // What a run in the project sees, with and without the folder.
  assert.deepEqual(placeOf({ project: id, links: [] }).scope, [W]);
  assert.deepEqual(placeOf({ project: id, links: [], without: [W] }).scope, []);
  assert.deepEqual(placeOf({ project: id, links: [H], without: [W] }).scope, [H], "another folder attached to it is still in");
  assert.deepEqual(placeOf({ project: id, links: [W], without: [W] }).scope, [W], "attached or mentioned after all, it's back");
  assert.equal(placeOf({}).scope, undefined, "outside mission control, nothing is scoped");

  api.seen.length = 0;
  script = () => ({ text: "Answered from what I know." });
  await runExpedition("What do you think of pnpm in general?", { id: "noctx1", project: id, links: [], without: [W] });
  const system = api.seen[0].body.system.map((x: any) => x.text).join("\n");
  assert.ok(!system.includes("WORK RULES"), "the folder's own instructions aren't loaded");
  assert.doesNotMatch(system, new RegExp(`It is about links/${W}/`));
  assert.match(system, new RegExp(`The user started this conversation without links/${W}/: nothing from it is part of this conversation\\.`));
  assert.match(system, /## Project: /, "it's still that project's conversation: its notes and description apply");
  // The crew can't reach into it either.
  await withExpedition({ id: "noctx-read", project: id, scope: placeOf({ project: id, links: [], without: [W] }).scope }, async () => {
    await assert.rejects(() => read(`links/${W}/src/app.ts`), /isn't part of this conversation/);
    assert.doesNotMatch(linksBlock(), new RegExp(`links/${W}/`));
    assert.equal(projectInstructions(), "");
  });

  // It's remembered with the conversation: a reply is started the same way, and the list of conversations says so.
  assert.deepEqual(threadFor("noctx1")!.without, [W]);
  assert.deepEqual(c.history().conversations.find((x) => x.id === "noctx1")!.without, [W]);
  // Mentioned in a later message, it's part of the conversation from then on.
  recordTurn({ thread: "noctx1", expedition: "noctx2", agent: "quartermaster", direct: false, task: `Look at links/${W}/src/app.ts after all`, reply: "Done.", status: "done", links: [W], without: [W] });
  assert.equal(c.history().conversations.find((x) => x.id === "noctx1")!.without, undefined);
  assert.deepEqual(placeOf({ project: id, links: threadFor("noctx2")!.links, without: threadFor("noctx2")!.without }).scope, [W]);
  // A conversation started the usual way has the folder, as before.
  api.seen.length = 0;
  await runExpedition("And with the project's folder?", { id: "ctx1", project: id, links: [] });
  assert.ok(api.seen[0].body.system.map((x: any) => x.text).join("\n").includes("WORK RULES"));
  assert.equal(threadFor("ctx1")!.without?.length, 0);
});
