// Settings → Models: other companies' models beside Claude (DeepSeek, Gemini, Groq, OpenRouter).
//
// Connect one by pasting its API key: the camp checks it with the provider, keeps it on your
// machine (camp/providers.json, readable only by you, off limits to the crew), and never shows it
// again. Its models then appear in every model picker, under the provider's name. Below that:
// which model does the camp's own small jobs.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { say } from "../bus.ts";
import { ModelOptions, forgetModelLists, useModelList } from "../components/ModelPicker.tsx";
import { ask } from "../components/Confirm.tsx";
import type { CampState, ProviderState } from "../types.ts";

type ModelProvider = Omit<ProviderState, "id"> & { id: ProviderState["id"] | "anthropic"; environment?: boolean };

function Provider({ p, refresh }: { p: ModelProvider; refresh: () => void }) {
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
            ? `Projects marked confidential (web: careful or off) may be sent to ${p.name}. This is your say-so: the camp can't check your agreement with them.`
            : `Until you tick this, a project marked confidential is never sent to ${p.name}.`}</span>
        </label>
      )}
      {p.connected ? (
        <div className="set-actions">
          {p.from === "env"
            ? <>
              <span className="meta">Its key comes from where the camp was started, so it's changed there.</span>
              {anthropic && <button type="button" className="btn small" disabled={busy} onClick={() => connect(true)}>{busy ? "Checking…" : "Import environment key"}</button>}
            </>
            : <button type="button" className="btn small danger" disabled={busy} onClick={disconnect}>Disconnect and forget the key</button>}
        </div>
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
  const other = /^(deepseek|gemini|groq|openrouter):/.test(small);
  return (
    <>
      <p className="set-note">Keys are kept on this machine in <code>camp/providers.json</code>, which only you can read and no crew member can open, and are never shown again.</p>
      <Provider p={{ id: "anthropic", name: "Anthropic", connected: S.anthropic?.connected ?? false, from: S.anthropic?.from ?? undefined, environment: S.anthropic?.environment, keysAt: "https://console.anthropic.com/settings/keys", privacy: "Claude API usage is billed separately from your Claude subscription and has its own limits.", models: 0, free: 0, approved: true }} refresh={refresh} />
      {providers.map((p) => <Provider key={p.id} p={p} refresh={refresh} />)}

      <h4 className="set-sub">Small jobs</h4>
      <p className="set-note">Naming a conversation, tidying a memory, and suggesting what to keep after a run are done by one small model. They're short and simple, so a free model usually does.</p>
      <label className="field prov-small">Model for small jobs
        <select value={small} disabled={!list} aria-label="Model for small jobs" onChange={(ev) => setSmall(ev.target.value)}>
          <option value="">Claude Haiku (the default)</option>
          {list && small && !list.models.some((m) => m.id === small) && <option value={small}>{small} (not available right now)</option>}
          {list && <ModelOptions models={list.models} />}
        </select>
      </label>
      {(error || listError) && <div className="form-error" role="alert">{error || listError}</div>}

      <h4 className="set-sub">Models guide</h4>
      <p className="set-note">A page in the wiki that lays out every model you can use, by cost, speed, and what each is good for. It's rewritten whenever you connect or disconnect a provider; the crew can read it too.</p>
      <div className="set-actions">
        <button type="button" className="btn small" disabled={guide === "writing"} onClick={writeGuide}>{guide === "writing" ? "Writing…" : "Update the guide"}</button>
        <button type="button" className="btn small" onClick={() => say({ do: "open-file", path: "camp/wiki/notes/models-guide.md" })}>Open the guide</button>
        {guide === "done" && <span className="work-done" role="status">Written to the wiki.</span>}
      </div>

      <h4 className="set-sub">What to know</h4>
      <ul className="prov-notes">
        <li><b>Confidential projects stay with Claude unless you approve a provider.</b> In a project whose web setting is "careful" or "off", a crew member set to another provider's model won't run, and that project's small jobs go to Claude whatever you chose{other ? " above" : ""}. Ticking "approved for confidential projects" on a provider's card lifts that for that provider only.</li>
        <li><b>These models don't have Claude's web search or fetch.</b> A crew member running on one works from files and the tools the camp gives it.</li>
        <li><b>Long, many-step work is where they struggle.</b> Planning and editing code depend on calling tools reliably over many turns. Summaries, lookups and reviews are a better fit.</li>
        <li><b>Only DeepSeek's cost is estimated.</b> It's counted at DeepSeek's listed peak-hour prices; off-peak is half that, so the estimate runs high. The camp doesn't know the others' prices, so their usage counts as $0 in its estimates; free tiers also limit how many requests you can make a minute.</li>
        <li><b>DeepSeek thinks before it answers.</b> That thinking is billed as output and isn't shown in the feed, so a reply can take a while to start. The camp's small jobs ask it not to.</li>
        <li><b>OpenRouter lists hundreds of models.</b> Only its free ones are offered in the pickers.</li>
      </ul>
    </>
  );
}
