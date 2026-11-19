// Settings → Voice: reading aloud with ElevenLabs.
//
// Connect by pasting your ElevenLabs API key: the camp checks it with ElevenLabs, keeps it on your
// machine beside the other keys (camp/providers.json, readable only by you, off limits to the
// crew), and never shows it again. Then choose which voice and model read, and try it.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { ask } from "../components/Confirm.tsx";
import { ReadAloud } from "../components/ReadAloud.tsx";
import type { CampState } from "../types.ts";

type Voice = { id: string; name: string; about: string };
const SAMPLE = "This is the voice Mae reads in. A debrief sounds like this: three runs, two quests, and one lesson worth keeping.";

export function VoicePage({ S, refresh }: { S: CampState; refresh: () => void }) {
  // (A camp server started before reading aloud existed doesn't send this: say so rather than fall over.)
  const v = (S.voice as CampState["voice"] | undefined) ?? { connected: false, from: null, voice: "", voiceName: "", model: "", models: [], stale: true as const };
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<{ voices: Voice[]; limited: boolean } | null>(null);
  useEffect(() => {
    if (!v.connected) { setVoices(null); return; }
    let on = true;
    api<{ voices: Voice[]; limited: boolean }>("/api/voice/voices", {}).then((r) => { if (on) setVoices(r); }, (e) => { if (on) setError(errorText(e)); });
    return () => { on = false; };
  }, [v.connected]);

  const run = async (path: string, body: object, after?: () => void) => {
    setBusy(true); setError("");
    try { await api(path, body); after?.(); refresh(); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const disconnect = async () => {
    if (!await ask({ title: "Remove the saved ElevenLabs key?", body: "Reading aloud stops working until you connect a key again. Speech already made stays on this machine.", action: "Disconnect and forget the key", danger: true })) return;
    void run("/api/voice/disconnect", {});
  };
  const listed = voices?.voices ?? [];
  if ("stale" in v) return <p className="set-note">Restart the camp to turn on reading aloud: the one that's running started before it was added.</p>;

  return (
    <div>
      <p className="set-note">Mae can read to you. Press <b>Read aloud</b> under an answer, a job's report, an inbox item or a ticket's debrief, or select some text in a conversation and choose <b>Read aloud</b>. A small player appears while it reads.</p>
      <section className="prov" aria-label="ElevenLabs">
        <div className="prov-head">
          <h4>ElevenLabs</h4>
          {v.connected ? <span className="pill done">Connected</span> : <span className="pill">Not connected</span>}
        </div>
        <p className="set-note">What you play is sent to ElevenLabs to be turned into speech, and counts against your plan's characters. Nothing is sent until you press Read aloud. Each piece of speech is kept on this machine, so hearing it again is instant and free.</p>
        {v.connected ? (
          <div className="set-actions">
            {v.from === "env"
              ? <span className="meta">Its key comes from where the camp was started (ELEVENLABS_API_KEY), so it's changed there.</span>
              : <button type="button" className="btn small danger" disabled={busy} onClick={disconnect}>Disconnect and forget the key</button>}
          </div>
        ) : (
          <form className="prov-key" onSubmit={(ev) => { ev.preventDefault(); if (key.trim()) void run("/api/voice/connect", { key }, () => setKey("")); }}>
            <input type="password" value={key} autoComplete="off" spellCheck={false} aria-label="ElevenLabs API key" placeholder="Paste your ElevenLabs API key" onChange={(ev) => { setKey(ev.target.value); setError(""); }} />
            <button type="submit" className="btn small primary" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Connect"}</button>
            <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">Get a key</a>
          </form>
        )}
      </section>
      {error && <div className="form-error" role="alert">{error}</div>}

      {v.connected && (
        <>
          <h4 className="set-sub">Voice</h4>
          <label className="field prov-small">Voice
            <select value={v.voice} disabled={busy || !voices} aria-label="Voice"
              onChange={(ev) => void run("/api/voice/set", { voice: ev.target.value, voiceName: listed.find((x) => x.id === ev.target.value)?.name })}>
              {!listed.some((x) => x.id === v.voice) && <option value={v.voice}>{voices ? v.voiceName : "Loading voices…"}</option>}
              {listed.map((x) => <option key={x.id} value={x.id}>{x.name}{x.about ? ` (${x.about})` : ""}</option>)}
            </select>
          </label>
          {voices?.limited && <p className="set-note">These are ElevenLabs' library voices. To choose from your own, clones included, give the key the “Voices: Read” permission on elevenlabs.io and connect it again.</p>}
          <label className="field prov-small">Model
            <select value={v.model} disabled={busy} aria-label="Voice model" onChange={(ev) => void run("/api/voice/set", { model: ev.target.value })}>
              {v.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="set-actions">
            <ReadAloud text={SAMPLE} what="Voice test" label="Test voice" />
          </div>
        </>
      )}
    </div>
  );
}
