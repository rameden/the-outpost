// Feedback on finished work: it's recorded, the agent that answered sees it in its next prompts
// (only where it applies), and a note you keep becomes a standing note straight away.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi } from "./helpers/fake-api.ts";

enterSandbox("feedback");
let script: (body: any) => any = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url;
process.env.CAMP_APPROVE_PLANS = "0";

const { recordTurn } = await import("../src/threads.ts");
const c = await import("../src/conversations.ts");
const fb = await import("../src/feedback.ts");
const { readMemory } = await import("../src/memory.ts");
const { projectNotes } = await import("../src/projects.ts");
const { runExpedition, runDirect } = await import("../src/quartermaster.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

const turn = (id: string, task: string, more: object = {}) =>
  recordTurn({ thread: id, expedition: id, agent: "quartermaster", direct: false, task, reply: "Done.", status: "done", ...more });
const events: any[] = [];
onEvent((e) => { if (e.type === "feedback") events.push(e); });

test("a thumb is recorded, and changing your mind replaces it", () => {
  turn("r1", "Summarize the wiki");
  const f = fb.giveFeedback("r1", { rating: "up" });
  assert.deepEqual([f.rating, f.agent, f.project, f.note, f.kept], ["up", "quartermaster", undefined, undefined, undefined]);
  fb.giveFeedback("r1", { rating: "down" });
  assert.equal(fb.allFeedback().length, 1, "one rating per run");
  assert.equal(fb.feedbackFor("r1")!.rating, "down");
  assert.deepEqual(events.map((e) => [e.id, e.rating]), [["r1", "up"], ["r1", "down"]], "the page hears about each");
  assert.throws(() => fb.giveFeedback("r1", { rating: "meh" }), /thumbs up or a thumbs down/);
  assert.throws(() => fb.giveFeedback("nope", { rating: "up" }), /isn't on record/);
  recordTurn({ thread: "busy", expedition: "busy", agent: "quartermaster", direct: false, task: "Long job", reply: "", status: "running" });
  assert.throws(() => fb.giveFeedback("busy", { rating: "up" }), /still running/);
});

test("a kept note becomes a standing note: the answerer's memory, or the project's notes", () => {
  turn("r2", "Plan the release");
  const general = fb.giveFeedback("r2", { rating: "down", note: "  Too many quests.\nBatch the small ones.  ", keep: true });
  assert.equal(general.kept, "the Quartermaster's memory");
  assert.match(readMemory("quartermaster"), /- \d{4}-\d\d-\d\d Feedback from the user \(do this differently\): Too many quests\. Batch the small ones\./);

  const p = c.addProject({ name: "Shed" });
  turn("r3", "Price the lumber");
  c.fileConversation("r3", p.id);
  const inProject = fb.giveFeedback("r3", { rating: "up", note: "Metric units, as asked.", keep: true });
  assert.deepEqual([inProject.project, inProject.kept], [p.id, "Shed's notes"]);
  assert.match(projectNotes(p.id), /Feedback from the user \(this worked well\): Metric units, as asked\./);
  assert.doesNotMatch(readMemory("quartermaster"), /Metric units/, "a project's feedback stays with the project");

  // Changing only the thumb doesn't save the note a second time, and it stays marked as kept.
  const again = fb.giveFeedback("r3", { rating: "down", note: "Metric units, as asked." });
  assert.equal(again.kept, "Shed's notes");
  assert.equal(projectNotes(p.id).match(/Metric units/g)!.length, 1);

  // A direct chat's feedback goes to whoever answered.
  recordTurn({ thread: "r4", expedition: "r4", agent: "scout", direct: true, task: "What's new?", reply: "Three things.", status: "done" });
  assert.equal(fb.giveFeedback("r4", { rating: "down", note: "Cite primary sources only.", keep: true }).kept, "the Scout's memory");
  assert.match(readMemory("scout"), /Cite primary sources only\./);
});

test("the answerer sees its recent feedback in its next prompt, only where it applies", async () => {
  const p = c.history().projects.find((x) => x.name === "Shed")!;
  turn("r5", "Draft the status update");
  fb.giveFeedback("r5", { rating: "down", note: "Lead with the decision I need to make." }); // not kept: it rides along in the recent list
  turn("r6", "Tidy the notes");
  fb.giveFeedback("r6", { rating: "down" });

  const general = fb.feedbackBlock("quartermaster", undefined);
  assert.match(general, /^## The user's feedback on your recent work\nOf your last 4 rated answers: 0 👍, 4 👎\./);
  assert.match(general, /👎 on "Draft the status update": Lead with the decision I need to make\./);
  assert.match(general, /👎 on "Tidy the notes" \(no note:/);
  assert.doesNotMatch(general, /Too many quests/, "a kept note is already in memory: it isn't repeated here");
  assert.doesNotMatch(general, /Price the lumber|Metric units/, "another project's feedback isn't shown outside it");
  assert.match(general, /Notes the user chose to keep are in your memory/);
  assert.match(fb.feedbackBlock("quartermaster", p.id), /Of your last 5 rated answers \(here and in general\)/);
  assert.equal(fb.feedbackBlock("scribe", undefined), "", "nothing said about the Scribe");
  assert.doesNotMatch(fb.feedbackBlock("scout", undefined), /status update/, "each agent sees feedback on its own answers");

  // And it really is in the prompt of the next run.
  let system = "";
  script = (b) => { system = b.system.map((x: any) => x.text).join("\n\n"); return { text: "Here's the update." }; };
  await runExpedition("Write this week's update", { id: "r7" });
  assert.match(system, /## The user's feedback on your recent work[\s\S]*Lead with the decision I need to make\./);
  assert.match(system, /Feedback from the user \(do this differently\): Too many quests/, "the kept note, from memory");
  await runDirect("scribe", "Polish it", "direct", undefined, undefined, "r8");
  assert.doesNotMatch(system, /The user's feedback on your recent work/);
});

test("a rating shows up when a conversation is read back from history", () => {
  const events = c.conversationEvents("r5", fb.feedbackFor);
  assert.deepEqual(events.map((e) => e.type), ["expedition_start", "text", "expedition_end", "feedback"]);
  assert.deepEqual([(events[3] as any).rating, (events[3] as any).note], ["down", "Lead with the decision I need to make."]);
});
