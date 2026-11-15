// Your notes: kept in camp/notes.json, newest change first, and never readable by the crew's file tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("notes");
const { loadNotes, saveNote, removeNote, NOTES_PATH, MAX_NOTE } = await import("../src/notes.ts");
const { campPath, rl } = await import("../src/tools.ts");
rl.close();

test("a note is kept under the id the page gave it, and saving it again changes it in place", async () => {
  assert.deepEqual(loadNotes(), []);
  const first = saveNote({ id: "aaaaaa111111", title: "  Release   steps ", text: "1. Tag\r\n2. Deploy", from: { conversation: "c1", title: "Shipping v2" } });
  assert.equal(first.title, "Release steps");
  assert.equal(first.text, "1. Tag\n2. Deploy");
  assert.deepEqual(first.from, { conversation: "c1", title: "Shipping v2" });
  await new Promise((ok) => setTimeout(ok, 5));
  saveNote({ id: "bbbbbb222222", title: "", text: "ask about the flaky test" });
  await new Promise((ok) => setTimeout(ok, 5));
  const again = saveNote({ id: "aaaaaa111111", title: "Release steps", text: "1. Tag\n2. Deploy\n3. Announce" });
  assert.equal(again.created, first.created);
  assert.ok(again.updated > first.updated);
  assert.deepEqual(again.from, first.from, "where it came from stays with it");
  assert.deepEqual(loadNotes().map((n) => n.id), ["aaaaaa111111", "bbbbbb222222"], "the one changed last comes first");
  assert.equal(JSON.parse(readFileSync(NOTES_PATH, "utf8")).length, 2);
});

test("what isn't a note is refused, and says why", () => {
  const refused = (input: object, why: RegExp) => assert.throws(() => saveNote(input), (e: any) => e.fixable === true && why.test(e.message));
  refused({ id: "../../etc", text: "x" }, /isn't a note/);
  refused({ id: "cccccc333333", title: " ", text: " \n " }, /Write something/);
  refused({ id: "cccccc333333", text: "x".repeat(MAX_NOTE + 1) }, /split it/);
  refused({ id: "cccccc333333", text: "a\u0000b" }, /isn't text/);
  assert.equal(loadNotes().length, 2);
});

test("a note can be deleted; one that isn't there is simply not there", () => {
  assert.equal(removeNote("bbbbbb222222"), true);
  assert.equal(removeNote("bbbbbb222222"), false);
  assert.deepEqual(loadNotes().map((n) => n.id), ["aaaaaa111111"]);
});

test("the crew's file tools can't open your notes", () => {
  assert.ok(existsSync(NOTES_PATH));
  assert.throws(() => campPath("camp/notes.json", "read", "scout"), /private camp configuration/);
});

test("a notes file that can't be read is set aside, not written over", () => {
  writeFileSync(NOTES_PATH, "{ not json");
  assert.deepEqual(loadNotes(), []);
  assert.ok(readdirSync("camp").some((f) => f.startsWith("notes.json.damaged-")), "the file as it was is kept beside it");
  saveNote({ id: "dddddd444444", text: "after the damage" });
  assert.equal(loadNotes().length, 1);
});
