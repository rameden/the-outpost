// The Notes panel: a place of your own to write things down beside a conversation.
//
// Closed, it's a slim tab; open, it's the list of your notes (narrow it by words) or the one
// you're writing. A note is plain text (Markdown works, and Preview shows it formatted) and is
// saved by itself a moment after you stop typing. From a note you can put its text in your
// message, or attach it to the message as a file. Going the other way, text you select in the
// thread gets a small "add to note" button (PickToNote, below), and every finished answer has a
// Note button of its own.
//
// Notes are yours: the crew doesn't read them unless one is in a message you send (notes.ts on
// the camp's side). Its size is its zone's: drag the line beside it.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cx, plural, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import { editNote, loadNotes, newNote, openNote, removeNote, titleOf, useNotes } from "../notes.ts";
import type { Note } from "../types.ts";
import { Drawer, Icon } from "./bits.tsx";
import { ask } from "./Confirm.tsx";

// The slim tab down the edge that brings the panel back.
export function NotesRail({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" className="zone-rail" aria-label="Show notes" title="Show your notes" onClick={onShow}>
      <Icon name="note" /><span>Notes</span>
    </button>
  );
}

// onInsert: put this text in the message box. onAttach: attach the note to the message as a file.
// (Neither is passed on a page with no message box.) onOpenConversation: go to where a note came from.
export const NotesPanel = memo(function NotesPanel({ onHide, onInsert, onAttach, onOpenConversation }: {
  onHide: () => void; onInsert?: (text: string) => void; onAttach?: (note: Note) => void; onOpenConversation?: (id: string) => void;
}) {
  const { notes, loaded, open, unsaved, error } = useNotes();
  const [words, setWords] = useState("");
  // Read them on opening, and again when you come back to the window (you may have written in another tab).
  useEffect(() => {
    void loadNotes();
    const again = () => void loadNotes();
    addEventListener("focus", again);
    return () => removeEventListener("focus", again);
  }, []);
  const note = notes.find((n) => n.id === open);
  const shown = useMemo(() => {
    const w = words.toLowerCase().split(/\s+/).filter(Boolean);
    return notes.filter((n) => w.every((x) => `${n.title}\n${n.text}`.toLowerCase().includes(x)));
  }, [notes, words]);

  return (
    <Drawer icon="note" label="Notes" onHide={onHide} hideLabel="Hide the notes" hideTitle="Hide your notes"
      // (While a note is open its list, and the list's own New note button, are out of sight: the rail carries one.)
      tools={note && <button type="button" className="hist-icon" aria-label="New note" title="Start another note" onClick={() => newNote()}><Icon name="plus" /></button>}>
      <aside className="notes" aria-label="Notes">
        {error && <div className="form-error notes-error" role="alert">{error}</div>}
        {note ? (
          <NoteEditor key={note.id} note={note} unsaved={unsaved} failed={!!error} onInsert={onInsert} onAttach={onAttach} onOpenConversation={onOpenConversation} />
        ) : (
          <>
            <div className="notes-top">
              <input aria-label="Narrow your notes" className="hist-search" placeholder="Narrow by words…" value={words} onChange={(ev) => setWords(ev.target.value)} />
              <button type="button" className="btn small primary" onClick={() => newNote()}><span aria-hidden="true">＋ </span>New note</button>
            </div>
            {!loaded ? <div className="notes-empty">Opening…</div>
              : !notes.length ? (
                <div className="notes-empty">
                  <b>Nothing noted yet.</b>
                  <p>Write things down here as you work: what to ask next, a decision, a command worth keeping. Select text in the thread to add it to a note, or press Note under an answer.</p>
                  <p>Notes are yours. The crew sees one only when you put it in a message.</p>
                </div>
              ) : !shown.length ? <div className="notes-empty">Nothing matches. <button type="button" className="linkish" onClick={() => setWords("")}>Show them all</button></div>
              : (
                <div className="notes-list" role="list" aria-label={`${notes.length} ${plural(notes.length, "note")}`}>
                  {shown.map((n) => (
                    <div key={n.id} role="listitem">
                      <button type="button" className="note-row" onClick={() => openNote(n.id)}>
                        <b>{titleOf(n)}</b>
                        {excerpt(n) && <span>{excerpt(n)}</span>}
                        <small>{when(n.updated)}{n.from ? ` · from ${n.from.title || "a conversation"}` : ""}</small>
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </>
        )}
      </aside>
    </Drawer>
  );
});

// A row's second line: the note's text, less the line already shown as its title.
function excerpt(n: Note) {
  const lines = n.text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (n.title.trim() ? lines : lines.slice(1)).join(" ").slice(0, 160);
}

function NoteEditor({ note, unsaved, failed, onInsert, onAttach, onOpenConversation }: {
  note: Note; unsaved: boolean; failed: boolean; onInsert?: (text: string) => void; onAttach?: (note: Note) => void; onOpenConversation?: (id: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // A note just started opens ready to type in.
  useEffect(() => { if (!note.title && !note.text) box.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = !note.text.trim();
  const blank = empty && !note.title.trim();
  const noBox = "Open a conversation first: this page has no message box.";

  // What goes in the message: the part of the note you've selected, or all of it.
  const picked = () => {
    const el = box.current;
    const part = el && el.selectionEnd > el.selectionStart ? el.value.slice(el.selectionStart, el.selectionEnd) : "";
    return (part.trim() ? part : note.text).trim();
  };
  async function copy() {
    try { await navigator.clipboard.writeText(picked()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard here: select and copy by hand */ }
  }
  async function remove() {
    if (!blank && !await ask({ title: `Delete “${titleOf(note)}”?`, body: "The note is deleted for good.", action: "Delete note", danger: true })) return;
    void removeNote(note.id);
  }

  return (
    <div className="note-edit">
      <div className="note-bar">
        <button type="button" className="hist-icon" aria-label="All notes" title="Back to all your notes" onClick={() => openNote(null)}><Icon name="chevronLeft" /></button>
        <input className="note-title" aria-label="Title" placeholder={empty ? "Untitled note" : titleOf({ title: "", text: note.text })} maxLength={120} value={note.title}
          onChange={(ev) => editNote(note.id, { title: ev.target.value })} />
        <button type="button" className={cx("hist-icon", preview && "on")} aria-pressed={preview} aria-label="Preview" title={preview ? "Back to writing" : "Preview: show the note formatted"}
          disabled={empty && !preview} onClick={() => setPreview((v) => !v)}><Icon name="eye" /></button>
        <button type="button" className="hist-icon" aria-label={copied ? "Copied" : "Copy the note"} title="Copy the note (or the part you've selected)" disabled={empty} onClick={copy}><Icon name={copied ? "check" : "copy"} /></button>
        <button type="button" className="hist-icon" aria-label="Delete this note" title="Delete this note" onClick={remove}><Icon name="trash" /></button>
      </div>
      {preview
        ? <div className="note-read"><Markdown text={note.text} /></div>
        : <textarea ref={box} className="note-text" aria-label="The note" spellCheck placeholder="Write here. Markdown works: # headings, - lists, `code`." value={note.text}
            onChange={(ev) => editNote(note.id, { text: ev.target.value })} />}
      <div className="note-foot">
        <span className={cx("note-saved", failed && "bad")} role="status">{failed ? "Not saved" : unsaved ? "Saving…" : blank ? "" : "Saved"}</span>
        {note.from && (onOpenConversation
          ? <button type="button" className="linkish note-from" title="Go to the conversation this note was started from" onClick={() => onOpenConversation(note.from!.conversation)}>From {note.from.title || "a conversation"}</button>
          : <span className="note-from">From {note.from.title || "a conversation"}</span>)}
      </div>
      <div className="note-actions">
        <button type="button" className="btn small primary" disabled={empty || !onInsert} title={onInsert ? "Put this note's text (or the part you've selected) in your message" : noBox}
          onClick={() => onInsert?.(picked())}>Add to message</button>
        <button type="button" className="btn small" disabled={empty || !onAttach} title={onAttach ? "Attach this note to your message as a file, as it stands now" : noBox}
          onClick={() => onAttach?.(note)}>Attach as a file</button>
      </div>
    </div>
  );
}

// Text selected in the thread gets a small button beside it: add it to the note you have open,
// or start a new note with it. within: the id of the element whose text can be picked.
// target: the note open in the panel right now (nothing, when the panel is closed or on its list).
export function PickToNote({ within = "feed", active, onAdd }: { within?: string; active: boolean; onAdd: (text: string, fresh: boolean) => void }) {
  const { notes, open } = useNotes();
  const target = active ? notes.find((n) => n.id === open) : undefined;
  const [at, setAt] = useState<{ text: string; left: number; top: number } | null>(null);
  useEffect(() => {
    const look = () => {
      const sel = document.getSelection();
      const text = sel?.toString().trim() ?? "";
      const focused = document.activeElement?.tagName;
      const range = text && sel?.rangeCount ? sel.getRangeAt(0) : null;
      if (!range || focused === "INPUT" || focused === "TEXTAREA" || !document.getElementById(within)?.contains(range.commonAncestorContainer)) return setAt(null);
      const r = range.getBoundingClientRect?.() ?? { top: 0, bottom: 0, left: 0, width: 0 };
      setAt({ text, left: Math.max(8, Math.min(r.left + r.width / 2, innerWidth - 8)), top: r.top > 52 ? r.top - 8 : r.bottom + 44 });
    };
    // Shown once the selection is made (not while it's being dragged out); gone as soon as it is.
    const made = () => setTimeout(look, 0);
    const changed = () => { if (!document.getSelection()?.toString().trim()) setAt(null); };
    const moved = () => setAt(null);
    document.addEventListener("pointerup", made);
    document.addEventListener("keyup", made);
    document.addEventListener("selectionchange", changed);
    document.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("pointerup", made);
      document.removeEventListener("keyup", made);
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("scroll", moved, true);
    };
  }, [within]);
  if (!at) return null;
  const add = (fresh: boolean) => { onAdd(at.text, fresh); document.getSelection()?.removeAllRanges(); setAt(null); };
  return (
    // (mousedown is kept from taking the selection away before the click lands)
    <div className="note-pick" role="toolbar" aria-label="Add the selected text to a note" style={{ left: at.left, top: at.top }} onMouseDown={(ev) => ev.preventDefault()}>
      {target && <button type="button" title={`Add the selected text to the end of “${titleOf(target)}”`} onClick={() => add(false)}><Icon name="note" /><span>Add to “{titleOf(target)}”</span></button>}
      <button type="button" title="Start a new note with the selected text" onClick={() => add(true)}>{!target && <Icon name="note" />}<span>{target ? "New note" : "Add to a note"}</span></button>
    </div>
  );
}
