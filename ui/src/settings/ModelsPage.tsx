// Settings → Models: other companies' models beside Claude (DeepSeek, Gemini, Groq, OpenRouter).
//
// Connect one by pasting its API key: the camp checks it with the provider, keeps it on your
// machine (camp/providers.json, readable only by you, off limits to the crew), and never shows it
// again. Its models then appear in every model picker, under the provider's name. Below that:
// what Auto is (the camp choosing a model for each task) and how it has done so far, and which
// model does the camp's own small jobs.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { say } from "../bus.ts";
import { AUTO_CHOICES, ModelOptions, forgetModelLists, useModelList } from "../components/ModelPicker.tsx";
import { ask } from "../components/Confirm.tsx";
import { autoName, money } from "../format.ts";
import type { CampState, ModelList, ProviderState } from "../types.ts";

import { w, a as an, cap } from "../words.ts";
type ModelProvider = Omit<ProviderState, "id"> & { id: ProviderState["id"] | "anthropic"; environment?: boolean };

// away: this browser isn't on the camp's own machine. The Anthropic key is set only there (the
// camp refuses it from anywhere else); the saved one can still be forgotten from here.
function Provider({ p, refresh, away }: { p: ModelProvider; refresh: () => void; away?: boolean }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const anthropic = p.id === "anthropic";
  const connect = async (importEnvironment = false) => {
    setBusy(true); setError("");
    try {
      await api(anthropic ? "/api/anthropic/key" : "/api/providers/connect", anthropic ? importEnvironment ? { import: true } : { key } : { id: p.id, key });
      setKey(""); forgetModelLists(); refresh();
    }
    catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const disconnect = async () => {
    if (anthropic && !await ask({ title: "Remove the saved Anthropic key?", body: p.environment ? "API work will use the environment key instead." : "API work will need another key. Your Claude subscription is unchanged.", action: "Disconnect and forget the key", danger: true })) return;
    setBusy(true); setError("");
    try {
      await api(anthropic ? "/api/anthropic/key" : "/api/providers/disconnect", anthropic ? { key: null } : { id: p.id });
      forgetModelLists(); refresh();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  return (
    <section className="prov" aria-label={p.name}>
      <div className="prov-head">
        <h4>{p.name}</h4>
        {p.connected
          ? <span className="pill done">Connected{p.models ? ` · ${p.models} ${p.models === 1 ? "model" : "models"}${p.free ? `, ${p.free} free` : ""}` : ""}</span>
          : <span className="pill">Not connected</span>}
      </div>
      <p className="set-note">{p.privacy}</p>
      {p.connected && !anthropic && (
        <label className="fb-keep prov-approve">
          <input type="checkbox" checked={p.approved} disabled={busy}
            onChange={(ev) => { setError(""); api("/api/providers/approve", { id: p.id, on: ev.target.checked }).then(refresh, (e) => setError(errorText(e))); }} />
          {p.name} is approved for confidential projects
          <span className="field-hint">{p.approved
            ? `Projects marked confidential (web: careful or off) may be sent to ${p.name}. This is your say-so: the ${w("camp")} can't check your agreement with them.`
            : `Until you tick this, a project marked confidential is never sent to ${p.name}.`}</span>
        </label>
      )}
      {p.connected ? (
        <div className="set-actions">
          {p.from === "env"
            ? <>
              <span className="meta">Its key comes from where the {w("camp")} was started, so it's changed there.</span>
              {anthropic && !away && <button type="button" className="btn small" disabled={busy} onClick={() => connect(true)}>{busy ? "Checking…" : "Import environment key"}</button>}
            </>
            : <button type="button" className="btn small danger" disabled={busy} onClick={disconnect}>Disconnect and forget the key</button>}
        </div>
      ) : anthropic && away ? (
        <p className="set-note" role="note">An Anthropic key is set only on the {w("camp")}'s own machine: open Settings → Models in a browser there.</p>
      ) : (
        <form className="prov-key" onSubmit={(ev) => { ev.preventDefault(); if (key.trim()) void connect(); }}>
          <input type="password" value={key} autoComplete="off" spellCheck={false} aria-label={`${p.name} API key`} placeholder={`Paste your ${p.name} API key`} onChange={(ev) => { setKey(ev.target.value); setError(""); }} />
          <button type="submit" className="btn small primary" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Connect"}</button>
          <a href={p.keysAt} target="_blank" rel="noopener noreferrer">Get a key</a>
        </form>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  );
}

// Auto: what it is, where it's turned on, and how the tasks it has run so far came out (/api/routing).
type Routing = { policy: string; arms: { arm: string; source: string; tasks: number; completed: number; usdPerSuccess: number | null }[] };
function AutoInfo({ models, subscription }: { models?: number; subscription: boolean }) {
  const [routing, setRouting] = useState<Routing | null>(null);
  useEffect(() => { let on = true; api<Routing>("/api/routing").then((r) => { if (on && Array.isArray(r?.arms)) setRouting(r); }, () => {}); return () => { on = false; }; }, []);
  const ran = (routing?.arms ?? []).filter((a) => a.source === "observed" && a.arm.startsWith("auto") && a.tasks > 0);
  return (
    <>
      <h4 className="set-sub">Auto</h4>
      <p className="set-note">Instead of one fixed model, {an("crew")} member or a conversation can run on Auto. For each task it looks at how hard the work is, how much rides on it and how big the request is, then picks a model and an effort from the ones you can use{models ? ` (${models} right now)` : ""}. It moves to another when the one it chose keeps failing, is rate limited, or is too small for the conversation, waits out an outage rather than giving up, and says in the feed which model it used and why.{subscription ? " On your Claude subscription it chooses at the start of a run; moving to another model part-way needs the API." : ""}</p>
      <ul className="prov-notes">
        {AUTO_CHOICES.map((a) => <li key={a.id}><b>{autoName(a.id)}{a.id === "auto:balanced" ? " (recommended)" : ""}.</b> {a.tip[0].toUpperCase()}{a.tip.slice(1)}.</li>)}
        <li><b>Where it's turned on.</b> Per {w("crew")} member under Settings → {w("Crew")} (Model), or for one conversation in the model picker beside the message box. Small jobs can use it too, below.</li>
        <li><b>It keeps to your rules.</b> A confidential project only goes to providers you've approved, and a run's budget is a hard limit on what it picks.</li>
        <li><b>It learns from how runs end.</b> A run whose last check passed counts for the model that did it, and one that failed counts against it, in <code>camp/routing-evidence.json</code>. Every choice, with its reason, is written to <code>camp/routing.jsonl</code>.</li>
      </ul>
      {routing && (
        <p className="set-note" role="status" aria-label="How Auto has done">
          {ran.length
            ? <>So far: {ran.map((a) => `${autoName(a.arm)} has run ${a.tasks} ${a.tasks === 1 ? "task" : "tasks"} and finished ${a.completed}${a.usdPerSuccess != null ? ` (${money(a.usdPerSuccess)} each)` : ""}`).join("; ")}.</>
            : <>Nothing has run on Auto yet.</>}
          {" "}<span className="meta">Policy {routing.policy}.</span>
        </p>
      )}
    </>
  );
}

// Which models Auto may pick. A model switched off here is never chosen by Auto, for crew, conversations
// or small jobs (settings autoExclude); you can still pick it yourself. Claude's few models are a row
// each; another provider is one row (its switch covers all its models, as the prefix "<provider>:"),
// with "Choose…" opening a searchable list of its models.
type Models = ModelList["models"];
const providerOf = (m: Models[number]) => m.id.slice(0, m.id.indexOf(":"));
function AutoModels({ models, excluded, refresh, onError }: { models: Models; excluded: string[]; refresh: () => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState("");
  const off = (id: string) => excluded.some((x) => id === x || id.startsWith(x));
  const set = (model: string, on: boolean) => api("/api/providers/auto-exclude", { model, on }).then(refresh, (e) => onError(errorText(e)));
  const claude = models.filter((m) => !m.provider);
  const providers = [...new Set(models.filter((m) => m.provider).map((m) => m.provider!))].map((name) => {
    const list = models.filter((m) => m.provider === name);
    return { name, id: providerOf(list[0]), list };
  });
  const known = (x: string) => models.some((m) => m.id === x || m.id.startsWith(x));
  const gone = excluded.filter((x) => !known(x));
  return (
    <>
      <h4 className="set-sub">Models Auto may use</h4>
      <p className="set-note">Switch a model off to keep Auto from ever choosing it. You can still pick it yourself for {an("crew")} member or a conversation.</p>
      <div className="auto-models" role="list">
        {claude.map((m) => (
          <div key={m.id} className="auto-row" role="listitem">
            <label className="switch"><input type="checkbox" checked={!off(m.id)} aria-label={`Auto may use ${m.name}`} onChange={(ev) => set(m.id, ev.target.checked)} /> {m.name}</label>
          </div>
        ))}
        {providers.map((p) => {
          const whole = excluded.includes(`${p.id}:`);
          const allowed = whole ? 0 : p.list.filter((m) => !off(m.id)).length;
          return (
            <div key={p.id} className="auto-row" role="listitem">
              <label className="switch"><input type="checkbox" checked={!whole} aria-label={`Auto may use ${p.name}`} onChange={(ev) => set(`${p.id}:`, ev.target.checked)} /> {p.name}</label>
              <span className="meta">{whole ? "Off" : allowed === p.list.length ? `All ${p.list.length} models` : `${allowed} of ${p.list.length} models`}</span>
              <button type="button" className="btn small" disabled={whole} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? "" : p.id)}>{open === p.id ? "Done" : "Choose…"}</button>
              {open === p.id && !whole && <ProviderModels name={p.name} list={p.list} off={off} set={set} />}
            </div>
          );
        })}
      </div>
      {gone.length > 0 && <p className="set-note">Also kept out: {gone.map((x, i) => <span key={x}>{i ? ", " : ""}<code>{x}</code> <button type="button" className="btn small" onClick={() => set(x, true)}>Allow</button></span>)}</p>}
    </>
  );
}
function ProviderModels({ name, list, off, set }: { name: string; list: Models; off: (id: string) => boolean; set: (model: string, on: boolean) => void }) {
  const [q, setQ] = useState("");
  const shown = list.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  const dupes = new Set(list.filter((m, i) => list.findIndex((n) => n.name === m.name) !== i).map((m) => m.name));
  return (
    <div className="auto-pick">
      {list.length > 8 && <input type="search" className="auto-search" value={q} placeholder={`Search ${list.length} ${name} models`} aria-label={`Search ${name} models`} onChange={(ev) => setQ(ev.target.value)} />}
      <div className="auto-pick-list">
        {shown.map((m) => (
          <label key={m.id} className="auto-pick-item">
            <input type="checkbox" checked={!off(m.id)} aria-label={`Auto may use ${m.name}${dupes.has(m.name) ? ` (${m.id})` : ""}`} onChange={(ev) => set(m.id, ev.target.checked)} />
            <span>{m.name}{m.free ? <span className="meta"> · free</span> : null}{dupes.has(m.name) && <span className="meta"> · {m.id.slice(m.id.indexOf(":") + 1)}</span>}</span>
          </label>
        ))}
        {!shown.length && <p className="set-note">No {name} model matches “{q}”.</p>}
      </div>
    </div>
  );
}

export function ModelsPage({ S, refresh }: { S: CampState; refresh: () => void }) {
  const providers = S.providers ?? [];
  const connected = [S.anthropic?.connected ? `anthropic:${S.anthropic.from}` : "", ...providers.filter((p) => p.connected).map((p) => p.id)].join(",");
  // The list changes with what's connected.
  const { list, error: listError } = useModelList(`${S.runtime}|${connected}`);
  const [error, setError] = useState("");
  const [guide, setGuide] = useState<"" | "writing" | "done">("");
  useEffect(() => { setError(""); }, [connected]);
  const writeGuide = async () => {
    setGuide("writing"); setError("");
    try { await api("/api/providers/guide", {}); setGuide("done"); refresh(); } catch (e) { setGuide(""); setError(errorText(e)); }
  };
  const small = S.settings.smallModel ?? "";
  const setSmall = (model: string) => api("/api/providers/small", { model: model || null }).then(refresh, (e) => setError(errorText(e)));
  const other = small === "auto" || /^(deepseek|gemini|groq|openrouter):/.test(small);
  return (
    <>
      <p className="set-note">Keys are kept on this machine in <code>camp/providers.json</code>, which only you can read and no {w("crew")} member can open, and are never shown again.</p>
      <Provider p={{ id: "anthropic", name: "Anthropic", connected: S.anthropic?.connected ?? false, from: S.anthropic?.from ?? undefined, environment: S.anthropic?.environment, keysAt: "https://console.anthropic.com/settings/keys", privacy: "Claude API usage is billed separately from your Claude subscription and has its own limits.", models: 0, free: 0, approved: true }} refresh={refresh} away={S.here === false} />
      {providers.map((p) => <Provider key={p.id} p={p} refresh={refresh} />)}

      <AutoInfo models={list?.models.length} subscription={S.runtime === "claude-code"} />
      {list && <AutoModels models={list.models} excluded={S.settings.autoExclude ?? []} refresh={refresh} onError={setError} />}

      <h4 className="set-sub">Small jobs</h4>
      <p className="set-note">Naming a conversation, tidying a memory, and suggesting what to keep after a run are done by one small model. They're short and simple, so a free model usually does.</p>
      <label className="field prov-small">Model for small jobs
        <select value={small} disabled={!list} aria-label="Model for small jobs" onChange={(ev) => setSmall(ev.target.value)}>
          <option value="">Claude Haiku (the default)</option>
          <option value="auto">Auto (the cheapest model that's up to it)</option>
          {list && small && small !== "auto" && !list.models.some((m) => m.id === small) && <option value={small}>{small} (not available right now)</option>}
          {list && <ModelOptions models={list.models} />}
        </select>
      </label>
      {small === "auto" && <p className="set-note">Auto sends each small job to the cheapest model that's connected and up to it (a free one, if you've connected one), and to the next best when that one fails or is rate limited. It chooses among Claude Haiku and other providers' models, never a large one.</p>}
      {(error || listError) && <div className="form-error" role="alert">{error || listError}</div>}

      <h4 className="set-sub">Models guide</h4>
      <p className="set-note">A page in the wiki that lays out every model you can use, by cost, speed, and what each is good for. It's rewritten whenever you connect or disconnect a provider; the {w("crew")} can read it too.</p>
      <div className="set-actions">
        <button type="button" className="btn small" disabled={guide === "writing"} onClick={writeGuide}>{guide === "writing" ? "Writing…" : "Update the guide"}</button>
        <button type="button" className="btn small" onClick={() => say({ do: "open-file", path: "camp/wiki/notes/models-guide.md" })}>Open the guide</button>
        {guide === "done" && <span className="work-done" role="status">Written to the wiki.</span>}
      </div>

      <h4 className="set-sub">What to know</h4>
      <ul className="prov-notes">
        <li><b>Confidential projects stay with Claude unless you approve a provider.</b> In a project whose web setting is "careful" or "off", {an("crew")} member set to another provider's model won't run, and that project's small jobs go to Claude whatever you chose{other ? " above" : ""}. Ticking "approved for confidential projects" on a provider's card lifts that for that provider only.</li>
        <li><b>These models don't have Claude's web search or fetch.</b> {cap(an("crew"))} member running on one works from files and the tools the {w("camp")} gives it.</li>
        <li><b>Long, many-step work is where they struggle.</b> Planning and editing code depend on calling tools reliably over many turns. Summaries, lookups and reviews are a better fit.</li>
        <li><b>Only DeepSeek's cost is estimated.</b> It's counted at DeepSeek's listed peak-hour prices; off-peak is half that, so the estimate runs high. The {w("camp")} doesn't know the others' prices, so their usage counts as $0 in its estimates; free tiers also limit how many requests you can make a minute.</li>
        <li><b>DeepSeek thinks before it answers.</b> That thinking is billed as output and isn't shown in the feed, so a reply can take a while to start. The {w("camp")}'s small jobs ask it not to.</li>
        <li><b>OpenRouter lists hundreds of models.</b> Only its free ones are offered in the pickers.</li>
      </ul>
    </>
  );
}
