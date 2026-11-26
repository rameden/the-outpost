// The debrief: when a ticket is done, the camp reads how the crew did on it from its own record
// and proposes lessons, which wait for your say. With a stand-in for the small model: no API.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("debrief");
const D = await import("../src/reports.ts");
const { createTicket, updateTicket } = await import("../src/tickets.ts");
const { addProject, fileConversation } = await import("../src/conversations.ts");
const { proposals, settleProposal } = await import("../src/keeping.ts");
const { fullMemory } = await import("../src/memory.ts");
const { setDrive, drive } = await import("../src/settings.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const project = addProject({ name: "web" });
const ticket = createTicket({ title: "Add an Open button", criteria: ["The report card has an Open button", "It's covered by a test"], project: project.id });
const idle = createTicket({ title: "Nobody worked on this", status: "done" });

let n = 0;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function turn(thread: string, when: string, task: string, more: Record<string, unknown> = {}) {
  const t = { thread, expedition: `run-${++n}`, agent: "quartermaster", direct: false, time: when, task, reply: "Done.", status: "done", ...more };
  appendFileSync("camp/threads.jsonl", JSON.stringify(t) + "\n");
  return t.expedition;
}
const quest = (expedition: string, character: string, more: Record<string, unknown> = {}) => appendFileSync("camp/quest-log.jsonl", JSON.stringify({
  time: ago(50), kind: "quest", character, expedition, project: project.id, task: "Add the button to ReportCard.tsx", result: "Added.", status: "done", model: "claude-sonnet-5-5", turns: 9, seconds: 120,
  usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.5, ...more }) + "\n");

const first = turn("open-button", ago(60), `Work on ${ticket.key}: add an Open button`, { ticket: ticket.key });
quest(first, "Artificer");
quest(first, "Artificer", { status: "out_of_turns", turns: 30, task: "Write the test for the Open button", result: "Ran out of turns." });
turn("open-button", ago(40), "Review the changes made above", { agent: "warden", aside: true, reply: 'Found one.\n```findings\n[{"title":"No test","severity":"blocker"}]\n```' });
turn("open-button", ago(30), "You forgot the test, add it");
turn("elsewhere", ago(30), "Something else entirely");
fileConversation("open-button", project.id);

test("the facts are the ticket's own work: its runs, the quests sent in them, what the review found", () => {
  const f = D.debriefFacts(D.maeSubject(ticket));
  assert.deepEqual([f.conversations, f.runs, f.asks, f.quests, f.cost, f.running], [1, 3, 2, 2, 1, false]);
  assert.match(f.facts, /Done means:\n- The report card has an Open button/);
  assert.match(f.facts, /Artificer sent \(claude-sonnet-5-5, 30 turns, 120s, \$0\.50\), ended out of turns\. Brief: Write the test/);
  assert.match(f.facts, /The review found 1 thing\(s\), 1 of them blocking/);
  assert.match(f.facts, /Run 3 \(the user asked; answered by Quartermaster\): You forgot the test, add it/);
  assert.ok(!f.facts.includes("Something else entirely"), "another conversation's work isn't this ticket's");
  assert.equal(D.debriefFacts(D.maeSubject(idle)).facts, "");
});

test("what the model says is read strictly: who a lesson is for has to be someone", () => {
  const read = D.parseDebrief('Here: {"well":["The first quest landed the button in one go."],"better":["x"],"lessons":[{"for":"Quartermaster","text":"Give a test its own quest with a larger turn limit."},{"for":"nobody","text":"This one is dropped."},{"for":"project","text":"short"}]}');
  assert.deepEqual(read, { well: ["The first quest landed the button in one go."], better: [], lessons: [{ for: "quartermaster", text: "Give a test its own quest with a larger turn limit." }] });
  assert.deepEqual(D.parseDebrief("nothing like JSON"), { well: [], better: [], lessons: [] });
});

const answer = JSON.stringify({ well: ["The button landed in the first quest."], better: ["The test was left out until the review and the user both asked for it."],
  lessons: [{ for: "quartermaster", text: "When a ticket's criteria name a test, brief it as its own step of the plan." }, { for: "project", text: "Run npm test before reporting on work in web." }] });

test("a debrief is due once the ticket is done, and what it proposes waits for your say", async () => {
  setDrive({ debrief: true });
  assert.deepEqual(D.debriefsDue(), [], "not while the ticket is still open (and never for one nobody worked on)");
  await assert.rejects(() => D.runDebrief(idle.key, async () => answer), /No work is on record/);
  updateTicket(ticket.key, { status: "done" });
  assert.deepEqual(D.debriefsDue(), [ticket.key]);
  assert.deepEqual(D.debriefsDue(new Date(Date.now() + 8 * 86_400_000)), [], "old work isn't dug up");
  setDrive({ debrief: false });
  assert.deepEqual(D.debriefsDue(), []);
  setDrive({ debrief: true });
  assert.equal(drive().debrief, true);

  let asked = "";
  const d = await D.runDebrief(ticket.key, async (_s, p) => { asked = p; return answer; });
  assert.match(asked, /Already in the notes:/);
  assert.deepEqual([d.runs, d.quests, d.well.length, d.better.length], [3, 2, 1, 1]);
  assert.deepEqual(d.proposed.map((l) => l.where), ["agent:quartermaster", `project:${project.id}`]);
  assert.deepEqual(D.readDebrief(ticket.key)?.proposed, d.proposed);
  assert.equal(D.readDebrief("../settings"), null);
  assert.deepEqual(D.debriefsDue(), [], "one per ticket");

  const waiting = proposals().filter((p) => p.kind === "keep");
  assert.equal(waiting.length, 2);
  assert.ok(!fullMemory("quartermaster").includes("its own step of the plan"), "nothing is kept until you approve it");
  settleProposal(waiting.find((p) => p.where === "agent:quartermaster")!.id, "approve");
  assert.ok(fullMemory("quartermaster").includes("its own step of the plan"), "approved, it's in the Quartermaster's memory for the next ticket");
  assert.deepEqual((await D.runDebrief(ticket.key, async () => answer)).proposed, [], "what's kept or already waiting isn't proposed again");
});

test("work that's still running isn't debriefed", async () => {
  const busy = createTicket({ title: "Still going", status: "done" });
  turn("still-going", ago(5), `Work on ${busy.key}`, { ticket: busy.key, status: "running", reply: "" });
  assert.deepEqual(D.debriefsDue(), []);
  await assert.rejects(() => D.runDebrief(busy.key, async () => answer), /still running/);
});

test("a Jira ticket is debriefed once its pull request merges, read from Jira for what done meant", async () => {
  const run = turn("mp-544", ago(20), "Work on MP-544: Open button on file citations", { jira: "MP-544" });
  quest(run, "Artificer");
  fileConversation("mp-544", project.id);
  const pr = (state: string) => writeFileSync("camp/prwatch.json", JSON.stringify({ prs: { "mp-544": { conversation: "mp-544", link: "web", path: ".", branch: "MP-544-open", number: 12, url: "https://github.com/acme/web/pull/12",
    title: "Open button", state, failing: 0, pending: 0, comments: 0, review: null, conflicts: false, checked: ago(1) } } }));
  assert.equal(D.workedOn("MP-544"), true);
  assert.equal(D.workedOn("MP-999"), false);
  pr("OPEN");
  assert.deepEqual(D.debriefsDue(), [], "not while its pull request is open");
  pr("MERGED");
  assert.deepEqual(D.debriefsDue(), ["MP-544"]);

  let asked = "";
  const d = await D.runDebrief("MP-544", async (_s, p) => { asked = p; return answer; }, async () => ({ summary: "Open button on file citations", criteria: ["It opens the cited file"] }));
  assert.match(asked, /Done means:\n- It opens the cited file/);
  assert.deepEqual([d.source, d.title, d.project, d.runs, d.quests], ["jira", "Open button on file citations", project.id, 1, 1]);
  assert.equal(D.readDebrief("MP-544")?.source, "jira");
  assert.deepEqual(D.debriefsDue(), [], "one per ticket");
  // Jira out of reach: the conversation's own title stands in, and the debrief still gets written.
  const blind = await D.runDebrief("MP-544", async () => answer, async () => { throw new Error("Jira is down"); });
  assert.match(blind.title, /MP-544/);
  await assert.rejects(() => D.runDebrief("MP-999", async () => answer, async () => ({ summary: "x", criteria: [] })), /No work is on record/);
});
