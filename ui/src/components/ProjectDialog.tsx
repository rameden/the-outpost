// The project dialog: name a project, say what it's about, point it at folders on your disk, pin
// references, and set its defaults. The crew is given the description, the folders, and the
// pinned references at the start of every conversation filed under the project, so the
// description is the place for standing notes: what the project is, how you like the work done
// there, what to be careful with.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { autoName, isAuto, nameNow, shortModel } from "../format.ts";
import type { CampState, History, PickResult, Project, ProjectSettings } from "../types.ts";
import { AUTO_CHOICES, useModelList } from "./ModelPicker.tsx";
import { Icon } from "./bits.tsx";
import { Dialog } from "./Dialog.tsx";

import { w } from "../words.ts";
type NewFolder = { path: string; access: "read" | "write" };
const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? "";

export function ProjectDialog({ S, project, onClose, onSaved }: {
  S: CampState | null;
  project: Project | null;                       // null: a new project
  onClose: () => void;
  onSaved: (history: History, projectId: string) => void;
}) {
  const general = project?.id === "general";
  const st = project?.settings ?? {};
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [links, setLinks] = useState<string[]>(project?.links ?? []);
  const [folders, setFolders] = useState<NewFolder[]>([]);          // folders to link when you save
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [access, setAccess] = useState<"read" | "write">("write");
  const [pins, setPins] = useState((project?.pins ?? []).join("\n"));
  const [workIn, setWorkIn] = useState(st.workIn ?? "");
  const [web, setWeb] = useState(st.web ?? "");
  const [approval, setApproval] = useState(st.approval ?? "");
  const [review, setReview] = useState(st.review ?? "");
  const [budget, setBudget] = useState(st.budgetUsd ? String(st.budgetUsd) : "");
  const [agents, setAgents] = useState<NonNullable<ProjectSettings["agents"]>>(st.agents ?? {});
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const { list: models } = useModelList(S?.runtime ?? "claude-code");
  const allLinks = S?.links ?? [];
  const free = allLinks.filter((l) => !links.includes(l.name));

  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function addFolder(p: string) {
    const clean = p.trim();
    if (!clean) return;
    setFolders((list) => (list.some((f) => f.path === clean) ? list : [...list, { path: clean, access }]));
    setName((n) => (n.trim() ? n : baseName(clean))); // a project named after its folder, unless you've typed a name
    setPath("");
    setAdding(false);
  }
  // The browser can't see a folder's real path, so the camp opens your system's folder dialog.
  async function choose() {
    setError("");
    setPicking(true);
    try {
      const r = await api<PickResult>("/api/links/pick", {});
      if ("path" in r) addFolder(r.path);
      else if ("unsupported" in r) setError(r.unsupported);
    } catch (e) { setError(errorText(e)); }
    setPicking(false);
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!name.trim()) { setError("Give the project a name."); nameInput.current?.focus(); return; }
    const pending = adding && path.trim() ? [...folders, { path: path.trim(), access }] : folders;
    setSaving(true);
    setError("");
    try {
      const settings: ProjectSettings = {
        ...(workIn ? { workIn: "worktree" as const } : {}), ...(web ? { web: web as ProjectSettings["web"] } : {}),
        ...(approval ? { approval: approval as ProjectSettings["approval"] } : {}), ...(review ? { review: review as ProjectSettings["review"] } : {}), ...(budget.trim() ? { budgetUsd: Number(budget) } : {}),
        ...(Object.keys(agents).length ? { agents } : {}),
      };
      const r = await api<{ history: History; project?: string }>("/api/history", {
        action: project ? "project.update" : "project.add",
        ...(project ? { id: project.id } : {}),
        name, description, links, pins: pins.split("\n"), settings,
        ...(pending.length ? { folders: pending } : {}),
      });
      onSaved(r.history, project?.id ?? r.project ?? "general");
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const setAgent = (id: string, patch: { model?: string; effort?: string }) => setAgents((all) => {
    const next = { ...all };
    const merged = { ...(next[id] ?? {}), ...patch };
    if (!merged.model) delete next[id]; else next[id] = merged;
    return next;
  });
  const customized = [workIn, web, approval, review, budget.trim(), Object.keys(agents).length ? "x" : ""].filter(Boolean).length;

  return (
    <Dialog as="form" className="dialog" labelledBy="project-dialog-title" onClose={onClose} onSubmit={save}>
        <h2 id="project-dialog-title">{project ? `Edit ${project.name}` : "New project"}</h2>
        <label className="field">Name
          <input ref={nameInput} value={name} maxLength={60} placeholder="e.g. mi-web-app, Home network" onChange={(ev) => setName(ev.target.value)} />
        </label>
        <label className="field">Description
          <textarea value={description} rows={5} maxLength={4000}
            placeholder="What this project is, how you like the work done here, and anything to be careful with."
            onChange={(ev) => setDescription(ev.target.value)} />
          <span className="field-hint">The {w("crew")} reads this at the start of every conversation in the project.</span>
        </label>

        {!general && (
          <div className="field" role="group" aria-label="Folders">Folders
            <div className="dialog-chips">
              {links.map((l) => {
                const link = allLinks.find((x) => x.name === l);
                return (
                  <span key={l} className="dialog-chip" title={link?.path}><Icon name="folder" /> links/{l}/ <small>{link ? (link.access === "write" ? "can edit" : "read-only") : "not linked any more"}</small>
                    <button type="button" className="att-x" aria-label={`Remove ${l} from this project`} onClick={() => setLinks((list) => list.filter((x) => x !== l))}>×</button>
                  </span>
                );
              })}
              {folders.map((f) => (
                <span key={f.path} className="dialog-chip" title={f.path}><Icon name="folder" /> {baseName(f.path)} <small>{f.access === "write" ? "can edit" : "read-only"} · linked when you save</small>
                  <button type="button" className="att-x" aria-label={`Don't link ${f.path}`} onClick={() => setFolders((list) => list.filter((x) => x.path !== f.path))}>×</button>
                </span>
              ))}
              {!links.length && !folders.length && <span className="field-hint">None. The {w("crew")} won't see any of your linked folders in this project.</span>}
            </div>
            <div className="dialog-folder-row">
              {free.length > 0 && (
                <select aria-label="Add a folder that's already linked" value="" onChange={(ev) => { if (ev.target.value) setLinks((list) => [...list, ev.target.value]); }}>
                  <option value="">Add a linked folder…</option>
                  {free.map((l) => <option key={l.name} value={l.name}>{l.name} · {l.path}</option>)}
                </select>
              )}
              <button type="button" className="btn small" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Link another folder…"}</button>
            </div>
            {adding && (
              <div className="dialog-folder">
                <div className="dialog-folder-row">
                  <button type="button" className="btn small" disabled={picking} onClick={choose}>{picking ? "Choosing…" : "Choose folder…"}</button>
                  <input value={path} placeholder="/Users/you/Projects/site" aria-label="Folder path" spellCheck={false} autoComplete="off"
                    onChange={(ev) => setPath(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addFolder(path); } }} />
                  <button type="button" className="btn small" onClick={() => addFolder(path)}>Add</button>
                </div>
                <div className="link-access">
                  <label><input type="radio" name="projectAccess" checked={access === "write"} onChange={() => setAccess("write")} /> Can edit</label>
                  <label><input type="radio" name="projectAccess" checked={access === "read"} onChange={() => setAccess("read")} /> Read-only</label>
                </div>
              </div>
            )}
            <span className="field-hint">The folders on your disk this project is about. Conversations here can use these and no other linked folders, unless you attach one.</span>
          </div>
        )}

        <label className="field">Pinned references
          <textarea value={pins} rows={2} spellCheck={false} placeholder={"links/app/docs/architecture.md\nhttps://example.com/api-reference"} onChange={(ev) => setPins(ev.target.value)} />
          <span className="field-hint">One per line: a file as the {w("crew")} sees it (links/…, camp/wiki/…) or a web address. Files are shown to the {w("crew")} in every conversation here; addresses are listed for them to fetch.</span>
        </label>

        <details className="dialog-more">
          <summary>Defaults for this project{customized ? ` (${customized} set)` : ""}</summary>
          {!general && (
            <label className="field">Where to work
              <select value={workIn} onChange={(ev) => setWorkIn(ev.target.value as "" | "worktree")}>
                <option value="">The linked checkout</option>
                <option value="worktree">A new worktree and branch for each conversation</option>
              </select>
            </label>
          )}
          <label className="field">Web access
            <select value={web} onChange={(ev) => setWeb(ev.target.value as "" | "careful" | "off")}>
              <option value="">On</option>
              <option value="careful">On, but confidential: keep this project's names and code out of searches</option>
              <option value="off">Off: no web search or fetch here</option>
            </select>
            {web === "careful" && <span className="field-hint">This is an instruction to the {w("crew")}, not a filter: nothing checks what they search for.</span>}
          </label>
          <label className="field">Shell commands
            <select value={approval} onChange={(ev) => setApproval(ev.target.value as typeof approval)}>
              <option value="">Same as the {w("camp")} ({S?.settings.approval ?? "safe"})</option>
              <option value="ask">Ask about every command</option>
              <option value="safe">Run simple read-only commands; ask about the rest</option>
              {S?.sandbox?.available && <option value="sandbox">Run the rest in the sandbox without asking</option>}
              <option value="god">God mode: run everything without asking, unsandboxed</option>
            </select>
          </label>
          <label className="field">Review changes before reporting
            <select value={review} onChange={(ev) => setReview(ev.target.value as typeof review)}>
              <option value="">Same as the {w("camp")} ({S?.settings.reviewChanges ? "on" : "off"})</option>
              <option value="on">Always here: the {nameNow("Warden")} reads the diff first</option>
              <option value="off">Never here</option>
            </select>
            <span className="field-hint">Each review is another {w("quest")}'s worth of usage. This project's page shows what its reviews have been finding.</span>
          </label>
          <label className="field">Budget per {w("expedition")} ($)
            <input type="number" min="0" step="0.25" value={budget} placeholder={S?.budgetUsd ? `Same as the ${w("camp")} ($${S.budgetUsd})` : `Same as the ${w("camp")} (none)`} onChange={(ev) => setBudget(ev.target.value)} />
          </label>
          <div className="field" role="group" aria-label="Models">Models
            {S?.characters.map((c) => {
              const mine = agents[c.id];
              const efforts = models?.models.find((m) => m.id === mine?.model)?.efforts ?? [];
              return (
                <div key={c.id} className="dialog-model">
                  <span>{c.emoji} {c.name}</span>
                  <select aria-label={`${c.name}'s model in this project`} value={mine?.model ?? ""} onChange={(ev) => setAgent(c.id, { model: ev.target.value, effort: "" })}>
                    <option value="">Same as the {w("camp")} ({shortModel(c.model)})</option>
                    {mine?.model && !isAuto(mine.model) && !models?.models.some((m) => m.id === mine.model) && <option value={mine.model}>{shortModel(mine.model)}</option>}
                    {AUTO_CHOICES.map((a) => <option key={a.id} value={a.id}>{autoName(a.id)}</option>)}
                    {models?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select aria-label={`${c.name}'s effort in this project`} value={mine?.effort ?? ""} disabled={!mine?.model} onChange={(ev) => setAgent(c.id, { effort: ev.target.value })}>
                    <option value="">default effort</option>
                    {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </details>

        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : project ? "Save" : "Create project"}</button>
        </div>
    </Dialog>
  );
}
