// Google Calendar on the page: linking your account (Settings → Connectors). The client secret is
// typed here and sent to the camp once, to be kept on your machine; it's never sent back. Signing
// in happens on Google's own page, in a new tab, which Google sends back to the camp; this card
// watches for the link to land.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import type { CampState } from "../types.ts";
import { Icon } from "./bits.tsx";
import { ask } from "./Confirm.tsx";
import { w as word } from "../words.ts";

const WAIT_MS = 10 * 60_000; // as long as the camp keeps a sign-in open

export function CalendarConnection({ S, refresh }: { S: CampState; refresh: () => void }) {
  const g = S.gcal;
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [write, setWrite] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWaiting = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setWaiting(false); };
  useEffect(() => { if (g?.connected) stopWaiting(); }, [g?.connected]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function connect(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    // The tab opens now, while the click still counts, so a pop-up blocker lets it through; it's
    // pointed at Google once the camp has the address.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>("/api/gcal", { clientId, clientSecret, write, origin: window.location.origin });
      if (!tab) { window.location.href = url; return; } // no new tab allowed: sign in here, and Google brings you back
      tab.opener = null;
      tab.location.href = url;
      setWaiting(true);
      const until = Date.now() + WAIT_MS;
      timer.current = setInterval(() => { if (Date.now() > until) stopWaiting(); else refresh(); }, 2000);
    } catch (e) { tab?.close(); setError(errorText(e)); }
  }
  async function disconnect() {
    if (!await ask({ title: "Unlink Google Calendar?", body: `The ${word("camp")} asks Google to forget its sign-in, then forgets it here too. Nothing on your calendar changes.`, action: "Unlink", danger: true })) return;
    try { await api("/api/gcal", { disconnect: true }); refresh(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <div className="wiki-group">
      <h4>Google Calendar</h4>
      <p>Link your Google account so the {word("crew")} can see your calendars, what's on between two times, and when you're busy. Reading is all it does unless you let it add events, and then each one asks you first. It never invites anyone, edits or deletes.</p>
      {g?.connected ? (
        <div className="card">
          <div className="card-top"><span className="who"><Icon name="calendar" /> {g.email ?? "Google Calendar"}</span><span className={g.broken ? "pill bad" : "pill done"}>{g.broken ? "Needs linking again" : "Linked"}</span></div>
          <div className="meta">{g.write ? "Can add events (asks you first each time)" : "Read-only"}{g.timeZone ? ` · ${g.timeZone}` : ""}</div>
          {g.broken && <div className="form-error" role="alert">{g.broken}</div>}
          <div className="card-actions"><button type="button" className="btn small danger" onClick={disconnect}>Unlink</button></div>
          {!g.write && <div className="meta">To let the {word("crew")} add events, unlink and link again with that box ticked.</div>}
          {error && <div className="form-error" role="alert">{error}</div>}
        </div>
      ) : (
        <form className="card jira-form" onSubmit={connect}>
          <div className="field-hint">You'll need your own OAuth client from Google Cloud (once):
            <ol className="gcal-steps">
              <li>At <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud → Google Calendar API</a>, pick or make a project and press Enable.</li>
              <li>Under <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noopener noreferrer">Google Auth Platform</a>, set up the app (External is fine), then under Audience press Publish app. Left in Testing, Google ends the sign-in after 7 days. Google will warn that the app isn't verified when you sign in: it's yours, so that's expected.</li>
              <li>Under <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Clients</a>, make a client of type Desktop app, and paste its ID and secret here.</li>
            </ol>
          </div>
          <label className="field">Client ID
            <input aria-label="Client ID" placeholder="1234…apps.googleusercontent.com" value={clientId} autoComplete="off" spellCheck={false} onChange={(ev) => setClientId(ev.target.value)} />
          </label>
          <label className="field">Client secret
            <input aria-label="Client secret" type="password" value={clientSecret} autoComplete="off" spellCheck={false} onChange={(ev) => setClientSecret(ev.target.value)} />
            <span className="field-hint">Kept with the sign-in in camp/gcal.json on this machine, readable only by you; no {word("crew")} member can open that file.</span>
          </label>
          <label className="switch"><input type="checkbox" checked={write} onChange={(ev) => setWrite(ev.target.checked)} /> Let the {word("crew")} add events (each one asks you first)</label>
          {waiting && <div className="meta" role="status">Waiting for Google: finish signing in on the tab that opened. <button type="button" className="linkish" onClick={stopWaiting}>Stop waiting</button></div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="card-actions"><button type="submit" className="btn small primary" disabled={!clientId.trim() || !clientSecret.trim()}>{waiting ? "Sign in again" : "Sign in with Google"}</button></div>
        </form>
      )}
    </div>
  );
}
