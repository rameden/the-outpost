// Settings → Terminal: the terminal's quick actions. Each is a chip in the terminal's header that
// runs a command of yours: in the terminal you're looking at, or in a new one (which can start in a
// linked folder, for the likes of a dev server). Several commands run as a chain. At most five.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import type { CampState, TermAction } from "../types.ts";

export const TERM_ACTIONS_MAX = 5;
// One being edited: its commands as the text in the box, one to a line.
type Draft = Omit<TermAction, "commands"> & { commands: string };
const toDraft = (a: TermAction): Draft => ({ ...a, commands: a.commands.join("\n") });
const blank = (): Draft => ({ label: "", commands: "", where: "current" });
const STARTERS: { say: string; make: Draft }[] = [
  { say: "Push", make: { label: "Push", commands: "git push origin HEAD", where: "current" } },
  { say: "Pull", make: { label: "Pull", commands: "git pull --rebase", where: "current" } },
  { say: "Dev server", make: { label: "Dev", commands: "pnpm install\npnpm dev", where: "new" } },
];
// What the chain comes to in the shell, as you'd type it.
const asTyped = (commands: string) => commands.split("\n").map((l) => l.trim()).filter(Boolean).join(" && ");

export function TerminalActions({ S, refresh }: { S: CampState; refresh: () => void }) {
  const saved = S.settings.termActions ?? [];
  const [list, setList] = useState<Draft[]>(() => saved.map(toDraft));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // What's kept changed under us (another tab): show that, unless you're part-way through an edit.
  const key = JSON.stringify(saved);
  const [seen, setSeen] = useState(key);
  const dirty = JSON.stringify(list) !== JSON.stringify(JSON.parse(seen).map(toDraft));
  useEffect(() => { if (key !== seen && !dirty) { setSeen(key); setList(saved.map(toDraft)); } }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (i: number, part: Partial<Draft>) => { setDone(false); setError(""); setList((l) => l.map((a, j) => (j === i ? { ...a, ...part } : a))); };
  const move = (i: number, by: number) => { setDone(false); setList((l) => { const next = [...l]; const [a] = next.splice(i, 1); next.splice(i + by, 0, a); return next; }); };
  const add = (a: Draft) => { setDone(false); setError(""); setList((l) => (l.length < TERM_ACTIONS_MAX ? [...l, a] : l)); };

  async function save() {
    setBusy(true); setError("");
    try {
      const r = await api<{ termActions: TermAction[] }>("/api/term/actions", { actions: list.map((a) => ({ ...a, commands: a.commands.split("\n") })) });
      setList(r.termActions.map(toDraft)); setSeen(JSON.stringify(r.termActions)); setDone(true);
      refresh();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  const full = list.length >= TERM_ACTIONS_MAX;
  return (
    <>
      <p className="set-note">Quick actions are chips at the top of the terminal: one click runs a command of yours, in the terminal you're looking at or in a new one. Up to {TERM_ACTIONS_MAX}, shown in this order. They're kept in <code>camp/settings.json</code>, which no crew member can read or change.</p>
      {list.map((a, i) => {
        const n = `Quick action ${i + 1}`;
        const chain = asTyped(a.commands);
        return (
          <fieldset key={i} className="term-action" aria-label={n}>
            <div className="ta-top">
              <label className="field ta-name">Name on the chip
                <input value={a.label} maxLength={14} placeholder="Push" aria-label={`${n}: name`} onChange={(ev) => change(i, { label: ev.target.value })} />
              </label>
              <label className="field">Where it runs
                <select value={a.where} aria-label={`${n}: where it runs`} onChange={(ev) => change(i, { where: ev.target.value as Draft["where"] })}>
                  <option value="current">In the terminal I'm looking at</option>
                  <option value="new">In a new terminal</option>
                </select>
              </label>
              <span className="ta-tools">
                <button type="button" className="btn small" aria-label={`Move ${a.label || n} up`} title="Move it earlier" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn small" aria-label={`Move ${a.label || n} down`} title="Move it later" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn small danger" aria-label={`Remove ${a.label || n}`} onClick={() => { setDone(false); setError(""); setList((l) => l.filter((_, j) => j !== i)); }}>Remove</button>
              </span>
            </div>
            {a.where === "new" && (
              <div className="ta-top">
                <label className="field">Start in
                  <select value={a.folder ?? ""} aria-label={`${n}: folder`} onChange={(ev) => change(i, { folder: ev.target.value || undefined, ...(ev.target.value ? {} : { sub: undefined }) })}>
                    <option value="">The project I'm in (its first folder)</option>
                    {S.links.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
                    {a.folder && !S.links.some((l) => l.name === a.folder) && <option value={a.folder}>{a.folder} (no longer linked)</option>}
                  </select>
                </label>
                {a.folder && (
                  <label className="field ta-sub">A folder inside it (optional)
                    <input value={a.sub ?? ""} placeholder="apps/web" spellCheck={false} autoCapitalize="off" aria-label={`${n}: folder inside ${a.folder}`} onChange={(ev) => change(i, { sub: ev.target.value || undefined })} />
                  </label>
                )}
              </div>
            )}
            <label className="field">Commands <span className="field-hint">One per line. With more than one, each runs only if the one before it succeeded.</span>
              <textarea value={a.commands} rows={Math.min(6, Math.max(2, a.commands.split("\n").length))} spellCheck={false} autoCapitalize="off" placeholder="git push origin HEAD"
                aria-label={`${n}: commands`} onChange={(ev) => change(i, { commands: ev.target.value })} />
            </label>
            {chain.includes(" && ") && <div className="ta-typed">Typed as <code>{chain}</code></div>}
            <label className="fb-keep"><input type="checkbox" checked={!a.ask} onChange={(ev) => change(i, { ask: ev.target.checked ? undefined : true })} /> Run it straight away
              <span className="field-hint">{a.ask ? "It's typed in, and waits for you to press Enter." : "Untick to have it typed in and wait for your Enter (for something you'd rather read first)."}</span></label>
          </fieldset>
        );
      })}
      {!list.length && <p className="set-note">None yet. Start from one of these, or add your own:</p>}
      <div className="set-actions">
        <button type="button" className="btn small" disabled={full} title={full ? `That's all ${TERM_ACTIONS_MAX}. Remove one to add another.` : undefined} onClick={() => add(blank())}>Add a quick action</button>
        {!list.length && STARTERS.map((s) => <button key={s.say} type="button" className="btn small" onClick={() => add({ ...s.make })}>{s.say}</button>)}
        <span className="ta-count">{list.length} of {TERM_ACTIONS_MAX}</span>
        <button type="button" className="btn small primary" disabled={busy || !dirty} onClick={save}>Save</button>
        {done && !dirty && <span className="work-done" role="status">Saved. They're in the terminal now.</span>}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </>
  );
}
