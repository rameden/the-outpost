// A question before something that costs something or can't be taken back: what will happen,
// in the page's own dialog, with the button that does it named for what it does. Enter goes
// ahead, Escape (or a click outside) doesn't.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Presence } from "../motion.tsx";

export function Confirm({ title, children, action, danger, busy, onConfirm, onCancel }: {
  title: string; children: ReactNode; action: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    go.current?.focus();
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onCancel(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onCancel} />
      <div className="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body" id="confirm-body">{children}</div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" ref={go} className={danger ? "btn danger" : "btn primary"} disabled={busy} onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </>
  );
}

// The same question from anywhere, without a dialog of your own to keep: `if (await ask({ … }))`.
// The page has one <ConfirmHost /> (in App) that shows it. A piece of the page drawn on its own,
// with no host (a test of one component), falls back to the browser's own prompt, with the same words.
export type Question = { title: string; body?: string; action: string; danger?: boolean };
let host: ((q: Question, done: (yes: boolean) => void) => void) | null = null;
export function ask(q: Question): Promise<boolean> {
  if (!host) return Promise.resolve(typeof confirm === "function" && confirm(q.body ? `${q.title} ${q.body}` : q.title));
  return new Promise((resolve) => host!(q, resolve));
}

export function ConfirmHost() {
  const [asked, setAsked] = useState<Question | null>(null);
  const done = useRef<((yes: boolean) => void) | null>(null);
  const answer = useCallback((yes: boolean) => { done.current?.(yes); done.current = null; setAsked(null); }, []);
  useEffect(() => {
    host = (q, resolve) => { done.current?.(false); done.current = resolve; setAsked(q); }; // a second question takes the first one's place
    return () => { host = null; done.current?.(false); done.current = null; };
  }, []);
  const yes = useCallback(() => answer(true), [answer]);
  const no = useCallback(() => answer(false), [answer]);
  return (
    <Presence>{asked && (
      // Above whatever asked it, Settings included.
      <div className="confirm-host">
        <Confirm title={asked.title} action={asked.action} danger={asked.danger} onConfirm={yes} onCancel={no}>{asked.body && <p>{asked.body}</p>}</Confirm>
      </div>
    )}</Presence>
  );
}
