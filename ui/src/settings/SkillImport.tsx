// Importing a packaged skill: a .skill file (a zip of a skill's folder: SKILL.md beside its
// scripts and reference pages). You choose the file, the camp shows what's in it (nothing is
// written and nothing in it runs), and only then do you install it: who gets it, and which of
// its commands, if any, may run without asking.

import { useRef, useState } from "react";
import { api, errorText } from "../api.ts";
import type { CampState, PackPreview } from "../types.ts";

const MAX = 8 * 1024 * 1024;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 102.4) / 10} KB`);
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function SkillImport({ S, refresh }: { S: CampState; refresh: () => void }) {
  const pick = useRef<HTMLInputElement>(null);
  const [pack, setPack] = useState<PackPreview | null>(null);
  const [owner, setOwner] = useState("shared");
  const [scripts, setScripts] = useState<string[]>([]);
  const [commands, setCommands] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function open(file: File) {
    setError(""); setDone(""); setPack(null);
    if (file.size > MAX) return setError("That file is over 8 MB, which is more than a skill needs.");
    setBusy(true);
    try { setPack(await api<PackPreview>("/api/skills/inspect", { name: file.name, data: await toBase64(file) })); setOwner("shared"); setScripts([]); setCommands(""); }
    catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  const replaces = !!pack?.installed.includes(owner);
  async function install() {
    if (!pack) return;
    setBusy(true); setError("");
    try {
      const r = await api<{ owner: string; name: string; files: number; commands: string[] }>("/api/skills/install",
        { id: pack.id, owner, scripts, commands: commands.split("\n").map((c) => c.trim()).filter(Boolean), replace: replaces });
      setDone(`Installed ${r.owner}/${r.name} (${r.files} ${r.files === 1 ? "file" : "files"})${r.commands.length ? `, with ${r.commands.length} ${r.commands.length === 1 ? "command" : "commands"} that run without asking` : ""}.`);
      setPack(null);
      refresh();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  const who = (id: string) => { const c = S.characters.find((x) => x.id === id); return c ? `${c.emoji} ${c.name} only` : id; };

  return (
    <div className="wiki-group skill-import">
      <h4>Import a packaged skill</h4>
      <p>A <code>.skill</code> file is a zip of a skill's folder: its SKILL.md, with any scripts and reference pages beside it. Choosing one only opens it for you to look at.</p>
      <input ref={pick} type="file" accept=".skill,.zip,application/zip" hidden aria-label="A .skill file" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void open(f); }} />
      {!pack && <div className="card-actions"><button type="button" className="btn small" disabled={busy} onClick={() => pick.current?.click()}>{busy ? "Opening…" : "Choose a .skill file…"}</button>{done && <span className="meta" role="status">{done}</span>}</div>}
      {pack && (
        <form className="card" aria-label={`Install ${pack.name}`} onSubmit={(ev) => { ev.preventDefault(); void install(); }}>
          <div className="card-top"><span className="who">{pack.name}</span><span className={replaces ? "pill live" : "pill"}>{replaces ? "Replaces the one installed" : "Not installed yet"}</span></div>
          <div className="meta">{pack.description}</div>
          <details><summary>SKILL.md</summary><pre className="raw">{pack.body}</pre></details>
          <details><summary>{pack.files.length} {pack.files.length === 1 ? "file" : "files"}</summary>
            <ul className="skill-files">{pack.files.map((f) => <li key={f.path}><code>{f.path}</code><span className="meta">{kb(f.size)}</span></li>)}</ul>
            {pack.skipped.length > 0 && <div className="meta">Left out (hidden, or not a name a skill's file can have): {pack.skipped.join(", ")}</div>}
          </details>
          <label className="field">Who gets it
            <select value={owner} onChange={(ev) => setOwner(ev.target.value)}>
              <option value="shared">Everyone (shared)</option>
              {S.characters.map((c) => <option key={c.id} value={c.id}>{who(c.id)}</option>)}
            </select>
          </label>
          {pack.scripts.length > 0 && (
            <fieldset className="skill-scripts">
              <legend>Its scripts</legend>
              <div className="field-hint">Ticked, a script runs without asking whenever a crew member calls it exactly as written, for as long as the file stays as it is now. Unticked, it asks you each time, like any other command. Read a script before you tick it: it runs as you, outside the sandbox.</div>
              {pack.scripts.map((s) => (
                <div key={s.file} className="skill-script">
                  <label className="dialog-check"><input type="checkbox" checked={scripts.includes(s.file)} onChange={(ev) => setScripts((l) => (ev.target.checked ? [...l, s.file] : l.filter((x) => x !== s.file)))} />
                    <code>{s.runner} skills/{owner}/{pack.name}/{s.file}</code></label>
                  <details><summary>Read it</summary><pre className="raw">{s.text}</pre></details>
                </div>
              ))}
            </fieldset>
          )}
          <label className="field">Other commands it may run without asking
            <textarea aria-label="Other commands it may run without asking" rows={2} spellCheck={false} placeholder={"One per line, like: pnpm add"} value={commands} onChange={(ev) => setCommands(ev.target.value)} />
            <span className="field-hint">Each is the start of a command. They apply to the whole crew while the skill is installed, and go when it's removed. A command still has to be one simple command that stays inside the camp; anything else asks as usual.</span>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="card-actions">
            <button type="submit" className="btn small primary" disabled={busy}>{busy ? "Installing…" : replaces ? "Replace the installed skill" : "Install"}</button>
            <button type="button" className="btn small" onClick={() => { setPack(null); setError(""); }}>Cancel</button>
          </div>
        </form>
      )}
      {!pack && error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}
