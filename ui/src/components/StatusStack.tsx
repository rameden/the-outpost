// What's going on in this conversation, in one card above the message box: the plan of the run
// that's working and how far it's got, the quests out on it, and the messages queued behind it.
// Each queued message can be changed, said to the run now instead, or taken off.
//
// It's there only when there's something to show, and it folds to its one header line (kept per
// conversation, in this browser). It never takes the focus or opens anything unless you ask.

import { useMemo, useState, type KeyboardEvent } from "react";
import { api, errorText, storeGet, storeRemove, storeSet } from "../api.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { findNodes, stepState, type ExpNode, type PlanNode } from "../feed/reducer.ts";
import { STEP_MARK, STEP_SAYS } from "../feed/steps.ts";
import type { CampState } from "../types.ts";
import { cx, plural } from "../format.ts";
import { w } from "../words.ts";
import { Icon } from "./bits.tsx";

type Queued = CampState["queued"][number];

// The messages queued one after another behind a run: the one that waits for it, the one that
// waits for that, and so on. (A request chained to something else isn't in this line.)
export function queueBehind(queued: Queued[] | undefined, run: string | null | undefined): Queued[] {
  const line: Queued[] = [];
  if (!run) return line;
  for (let end = run, seen = new Set<string>(); !seen.has(end); ) {
    seen.add(end);
    const next = (queued ?? []).find((q) => q.after === end);
    if (!next) break;
    line.push(next);
    end = next.id;
  }
  return line;
}

const stackKey = (draftKey?: string) => `camp-stack:${draftKey ?? ""}`;

// anchor: the run the queue lines up behind (the one working, else the conversation's latest).
// live: the run that's working now, if one is.
export function StatusStack({ S, store, anchor, live, draftKey, refresh }: {
  S: CampState | null; store: FeedStore; anchor?: string | null; live?: string | null; draftKey?: string; refresh: () => void;
}) {
  const items = useFeed(store, (s) => s.items);
  const out = useFeed(store, (s) => s.quests);
  const queue = useMemo(() => queueBehind(S?.queued, anchor), [S?.queued, anchor]);
  const plan = useMemo(() => {
    if (!live) return null;
    const run = items.find((n): n is ExpNode => n.kind === "exp" && n.expId === live) ?? findNodes(items, "exp").find((n) => n.expId === live);
    return run ? (findNodes(run.nodes, "plan").at(-1) as PlanNode | undefined) ?? null : null;
  }, [items, live]);
  const quests = useMemo(() => (live ? out.filter((q) => q.expId === live) : []), [out, live]);

  // Folded or open, per conversation. (Read again when you move to another one.)
  const [foldedAt, setFoldedAt] = useState(draftKey);
  const [folded, setFolded] = useState(() => storeGet(stackKey(draftKey)) === "folded");
  if (foldedAt !== draftKey) { setFoldedAt(draftKey); setFolded(storeGet(stackKey(draftKey)) === "folded"); }
  const fold = (f: boolean) => { setFolded(f); if (f) storeSet(stackKey(draftKey), "folded"); else storeRemove(stackKey(draftKey)); };

  const steps = plan?.steps ?? [];
  if (!queue.length && !steps.length && !quests.length) return null;
  const done = steps.filter((s) => stepState(s, plan?.ended) === "done").length;
  const summary = [
    steps.length ? `Plan: ${done} of ${steps.length} done` : "",
    quests.length ? `${quests.length} ${plural(quests.length, w("quest"), w("quests"))} out` : "",
    queue.length ? `${queue.length} queued` : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="status-stack" aria-label="What's going on here">
      <button type="button" className="stack-head" aria-expanded={!folded} onClick={() => fold(!folded)}
        title={folded ? "Show what's going on" : "Fold it to this line"}>
        <Icon name="layers" /><span>{summary}</span><Icon name={folded ? "chevronUp" : "chevron"} />
      </button>
      {!folded && (
        <div className="stack-body">
          {steps.length > 0 && (
            <ol className="stack-plan" aria-label="Plan">
              {steps.map((s) => {
                const state = stepState(s, plan?.ended);
                return (
                  <li key={s.n} className={cx("stack-step", state)} title={STEP_SAYS[state]}>
                    <span className="stack-mark" aria-label={STEP_SAYS[state]}>{STEP_MARK[state]}</span><span>{s.text}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {quests.length > 0 && (
            <ul className="stack-quests" aria-label={`${w("quests")} out`}>
              {quests.map((q) => (
                <li key={q.id}><span aria-hidden="true">{q.emoji}</span><b>{q.who}</b><span className="stack-line">{q.line || q.brief}</span>{q.waiting && <small>waiting on you</small>}</li>
              ))}
            </ul>
          )}
          {queue.length > 0 && (
            <ul className="stack-queue" aria-label="Queued">
              {queue.map((q, i) => <QueuedRow key={q.id} q={q} n={i + 1} live={live ?? null} refresh={refresh} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// One queued message: what it says, and what you can do with it before it goes.
function QueuedRow({ q, n, live, refresh }: { q: Queued; n: number; live: string | null; refresh: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const said = q.text ?? q.task ?? q.label;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); refresh(); return true; } catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  };
  const save = async () => {
    if (editing === null) return;
    if (await act(() => api("/api/queue/edit", { id: q.id, text: editing }))) setEditing(null);
  };
  // Said to the working run now, and so no longer waiting behind it.
  const steer = () => act(async () => { await api("/api/steer", { id: live, text: said }); await api("/api/stop", { id: q.id }); });
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setEditing(null); setError(""); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void save(); }
  };
  return (
    <li className={cx("stack-queued", q.held && "held")}>
      <span className="stack-n" aria-hidden="true">{n}</span>
      {editing !== null ? (
        <span className="stack-edit">
          <textarea autoFocus aria-label="Change the queued message" value={editing} rows={Math.min(6, Math.max(2, editing.split("\n").length))}
            onChange={(ev) => setEditing(ev.target.value)} onKeyDown={onKey} />
          <span className="stack-actions">
            <button type="button" className="btn small primary" disabled={busy || !editing.trim()} onClick={() => void save()} title="Keep the change (⌘Enter)">Save</button>
            <button type="button" className="btn small" disabled={busy} onClick={() => { setEditing(null); setError(""); }} title="Leave it as it was (Esc)">Cancel</button>
          </span>
        </span>
      ) : (
        <>
          <span className="stack-said">
            <span>{said}</span>
            {q.held && <small>{`The work it was waiting on ended as ${q.held}, so it hasn't gone.`}</small>}
          </span>
          <span className="stack-actions">
            {q.held && <button type="button" className="btn small" disabled={busy} onClick={() => void act(() => api("/api/queue/release", { id: q.id }))} title="Send it without waiting any longer">Send it anyway</button>}
            {q.text !== undefined && <button type="button" className="btn small" disabled={busy} onClick={() => setEditing(q.text ?? "")} title="Change what it says before it goes">Edit</button>}
            {live && q.text !== undefined && <button type="button" className="btn small" disabled={busy} onClick={() => void steer()}
              title={`Say it to the ${w("crew")} now: they read it on their next step, without waiting for the ${w("expedition")} to finish`}>Steer now</button>}
            <button type="button" className="btn small" disabled={busy} onClick={() => void act(() => api("/api/stop", { id: q.id }))} title="Take it off the queue: it won't be sent"
              aria-label={`Take off queued message ${n}`}>Remove</button>
          </span>
        </>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
    </li>
  );
}
