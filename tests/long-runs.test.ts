// Long runs: a transcript saved every turn and restored when the task is picked up again, a
// transcript that's compacted before it outgrows the model's context, and tool output too long to
// show that goes to a file instead of being cut.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, type Reply } from "./helpers/fake-api.ts";

enterSandbox("long-runs");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

const { runAgent, setRetryWaitsForTests, setContextForTests } = await import("../src/agent.ts");
const { withExpedition } = await import("../src/context.ts");
const { onEvent } = await import("../src/events.ts");
const { OpJournal } = await import("../src/oplog.ts");
const { RunStore, RUNS_DIR, resumeMessages, transcriptText, pruneRuns, RESTORED_NOTE } = await import("../src/runstore.ts");
const { compact, pruneToolResults, tailStart, keptPairs, fallbackSummary, validSummary, SECTIONS, SUMMARY_MARK, CLEARED, SUMMARY_SYSTEM } = await import("../src/compaction.ts");
const { spillOutput, pruneSpill, SPILL_DIR } = await import("../src/spill.ts");
const { campPath, clipOutput, MAX_TOOL_OUTPUT, rl } = await import("../src/tools.ts");
const settings = await import("../src/settings.ts");
after(async () => { rl.close(); await api.close(); });

const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; script = () => ({ text: "ok" }); setRetryWaitsForTests([]); setContextForTests(null); });
const notices = () => events.filter((e) => e.type === "notice").map((e) => e.text).join("\n");

// ---------- A transcript to cut up ----------
const use = (id: string, name: string, input: any = {}) => ({ type: "tool_use" as const, id, name, input });
const result = (id: string, content: string, more: any = {}) => ({ type: "tool_result" as const, tool_use_id: id, content, ...more });
// The task, then `n` rounds of (the assistant calls a tool, the result comes back).
function transcript(n: number, o: { size?: number; special?: Record<number, string> } = {}): any[] {
  const out: any[] = [{ role: "user", content: "Port the billing module to the new API." }];
  for (let i = 1; i <= n; i++) {
    const name = o.special?.[i] ?? "read_file";
    out.push({ role: "assistant", content: [{ type: "text", text: `Step ${i}.` }, use(`t${i}`, name, { path: `src/file${i}.ts` })] });
    out.push({ role: "user", content: [result(`t${i}`, `${name} output ${i} ` + "x".repeat(o.size ?? 2_000))] });
  }
  return out;
}
// What the API insists on: roles take turns from the user, and every result answers a call in the message before it (and the other way round).
function assertWellFormed(messages: any[], what = "the transcript") {
  assert.equal(messages[0].role, "user", `${what} starts with the user`);
  for (let i = 1; i < messages.length; i++) assert.notEqual(messages[i].role, messages[i - 1].role, `${what}: roles take turns at ${i}`);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!Array.isArray(m.content)) continue;
    if (m.role === "assistant") {
      const ids = m.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id);
      if (!ids.length) continue;
      const answers = new Set((messages[i + 1]?.content ?? []).filter?.((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id));
      for (const id of ids) assert.ok(answers.has(id), `${what}: call ${id} has its result in the next message`);
    } else {
      const called = new Set((Array.isArray(messages[i - 1]?.content) ? messages[i - 1].content : []).filter((b: any) => b.type === "tool_use").map((b: any) => b.id));
      for (const b of m.content) if (b.type === "tool_result") assert.ok(called.has(b.tool_use_id), `${what}: result ${b.tool_use_id} answers a call in the message before`);
    }
  }
}
const SUMMARY = SECTIONS.map((h) => `## ${h}\n${h === "Progress" ? "### Done\n- read files 1 to 6\n### In progress\n- file 7\n### Blocked\nNone." : `about ${h.toLowerCase()}`}`).join("\n\n");

// ---------- Compaction: the pure parts ----------
test("old tool results are cleared without a model, but never the newest ones, nor what submit_plan and remember said", () => {
  const list = transcript(12, { special: { 2: "submit_plan", 3: "remember" } });
  const { messages, cleared } = pruneToolResults(list, { keep: 4 });
  assert.equal(cleared, 6, "12 results, less the 4 newest, less the plan and the memory");
  const text = (i: number) => (messages[i * 2].content[0] as any).content as string;
  assert.ok(text(1).startsWith(CLEARED) && /read_file returned [\d,]+ characters/.test(text(1)));
  assert.match(text(2), /^submit_plan output 2/);
  assert.match(text(3), /^remember output 3/);
  for (const i of [9, 10, 11, 12]) assert.match(text(i), /^read_file output/, "the newest stay whole");
  assert.equal(messages[1], list[1], "a message that didn't change is the same object");
  assert.equal(list[2].content[0].content.length > 1_000, true, "the original isn't touched");
  assertWellFormed(messages);
  // A second pass has nothing left to clear.
  assert.equal(pruneToolResults(messages, { keep: 4 }).cleared, 0);
  assert.equal(pruneToolResults(transcript(3), { keep: 8 }).cleared, 0);
});

test("the cut never falls between a call and its result, whatever the room for the tail", () => {
  const list = transcript(14);
  for (const room of [50, 400, 700, 1_500, 3_000, 6_000]) {
    const at = tailStart(list, room);
    if (at == null) continue;
    assert.equal(list[at].role, "assistant", `room ${room}: the tail starts at an assistant message`);
    assert.ok(at >= 3 && list.length - at >= 4);
    assertWellFormed([list[0], ...list.slice(at)], `tail from ${at}`);
  }
  assert.equal(tailStart(transcript(2), 100), null, "too short to have a middle");
  assert.equal(tailStart(list, 10_000_000), null, "everything fits in the tail: nothing to summarise");
});

test("the middle becomes a summary in fixed sections; the task, the latest turns, the plan and what was remembered stay", async () => {
  const list = transcript(14, { special: { 2: "submit_plan", 4: "remember" } });
  let asked: { system: string; prompt: string } | null = null;
  const done = await compact(list, { limit: 3_000, keepResults: 3, summarise: async (system, prompt) => { asked = { system, prompt }; return SUMMARY; } });
  assert.ok(done && done.summarised > 0 && !done.fallback);
  assert.ok(done.after < done.before / 2, `smaller: ${done.before} → ${done.after}`);
  assertWellFormed(done.messages, "after compaction");
  const head = done.messages[0].content as any[];
  assert.equal(head[0].text, "Port the billing module to the new API.", "the task, word for word");
  assert.ok(head[1].text.startsWith(SUMMARY_MARK) && validSummary(head[1].text));
  const calls = done.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "tool_use").map((b: any) => b.name);
  assert.deepEqual(calls.slice(0, 2), ["submit_plan", "remember"], "kept as calls, each with its result");
  const results = done.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "tool_result");
  assert.match(results[0].content, /^submit_plan output 2/);
  assert.match(results[1].content, /^remember output 4/);
  assert.deepEqual(done.messages.at(-1), list.at(-1), "the latest turn is untouched");
  assert.equal(asked!.system, SUMMARY_SYSTEM);
  assert.match(asked!.prompt, /# Notes so far\nNone yet\./);
  assert.match(asked!.prompt, /CALL read_file: \{"path":"src\/file3\.ts"\}/);

  // A later compaction updates the notes it has instead of starting again.
  const longer = [...done.messages];
  for (let i = 20; i < 32; i++) longer.push({ role: "assistant", content: [use(`t${i}`, "bash", { command: `step ${i}` })] }, { role: "user", content: [result(`t${i}`, "y".repeat(2_000))] });
  const again = await compact(longer, { limit: 3_000, keepResults: 3, summarise: async (_s, prompt) => { asked = { system: "", prompt }; return SUMMARY.replace("file 7", "file 9"); } });
  assert.ok(again && again.summarised > 0);
  assert.match(asked!.prompt, /# Notes so far\n## Goal\nabout goal/, "the earlier summary is handed over to be updated");
  const head2 = again.messages[0].content as any[];
  assert.equal(head2.length, 2, "one task, one summary: the old summary is replaced, not stacked");
  assert.match(head2[1].text, /file 9/);
  assert.equal(again.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "tool_use" && b.name === "submit_plan").length, 1, "the plan is still there");
  assertWellFormed(again.messages, "after the second compaction");
});

test("clearing tool results is enough when it makes room: no summary is asked for", async () => {
  let asked = 0;
  const done = await compact(transcript(14), { limit: 6_000, keepResults: 2, summarise: async () => { asked++; return SUMMARY; } });
  assert.ok(done && done.pruned > 0 && done.summarised === 0);
  assert.equal(asked, 0);
  assert.equal(done.messages.length, 29, "every message is still there");
  assert.equal(await compact(transcript(2), { limit: 1_000_000, summarise: async () => SUMMARY }), null, "nothing to do");
});

test("a summariser that fails, stalls or writes something else: the summary is put together from the transcript", async () => {
  const list = transcript(14).map((m, i) => (i === 6 ? { ...m, content: [result("t3", "ENOENT: no such file", { is_error: true })] } : m));
  for (const [why, summarise] of [
    ["fails", async () => { throw new Error("no key"); }],
    ["stalls", () => new Promise<string>(() => {})],
    ["writes something else", async () => "Sure! Here's what happened: lots."],
  ] as const) {
    const done = await compact(list, { limit: 600, summarise: summarise as any, timeoutMs: 40 });
    assert.ok(done?.fallback, why);
    const text = (done.messages[0].content as any[])[1].text as string;
    assert.ok(validSummary(text), `${why}: the same sections`);
    assert.match(text, /read_file \{"path":"src\/file2\.ts"\}/);
    assert.match(text, /src\/file2\.ts/);
    assert.match(text, /### Blocked\n- read_file: ENOENT/);
    assertWellFormed(done.messages, why);
  }
  assert.ok(validSummary(fallbackSummary("the task", "## Goal\nold notes", [])));
  assert.equal(validSummary("## Goal\nonly this"), false);
  assert.deepEqual(keptPairs(transcript(3).slice(1)), []);
});

// ---------- Spillover ----------
test("tool output over the cap goes to a file: the model gets its start, its end and the path", () => {
  const big = "HEAD-" + "a".repeat(MAX_TOOL_OUTPUT) + "\nline two\n-TAIL";
  const out = spillOutput(big, "scribe");
  assert.ok(out.length < 12_000, "a preview, not the lot");
  assert.ok(out.startsWith("HEAD-") && out.includes("-TAIL"));
  const path = out.match(/saved at (camp\/spill\/scribe__[\w-]+\.txt)/)?.[1];
  assert.ok(path, out.slice(-300));
  assert.equal(readFileSync(path!, "utf8"), big, "all of it is in the file");
  assert.match(out, /read_file/);
  assert.equal(spillOutput("short", "scribe"), "short");
  // Text inside a block list is spilled the same way; pictures pass through.
  const blocks = spillOutput([{ type: "text", text: big }, { type: "text", text: "small" }] as any, "scribe") as any[];
  assert.match(blocks[0].text, /saved at camp\/spill\//);
  assert.equal(blocks[1].text, "small");
  // The agent it was set aside for can open it; another can't; nobody writes there.
  assert.ok(campPath(path!, "read", "scribe"));
  assert.throws(() => campPath(path!, "read", "scout"), /another .* tool output/);
  assert.throws(() => campPath(path!, "write", "scribe"));
  // clipOutput itself is as it was, for the tools that still cut.
  assert.match(clipOutput(big), /\[cut at/);
});

test("spill files and saved transcripts nobody came back for are removed after a week", () => {
  mkdirSync(SPILL_DIR, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
  const old = new Date(Date.now() - 8 * 86_400_000);
  for (const dir of [SPILL_DIR, RUNS_DIR]) {
    writeFileSync(`${dir}/old.txt`, "old");
    utimesSync(`${dir}/old.txt`, old, old);
    writeFileSync(`${dir}/new.txt`, "new");
  }
  assert.equal(pruneSpill().files >= 1, true);
  assert.equal(pruneRuns().files, 1);
  for (const dir of [SPILL_DIR, RUNS_DIR]) assert.deepEqual([existsSync(`${dir}/old.txt`), existsSync(`${dir}/new.txt`)], [false, true]);
  assert.throws(() => campPath("camp/runs/new.txt", "read", "scribe"), /off limits/);
});

// ---------- The saved transcript ----------
test("a restored transcript is made whole: a call that never got its result is answered, and the new message goes on the end", () => {
  const saved = transcript(2);
  // Broke off while two calls were under way: one result had come back, the other hadn't.
  const mid = [...saved, { role: "assistant", content: [use("a", "bash", { command: "make" }), use("b", "bash", { command: "deploy" })] }];
  const a = resumeMessages(mid, "carry on");
  assertWellFormed(a);
  const last = a.at(-1)!.content as any[];
  assert.deepEqual(last.slice(0, 2).map((b) => [b.tool_use_id, b.is_error]), [["a", true], ["b", true]]);
  assert.match(last[0].content, /Interrupted/);
  assert.deepEqual(last.slice(2).map((b) => b.text), [RESTORED_NOTE, "carry on"]);
  // Broke off after the results were in: the new message joins them.
  const b = resumeMessages(saved, [{ type: "text", text: "carry on" }]);
  assertWellFormed(b);
  assert.equal(b.length, saved.length);
  assert.deepEqual((b.at(-1)!.content as any[]).map((x) => x.type), ["tool_result", "text", "text"]);
  // A reply with nothing called (cut off mid-thought) is dropped.
  const c = resumeMessages([...saved, { role: "assistant", content: [{ type: "text", text: "Next I'll" }] }], "carry on");
  assertWellFormed(c);
  assert.equal(c.length, saved.length);
  assert.equal(saved.length, 5, "the saved copy isn't changed");
  assert.match(transcriptText(mid), /You called read_file: \{"path":"src\/file1\.ts"\}\nResult: read_file output 1/);
});

const shellTool = (run: (input: any) => Promise<string> | string) => ({ def: { name: "bash", description: "run", input_schema: { type: "object" as const, properties: { command: { type: "string" } } } }, run: async (input: any) => run(input) });
const specWith = (tools: any[]) => ({ id: "scribe" as const, name: "Scribe", emoji: "📜", role: "test", persona: "test", tools, skillDirs: [] });
const mainRequests = () => api.seen.filter((s) => !String(s.body.system?.[0]?.text ?? s.body.system ?? "").includes("working notes"));

test("a run is saved every turn and its file is gone when it ends; one that fails leaves it, and the reply to it carries on from there", async () => {
  let ran: string[] = [];
  let savedMidRun: any = null;
  const file = `${RUNS_DIR}/t-save_scribe.json`;
  const shell = shellTool(({ command }) => { ran.push(command); savedMidRun = JSON.parse(readFileSync(file, "utf8")); return `did ${command}`; });
  let turn = 0;
  script = () => [{ tools: [{ name: "bash", input: { command: "gh issue create" } }] }, { text: "All done." }][turn++] ?? { text: "done" };
  const ok = await withExpedition({ id: "e1", thread: "t-save" }, () => runAgent(specWith([shell]) as any, "File the issue", { plain: true }));
  assert.equal(ok.status, "done");
  assert.equal(savedMidRun.run.startsWith("e1:"), true);
  assert.deepEqual(savedMidRun.messages.map((m: any) => m.role), ["user", "assistant"], "on disk before the tools ran");
  assert.equal(existsSync(file), false, "removed once the run ended on its own terms");
  assert.deepEqual(readdirSync("camp").filter((f) => f.includes(".tmp-")), []);

  // The same task again, and this time the API fails after the first step.
  ran = []; turn = 0;
  script = () => (turn++ === 0 ? { tools: [{ name: "bash", input: { command: "gh pr create" } }] } : { status: 400 });
  await assert.rejects(withExpedition({ id: "e2", thread: "t-save" }, () => runAgent(specWith([shell]) as any, "Open the pull request, then announce it", { plain: true })));
  assert.deepEqual(ran, ["gh pr create"]);
  const left = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(left.messages.map((m: any) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(left.ops.map((o: any) => o[1]), [1], "the journal's count of that call is kept with it");

  // A later message that isn't a reply to that run starts from the task alone, as before.
  api.seen.length = 0; turn = 0;
  script = () => ({ text: "Hello." });
  await withExpedition({ id: "e-other", thread: "t-save-2", replyTo: "something-else" }, () => runAgent(specWith([shell]) as any, "Hi", { plain: true }));
  assert.equal(api.seen[0].body.messages.length, 1);

  // The reply to the run that broke off: the model sees what it had done, and doesn't do it again.
  api.seen.length = 0; events.length = 0;
  script = (body) => (body.messages.at(-1).content.some?.((b: any) => b.type === "tool_result" && /announced/.test(b.content)) ? { text: "Announced." } : { tools: [{ name: "bash", input: { command: "gh pr comment --body announced" } }] });
  const shell2 = shellTool(({ command }) => { ran.push(command); return "announced"; });
  const r = await withExpedition({ id: "e3", thread: "t-save", replyTo: "e2" }, () => runAgent(specWith([shell2]) as any, "carry on", { plain: true }));
  assert.equal(r.status, "done");
  const sent = api.seen[0].body.messages;
  assertWellFormed(sent, "what the model was sent on resume");
  assert.equal(sent[0].content, "Open the pull request, then announce it");
  assert.equal(sent[1].content.find((b: any) => b.type === "tool_use").input.command, "gh pr create");
  assert.match(sent[2].content[0].content, /did gh pr create/);
  assert.deepEqual(sent[2].content.slice(1).map((b: any) => b.text), [RESTORED_NOTE, "carry on"]);
  assert.deepEqual(ran, ["gh pr create", "gh pr comment --body announced"], "the pull request wasn't opened twice");
  assert.match(notices(), /Picked up from the saved transcript/);
  assert.equal(existsSync(file), false, "and once it's done, the file goes");
});

test("a call that was under way when the run broke off is re-issued under its old id, so the journal still guards it", async () => {
  // As it was left: the transcript ends on the call, and the journal has the call as finished.
  const before = new OpJournal("t-mid:scribe", "old:-:scribe:1");
  before.begin();
  const op = before.opId("bash", { command: "gh release create v2" });
  before.started(op, "bash"); before.done(op, "bash", "release v2 published");
  before.abandon();
  const prior = new RunStore("t-mid", "scribe", "old:-:scribe:1");
  prior.save({ model: "claude-haiku-5-5", turn: 1, authorOf: () => undefined, ops: [],
    messages: [{ role: "user", content: "Cut the release" }, { role: "assistant", content: [use("tu_old", "bash", { command: "gh release create v2" })] as any }] });
  prior.abandon();

  let ran = 0, turn = 0;
  script = () => [{ tools: [{ name: "bash", input: { command: "gh release create v2" } }] }, { text: "Released." }][turn++] ?? { text: "done" };
  const r = await withExpedition({ id: "new", thread: "t-mid", replyTo: "old" }, () => runAgent(specWith([shellTool(() => { ran++; return "published again"; })]) as any, "carry on", { plain: true }));
  assert.equal(r.status, "done");
  assert.equal(ran, 0, "not run a second time");
  const first = api.seen[0].body.messages;
  assertWellFormed(first);
  assert.match(first[2].content[0].content, /Interrupted/);
  assert.match(api.seen[1].body.messages.at(-1).content[0].content, /Recorded result reused[\s\S]*release v2 published/);
});

// ---------- In the loop ----------
test("a long run is compacted before it outgrows the context: summary in, prompt layout and server-side clearing as they were", async () => {
  setContextForTests(8_000);
  let step = 0, summaries = 0;
  const reader = { def: { name: "read_file", description: "read", input_schema: { type: "object" as const, properties: { path: { type: "string" } } } }, run: async (i: any) => `contents of ${i.path} ` + "z".repeat(4_000) };
  const plan = { def: { name: "submit_plan", description: "plan", input_schema: { type: "object" as const, properties: { plan: { type: "string" } } } }, run: async () => "Plan accepted: three steps." };
  script = (body) => {
    if (String(body.system).includes("working notes")) { summaries++; return { whole: true, text: SUMMARY }; }
    step++;
    if (step === 1) return { tools: [{ name: "submit_plan", input: { plan: "three steps" } }] };
    return step <= 12 ? { tools: [{ name: "read_file", input: { path: `src/f${step}.ts` } }] } : { text: "Ported." };
  };
  const r = await withExpedition({ id: "c1", thread: "t-compact" }, () => runAgent(specWith([reader, plan]) as any, "Port the billing module", { plain: true }));
  assert.equal(r.status, "done");
  assert.ok(summaries >= 1, "the summariser was asked");
  assert.match(notices(), /🗜️ .*made smaller.*replaced by a summary/);
  const main = mainRequests();
  for (const s of main) assertWellFormed(s.body.messages, "every request");
  const sizes = main.map((s) => JSON.stringify(s.body.messages).length);
  assert.ok(Math.max(...sizes) < 8_000 * 4, `no request outgrew the context (largest ${Math.max(...sizes)} characters)`);
  const last = main.at(-1)!.body;
  assert.ok(last.messages[0].content.some((b: any) => b.type === "text" && b.text.startsWith(SUMMARY_MARK) && /## Next steps/.test(b.text)));
  assert.equal(last.messages[0].content[0].text, "Port the billing module");
  const kept = last.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
  assert.ok(kept.some((b: any) => b.type === "tool_use" && b.name === "submit_plan"), "the plan is never dropped");
  assert.ok(kept.some((b: any) => b.type === "tool_result" && /Plan accepted/.test(b.content)));
  // The cache layout and the API's own clearing are untouched.
  assert.deepEqual(last.cache_control, { type: "ephemeral" });
  assert.ok(last.system.every((b: any) => b.cache_control?.type === "ephemeral"));
  assert.deepEqual(last.system.map((b: any) => b.text), main[0].body.system.map((b: any) => b.text), "the system prompt is byte for byte what it was");
  assert.equal(last.context_management.edits[0].type, "clear_tool_uses_20250919");
  assert.deepEqual(last.context_management.edits[0].exclude_tools, ["submit_plan", "remember"]);
});

test("with the summariser down the run still goes on, on a summary of its own making; and compactAt 0 turns compaction off", async () => {
  setContextForTests(8_000);
  let step = 0;
  const reader = { def: { name: "read_file", description: "read", input_schema: { type: "object" as const, properties: { path: { type: "string" } } } }, run: async (i: any) => `contents of ${i.path} ` + "z".repeat(4_000) };
  script = (body) => {
    if (String(body.system).includes("working notes")) return { status: 400 };
    return ++step <= 12 ? { tools: [{ name: "read_file", input: { path: `src/f${step}.ts` } }] } : { text: "Ported." };
  };
  const r = await withExpedition({ id: "c2", thread: "t-compact-2" }, () => runAgent(specWith([reader]) as any, "Port the billing module", { plain: true }));
  assert.equal(r.status, "done");
  assert.match(notices(), /put together without a model/);
  const head = mainRequests().at(-1)!.body.messages[0].content;
  assert.ok(head.some((b: any) => b.type === "text" && b.text.startsWith(SUMMARY_MARK) && /read_file \{"path":"src\/f/.test(b.text)));

  writeFileSync("camp/settings.json", JSON.stringify({ agents: {}, compactAt: 0 }));
  assert.equal(settings.compactAt(), 0);
  step = 0; events.length = 0; api.seen.length = 0;
  await withExpedition({ id: "c3", thread: "t-compact-3" }, () => runAgent(specWith([reader]) as any, "Port the billing module", { plain: true }));
  assert.doesNotMatch(notices(), /made smaller/);
  assert.equal(api.seen.at(-1)!.body.messages.length, 25, "the whole transcript was sent");
  writeFileSync("camp/settings.json", JSON.stringify({ agents: {}, compactAt: 0.2 }));
  assert.equal(settings.compactAt(), 0.3, "held to a sensible share");
  writeFileSync("camp/settings.json", JSON.stringify({ agents: {} }));
  assert.equal(settings.compactAt(), 0.7);
});

test("in a run, long tool output is spilled: the model is sent the preview and the path, and the file has the rest", async () => {
  const big = "START " + "q".repeat(MAX_TOOL_OUTPUT + 5_000) + " END";
  let turn = 0;
  script = () => (turn++ === 0 ? { tools: [{ name: "bash", input: { command: "cat big.log" } }] } : { text: "Read it." });
  const r = await runAgent(specWith([shellTool(() => big)]) as any, "Look at the log", { plain: true });
  assert.equal(r.status, "done");
  const got = api.seen[1].body.messages.at(-1).content[0].content as string;
  assert.ok(got.length < 12_000 && got.startsWith("START ") && got.includes(" END"));
  const path = got.match(/saved at (camp\/spill\/scribe__[\w-]+\.txt)/)![1];
  assert.equal(readFileSync(path, "utf8"), big);
});
