// Editing an installed skill, in the page: its SKILL.md and the text files beside it (scripts,
// reference pages), and adding a file. Saved to skills/<owner>/<name>/ as you save each file;
// the crew reads the new version from their next run. A script you let run without asking stays
// approved when you change it here, pinned to what you saved: the change is yours.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { cx } from "../format.ts";
import type { SkillDetail } from "../types.ts";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 102.4) / 10} KB`);
const q = (owner: string, name: string, path?: string) => `/api/skills/files?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}${path ? `&path=${encodeURIComponent(path)}` : ""}`;

export function SkillEditor({ owner, name, onClose, onSaved }: { owner: string; name: string; onClose: () => void; onSaved: () => void }) {
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [path, setPath] = useState("SKILL.md");
  const [kept, setKept] = useState<string | null>(null); // the file as it's saved (null: not loaded)
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // the name being typed for a new file
  const box = useRef<HTMLTextAreaElement>(null);
  const dirty = kept !== null && text !== kept;

  useEffect(() => {
    let gone = false;
    api<SkillDetail>(q(owner, name)).then((d) => { if (!gone) setSkill(d); }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
  }, [owner, name]);
  useEffect(() => {
    let gone = false;
    setKept(null); setError("");
    api<{ text: string }>(q(owner, name, path)).then((d) => { if (!gone) { setKept(d.text); setText(d.text); } }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
  }, [owner, name, path]);

  // Leaving with changes you haven't saved is asked about once: the next try goes through.
  const [warned, setWarned] = useState(false);
  const leave = useCallback((go: () => void) => {
    if (dirty && !warned) { setWarned(true); setNote("You've changed this file and not saved it. Save it, or do that again to leave without saving."); return; }
    setWarned(false); setNote("");
    go();
  }, [dirty, warned]);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); leave(onClose); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [leave, onClose]);

  async function save(ev?: FormEvent) {
    ev?.preventDefault();
    if (!dirty || busy) return;
    setBusy(true); setError(""); setNote(""); setWarned(false);
    try {
      const r = await api<SkillDetail & { stillApproved: boolean }>("/api/skills/save", { owner, name, path, text });
      setSkill(r); setKept(text);
      setNote(r.stillApproved ? "Saved. It still runs without asking, as you've just written it." : "Saved. The crew reads it from their next run.");
      onSaved();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  async function add(ev: FormEvent) {
    ev.preventDefault();
    const file = (adding ?? "").trim();
    if (!file) return setAdding(null);
    setBusy(true); setError("");
    try {
      setSkill(await api<SkillDetail>("/api/skills/save", { owner, name, path: file, text: "", create: true }));
      setAdding(null); setPath(file); onSaved();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  const approved = skill?.commands.find((c) => c.endsWith(` skills/${owner}/${name}/${path}`));

  return (
    <>
      <div className="drawer-backdrop" onClick={() => leave(onClose)} />
      <form className="dialog file-view skill-editor" role="dialog" aria-modal="true" aria-label={`Edit the skill ${owner}/${name}`} onSubmit={save}>
        <header className="file-head">
          <b>skills/{owner}/{name}/{path}</b>
          <small>{dirty ? "changed, not saved" : kept !== null ? "saved" : ""}</small>
          <button type="button" className="hist-icon" aria-label="Close the editor" title="Close (Esc)" onClick={() => leave(onClose)}>×</button>
        </header>
        <div className="skill-editor-body">
          <nav className="skill-editor-files" aria-label="The skill's files">
            {skill?.files.map((f) => (
              <button key={f.path} type="button" className={cx("skill-editor-file", f.path === path && "on")} aria-current={f.path === path ? "true" : undefined} disabled={!f.text}
                title={f.text ? f.path : `${f.path} isn't text, so it can't be edited here`} onClick={() => { if (f.path !== path) leave(() => setPath(f.path)); }}>
                <span>{f.path}</span><small>{kb(f.size)}</small>
              </button>
            ))}
            {adding === null
              ? <button type="button" className="linkish skill-editor-add" onClick={() => leave(() => setAdding(""))}>Add a file…</button>
              : <input autoFocus aria-label="The new file's path" placeholder="references/notes.md" value={adding} spellCheck={false} autoCapitalize="off"
                  onChange={(ev) => setAdding(ev.target.value)} onBlur={() => { if (!adding.trim()) setAdding(null); }}
                  onKeyDown={(ev) => { if (ev.key === "Enter") void add(ev); else if (ev.key === "Escape") { ev.stopPropagation(); setAdding(null); } }} />}
          </nav>
          {kept === null
            ? <div className="ft-note">{error ? "" : "Opening…"}</div>
            : <textarea ref={box} className="skill-editor-text" aria-label={`The text of ${path}`} value={text} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                onChange={(ev) => { setText(ev.target.value); setNote(""); setWarned(false); }}
                onKeyDown={(ev) => {
                  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); void save(); }
                  else if (ev.key === "Tab" && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); document.execCommand?.("insertText", false, "  "); } // Tab indents; Esc first, then Tab, to move on
                }} />}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <span className="meta skill-editor-note" role="status">{note || (path === "SKILL.md"
            ? "Keep the front matter at the top: the name (the skill's folder) and a one-line description, which is all a crew member sees until they open it."
            : approved ? "You let this script run without asking. It stays that way when you save: the change is yours." : "")}</span>
          {dirty && <button type="button" className="btn" onClick={() => { setText(kept ?? ""); setNote(""); setWarned(false); }}>Undo changes</button>}
          <button type="submit" className="btn primary" disabled={!dirty || busy} title="Save this file (⌘S / Ctrl+S)">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </>
  );
}
