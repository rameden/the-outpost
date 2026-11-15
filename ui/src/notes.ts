// Your notes, as the page holds them: the list, which one is open in the Notes panel, and what
// you've typed that hasn't reached the camp yet.
//
// One store for the whole page, because notes are touched from far-apart places: the Notes panel
// writes them, the thread adds to them (text you picked out of an answer), and the message box's
// + menu attaches them. What you type shows at once and is saved a moment after you stop; a
// note with nothing in it is never sent, and goes when you leave it.

import { useSyncExternalStore } from "react";
import { api, errorText, storeGet, storeRemove, storeSet } from "./api.ts";
import type { Note } from "./types.ts";

export type NotesState = {
  notes: Note[];        // the one changed last first
  loaded: boolean;
  open: string | null;  // the note in the editor (remembered across reloads)
  unsaved: boolean;     // something typed here hasn't reached the camp yet
  error: string;        // why the last load or save didn't go through
};

const SAVE_AFTER_MS = 700;
const OPEN_KEY = "camp-note-open";

let state: NotesState = { notes: [], loaded: false, open: storeGet(OPEN_KEY), unsaved: false, error: "" };
const heard = new Set<() => void>();
const dirty = new Set<string>(); // changed here, not saved yet
const fresh = new Set<string>(); // made here and never saved: the camp doesn't have them
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

function set(change: Partial<NotesState>) {
  state = { ...state, ...change, unsaved: dirty.size > 0 };
  for (const fn of heard) fn();
}
const subscribe = (fn: () => void) => { heard.add(fn); return () => { heard.delete(fn); }; };
export const useNotes = () => useSyncExternalStore(subscribe, () => state);
// The notes right now, for a handler that acts on them without being redrawn by every keystroke.
export const notesNow = () => state;

const isEmpty = (n: Note) => !n.title.trim() && !n.text.trim();
const newestFirst = (a: Note, b: Note) => b.updated.localeCompare(a.updated);
function newId() {
  const bytes = new Uint8Array(6);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// What a note is called: its title, or (without one) its first line.
export function titleOf(n: Pick<Note, "title" | "text">) {
  const first = n.text.split("\n").map((l) => l.replace(/^[#>\-*\s]+/, "").trim()).find(Boolean) ?? "";
  return n.title.trim() || (first.length > 60 ? `${first.slice(0, 60).trimEnd()}…` : first) || "Untitled note";
}

// A note as a file, to attach to a message: Markdown, under its own name.
export function noteFile(n: Pick<Note, "title" | "text">): File {
  const name = titleOf(n).replace(/[^\w.\- ()]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 60).replace(/[.\s]+$/, "") || "note";
  const body = n.text.trim();
  return new File([/^#\s+\S/.test(body) || !n.title.trim() ? `${body}\n` : `# ${n.title.trim()}\n\n${body}\n`], `${name}.md`, { type: "text/markdown" });
}

// Read them from the camp. What's being written here stays as it is here: it's the newer.
export async function loadNotes() {
  try {
    const r = await api<{ notes: Note[] }>("/api/notes");
    const mine = state.notes.filter((n) => dirty.has(n.id) || fresh.has(n.id));
    const notes = [...mine, ...r.notes.filter((n) => !mine.some((m) => m.id === n.id))].sort(newestFirst);
    const open = state.open && notes.some((n) => n.id === state.open) ? state.open : null; // deleted since, in another tab
    if (!open) storeRemove(OPEN_KEY);
    set({ notes, loaded: true, open, error: "" });
  } catch (e) { set({ loaded: true, error: errorText(e) }); }
}

function later() {
  clearTimeout(timer);
  timer = setTimeout(() => void flushNotes(), SAVE_AFTER_MS);
}

// Send everything that's waiting, now (one save at a time, in the order they were asked for).
export function flushNotes(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  saving = saving.then(async () => {
    for (const id of [...dirty]) {
      const n = state.notes.find((x) => x.id === id);
      dirty.delete(id);
      if (!n || isEmpty(n)) continue;
      try {
        await api("/api/notes", { action: "save", id, title: n.title, text: n.text, from: n.from });
        fresh.delete(id);
        set({ error: "" });
      } catch (e) {
        dirty.add(id); // still owed: the next change (or the next flush) tries again
        set({ error: errorText(e) });
        return;
      }
    }
    set({});
  });
  return saving;
}

// Which note the editor shows (null: the list). A note left with nothing in it goes.
export function openNote(id: string | null) {
  const leaving = state.notes.find((n) => n.id === state.open);
  if (id) storeSet(OPEN_KEY, id); else storeRemove(OPEN_KEY);
  set({ open: id });
  if (leaving && leaving.id !== id && isEmpty(leaving)) void removeNote(leaving.id);
}

// A new note. With something in it, it's saved; an empty one waits for its first words.
// from: the conversation its text was picked out of.
export function newNote(init: { title?: string; text?: string; from?: Note["from"] } = {}): Note {
  const now = new Date().toISOString();
  const note: Note = { id: newId(), title: init.title ?? "", text: init.text ?? "", created: now, updated: now, ...(init.from ? { from: init.from } : {}) };
  fresh.add(note.id);
  if (!isEmpty(note)) dirty.add(note.id);
  const leaving = state.notes.find((n) => n.id === state.open);
  storeSet(OPEN_KEY, note.id);
  set({ notes: [note, ...state.notes], open: note.id });
  if (leaving && isEmpty(leaving)) void removeNote(leaving.id);
  if (dirty.has(note.id)) later();
  return note;
}

export function editNote(id: string, change: { title?: string; text?: string }) {
  if (!state.notes.some((n) => n.id === id)) return;
  dirty.add(id);
  set({ notes: state.notes.map((n) => (n.id === id ? { ...n, ...change, updated: new Date().toISOString() } : n)) });
  later();
}

// Add to the end of a note, a blank line after what's there.
export function appendToNote(id: string, text: string) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  editNote(id, { text: n.text.trim() ? `${n.text.trimEnd()}\n\n${text}` : text });
}

export async function removeNote(id: string) {
  const onCamp = !fresh.has(id);
  dirty.delete(id);
  fresh.delete(id);
  if (state.open === id) storeRemove(OPEN_KEY);
  set({ notes: state.notes.filter((n) => n.id !== id), open: state.open === id ? null : state.open });
  if (!onCamp) return;
  try { await saving; await api("/api/notes", { action: "remove", id }); }
  catch (e) { set({ error: errorText(e) }); void loadNotes(); } // still there: show it again
}

// Leaving the page (or putting it in the background): what's typed goes to the camp first.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirty.size) void flushNotes(); });
}

// For tests: start from nothing.
export function resetNotes() {
  clearTimeout(timer);
  timer = undefined;
  dirty.clear();
  fresh.clear();
  saving = Promise.resolve();
  state = { notes: [], loaded: false, open: null, unsaved: false, error: "" };
  for (const fn of heard) fn();
}
