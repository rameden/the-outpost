// The project dialog: name a project, say what it's about, and (optionally) point it at a
// folder on your disk. The Quartermaster is given all three at the start of every conversation
// filed under the project, so the description is the place for standing notes: what the
// project is, how you like the work done there, what to be careful with.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import type { CampState, History, PickResult, Project } from "../types.ts";

const NEW_FOLDER = "\u0000new"; // the "link another folder" choice in the folder list

export function ProjectDialog({ S, project, onClose, onSaved }: {
  S: CampState | null;
  project: Project | null;                       // null: a new project
  onClose: () => void;
  onSaved: (history: History, projectId: string) => void;
}) {
  const general = project?.id === "general";
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [folder, setFolder] = useState(project?.link ?? "");   // "", a linked folder's name, or NEW_FOLDER
  const [path, setPath] = useState("");
  const [access, setAccess] = useState<"read" | "write">("write");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const links = S?.links ?? [];

  useEffect(() => {
    nameInput.current?.focus();
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  // The browser can't see a folder's real path, so the camp opens your system's folder dialog.
  async function choose() {
    setError("");
    setPicking(true);
    try {
      const r = await api<PickResult>("/api/links/pick", {});
      if ("path" in r) {
        setPath(r.path);
        // A project named after its folder, unless you've already typed a name.
        setName((n) => n.trim() ? n : r.path.replace(/\/+$/, "").split("/").pop() ?? "");
      } else if ("unsupported" in r) setError(r.unsupported);
    } catch (e) { setError(errorText(e)); }
    setPicking(false);
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!name.trim()) { setError("Give the project a name."); nameInput.current?.focus(); return; }
    if (folder === NEW_FOLDER && !path.trim()) { setError("Choose the folder to link, or pick “No folder”."); return; }
    setSaving(true);
    setError("");
    try {
      const r = await api<{ history: History; project?: string }>("/api/history", {
        action: project ? "project.update" : "project.add",
        ...(project ? { id: project.id } : {}),
        name, description,
        ...(folder === NEW_FOLDER ? { folder: { path: path.trim(), access } } : { link: folder }),
      });
      onSaved(r.history, project?.id ?? r.project ?? "general");
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onSubmit={save}>
        <h2 id="project-dialog-title">{project ? `Edit ${project.name}` : "New project"}</h2>
        <label className="field">Name
          <input ref={nameInput} value={name} maxLength={60} placeholder="e.g. mi-web-app, Home network, Mae" onChange={(ev) => setName(ev.target.value)} />
        </label>
        <label className="field">Description
          <textarea value={description} rows={5} maxLength={4000}
            placeholder="What this project is, how you like the work done here, and anything to be careful with."
            onChange={(ev) => setDescription(ev.target.value)} />
          <span className="field-hint">The Quartermaster reads this at the start of every conversation in the project and passes on what matters to the crew.</span>
        </label>
        {!general && (
          <label className="field">Folder
            <select value={folder} onChange={(ev) => setFolder(ev.target.value)}>
              <option value="">No folder</option>
              {links.map((l) => <option key={l.name} value={l.name}>{l.name} · {l.path} ({l.access === "write" ? "can edit" : "read-only"})</option>)}
              <option value={NEW_FOLDER}>Link another folder…</option>
            </select>
            <span className="field-hint">The folder on your disk this project is about. The crew works there unless you say otherwise.</span>
          </label>
        )}
        {folder === NEW_FOLDER && (
          <div className="dialog-folder">
            <div className="dialog-folder-row">
              <button type="button" className="btn small" disabled={picking} onClick={choose}>{picking ? "Choosing…" : "Choose folder…"}</button>
              <input value={path} placeholder="/Users/you/Projects/site" aria-label="Folder path" spellCheck={false} autoComplete="off" onChange={(ev) => setPath(ev.target.value)} />
            </div>
            <div className="link-access">
              <label><input type="radio" name="projectAccess" checked={access === "write"} onChange={() => setAccess("write")} /> Can edit</label>
              <label><input type="radio" name="projectAccess" checked={access === "read"} onChange={() => setAccess("read")} /> Read-only</label>
            </div>
            <span className="field-hint">The crew reads the folder where it is; nothing is uploaded.</span>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : project ? "Save" : "Create project"}</button>
        </div>
      </form>
    </>
  );
}
