// Your notes: what you jot down beside a conversation (camp/notes.json).
//
// They're yours, not the camp's memory. The crew's file tools can't open the file (tools.ts), so
// a note reaches the crew only when you put it in a message: as text, or attached as a file.
// (What the crew should know from now on belongs in the wiki instead.)
//
// The page keeps each note under an id of its own making, so a note is saved the same way
// whether it's new or not: there's no "create, then learn its name" step for typing to race.

import { readJsonFile, writeJsonAtomic } from "./atomic.js";

export const NOTES_PATH = "camp/notes.json";
// from: the conversation it was started from (text picked out of its thread), if any.
export type Note = { id: string; title: string; text: string; created: string; updated: string; from?: { conversation: string; title: string } };

export const MAX_NOTES = 500;
export const MAX_NOTE = 200_000;
const MAX_TITLE = 120;
const ID_RE = /^[a-z0-9]{6,24}$/;
const fixable = (message: string) => Object.assign(new Error(message), { fixable: true });

const isNote = (n: any): n is Note => !!n && typeof n === "object" && typeof n.id === "string" && ID_RE.test(n.id)
  && typeof n.title === "string" && typeof n.text === "string" && typeof n.created === "string" && typeof n.updated === "string";

// Every note, the one changed last first.
export function loadNotes(): Note[] {
  const kept = readJsonFile(NOTES_PATH, []);
  const list = Array.isArray(kept) ? kept.filter(isNote) : [];
  return list.sort((a, b) => b.updated.localeCompare(a.updated));
}

// Keep a note: a new one (an id not seen before) or a change to one that's there. A note with
// nothing in it isn't kept.
export function saveNote(input: { id?: unknown; title?: unknown; text?: unknown; from?: unknown }): Note {
  const id = String(input.id ?? "");
  if (!ID_RE.test(id)) throw fixable("That isn't a note.");
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  const text = String(input.text ?? "").replace(/\r\n/g, "\n");
  if (text.includes("\u0000")) throw fixable("That isn't text.");
  if (text.length > MAX_NOTE) throw fixable(`That's over ${MAX_NOTE.toLocaleString("en-US")} characters: split it into more than one note.`);
  if (!title && !text.trim()) throw fixable("Write something for the note to say.");
  const list = loadNotes();
  const was = list.find((n) => n.id === id);
  if (!was && list.length >= MAX_NOTES) throw fixable(`That's ${MAX_NOTES} notes already: delete some you no longer need first.`);
  const now = new Date().toISOString();
  const f = input.from as { conversation?: unknown; title?: unknown } | undefined;
  const from = was?.from ?? (f && typeof f.conversation === "string" && f.conversation
    ? { conversation: f.conversation.slice(0, 80), title: String(f.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) } : undefined);
  const note: Note = { id, title, text, created: was?.created ?? now, updated: now, ...(from ? { from } : {}) };
  writeJsonAtomic(NOTES_PATH, [note, ...list.filter((n) => n.id !== id)]);
  return note;
}

export function removeNote(id: string): boolean {
  const list = loadNotes();
  if (!list.some((n) => n.id === id)) return false;
  writeJsonAtomic(NOTES_PATH, list.filter((n) => n.id !== id));
  return true;
}
