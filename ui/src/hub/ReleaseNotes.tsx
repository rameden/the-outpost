// Release notes, in the star chart's drawer down its left side: what changed in Outpost itself,
// written up from the pull requests merged into its repository (src/releases.ts). A running outpost
// writes one every 48 hours, split into the front end and the back end, with the big features
// first; Check now, the refresh button on the drawer's rail, writes the next one here. Newest first. The drawer's rail closes it, as the
// workspace's rail does in an outpost (Drawer in components/bits.tsx), and the page remembers which.

import { useCallback, useEffect, useState } from "react";
import { Drawer, Icon } from "../components/bits.tsx";
import { plural } from "../format.ts";
import type { Releases, Release, Note } from "../../../src/releases.ts";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const DAY = 86_400_000;
const KEY = "hub-notes"; // "open" or "closed"

// Open unless it was closed here before: the page's first look shows what's new.
export const notesOpenAtFirst = () => { try { return localStorage.getItem(KEY) !== "closed"; } catch { return true; } };
export const keepNotesOpen = (open: boolean) => { try { localStorage.setItem(KEY, open ? "open" : "closed"); } catch { /* private mode */ } };

type Ask = <T>(path: string, body?: object) => Promise<T>;

// The rail while it's closed; the rail, with Check now on it, and the notes while it's open.
export function ReleaseDrawer({ open, onToggle, ask }: { open: boolean; onToggle: () => void; ask: Ask }) {
  if (!open) {
    return (
      <div className="hub-notes">
        <button type="button" className="zone-rail" aria-expanded="false" aria-label="Show the release notes" title="Release notes: what's changed in Outpost" onClick={onToggle}>
          <Icon name="bookmark" /><span>Release notes</span>
        </button>
      </div>
    );
  }
  return <OpenDrawer onToggle={onToggle} ask={ask} />;
}

function OpenDrawer({ onToggle, ask }: { onToggle: () => void; ask: Ask }) {
  const notes = useReleases(ask);
  const check = (
    <button type="button" className={notes.checking ? "hist-icon checking" : "hist-icon"} aria-label="Check now" aria-busy={notes.checking} disabled={notes.checking}
      title={notes.checking ? "Checking…" : "Check now: look for pull requests merged since the last write-up, and write them up"} onClick={() => void notes.checkNow()}>
      <Icon name="refresh" />
    </button>
  );
  return (
    <div className="hub-notes open">
      <Drawer icon="bookmark" label="Release notes" hideLabel="Hide the release notes" hideTitle="Hide the release notes. Their tab brings them back." onHide={onToggle} tools={check}>
        <ReleaseNotes {...notes} />
      </Drawer>
    </div>
  );
}

type Notes = { data: Releases | null; error: string; checking: boolean; checkNow: () => Promise<void> };

// The notes, read when the drawer opens and again on coming back from an outpost (which may have written new ones).
function useReleases(ask: Ask): Notes {
  const [data, setData] = useState<Releases | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const load = useCallback(() => { ask<Releases>("/api/releases").then((r) => { setData(r); setError(""); }, (e) => setError(why(e))); }, [ask]);
  useEffect(() => {
    load();
    window.addEventListener("pageshow", load);
    return () => window.removeEventListener("pageshow", load);
  }, [load]);
  const checkNow = async () => {
    setChecking(true);
    try { setData(await ask<Releases>("/api/releases/refresh", {})); setError(""); } catch (e) { setError(why(e)); } finally { setChecking(false); }
  };
  return { data, error, checking, checkNow };
}

export function ReleaseNotes({ data, error, checking, checkNow }: Notes) {
  const list = data?.releases ?? [];
  const next = data?.checked ? new Date(new Date(data.checked).getTime() + 2 * DAY) : null;
  return (
    <section className="hub-notes-panel" aria-label="Release notes">
      <div className="hub-notes-body">
        <p className="meta">
          What's changed in {data?.repo ? <a href={`https://github.com/${data.repo}`} target="_blank" rel="noreferrer">{data.repo}</a> : "Outpost"}, summed up from its merged pull requests every 48 hours.
          {data?.checked ? ` Last looked ${day(data.checked)}${next ? `; next around ${day(next.toISOString())}` : ""}.` : ""}
        </p>
        {checking && <div className="hub-notes-checking" role="status"><Icon name="refresh" />Looking for pull requests merged since the last write-up, and writing them up. This can take a minute.</div>}
        {(error || data?.error) && <div className="hist-empty" role="alert">Couldn't read the merged pull requests: {error || data?.error}</div>}
        {data && !list.length && <div className="hist-empty">No release notes yet. A running outpost writes the first a minute after it starts, from the last two weeks of merged pull requests, or <button type="button" className="linkish" onClick={() => void checkNow()}>write them now</button>.</div>}
        {list.map((r) => <ReleaseCard key={r.id} r={r} />)}
      </div>
    </section>
  );
}

function ReleaseCard({ r }: { r: Release }) {
  const url = new Map(r.prs.map((p) => [p.number, p.url]));
  return (
    <section className="release" aria-label={`Release notes for ${day(r.to)}`}>
      <div className="section-label">{day(r.from)} – {day(r.to)} · {r.prs.length} {plural(r.prs.length, "pull request")}</div>
      {([["frontend", "Front end"], ["backend", "Back end"]] as const).map(([side, title]) => r[side].length > 0 && (
        <ReleaseSide key={side} title={title} notes={r[side]} url={url} />
      ))}
      {!r.byModel && <div className="meta">Listed one line per pull request: the model couldn't be reached to sum them up.</div>}
    </section>
  );
}

// Front end or back end: a header that folds its notes away and opens them again.
function ReleaseSide({ title, notes, url }: { title: string; notes: Note[]; url: Map<number, string> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={open ? "release-side" : "release-side folded"}>
      <h3>
        <button type="button" className="release-fold" aria-expanded={open} title={open ? `Fold the ${title.toLowerCase()} notes away` : `Show the ${title.toLowerCase()} notes`} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "chevron" : "chevronRight"} /><span>{title}</span><span className="release-count">{notes.length}</span>
        </button>
      </h3>
      {open && (
        <ul>
          {ordered(notes).map((n, i) => <NoteLine key={i} n={n} url={url} />)}
        </ul>
      )}
    </div>
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
