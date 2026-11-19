// The star you picked, in words: the line itself, where it lives and came from, when it was used,
// and what you can do with it (pin it, forget it, merge it with another line of the same place).
import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { ask } from "../components/Confirm.tsx";
import { Icon } from "../components/bits.tsx";
import { cx, plural, when } from "../format.ts";
import type { GraphEdge, GraphNode, Why } from "../types.ts";

const HOW: Record<string, string> = { remember: "the crew noted it", feedback: "your feedback", suggestion: "a suggestion you approved", you: "you", tidy: "a tidy" };
const USED: Record<Why["how"], string> = { relevant: "Loaded: it bore on the request", recall: "Found with recall" };
const day = (iso: string) => new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

// Merging takes a second line: "pick" while you choose it, then the draft is asked for, and it waits on the Memory page.
export type Merge = null | { step: "pick" } | { step: "drafting" } | { step: "drafted"; text: string } | { step: "failed"; error: string };

export function LinePanel({ node, cls, edges, nodes, merge, onClose, onSelect, onChanged, onMerge, onPick, onOpenConversation, onOpenMemory }: {
  node: GraphNode; cls: string; edges: GraphEdge[]; nodes: GraphNode[]; merge: Merge;
  onClose: () => void;
  onSelect: (id: string) => void;                 // go to another star
  onChanged: (gone?: boolean) => void;            // the line was pinned, unpinned or (gone) forgotten
  onMerge: (to: Merge) => void;                   // start or stop picking
  onPick: (other: GraphNode) => void;             // the second line was chosen here, from the list
  onOpenConversation: (id: string) => void;
  onOpenMemory: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Why[] | null>(null);
  useEffect(() => { setError(""); setBusy(""); }, [node.id]);
  // Its history is asked for when the star is picked, and again when it's been used since.
  useEffect(() => {
    let live = true;
    setHistory(null);
    api<{ history: Why[] }>(`/api/memory/why?where=${encodeURIComponent(node.where)}&line=${encodeURIComponent(node.text)}`)
      .then((r) => { if (live) setHistory(Array.isArray(r.history) ? r.history : []); }, () => { if (live) setHistory([]); });
    return () => { live = false; };
  }, [node.id, node.where, node.text, node.recalls]);

  const pin = async () => {
    setBusy("pin"); setError("");
    try { await api("/api/memory/pin", { where: node.where, line: node.text, on: !node.pinned }); onChanged(); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  const forget = async () => {
    if (!(await ask({ title: "Forget this line?", body: `It's taken out of ${node.place} for good: "${node.text.length > 160 ? node.text.slice(0, 160) + "…" : node.text}"`, action: "Forget", danger: true }))) return;
    setBusy("forget"); setError("");
    try { await api("/api/memory/forget", { where: node.where, line: node.text }); onChanged(true); } catch (e) { setError(errorText(e)); setBusy(""); }
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const joined = (kind: GraphEdge["kind"]) => edges.flatMap((e) => (e.kind === kind && (e.a === node.id || e.b === node.id) ? [byId.get(e.a === node.id ? e.b : e.a)] : [])).filter((n): n is GraphNode => !!n);
  const alike = joined("alike"), together = joined("together");
  const others = nodes.filter((n) => n.where === node.where && n.id !== node.id);
  const o = node.origin;
  const picking = merge?.step === "pick";

  return (
    <aside className={cx("con-panel", cls)} aria-label="The line you picked">
      <header>
        <span className="con-dot" aria-hidden="true" />
        <h3>{node.emoji && <span className="con-emoji" aria-hidden="true">{node.emoji}</span>}{node.place}</h3>
        <button type="button" className="con-tool" title="Close (Esc)" aria-label="Close this line" onClick={onClose}><Icon name="x" /></button>
      </header>
      <div className="con-panel-body">
        <p className="con-text">{node.pinned && <span className="con-pinned" title="Pinned: it's in every prompt"><Icon name="pin" /> Pinned</span>}{node.text}</p>
        <dl className="con-facts">
          {node.date && <><dt>Kept</dt><dd>{node.date}</dd></>}
          <dt>From</dt>
          <dd>{o ? <>{HOW[o.how] ?? o.how}{o.thread && <>, in <button type="button" className="linkish" title="Open that conversation" onClick={() => onOpenConversation(o.thread!)}>{o.title || "a conversation"}</button></>}</> : "not on record (written before origins were kept, or by hand)"}</dd>
          <dt>Used</dt>
          <dd>{node.recalls
            ? <>Recalled {node.recalls} {plural(node.recalls, "time")}, last on {day(node.lastRecalled!)}{node.lastThread && <>, in <button type="button" className="linkish" title="Open that conversation" onClick={() => onOpenConversation(node.lastThread!.id)}>{node.lastThread.title || "a conversation"}</button></>}</>
            : "Not recalled yet"}</dd>
        </dl>

        {merge?.step === "pick" && (
          <section className="con-merge" aria-label="Merge with another line">
            <p><b>Merge with which line?</b> Pick another star in {node.place}, or one from this list. A draft of the one line is written for you to approve: nothing changes until you do.</p>
            {others.length
              ? <ul className="con-list">{others.map((n) => <li key={n.id}><button type="button" onClick={() => onPick(n)}>{n.text}</button></li>)}</ul>
              : <p className="con-quiet">There's no other line in {node.place} to merge it with.</p>}
            <button type="button" className="btn" onClick={() => onMerge(null)}>Cancel</button>
          </section>
        )}
        {merge?.step === "drafting" && <p className="con-merge" role="status">Drafting the one line…</p>}
        {merge?.step === "drafted" && (
          <section className="con-merge" role="status">
            <p><b>Drafted, and waiting for you.</b> Nothing has changed yet: approve it on the Memory page and it takes both lines' place.</p>
            <p className="con-draft">{merge.text}</p>
            <button type="button" className="btn primary" onClick={onOpenMemory}>Review it</button>
          </section>
        )}
        {merge?.step === "failed" && <p className="con-error" role="alert">{merge.error}</p>}
        {error && <p className="con-error" role="alert">{error}</p>}

        {!picking && <>
          <h4>When it was used</h4>
          {history === null ? <p className="con-quiet">Looking…</p>
            : history.length === 0 ? <p className="con-quiet">Nothing on record yet. It's written down each time this line bears on a request or comes back from recall.</p>
            : <ol className="con-history">{history.map((h, i) => (
                <li key={`${h.time}${i}`}>
                  <time dateTime={h.time}>{when(h.time)}</time>
                  <span>{USED[h.how] ?? h.how}{h.score !== undefined && <small title="How strongly it matched"> · {h.score}</small>}</span>
                  {h.thread && <button type="button" className="linkish" title="Open that conversation" onClick={() => onOpenConversation(h.thread!)}>{h.title || "a conversation"}</button>}
                </li>
              ))}</ol>}
          {alike.length > 0 && <><h4>Lines like it</h4><ul className="con-list">{alike.map((n) => <li key={n.id}><button type="button" onClick={() => onSelect(n.id)}>{n.text}<small>{n.where === node.where ? "" : n.place}</small></button></li>)}</ul></>}
          {together.length > 0 && <><h4>Used with it</h4><ul className="con-list">{together.map((n) => <li key={n.id}><button type="button" onClick={() => onSelect(n.id)}>{n.text}<small>{n.where === node.where ? "" : n.place}</small></button></li>)}</ul></>}
        </>}
      </div>
      <footer>
        {/* The note about you is loaded as written: there's nothing to pin. */}
        {node.kind !== "about" && <button type="button" className="btn" disabled={!!busy} onClick={pin}>{node.pinned ? "Unpin" : "Pin"}</button>}
        <button type="button" className="btn" disabled={!!busy || merge?.step === "drafting"} aria-pressed={picking} onClick={() => onMerge(picking ? null : { step: "pick" })}>Merge with…</button>
        <button type="button" className="btn danger" disabled={!!busy} onClick={forget}>Forget</button>
      </footer>
    </aside>
  );
}
