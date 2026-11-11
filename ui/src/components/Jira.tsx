// Jira on the page: linking your account (Settings → Connectors), and picking a ticket to attach
// to a message (the + menu). The API token is typed here and sent to the camp once, to be
// checked with Jira and kept on your machine; it's never sent back to the page.

import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import type { CampState, JiraPull, JiraRef, JiraStatus } from "../types.ts";
import { Icon } from "./bits.tsx";

// The usual filters. The first is where the camp starts.
export const JIRA_PRESETS: { name: string; jql: string }[] = [
  { name: "Assigned to me, not done", jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" },
  { name: "Assigned to me, in progress", jql: 'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC' },
  { name: "Reported by me, not done", jql: "reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC" },
  { name: "Mine or watched, changed this week", jql: "(assignee = currentUser() OR watcher = currentUser()) AND updated >= -7d ORDER BY updated DESC" },
  { name: "Looked at lately", jql: "issue in issueHistory() ORDER BY lastViewed DESC" },
];
export const filterName = (jql: string) => JIRA_PRESETS.find((p) => p.jql === jql.trim())?.name ?? null;

// Which tickets are pulled in, for the whole camp: the Jira page shows what this matches, and so
// does the + menu's Jira tickets before you type. It's Jira's own query language (JQL): pick a
// usual one or write your own, try it to see what it matches, and keep it.
function JiraFilter({ kept, refresh }: { kept: string; refresh: () => void }) {
  const [jql, setJql] = useState(kept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState<JiraPull | null>(null);
  useEffect(() => { setJql(kept); }, [kept]);
  const changed = jql.trim() !== kept;

  async function ask(query: string, keep: boolean) {
    setBusy(true); setError("");
    try {
      const r = keep ? await api<JiraPull>("/api/jira/filter", { jql: query }) : await api<JiraPull>(`/api/jira/tickets?jql=${encodeURIComponent(query)}`);
      setTried(r);
      if (keep) refresh();
    } catch (e) { setTried(null); setError(errorText(e)); }
    setBusy(false);
  }
  const run = (ev: FormEvent) => { ev.preventDefault(); if (jql.trim()) void ask(jql.trim(), false); };

  return (
    <form className="jira-filter" onSubmit={run} aria-label="Which tickets are pulled in">
      <div className="section-label">Which tickets are pulled in</div>
      <div className="jira-filter-row">
        <select aria-label="A usual filter" value={filterName(jql) ? jql.trim() : ""} onChange={(ev) => { if (ev.target.value) { setJql(ev.target.value); setTried(null); setError(""); } }}>
          {!filterName(jql) && <option value="">Your own filter</option>}
          {JIRA_PRESETS.map((p) => <option key={p.name} value={p.jql}>{p.name}</option>)}
        </select>
        <input aria-label="Filter (JQL)" className="jira-jql" value={jql} spellCheck={false} autoComplete="off" placeholder='project = APP AND status = "In Progress"'
          onChange={(ev) => { setJql(ev.target.value); setTried(null); setError(""); }} />
      </div>
      <div className="jira-filter-row">
        <button type="submit" className="btn small" disabled={busy || !jql.trim()} title="See what this filter matches, without keeping it">{busy ? "Asking Jira…" : "Try it"}</button>
        <button type="button" className="btn small primary" disabled={busy || !changed || !jql.trim()} title="Make this the filter from now on, everywhere tickets are pulled in" onClick={() => ask(jql.trim(), true)}>Keep this filter</button>
        {tried && !error && (
          <span className="meta" role="status">
            {tried.tickets.length ? `Matches ${tried.tickets.length}${tried.more ? "+" : ""} ${tried.tickets.length === 1 ? "ticket" : "tickets"}: ${tried.tickets.slice(0, 4).map((t) => t.key).join(", ")}${tried.tickets.length > 4 ? "…" : ""}` : "Matches no tickets right now."}
            {tried.saved === tried.jql ? " Kept." : ""}
          </span>
        )}
      </div>
      <div className="field-hint">Written in Jira's query language (JQL). It decides what the Jira page lists and what the + menu's Jira tickets offers before you type. {changed ? "You've changed it and not kept it yet." : "This is the filter in use."}</div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </form>
  );
}

// What the camp may write to Jira: nothing, unless you turn this on. With it on, a ticket gets a
// short comment when work starts from it and when its pull request opens (in the camp's own
// fixed words: nothing an agent wrote goes to Jira), and moves to a status if you name one.
export function JiraWriteBack({ S, refresh }: { S: CampState; refresh: () => void }) {
  const w = S.settings.jiraWrite;
  const [start, setStart] = useState(w.startStatus);
  const [pr, setPr] = useState(w.prStatus);
  const [error, setError] = useState("");
  const [kept, setKept] = useState(false);
  const save = async (next: { on: boolean; startStatus: string; prStatus: string }) => {
    setError(""); setKept(false);
    try { await api("/api/jira/write", next); setKept(true); refresh(); } catch (e) { setError(errorText(e)); }
  };
  const changed = start.trim() !== w.startStatus || pr.trim() !== w.prStatus;
  return (
    <form className="jira-write" aria-label="Writing back to Jira" onSubmit={(ev) => { ev.preventDefault(); void save({ on: w.on, startStatus: start, prStatus: pr }); }}>
      <label className="switch"><input type="checkbox" checked={w.on} aria-label="Let the camp write to Jira"
        onChange={(ev) => save({ on: ev.target.checked, startStatus: start, prStatus: pr })} /> Write back to tickets: {w.on ? "On" : "Off"}</label>
      <div className="field-hint">Off, nothing is ever written to Jira. On, a ticket you start work from gets a comment saying work has started (and on which branch), and another with the link when you open its pull request.
        The comments are posted as you. The crew still can't write to Jira: this is the camp, at those two moments only.</div>
      {w.on && (
        <>
          <div className="jira-write-row">
            <label className="field">Move it when work starts<input aria-label="Status when work starts" placeholder="Leave it where it is" value={start} onChange={(ev) => { setStart(ev.target.value); setKept(false); }} /></label>
            <label className="field">Move it when the pull request opens<input aria-label="Status when the pull request opens" placeholder="Leave it where it is" value={pr} onChange={(ev) => { setPr(ev.target.value); setKept(false); }} /></label>
          </div>
          <div className="field-hint">The name of a status in your workflow, such as In Progress or In Review. If the ticket can't go there from where it is, it's left alone and you're told.</div>
          <div className="card-actions"><button type="submit" className="btn small" disabled={!changed}>Keep these</button>{kept && !changed && <span className="meta" role="status">Kept.</span>}</div>
        </>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
    </form>
  );
}

export function JiraConnection({ S, refresh }: { S: CampState; refresh: () => void }) {
  const j = S.jira;
  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true); setError("");
    try { await api<JiraStatus>("/api/jira", { siteUrl, email, apiToken }); setApiToken(""); refresh(); }
    catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  async function disconnect() {
    if (!confirm("Unlink Jira? The camp forgets the API token. Tickets already attached to conversations stay as they are.")) return;
    try { await api("/api/jira", { disconnect: true }); refresh(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <div className="wiki-group">
      <h4>Jira</h4>
      <p>Link your Jira Cloud account to attach tickets to a message, and to let the crew read a ticket or search. The crew can only read, and only what your account can see. Nothing is written to Jira unless you turn on writing back below.</p>
      {j?.connected ? (
        <div className="card">
          <div className="card-top"><span className="who"><Icon name="link" /> {j.siteUrl?.replace(/^https?:\/\//, "")}</span><span className="pill done">Linked</span></div>
          <div className="meta">{j.displayName ? `${j.displayName} · ` : ""}{j.email}</div>
          {j.source === "environment"
            ? <div className="meta">Set with JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN where the camp was started. Remove them there to unlink.</div>
            : <div className="card-actions"><button type="button" className="btn small danger" onClick={disconnect}>Unlink</button></div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <JiraFilter kept={j.filter} refresh={refresh} />
          <JiraWriteBack S={S} refresh={refresh} />
        </div>
      ) : (
        <form className="card jira-form" onSubmit={connect}>
          <label className="field">Jira address
            <input aria-label="Jira address" placeholder="https://yourteam.atlassian.net" value={siteUrl} autoComplete="url" spellCheck={false} onChange={(ev) => setSiteUrl(ev.target.value)} />
          </label>
          <label className="field">Atlassian account email
            <input aria-label="Atlassian account email" type="email" placeholder="you@yourteam.com" value={email} autoComplete="email" onChange={(ev) => setEmail(ev.target.value)} />
          </label>
          <label className="field">API token
            <input aria-label="API token" type="password" value={apiToken} autoComplete="off" spellCheck={false} onChange={(ev) => setApiToken(ev.target.value)} />
            <span className="field-hint">Make one at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com → Security → API tokens</a>.
              It's checked with Jira, then kept in camp/jira.json on this machine, readable only by you; no crew member can open that file.</span>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="card-actions"><button type="submit" className="btn small primary" disabled={busy || !siteUrl.trim() || !email.trim() || !apiToken.trim()}>{busy ? "Checking with Jira…" : "Link Jira"}</button></div>
        </form>
      )}
    </div>
  );
}

// The + menu's Jira panel: the tickets you looked at last, or a search as you type. Picking one
// attaches it to the message.
export function JiraPicker({ connected, onPick, onConnect }: { connected: boolean; onPick: (issue: JiraRef) => void; onConnect: () => void }) {
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<JiraRef[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) return;
    let gone = false;
    const t = setTimeout(() => {
      api<{ issues: JiraRef[] }>(`/api/jira/issues?q=${encodeURIComponent(query.trim())}`)
        .then((r) => { if (!gone) { setIssues(r.issues); setError(""); } }, (e) => { if (!gone) { setIssues([]); setError(errorText(e)); } });
    }, query ? 250 : 0);
    return () => { gone = true; clearTimeout(t); };
  }, [query, connected]);

  if (!connected) {
    return (
      <div className="menu-tip jira-off">Jira isn't linked yet.
        <button type="button" className="btn small" onClick={onConnect}>Link Jira in Settings</button>
      </div>
    );
  }
  return (
    <>
      <label className="fly-search">
        <Icon name="search" />
        <input autoFocus aria-label="Find a Jira ticket" placeholder="A key like APP-123, or words…" value={query} autoComplete="off" spellCheck={false} onChange={(ev) => setQuery(ev.target.value)} />
      </label>
      {!query.trim() && <div className="menu-label">From your filter</div>}
      <div className="fly-list jira-list" role="listbox" aria-label="Jira tickets">
        {error && <div className="form-error" role="alert">{error}</div>}
        {issues === null && !error && <div className="menu-tip">Asking Jira…</div>}
        {issues?.length === 0 && !error && <div className="menu-tip">{query.trim() ? "No tickets match." : "Your filter matches nothing right now. Type a key or some words."}</div>}
        {issues?.map((i) => (
          <button key={i.key} type="button" role="option" aria-selected="false" className="jira-item" title={`Attach ${i.key} to your message`} onClick={() => onPick(i)}>
            <span className="jira-key">{i.key}</span>
            <span className="jira-summary">{i.summary}</span>
            <small>{[i.type, i.status].filter(Boolean).join(" · ")}</small>
          </button>
        ))}
      </div>
    </>
  );
}
