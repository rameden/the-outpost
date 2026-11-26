// Release notes, as a page of its own: what changed in Mae, written up from the pull requests
// merged into its repository (releases.ts). The camp writes one every 48 hours while it's open,
// split into the front end and the back end, with the big features first. Newest first.

import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { plural } from "../format.ts";
import type { Releases, Release, Note } from "../../../src/releases.ts";

export const RELEASES_CHANGED = "camp:releases-changed";
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const DAY = 86_400_000;

export function ReleaseNotes() {
  const [data, setData] = useState<Releases | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const load = useCallback(() => { api<Releases>("/api/releases").then((r) => { setData(r); setError(""); }, (e) => setError(errorText(e))); }, []);
  useEffect(() => {
    load();
    window.addEventListener(RELEASES_CHANGED, load);
    return () => window.removeEventListener(RELEASES_CHANGED, load);
  }, [load]);
  const checkNow = async () => {
    setChecking(true);
    try { setData(await api<Releases>("/api/releases/refresh", {})); setError(""); } catch (e) { setError(errorText(e)); } finally { setChecking(false); }
  };
  const list = data?.releases ?? [];
  const next = data?.checked ? new Date(new Date(data.checked).getTime() + 2 * DAY) : null;
  return (
    <div className="feed proj-page releases-page">
      <header className="proj-head">
        <div>
          <h2>Release notes</h2>
          <div className="meta">
            What's changed in {data?.repo ? <a href={`https://github.com/${data.repo}`} target="_blank" rel="noreferrer">{data.repo}</a> : "Mae"}, summed up from its merged pull requests every 48 hours.
            {data?.checked ? ` Last looked ${day(data.checked)}${next ? `; next around ${day(next.toISOString())}` : ""}.` : ""}
          </div>
        </div>
        <div className="proj-actions">
          <button type="button" className="btn small" disabled={checking} title="Look for pull requests merged since the last write-up, and write them up now" onClick={checkNow}>
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>
      </header>
      {(error || data?.error) && <div className="hist-empty" role="alert">Couldn't read the merged pull requests: {error || data?.error}</div>}
      {data && !list.length && <div className="hist-empty">No release notes yet. The first are written a minute after the camp starts, from the last two weeks of merged pull requests, or <button type="button" className="linkish" onClick={checkNow}>write them now</button>.</div>}
      {list.map((r) => <ReleaseCard key={r.id} r={r} />)}
    </div>
  );
}

function ReleaseCard({ r }: { r: Release }) {
  const url = new Map(r.prs.map((p) => [p.number, p.url]));
  return (
    <section className="release" aria-label={`Release notes for ${day(r.to)}`}>
      <div className="section-label">{day(r.from)} – {day(r.to)} · {r.prs.length} {plural(r.prs.length, "pull request")}</div>
      {([["frontend", "Front end"], ["backend", "Back end"]] as const).map(([side, title]) => r[side].length > 0 && (
        <div key={side} className="release-side">
          <h3>{title}</h3>
          <ul>
            {ordered(r[side]).map((n, i) => <NoteLine key={i} n={n} url={url} />)}
          </ul>
        </div>
      ))}
      {!r.byModel && <div className="meta">Listed one line per pull request: the model couldn't be reached to sum them up.</div>}
    </section>
  );
}

// New features first, then the rest; newest pull request first within each (saved notes may predate this order).
const newest = (n: Note) => Math.max(0, ...n.prs);
export const ordered = (notes: Note[]) => [...notes].sort((a, b) => Number(b.major) - Number(a.major) || newest(b) - newest(a));

function NoteLine({ n, url }: { n: Note; url: Map<number, string> }) {
  return (
    <li className={n.major ? "release-note major" : "release-note"}>
      <div>
        {n.major && <span className="pill release-major">New</span>}
        <b>{n.title}</b>
        {n.prs.map((x) => <a key={x} className="release-pr" href={url.get(x)} target="_blank" rel="noreferrer">#{x}</a>)}
      </div>
      {n.detail && <div className="meta">{n.detail}</div>}
    </li>
  );
}
