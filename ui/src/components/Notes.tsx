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
//
// Two things the camp does with them, both only when you ask. "Write up as a ticket" has the
// Scout read the project's code and turn a note into a ticket the crew can work from (a title,
// acceptance criteria, a description in fixed sections); it's kept beside the note, and "Start
// work" puts it in your message. "Suggest ideas" asks what the project's record points at next:
// what comes back sits in the list marked as suggested, until you keep it or delete it.
//
// And two that make Mae tickets of it (tickets.ts): "Turn into tickets" splits the note into
// pieces of work for you to choose from, and a ticket written up here can be added to them as it is.
// A note that's been filed says so, and opens its tickets.

import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cx, nameNow, plural, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import { editNote, isWriting, keepIdea, loadNotes, newNote, openNote, removeNote, suggestIdeas, ticketBrief, ticketText, titleOf, useNotes, writeTicket } from "../notes.ts";
import type { Note } from "../types.ts";
import { createTicket, filedFrom, showTicket as openTicket, turnIntoTickets, useTickets } from "../tickets.ts";
import { Drawer, Icon } from "./bits.tsx";
import { VoiceOn } from "./ReadAloud.tsx";
import { readAloud, spokenLines } from "../readaloud.ts";
import { ask } from "./Confirm.tsx";

import { w } from "../words.ts";
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
// project: the project you're in (none, outside one): whose code a ticket is written from, and what ideas are suggested for.
export const NotesPanel = memo(function NotesPanel({ onHide, onInsert, onAttach, onOpenConversation, project }: {
  onHide: () => void; onInsert?: (text: string) => void; onAttach?: (note: Note) => void; onOpenConversation?: (id: string) => void; project?: { id: string; name: string };
}) {
  const { notes, loaded, open, unsaved, error } = useNotes();
  const [words, setWords] = useState("");
  // Asking for ideas: while the camp thinks, and what came of it.
  const [thinking, setThinking] = useState(false);
  const [came, setCame] = useState("");
  const unkept = project ? notes.filter((n) => n.idea?.project === project.id && !n.idea.kept).length : 0;
  async function ideas(replace: boolean) {
    if (!project || thinking) return;
    setThinking(true); setCame("");
    const r = await suggestIdeas(project.id, replace);
    setThinking(false);
    if (r) setCame(r.added ? `${r.added} ${plural(r.added, "idea")} added.` : "Nothing new came to mind: the record doesn't point at anything yet.");
  }
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
          <NoteEditor key={note.id} note={note} unsaved={unsaved} failed={!!error} onInsert={onInsert} onAttach={onAttach} onOpenConversation={onOpenConversation} project={project} />
        ) : (
          <>
            <div className="notes-top">
              <input aria-label="Narrow your notes" className="hist-search" placeholder="Narrow by words…" value={words} onChange={(ev) => setWords(ev.target.value)} />
              <button type="button" className="btn small primary" onClick={() => newNote()}><span aria-hidden="true">＋ </span>New note</button>
            </div>
            <div className="notes-ideas">
              <button type="button" className="btn small" disabled={!project || thinking}
                title={project ? `Ask the ${w("camp")} what ${project.name}'s record points at next. What it suggests lands here, marked as suggested.` : "Open a project, or a conversation in one, first: ideas are suggested for a project."}
                onClick={() => ideas(false)}>{thinking ? "Thinking…" : "Suggest ideas"}</button>
              {unkept > 0 && !thinking && <button type="button" className="linkish" title="Clear out the suggestions you haven't kept (they won't be suggested again) and ask for others" onClick={() => ideas(true)}>Replace the {unkept} you haven't kept</button>}
              {came && <span className="meta" role="status">{came}</span>}
            </div>
            {!loaded ? <div className="notes-empty">Opening…</div>
              : !notes.length ? (
                <div className="notes-empty">
                  <b>Nothing noted yet.</b>
                  <p>Write things down here as you work: what to ask next, a decision, a command worth keeping. Select text in the thread to add it to a note, or press Note under an answer.</p>
                  <p>Notes are yours. The {w("crew")} sees one only when you put it in a message.</p>
                </div>
              ) : !shown.length ? <div className="notes-empty">Nothing matches. <button type="button" className="linkish" onClick={() => setWords("")}>Show them all</button></div>
              : (
                <div className="notes-list" role="list" aria-label={`${notes.length} ${plural(notes.length, "note")}`}>
                  {shown.map((n) => (
                    <div key={n.id} role="listitem">
                      <button type="button" className={cx("note-card", n.idea && !n.idea.kept && "suggested")} onClick={() => openNote(n.id)}>
                        <b>{titleOf(n)}</b>
                        {excerpt(n) && <span className="note-card-text">{excerpt(n)}</span>}
                        {(n.idea && !n.idea.kept || isWriting(n) || n.ticket) && (
                          <span className="note-card-tags">
                            {n.idea && !n.idea.kept && <span className="note-tag idea">Suggested</span>}
                            {isWriting(n) ? <span className="note-tag">Ticket being written</span> : n.ticket && <span className="note-tag">Has a ticket</span>}
                          </span>
                        )}
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

// What a card shows of the note: its text, less the line already shown as its title, line breaks kept.
function excerpt(n: Note) {
  const lines = n.text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (n.title.trim() ? lines : lines.slice(1)).join("\n").slice(0, 400);
}

function NoteEditor({ note, unsaved, failed, onInsert, onAttach, onOpenConversation, project }: {
  note: Note; unsaved: boolean; failed: boolean; onInsert?: (text: string) => void; onAttach?: (note: Note) => void; onOpenConversation?: (id: string) => void; project?: { id: string; name: string };
}) {
  const [preview, setPreview] = useState(false);
  // Which side of the note is showing, once it has a ticket: your words, or the ticket written from them.
  const [side, setSide] = useState<"note" | "ticket">("note");
  const ticket = note.ticket;
  const writing = isWriting(note);
  const suggested = !!note.idea && !note.idea.kept;
  // The ticket shows as soon as it's written, if you were here waiting for it.
  const waited = useRef(writing);
  useEffect(() => { if (waited.current && !writing && ticket) setSide("ticket"); waited.current = writing; }, [writing, ticket]);
  const showTicket = side === "ticket" && !!ticket;
  const write = () => void writeTicket(note.id, project?.id);
  // Start work from the ticket: the brief goes in the message box, the ticket rides along as a file.
  const start = () => { if (!ticket) return; onAttach?.({ ...note, title: ticket.title, text: ticketText(ticket) }); onInsert?.(ticketBrief(ticket)); };
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // A note just started opens ready to type in.
  useEffect(() => { if (!note.title && !note.text) box.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = !note.text.trim();
  const blank = empty && !note.title.trim();
  const noBox = "Open a conversation first: this page has no message box.";
  // Mae tickets made from this note, and making them.
  const filed = filedFrom(useTickets().tickets, note.id);
  const from = { kind: "note" as const, id: note.id, title: titleOf(note) };
  const [filing, setFiling] = useState(false);
  const turn = () => turnIntoTickets({ text: [note.title.trim(), note.text.trim()].filter(Boolean).join("\n\n"), kind: "note", title: titleOf(note), project: project?.id, from });
  async function addTicket() {
    if (!ticket || filing) return;
    setFiling(true);
    try { openTicket((await createTicket({ title: ticket.title, criteria: ticket.criteria, description: ticket.description, project: project?.id, from })).key); }
    catch { /* the ticket store says why */ }
    setFiling(false);
  }

  // What goes in the message: the part of the note you've selected, or all of it.
  const picked = () => {
    const el = box.current;
    const part = el && el.selectionEnd > el.selectionStart ? el.value.slice(el.selectionStart, el.selectionEnd) : "";
    return (part.trim() ? part : note.text).trim();
  };
  async function copy() {
    try { await navigator.clipboard.writeText(showTicket ? ticketText(ticket!) : picked()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard here: select and copy by hand */ }
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
          disabled={showTicket || (empty && !preview)} onClick={() => setPreview((v) => !v)}><Icon name="eye" /></button>
        <button type="button" className="hist-icon" aria-label={copied ? "Copied" : showTicket ? "Copy the ticket" : "Copy the note"} title={showTicket ? "Copy the ticket, as Markdown" : "Copy the note (or the part you've selected)"} disabled={empty && !showTicket} onClick={copy}><Icon name={copied ? "check" : "copy"} /></button>
        <button type="button" className="hist-icon" aria-label="Delete this note" title={suggested ? "Delete this suggestion: it won't be suggested again" : "Delete this note"} onClick={remove}><Icon name="trash" /></button>
      </div>
      {ticket && (
        <div className="tabs note-sides" role="tablist" aria-label="The note, or its ticket">
          <button type="button" role="tab" className="tab" aria-selected={!showTicket} onClick={() => setSide("note")}>Note</button>
          <button type="button" role="tab" className="tab" aria-selected={showTicket} onClick={() => setSide("ticket")}>Ticket</button>
        </div>
      )}
      {suggested && !showTicket && (
        <div className="note-idea" role="note">
          <span>The {w("camp")} suggested this. Keep it and it's yours; delete it and it won't be suggested again.</span>
          <button type="button" className="btn small" onClick={() => void keepIdea(note.id)}>Keep</button>
        </div>
      )}
      {showTicket ? (
        <div className="note-read note-ticket" role="tabpanel" aria-label="Ticket">
          {ticket!.stale && <div className="note-stale" role="note">The note has changed since this was written. <button type="button" className="linkish" disabled={writing} onClick={write}>Write it again</button></div>}
          <Markdown text={ticketText(ticket!)} />
        </div>
      ) : preview
        ? <div className="note-read"><Markdown text={note.text} /></div>
        : <textarea ref={box} className="note-text" aria-label="The note" spellCheck placeholder="Write here. Markdown works: # headings, - lists, `code`." value={note.text}
            onChange={(ev) => editNote(note.id, { text: ev.target.value })} />}
      {!showTicket && !!note.idea?.criteria.length && (
        <div className="note-criteria">
          <b>Done would mean</b>
          <ul>{note.idea.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <div className="note-foot">
        <span className={cx("note-saved", failed && "bad")} role="status">{failed ? "Not saved" : unsaved ? "Saving…" : blank ? "" : "Saved"}</span>
        {note.from && (onOpenConversation
          ? <button type="button" className="linkish note-from" title="Go to the conversation this note was started from" onClick={() => onOpenConversation(note.from!.conversation)}>From {note.from.title || "a conversation"}</button>
          : <span className="note-from">From {note.from.title || "a conversation"}</span>)}
        {filed.length > 0 && (
          <span className="note-filed">Filed as {filed.slice(0, 3).map((t, i) => (
            <span key={t.key}>{i > 0 && ", "}<button type="button" className="linkish jira-key" title={`Open ${t.key}: ${t.title}`} onClick={() => openTicket(t.key)}>{t.key}</button></span>
          ))}{filed.length > 3 && ` and ${filed.length - 3} more`}</span>
        )}
      </div>
      {writing && (
        <div className="note-writing" role="status">
          <span>Writing the ticket{project ? `: the ${nameNow("Scout")} is reading ${project.name}'s code first` : ""}. It takes a minute or two.</span>
          {onOpenConversation && <button type="button" className="linkish" onClick={() => onOpenConversation(note.writing!.run)}>Watch</button>}
        </div>
      )}
      {showTicket ? (
        <div className="note-actions">
          <button type="button" className="btn small primary" disabled={!onInsert || !onAttach} title={onInsert ? "Put the brief in your message, with the ticket attached. Nothing is sent until you send it." : noBox} onClick={start}>Start work</button>
          <button type="button" className="btn small" disabled={writing || blank} title="Have it written again from the note as it stands now" onClick={write}>Write it again</button>
          <button type="button" className="btn small" disabled={filing} title="File this as a Mae ticket, to track on the Tickets page" onClick={addTicket}>{filing ? "Adding…" : "Add to tickets"}</button>
          {ticket!.conversation && onOpenConversation && <button type="button" className="linkish" title={`The conversation in which the ${nameNow("Scout")} read the code and wrote this`} onClick={() => onOpenConversation(ticket!.conversation!)}>How it was written</button>}
        </div>
      ) : (
        <div className="note-actions">
          <button type="button" className="btn small primary" disabled={empty || !onInsert} title={onInsert ? "Put this note's text (or the part you've selected) in your message" : noBox}
            onClick={() => onInsert?.(picked())}>Add to message</button>
          <button type="button" className="btn small" disabled={empty || !onAttach} title={onAttach ? "Attach this note to your message as a file, as it stands now" : noBox}
            onClick={() => onAttach?.(note)}>Attach as a file</button>
          {!ticket && <button type="button" className="btn small" disabled={blank || writing || unsaved && failed}
            title={project ? `Have the ${nameNow("Scout")} read ${project.name}'s code and write this up as a ticket the ${w("crew")} can work from: a title, acceptance criteria, and where it goes` : `Have the ${nameNow("Scout")} write this up as a ticket the ${w("crew")} can work from. Outside a project it can't read any code, so its technical notes will be guesses: open a project first for a grounded one.`}
            onClick={write}>Write up as a ticket</button>}
          <button type="button" className="btn small" disabled={empty} title="Split this note into Mae tickets, one per piece of work: you choose which to file" onClick={turn}>Turn into tickets</button>
        </div>
      )}
    </div>
  );
}

// Text selected in the thread gets a small bar beside it: add it to the note you have open,
// start a new note with it, or (with a voice connected) have it read aloud. within: the id of the element whose text can be picked.
// target: the note open in the panel right now (nothing, when the panel is closed or on its list).
export function PickToNote({ within = "feed", active, onAdd }: { within?: string; active: boolean; onAdd: (text: string, fresh: boolean) => void }) {
  const { notes, open } = useNotes();
  const target = active ? notes.find((n) => n.id === open) : undefined;
  const voice = useContext(VoiceOn);
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
  // (The selection stays, so you can see what's being read.)
  const read = () => { readAloud(spokenLines(at.text), { what: "Selected text" }); setAt(null); };
  return (
    // (mousedown is kept from taking the selection away before the click lands)
    <div className="note-pick" role="toolbar" aria-label="For the selected text" style={{ left: at.left, top: at.top }} onMouseDown={(ev) => ev.preventDefault()}>
      {target && <button type="button" title={`Add the selected text to the end of “${titleOf(target)}”`} onClick={() => add(false)}><Icon name="note" /><span>Add to “{titleOf(target)}”</span></button>}
      <button type="button" title="Start a new note with the selected text" onClick={() => add(true)}>{!target && <Icon name="note" />}<span>{target ? "New note" : "Add to a note"}</span></button>
      {voice && <button type="button" title="Read the selected text aloud. It goes to ElevenLabs to be spoken." onClick={read}><Icon name="speaker" /><span>Read aloud</span></button>}
    </div>
  );
}
