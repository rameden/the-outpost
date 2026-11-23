// The crew dialog: add a crew member of your own, or change one you added.
//
// A crew member is who they are (name, role, personality, where their job ends), how they work,
// and what they're able to do. Everyone can read and search files and keeps their own memory;
// the abilities here add the rest. The Quartermaster sees the role line when choosing who to
// send, and you can message a crew member directly with @handle.
// Model, effort, and turn limit are set from their card afterwards, like anyone's.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { cx, nameNow } from "../format.ts";
import type { Character } from "../types.ts";
import { ask } from "./Confirm.tsx";

export const CREW_COLORS = ["teal", "rose", "blue", "gold", "green", "violet", "slate"];
const handleFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

export function CrewDialog({ member, onClose, onSaved }: {
  member: Character | null;          // null: a new crew member
  onClose: () => void;
  onSaved: () => void;
}) {
  const a = member?.abilities ?? {};
  const [name, setName] = useState(member?.name ?? "");
  const [emoji, setEmoji] = useState(member?.emoji ?? "");
  const [handle, setHandle] = useState(member?.id ?? "");
  const [typedHandle, setTypedHandle] = useState(!!member);
  const [color, setColor] = useState(member?.color ?? CREW_COLORS[0]);
  const [role, setRole] = useState(member?.role ?? "");
  const [personality, setPersonality] = useState(member?.personality ?? "");
  const [handles, setHandles] = useState(member?.handles ?? "");
  const [notFor, setNotFor] = useState(member?.notFor ?? "");
  const [persona, setPersona] = useState(member?.persona ?? "");
  const [web, setWeb] = useState(!!a.web);
  const [write, setWrite] = useState<"" | "outputs" | "project">(a.write ?? "outputs");
  const [shell, setShell] = useState(!!a.shell);
  const [wiki, setWiki] = useState(member ? !!a.wiki : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.focus();
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function send(body: object) {
    setSaving(true);
    setError("");
    try { await api("/api/crew", body); onSaved(); }
    catch (e) { setError(errorText(e)); setSaving(false); }
  }
  function save(ev: FormEvent) {
    ev.preventDefault();
    if (!name.trim()) { setError("Give the crew member a name."); nameInput.current?.focus(); return; }
    if (!role.trim()) { setError("Say in one line what they're for."); return; }
    const details = {
      id: handle, name, emoji, color, role, personality, handles, notFor, persona,
      abilities: { web, ...(write ? { write } : {}), shell, wiki },
    };
    void send(member ? { action: "update", id: member.id, member: details } : { action: "add", member: details });
  }
  async function remove() {
    if (!member) return;
    if (await ask({ title: `Remove ${member.name} from the crew?`, body: `Their memory and files stay in camp/agents/${member.id}/, and adding a crew member with the same handle later picks those up.`, action: "Remove", danger: true })) void send({ action: "remove", id: member.id });
  }

  // Reading the web and being able to change things is the combination to think twice about.
  const risky = web && (write === "project" || shell);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="crew-dialog-title" onSubmit={save}>
        <h2 id="crew-dialog-title">{member ? `Edit ${member.name}` : "New crew member"}</h2>
        <div className="dialog-row">
          <label className="field dialog-emoji">Icon
            <input value={emoji} maxLength={8} placeholder="✦" aria-label="Icon (an emoji)" onChange={(ev) => setEmoji(ev.target.value)} />
          </label>
          <label className="field">Name
            <input ref={nameInput} value={name} maxLength={24} placeholder="e.g. Cartographer, Tester, Analyst"
              onChange={(ev) => { setName(ev.target.value); if (!typedHandle) setHandle(handleFrom(ev.target.value)); }} />
          </label>
          <label className="field">Handle
            <input value={handle} maxLength={20} disabled={!!member} placeholder="cartographer" spellCheck={false}
              onChange={(ev) => { setTypedHandle(true); setHandle(handleFrom(ev.target.value)); }} />
          </label>
        </div>
        <div className="field-hint dialog-under">{member ? `You message them with @${member.id}. The handle can't change: their memory and history are filed under it.` : `You'll message them with @${handle || "handle"}.`}</div>

        <div className="field" role="group" aria-label="Colour">Colour
          <div className="dialog-swatches">
            {CREW_COLORS.map((c) => (
              <button key={c} type="button" className={cx("swatch", `c-x-${c}`, color === c && "selected")} aria-label={c} aria-pressed={color === c} title={c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        <label className="field">What they're for
          <input value={role} maxLength={160} placeholder="Testing: writes and runs tests, and reports what fails and why." onChange={(ev) => setRole(ev.target.value)} />
          <span className="field-hint">One line. The {nameNow("Quartermaster")} reads this when choosing who to send.</span>
        </label>
        <label className="field">How they work
          <textarea value={persona} rows={4} maxLength={4000}
            placeholder="How they should go about the job: what to check first, what a good result looks like, what to hand back."
            onChange={(ev) => setPersona(ev.target.value)} />
        </label>

        <details className="dialog-more">
          <summary>Personality and boundaries (optional)</summary>
          <label className="field">Personality
            <input value={personality} maxLength={240} placeholder="Meticulous and a little dry. Never says a test passed without running it." onChange={(ev) => setPersonality(ev.target.value)} />
          </label>
          <label className="field">They handle
            <input value={handles} maxLength={300} placeholder="writing tests, running test suites, reproducing bugs" onChange={(ev) => setHandles(ev.target.value)} />
          </label>
          <label className="field">Not theirs
            <input value={notFor} maxLength={300} placeholder={`fixing the code under test (the ${nameNow("Artificer")}), prose (the ${nameNow("Scribe")})`} onChange={(ev) => setNotFor(ev.target.value)} />
            <span className="field-hint">Asked for something outside their job, a crew member declines in one line and names who should take it.</span>
          </label>
        </details>

        <div className="field" role="group" aria-label="Abilities">What they can do
          <span className="field-hint">Everyone can read and search files in the conversation's project, and keeps their own memory.</span>
          <label className="dialog-check"><input type="checkbox" checked={web} onChange={(ev) => setWeb(ev.target.checked)} /> Search the web and fetch pages</label>
          <label className="dialog-check dialog-check-select">Write files
            <select aria-label="Write files" value={write} onChange={(ev) => setWrite(ev.target.value as typeof write)}>
              <option value="">No</option>
              <option value="outputs">Only in their own outputs folder</option>
              <option value="project">In projects too (create and edit files)</option>
            </select>
          </label>
          <label className="dialog-check"><input type="checkbox" checked={shell} onChange={(ev) => setShell(ev.target.checked)} /> Run shell commands (they ask you first, as the {nameNow("Artificer")} does)</label>
          <label className="dialog-check"><input type="checkbox" checked={wiki} onChange={(ev) => setWiki(ev.target.checked)} /> Save findings to the camp wiki's notes</label>
          {risky && (
            <div className="dialog-warn" role="note">
              This crew member reads the web and can also change things. A page they read could try to talk them into a change you didn't ask for.
              The {nameNow("Scout")} is limited to its own outputs folder for that reason. If you keep both, read their plans and approvals with that in mind.
            </div>
          )}
        </div>
        <div className="field-hint">Their model, effort, and turn limit are set from their card: click the model line under their name.</div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          {member && <button type="button" className="btn danger dialog-remove" disabled={saving} onClick={remove}>Remove from the crew</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : member ? "Save" : "Add to the crew"}</button>
        </div>
      </form>
    </>
  );
}
