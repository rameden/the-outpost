// The page's notes: what you type shows at once and is saved a moment later; an empty note is never sent.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appendToNote, editNote, flushNotes, loadNotes, newNote, noteFile, notesNow, openNote, removeNote, resetNotes, titleOf } from "./notes.ts";

type Sent = { action: string; id: string; title?: string; text?: string; from?: unknown };
let sent: Sent[] = [];
let onCamp: object[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  sent = []; onCamp = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ok: true })); }
    return new Response(JSON.stringify({ notes: onCamp }));
  }));
});
afterEach(() => { resetNotes(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

test("a new note waits for its first words, then is saved a moment after you stop typing", async () => {
  const n = newNote();
  expect(notesNow().open).toBe(n.id);
  await vi.advanceTimersByTimeAsync(2000);
  expect(sent).toEqual([]); // nothing in it: nothing to keep
  editNote(n.id, { text: "ask about the flaky" });
  editNote(n.id, { text: "ask about the flaky test" });
  expect(notesNow().notes[0].text).toBe("ask about the flaky test"); // on the page at once
  expect(notesNow().unsaved).toBe(true);
  await vi.advanceTimersByTimeAsync(800);
  expect(sent).toEqual([{ action: "save", id: n.id, title: "", text: "ask about the flaky test" }]); // one save, of where it ended up
  expect(notesNow().unsaved).toBe(false);
});

test("text picked from a thread starts a note that remembers its conversation, or is added to one", async () => {
  const n = newNote({ text: "Use a worktree per ticket.", from: { conversation: "c7", title: "Branching" } });
  appendToNote(n.id, "Rebase before the PR.");
  await flushNotes();
  expect(sent.at(-1)).toEqual({ action: "save", id: n.id, title: "", text: "Use a worktree per ticket.\n\nRebase before the PR.", from: { conversation: "c7", title: "Branching" } });
});

test("a note left empty goes; one that was saved is deleted on the camp too", async () => {
  const blank = newNote();
  openNote(null);
  expect(notesNow().notes).toEqual([]);
  expect(sent).toEqual([]); // the camp never had it
  const kept = newNote({ text: "keep me" });
  await flushNotes();
  await removeNote(kept.id);
  expect(sent.at(-1)).toEqual({ action: "remove", id: kept.id });
  expect(notesNow().open).toBeNull();
  expect(blank.id).not.toBe(kept.id);
});

test("reading the camp's notes keeps what's being written here, and a save that fails says so and is tried again", async () => {
  onCamp = [{ id: "aaaaaa111111", title: "Old", text: "from the camp", created: "2026-11-01T00:00:00.000Z", updated: "2026-11-01T00:00:00.000Z" }];
  await loadNotes();
  editNote("aaaaaa111111", { text: "typed here since" });
  await loadNotes(); // you came back to the window before it was saved
  expect(notesNow().notes[0].text).toBe("typed here since");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "The disk is full." }), { status: 500 })));
  await flushNotes();
  expect(notesNow().error).toBe("The disk is full.");
  expect(notesNow().unsaved).toBe(true);
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => { sent.push(JSON.parse(String(init!.body))); return new Response("{}"); }));
  await flushNotes();
  expect(sent.at(-1)?.text).toBe("typed here since");
  expect(notesNow().error).toBe("");
});

test("a note is called by its title, or its first line; as a file it's Markdown under that name", async () => {
  expect(titleOf({ title: "", text: "\n## Things to ask\n- one" })).toBe("Things to ask");
  expect(titleOf({ title: " Plan ", text: "x" })).toBe("Plan");
  expect(titleOf({ title: "", text: "" })).toBe("Untitled note");
  const f = noteFile({ title: "Plan: v2/beta?", text: "ship it" });
  expect(f.name).toBe("Plan v2 beta.md");
  expect(noteFile({ title: "", text: "Rebase before the PR." }).name).toBe("Rebase before the PR.md");
  expect(await f.text()).toBe("# Plan: v2/beta?\n\nship it\n");
  expect(await noteFile({ title: "", text: "# Own heading\n\nbody" }).text()).toBe("# Own heading\n\nbody\n");
});
