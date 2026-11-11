// A question before something that costs something or can't be taken back: what will happen,
// in the page's own dialog, with the button that does it named for what it does. Enter goes
// ahead, Escape (or a click outside) doesn't.

import { useEffect, useRef, type ReactNode } from "react";

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
