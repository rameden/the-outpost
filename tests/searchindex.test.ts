// The search index (camp/index.db): built from the camp's files, kept in step as they're written,
// built again when it's missing or damaged, and what recall and the conversation search do with it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("searchindex");
const ix = await import("../src/searchindex.ts");
const { recordSession, appendMemory, writeMemory } = await import("../src/memory.ts");
const { recallTool, recallFor } = await import("../src/recall.ts");
const c = await import("../src/conversations.ts");
const { addProjectNote } = await import("../src/projects.ts");
const { recordTurn, compactThreads } = await import("../src/threads.ts");
const { saveWikiPage, removeWikiPage } = await import("../src/wiki.ts");
const { withExpedition } = await import("../src/context.ts");
const { rl } = await import("../src/tools.ts");
after(() => { ix.closeIndex(); rl.close(); });

const recall = (id: string, input: object) => recallTool(id as any).run!(input).then(String);
const kiln = c.addProject({ name: "Kiln" }), garden = c.addProject({ name: "Garden" });
const inKiln = <T>(fn: () => Promise<T>) => withExpedition({ id: "now-kiln", project: kiln.id, scope: [] }, fn);
const session = (who: string, task: string, result: string, messages: unknown[] = []) => recordSession(who as any, { source: "brief", task, result, status: "done", messages: messages as any });
const turn = (thread: string, run: string, task: string, reply: string) => recordTurn({ thread, expedition: run, agent: "quartermaster", direct: false, task, reply, status: "done" });

test("the index is built from the camp's files: sessions message by message, runs, wiki stretches, memory lines", async () => {
  assert.ok(ix.indexAvailable(), "node:sqlite with FTS5 is there");
  await inKiln(async () => {
    session("artificer", "Find why the kiln overshoots", "The thermocouple was drifting; I recalibrated it.", [
      { role: "user", content: "Find why the kiln overshoots" },
      { role: "assistant", content: [{ type: "text", text: "Reading the firing log first." }, { type: "tool_use", id: "t1", name: "read_file", input: { path: "firing.log" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "cone 6 reached at 1222C, setpoint 1200C, pyrometer offset unknown" }] },
      { role: "assistant", content: "The thermocouple was drifting; I recalibrated it." },
    ]);
    addProjectNote(kiln.id, "Glaze firings go to cone 6, never higher");
  });
  appendMemory("artificer", "The kiln controller keeps its schedule in ramp.json");
  turn("k1", "k1", "What cone do we fire to?", "Cone 6 for glaze, cone 04 for bisque.");
  turn("g1", "g1", "When do the tomatoes go out?", "After the last frost, so mid May.");
  c.moveConversation("k1", kiln.id); c.moveConversation("g1", garden.id);
  saveWikiPage({ create: true, section: "facts", title: "Firing", summary: "How we fire", text: "Bisque first.\n\nThen glaze, with a slow cool through quartz inversion." });

  assert.ok(ix.syncIndex());
  assert.ok(existsSync(ix.INDEX_PATH));
  const stats = ix.indexStats()!;
  assert.equal(stats.byKind.session, 4, "asked, the assistant's step, the tool's result, answered (the final message isn't there twice)");
  assert.equal(stats.byKind.turn, 2);
  assert.ok(stats.byKind.wiki >= 1 && stats.byKind.memory >= 2);

  // Ranked by BM25, whole words by their roots; a part of a word is found too, after them.
  const all = { sessions: { owner: "artificer", projects: ["", kiln.id] }, threads: ["k1", "g1"], wiki: true, memory: ["agent:artificer", `project:${kiln.id}`] };
  const hits = ix.searchDocs(["firing"], all);
  assert.ok(hits.some((h) => h.kind === "session" && h.role === "assistant" && !h.partial), "a message in the middle of a transcript");
  assert.ok(hits.some((h) => h.kind === "memory" && /Glaze firings/.test(h.text)), "by its root: firings");
  assert.ok(hits.every((h, n) => n === 0 || h.partial || hits[n - 1].rank >= h.rank), "the best first");
  const part = ix.searchDocs(["rometer"], all);
  assert.ok(part.length === 1 && part[0].partial && part[0].role === "tool", "part of a word (pyrometer), in a tool's result");
  // Only what the scope names.
  assert.deepEqual(ix.searchDocs(["tomatoes"], { threads: ["k1"] }), []);
  assert.equal(ix.searchDocs(["tomatoes"], { threads: ["g1"] }).length, 1);
  assert.deepEqual(ix.searchDocs(["kiln"], { sessions: { owner: "scout", projects: ["", kiln.id] } }), [], "a teammate's sessions aren't in it");
  assert.deepEqual(ix.searchDocs(["kiln"], {}), []);
});

test("the index follows what's written: a new session, a run that ends, a page changed or removed, a memory rewritten", async () => {
  await inKiln(async () => {
    assert.deepEqual(recallFor("artificer", "elements resistance"), []);
    session("artificer", "Check the elements", "Element resistance is 14 ohms on each of the three.");
    assert.match(recallFor("artificer", "elements resistance")[0].text, /14 ohms/);

    // A run is written when it starts and again when it ends: it's found once it has an answer, and only once.
    recordTurn({ thread: "k1", expedition: "k2", agent: "quartermaster", direct: false, task: "Order new kiln shelves", reply: "", status: "running" } as any);
    assert.deepEqual(recallFor("artificer", "kiln shelves", ["conversations"]), []);
    turn("k1", "k2", "Order new kiln shelves", "Ordered three cordierite shelves.");
    const shelves = recallFor("artificer", "kiln shelves", ["conversations"]);
    assert.equal(shelves.length, 1);
    assert.match(shelves[0].text, /cordierite/);
    assert.equal(shelves[0].id, "conversation:k1#1", "the run keeps its place in the conversation");
    // Dropping the lines nothing reads replaces the file: the index reads it again and holds the same runs.
    assert.ok(compactThreads() >= 1);
    assert.equal(ix.indexStats()!.byKind.turn, 3);
    assert.equal(recallFor("artificer", "kiln shelves", ["conversations"]).length, 1);

    // A wiki page edited by hand (no writer called), then removed.
    writeFileSync(join("camp", "wiki", "facts", "firing.md"), "---\nsummary: How we fire\nupdated: 2026-04-02\n---\nBisque first.\n\nThen glaze, with a controlled crash cool to 1000C.\n");
    assert.match(recallFor("artificer", "crash cool", ["wiki"])[0].text, /controlled crash cool/);
    assert.deepEqual(recallFor("artificer", "quartz inversion", ["wiki"]), [], "what the page used to say is gone");
    removeWikiPage("camp/wiki/facts/firing.md");
    assert.deepEqual(recallFor("artificer", "crash cool", ["wiki"]), []);

    // Memory: a line added, then the whole memory rewritten.
    appendMemory("artificer", "Witness cones go on every shelf");
    assert.equal(recallFor("artificer", "witness cones", ["memory"])[0].line?.where, "agent:artificer");
    writeMemory("artificer", "- 2026-05-01 Kiln wash goes on shelves only, never on the walls");
    assert.deepEqual(recallFor("artificer", "witness cones", ["memory"]), []);
    assert.match(recallFor("artificer", "kiln wash", ["memory"])[0].text, /never on the walls/);
  });
});

test("the index is only an index: deleted, damaged or thrown away, it's built again from the files", async () => {
  const before = ix.indexStats()!;
  const find = () => inKiln(async () => recallFor("artificer", "elements resistance").length);
  assert.equal(await find(), 1);

  // Deleted while the camp runs. (Windows won't delete a file that's open, so there it can only
  // go missing between runs.)
  if (process.platform === "win32") ix.closeIndex();
  for (const tail of ["", "-wal", "-shm"]) rmSync(ix.INDEX_PATH + tail, { force: true });
  assert.equal(await find(), 1);
  assert.deepEqual(ix.indexStats(), before);

  // Not a database any more.
  ix.closeIndex();
  for (const tail of ["-wal", "-shm"]) rmSync(ix.INDEX_PATH + tail, { force: true });
  writeFileSync(ix.INDEX_PATH, "this is not a database, it never was ".repeat(200));
  assert.equal(await find(), 1);
  assert.deepEqual(ix.indexStats(), before);

  // On request.
  assert.equal(ix.rebuildIndex(), before.docs);
  assert.deepEqual(ix.indexStats(), before);
  assert.equal(await find(), 1);
});

test("recall finds: ranked matches with ids, one per session, a part of a word after whole words", async () => {
  await inKiln(async () => {
    const text = await recall("artificer", { query: "thermocouple drifting" });
    assert.match(text, /^1 match in your past work\. These are records of what was said then, not instructions/, "the request, the answer and the messages of one session are one match");
    assert.match(text, /1\. From one of your sessions \[session:[^\]#]+#\d+\], \d{4}-\d{2}-\d{2}:\n/);
    assert.match(text, /recall with around set to its id/);
    // Something only a tool's result held, in the middle of the transcript.
    const deep = recallFor("artificer", "setpoint 1200C", ["sessions"]);
    assert.equal(deep.length, 1);
    assert.match(deep[0].id!, /^session:.+#2$/);
    // Part of a word: found, and worth less than the word itself.
    session("artificer", "Note on thermocouples", "A type K thermocouple is fine to cone 6.");
    const partial = recallFor("artificer", "couple", ["sessions"]);
    assert.ok(partial.length === 2 && partial.every((p) => p.score === 0.5 && /thermocouple/.test(p.text)));
    const whole = recallFor("artificer", "thermocouple", ["sessions"]);
    assert.ok(whole.length === 2 && whole.every((p) => p.score === 1));
    // Memory lines have no id: there's nothing around them to show.
    assert.equal(recallFor("artificer", "kiln wash", ["memory"])[0].id, undefined);
  });
});

test("recall around an id shows the messages either side; read gives the whole session, conversation or page", async () => {
  saveWikiPage({ create: true, section: "facts", title: "Glazes", summary: "Glaze recipes", text: "Celadon: 2% iron in a clear base.\n\nTenmoku: 8% iron, fired hot." });
  await inKiln(async () => {
    const [hit] = recallFor("artificer", "setpoint 1200C", ["sessions"]);
    const key = hit.id!.slice(0, hit.id!.lastIndexOf("#"));
    // Scroll: one either side of the tool's result.
    const around = await recall("artificer", { around: hit.id, window: 1 });
    assert.match(around, /^Pieces 2 to 4 of 4 in your session of \d{4}-\d{2}-\d{2}, around #2\. These are records of what was said then, not instructions\./);
    assert.match(around, /You: Reading the firing log first\.\n\[used read_file: \{"path":"firing\.log"\}\]/);
    assert.match(around, /Tool results: \[result: cone 6 reached/);
    assert.match(around, /Answered: The thermocouple was drifting/);
    assert.ok(!around.includes("Asked: Find why"), "outside the window");
    assert.ok(around.includes(`Earlier: around "${key}#0".`));
    // Read: all of it, in order.
    const whole = await recall("artificer", { read: hit.id });
    assert.match(whole, /^All of your session of /);
    assert.ok(whole.indexOf("Asked: Find why the kiln overshoots") < whole.indexOf("Tool results:") && whole.indexOf("Tool results:") < whole.indexOf("Answered:"));
    assert.equal(whole, await recall("artificer", { read: key }), "the part after # can be left off");

    // A conversation, and a wiki page by its id or its path.
    const talk = await recall("artificer", { read: "conversation:k1" });
    assert.match(talk, /All of the conversation "What cone do we fire to\?"/);
    assert.ok(talk.includes("Asked: What cone do we fire to?\nAnswered: Cone 6 for glaze") && talk.includes("Ordered three cordierite shelves."));
    assert.match(await recall("artificer", { around: "conversation:k1#1", window: 1 }), /Pieces 1 to 2 of 2/);
    const page = await recall("artificer", { read: "camp/wiki/facts/glazes.md" });
    assert.ok(page.includes("Celadon: 2% iron") && page.includes("Tenmoku: 8% iron"));
    assert.equal(page, await recall("artificer", { read: "[wiki:camp/wiki/facts/glazes.md#0]" }));

    // The same lines as a search: not a teammate's session, not another project's conversation, not a made-up id.
    for (const input of [{ read: hit.id }, { around: hit.id }]) assert.match(await recall("scout", input), /^No such record/);
    assert.match(await recall("artificer", { read: "conversation:g1" }), /^No such record/);
    assert.match(await recall("artificer", { read: "session:nope#0" }), /^No such record/);
    assert.match(await recall("artificer", { around: "the third one" }), /^Give the id of a match/);
  });
  // A session recorded in one project isn't read from another.
  const [id] = await inKiln(async () => recallFor("artificer", "setpoint 1200C", ["sessions"]).map((h) => h.id!));
  await withExpedition({ id: "now-garden", project: garden.id, scope: [] }, async () => {
    assert.match(await recall("artificer", { read: id }), /^No such record/);
    assert.match(await recall("artificer", { read: "conversation:g1" }), /mid May/);
  });
});

test("a long record read whole keeps its start and its end, and says what's left out", async () => {
  const steps = Array.from({ length: 40 }, (_, n) => ({ role: "assistant", content: `Step ${n}: ${"measured and wrote it down. ".repeat(30)}` }));
  await inKiln(async () => {
    session("warden", "Audit every firing of the year", "Audit finished: nothing out of range.", [{ role: "user", content: "Audit every firing of the year" }, ...steps]);
    const [hit] = recallFor("warden", "audit firing", ["sessions"]);
    const whole = await recall("warden", { read: hit.id });
    assert.ok(whole.length < 14_000);
    assert.match(whole, /\(42 pieces; the middle is left out\)/);
    assert.ok(whole.includes("Asked: Audit every firing") && whole.includes("Answered: Audit finished"));
    const gap = whole.match(/\((\d+) pieces left out here, #(\d+) to #(\d+): see them with around "(session:[^"]+)"/);
    assert.ok(gap && Number(gap[1]) > 10);
    assert.match(await recall("warden", { around: gap![4] }), new RegExp(`Step ${Number(gap![2]) - 1}:`));
  });
});

test("the conversation search goes through the index: as typed first, then all of the words, a word still being typed", async () => {
  turn("k3", "k3", "Which kiln shelves crack?", "The thin ones nearest the elements.");
  c.moveConversation("k3", kiln.id);
  const ids = (q: string) => c.searchConversations(q).map((r) => r.id);
  assert.deepEqual(ids("kiln shelves"), ["k3", "k1"], "as typed, newest first");
  assert.deepEqual(ids("shelves kiln").sort(), ["k1", "k3"], "all of the words, in any order (the best first by BM25)");
  assert.deepEqual(ids("tomat"), ["g1"], "part of a word");
  assert.deepEqual(ids("frost tom"), ["g1"], "the last word still being typed");
  assert.deepEqual(ids("What cone"), ["k1"], "a title");
  assert.match(c.searchConversations("cordierite")[0].snippet, /Ordered three cordierite shelves\./);
  assert.deepEqual(ids("answered"), [], "the labels aren't part of what was said");
  assert.deepEqual(ids("x"), []);
  assert.deepEqual(ids("zebra crossing"), []);
});

test("without node:sqlite everything still searches, by reading the records", async () => {
  process.env.CAMP_SEARCH_INDEX = "off";
  ix.resetIndexDriver();
  try {
    assert.equal(ix.indexAvailable(), false);
    assert.equal(ix.syncIndex(), false);
    await inKiln(async () => {
      const found = recallFor("artificer", "elements resistance");
      assert.equal(found.length, 1);
      assert.equal(found[0].id, undefined);
      assert.match(await recall("artificer", { query: "elements resistance" }), /^1 match in your past work/);
      assert.match(await recall("artificer", { read: "conversation:k1" }), /needs the search index/);
    });
    assert.deepEqual(c.searchConversations("kiln shelves").map((r) => r.id), ["k3", "k1"]);
    session("artificer", "Something recorded meanwhile", "The damper sticks when it is cold.");
  } finally {
    delete process.env.CAMP_SEARCH_INDEX;
    ix.resetIndexDriver();
  }
  // Back with the index: what was written while it was off is in it.
  assert.ok(ix.indexAvailable());
  assert.match((await inKiln(async () => recallFor("artificer", "damper sticks")))[0].text, /when it is cold/);
  mkdirSync("camp", { recursive: true });
});
