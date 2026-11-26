// The wiki, as a page of its own: what the camp knows between conversations. Facts are what
// you told the crew or decided (treated as true); notes are what the crew found and brought
// back, with sources (treated as claims). Each is a Markdown file in camp/wiki/, shown here as
// a card; a card opens the page. Narrow by words to find one. The crew writes
// these (with wiki_write). You can add a page of your own, change any page, or take one away.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { plural } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import { Presence } from "../motion.tsx";
import type { CampState } from "../types.ts";
import { Confirm } from "./Confirm.tsx";

import { w } from "../words.ts";
const sections = () => [
  ["facts", "Facts", `What you told the ${w("crew")} or decided. Treated as true.`],
  ["notes", "Notes", `What the ${w("crew")} found, with sources. Treated as claims.`],
] as const;
const nameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
const stripFrontmatter = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n*/, "");

// A page's file name, from its title (the camp works it out the same way).
export const pageName = (title: string) => title.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
type Page = CampState["wiki"][number];

// open: the page being read (its path), if any. onOpen: read another, or go back to them all (null).
// refresh: the list has changed (a page was added, changed or removed).
// embedded: shown inside the Memory page, which has the heading.
export function WikiHome({ S, open, onOpen: setOpen, refresh, embedded }: { S: CampState; open?: string; onOpen: (path: string | null) => void; refresh?: () => void; embedded?: boolean }) {
  const [words, setWords] = useState("");
  // Writing: a new page, or the one being read.
  const [writing, setWriting] = useState<"new" | "edit" | null>(null);
  useEffect(() => { setWriting(null); }, [open]);
  const pages = S.wiki ?? [];
  const shown = useMemo(() => {
    const w = words.toLowerCase().split(/\s+/).filter(Boolean);
    return pages.filter((p) => w.every((x) => `${nameOf(p.path)} ${p.summary}`.toLowerCase().includes(x)));
  }, [pages, words]);
  const saved = (p: Page) => { setWriting(null); refresh?.(); setOpen(p.path); };
  if (writing === "new") return <WikiEditor onCancel={() => setWriting(null)} onSaved={saved} />;
  if (open && writing === "edit") return <WikiEditor page={pages.find((p) => p.path === open) ?? { path: open, section: open.includes("/facts/") ? "facts" : "notes", summary: "", updated: "" }} onCancel={() => setWriting(null)} onSaved={saved} />;
  if (open) return <WikiRead path={open} known={pages.find((p) => p.path === open)} onBack={() => setOpen(null)} onEdit={() => setWriting("edit")} onRemoved={() => { refresh?.(); setOpen(null); }} />;
  return (
    <div className={embedded ? "wiki-page wiki-embedded" : "feed proj-page wiki-page"}>
      <header className="proj-head">
        <div>
          {!embedded && <h2>Wiki</h2>}
          <div className="meta">{pages.length} {plural(pages.length, "page")} · what the {w("camp")} knows between conversations. The {w("crew")} reads the list of these at the start of every run, and opens the ones that bear on the work.</div>
        </div>
        <div className="proj-actions"><button type="button" className="btn small primary" title={`Write a page yourself: something the ${w("crew")} should know from now on`} onClick={() => setWriting("new")}><span aria-hidden="true">＋ </span>New page</button></div>
      </header>
      {pages.length > 0 && <input aria-label="Narrow the wiki" className="hist-search" placeholder="Narrow by name or words…" value={words} onChange={(ev) => setWords(ev.target.value)} />}
      {!pages.length && <div className="hist-empty">The wiki is empty. Facts you share and findings the {w("crew")} brings back are saved here, as Markdown files in camp/wiki/. <button type="button" className="linkish" onClick={() => setWriting("new")}>Write the first page</button></div>}
      {pages.length > 0 && !shown.length && <div className="hist-empty">Nothing matches. <button type="button" className="linkish" onClick={() => setWords("")}>Show them all</button></div>}
      {pages.length > 0 && sections().map(([section, title, blurb]) => {
        const list = shown.filter((p) => p.section === section);
        if (words.trim() && !list.length) return null;
        return (
          <section key={section} aria-label={title}>
            <div className="section-label">{title} · {list.length}</div>
            <div className="meta wiki-blurb">{blurb}</div>
            {!list.length ? <div className="meta">Nothing yet.</div> : (
              <div className="proj-grid">
                {list.map((p) => (
                  <button key={p.path} type="button" className="proj-card" aria-label={`${nameOf(p.path)}: ${p.summary}`} onClick={() => setOpen(p.path)}>
                    <b>{nameOf(p.path)}</b>
                    <span className="proj-card-desc">{p.summary || "No summary."}</span>
                    <span className="meta">{p.updated ? `updated ${p.updated}` : section}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// Writing a page: a new one (title, whether it's a fact or a note, a one-line summary, the page
// itself), or an existing one (its summary and text; its name and kind stay as they are).
function WikiEditor({ page, onCancel, onSaved }: { page?: Page; onCancel: () => void; onSaved: (p: Page) => void }) {
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<"facts" | "notes">(page?.section ?? "facts");
  const [summary, setSummary] = useState(page?.summary ?? "");
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(!page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!page) return;
    let gone = false;
    api<{ text: string }>(`/api/wiki?path=${encodeURIComponent(page.path)}`).then((p) => {
      if (gone) return;
      setText(stripFrontmatter(p.text).trim());
      // The file is what's true: its own summary line, rather than the list's (which may be a moment behind).
      const own = p.text.match(/^---\n[\s\S]*?\n---/)?.[0].match(/^summary:\s*(.+)$/m)?.[1]?.trim();
      if (own) setSummary(own);
      setLoaded(true);
    }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
  }, [page?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = page ? nameOf(page.path) : pageName(title);
  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true); setError("");
    try { onSaved((await api<{ page: Page }>("/api/wiki/save", page ? { path: page.path, summary, text } : { create: true, section, title, summary, text })).page); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <form className="feed proj-page wiki-page wiki-edit" aria-label={page ? `Edit ${name}` : "A new wiki page"} onSubmit={save}>
      <header className="proj-head">
        <div>
          <h2>{page ? <>Edit {name}</> : "A new wiki page"}</h2>
          <div className="meta">{page ? <code>{page.path}</code> : name ? <>It'll be kept as <code>camp/wiki/{section}/{name}.md</code></> : `Something the ${w("crew")} should know from now on.`}</div>
        </div>
        <div className="proj-actions">
          <button type="button" className="btn small" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn small primary" disabled={busy || !loaded || !text.trim() || !summary.trim() || !name}>{busy ? "Saving…" : page ? "Save" : "Add the page"}</button>
        </div>
      </header>
      {error && <div className="form-error" role="alert">{error}</div>}
      {!page && (
        <>
          <label className="field">Title<input aria-label="Title" value={title} maxLength={90} autoFocus placeholder="Release process" onChange={(ev) => setTitle(ev.target.value)} /></label>
          <div className="wiki-kinds" role="radiogroup" aria-label="What kind of page">
            {sections().map(([id]) => (
              <label key={id} className={section === id ? "wizard-pick on" : "wizard-pick"}>
                <input type="radio" name="wiki-kind" checked={section === id} onChange={() => setSection(id)} />
                <span><b>{id === "facts" ? "A fact" : "A note"}</b><small>{id === "facts" ? `Something you're telling the ${w("crew")} or have decided. They treat it as true.` : "Something found or read, worth keeping. They treat it as a claim to weigh: say where it came from."}</small></span>
              </label>
            ))}
          </div>
        </>
      )}
      <label className="field">Summary
        <input aria-label="Summary" value={summary} maxLength={140} placeholder="One line: what this page is about" onChange={(ev) => setSummary(ev.target.value)} />
        <span className="field-hint">The {w("crew")} sees this line in the list at the start of every run. It's how they decide whether to open the page.</span>
      </label>
      <label className="field">The page
        {loaded
          ? <textarea className="wiki-text" aria-label="The page" value={text} rows={16} spellCheck placeholder={"Markdown. Keep it to one topic.\n\n- What's true\n- What to do about it"} onChange={(ev) => setText(ev.target.value)} />
          : <div className="meta">Opening…</div>}
      </label>
    </form>
  );
}

function WikiRead({ path, known, onBack, onEdit, onRemoved }: { path: string; known?: Page; onBack: () => void; onEdit: () => void; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [gone, setGone] = useState("");
  const remove = async () => {
    try { await api("/api/wiki/remove", { path }); setAsking(false); onRemoved(); }
    catch (e) { setAsking(false); setGone(errorText(e)); }
  };
  const [page, setPage] = useState<{ text?: string; error?: string } | null>(null);
  useEffect(() => {
    let gone = false;
    setPage(null);
    api<{ text: string }>(`/api/wiki?path=${encodeURIComponent(path)}`).then((p) => { if (!gone) setPage({ text: p.text }); }, (e) => { if (!gone) setPage({ error: errorText(e) }); });
    return () => { gone = true; };
  }, [path]);
  return (
    <div className="feed proj-page wiki-page">
      <header className="proj-head">
        <div>
          <h2><button type="button" className="linkish wiki-back" onClick={onBack}>Wiki</button> <span aria-hidden="true">›</span> {nameOf(path)}</h2>
          <div className="meta">{known ? `${known.section === "facts" ? "A fact: treated as true" : "A note: treated as a claim"}${known.updated ? ` · updated ${known.updated}` : ""} · ` : ""}<code>{path}</code></div>
        </div>
        <div className="proj-actions">
          <button type="button" className="btn small" onClick={onBack}>← All pages</button>
          <button type="button" className="btn small" disabled={page?.text == null} onClick={onEdit}>Edit</button>
          <button type="button" className="btn small danger" onClick={() => setAsking(true)}>Delete</button>
        </div>
      </header>
      {gone && <div className="form-error" role="alert">{gone}</div>}
      <Presence>{asking && (
        <Confirm title={`Delete ${nameOf(path)}?`} action="Delete the page" danger onConfirm={remove} onCancel={() => setAsking(false)}>
          <p>The file <code>{path}</code> is deleted, and the {w("crew")} stops seeing it from their next run. It can't be brought back from here.</p>
        </Confirm>
      )}</Presence>
      <section className="proj-about">
        {page?.error ? <div className="form-error" role="alert">{page.error}</div> : page?.text != null ? <Markdown text={stripFrontmatter(page.text)} /> : <div className="meta">Opening…</div>}
      </section>
    </div>
  );
}
