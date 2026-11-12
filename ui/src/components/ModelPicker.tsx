// The model picker for one crew member: model, effort, and how many turns a run may take.

import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.ts";
import type { Character, ModelList } from "../types.ts";

// The model list, per runtime (your subscription and the API offer different models).
const lists = new Map<string, ModelList>();

// The model list for this runtime, loaded once and shared (the picker and the Settings page).
// A provider was connected or disconnected: the lists are out of date.
export const forgetModelLists = () => lists.clear();
// The options of a model <select>: Claude's first, then each connected provider's under its own heading.
export function ModelOptions({ models, defaultModel }: { models: ModelList["models"]; defaultModel?: string }) {
  const label = (x: ModelList["models"][number]) => `${x.name}${x.price ? ` · ${x.price}` : ""}${x.id === defaultModel ? " (default)" : ""}`;
  const groups = [...new Set(models.filter((m) => m.provider).map((m) => m.provider!))];
  return (
    <>
      {models.filter((m) => !m.provider).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
      {groups.map((g) => <optgroup key={g} label={g}>{models.filter((m) => m.provider === g).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</optgroup>)}
    </>
  );
}
export function useModelList(runtime: string) {
  const [list, setList] = useState<ModelList | null>(lists.get(runtime) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (lists.has(runtime)) return void setList(lists.get(runtime)!);
    let gone = false;
    api<ModelList>("/api/models").then(
      (l) => { lists.set(runtime, l); if (!gone) setList(l); },
      (e) => { if (!gone) setError(errorText(e)); },
    );
    return () => { gone = true; };
  }, [runtime]);
  return { list, error };
}

export function ModelPicker({ c, runtime, at, onClose, onSaved }: {
  c: Character; runtime: string; at: { left: number; top: number }; onClose: () => void; onSaved: () => void;
}) {
  const { list, error: loadError } = useModelList(runtime);
  const [model, setModel] = useState(c.model);
  const [effort, setEffort] = useState<string>(c.effort);
  const [turns, setTurns] = useState(String(c.maxTurns));
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => { if (list) select.current?.focus(); }, [list]);
  useEffect(() => { if (loadError) setError(loadError); }, [loadError]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Element;
      if (!box.current?.contains(t) && !t.closest?.(".kit-btn")) onClose();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const m = list?.models.find((x) => x.id === model);
  const efforts: string[] = m?.efforts ?? [];
  const chosenEffort = efforts.includes(effort) ? effort : ""; // a model that can't do the chosen effort falls back to its own default

  const notes: string[] = [];
  if (list) {
    if (!efforts.length) notes.push("This model doesn't take an effort setting.");
    if (m?.id.includes("fable")) notes.push("Fable is the most capable model and costs the most; best for hard, long tasks.");
    if (m?.id.includes("haiku")) notes.push("Haiku is the fastest and cheapest; good for quick, simple work.");
    if (m?.price) notes.push(`Price per million tokens: ${m.price} (input / output).`);
    if (!list.live) notes.push("Couldn't reach the Models API, so this shows the current models.");
    notes.push(`Max turns: one reply and its tool calls is a turn (default ${c.defaultMaxTurns}). Applies from ${c.name}'s next run.`);
  }

  async function save() {
    try {
      const t = turns.trim();
      // Same as the crew default (or empty) clears the override, so a later default change still applies.
      const maxTurns = t === "" || Number(t) === c.defaultMaxTurns ? null : Number(t);
      await api("/api/agents", { id: c.id, model, effort: chosenEffort || null, maxTurns });
      onSaved();
    } catch (e) { setError(errorText(e)); }
  }
  async function reset() {
    try { await api("/api/agents", { id: c.id, reset: true }); onSaved(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <div className="popover model-picker" role="dialog" aria-label="Choose model" ref={box} style={{ left: at.left, top: at.top }}>
      <div className="menu-head">{c.emoji} {c.name}'s model</div>
      <label className="field">Model
        <select ref={select} value={list ? model : ""} disabled={!list} onChange={(ev) => { setModel(ev.target.value); setError(""); }}>
          {!list && <option value="">Loading models…</option>}
          {list && !list.models.some((x) => x.id === c.model) && <option value={c.model}>{c.model}</option>}
          {list && <ModelOptions models={list.models} defaultModel={c.defaultModel} />}
        </select>
      </label>
      <label className="field">Effort
        <select value={chosenEffort} disabled={efforts.length === 0} onChange={(ev) => { setEffort(ev.target.value); setError(""); }}>
          <option value="">Model's own default</option>
          {efforts.map((e) => <option key={e} value={e}>{e}{e === c.defaultEffort ? " (crew default)" : ""}</option>)}
        </select>
      </label>
      <label className="field">Max turns per run
        <input type="number" min={5} max={200} step={5} inputMode="numeric" value={turns} placeholder={String(c.defaultMaxTurns)}
          title={`Each turn is one reply and the tool calls in it. Crew default: ${c.defaultMaxTurns}. Your budget and the Stop button still apply.`}
          onChange={(ev) => { setTurns(ev.target.value); setError(""); }} />
      </label>
      <div className={error ? "pick-note warn" : "pick-note"}>{error || notes.join(" ")}</div>
      <div className="card-actions">
        <button type="button" className="btn small primary" disabled={!list} onClick={save}>Save</button>
        <button type="button" className="btn small" onClick={reset}>Reset to default</button>
        <button type="button" className="btn small" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
