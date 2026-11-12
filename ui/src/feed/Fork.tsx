// Carry on from an earlier point: a new conversation that starts as a copy of this one up to this
// run (the original stays as it was). "Go back to here" also puts back what every later run in
// the conversation changed, so the files are as they were right after this one.

import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.ts";
import { say } from "../bus.ts";
import { Confirm } from "../components/Confirm.tsx";
import { plural } from "../format.ts";

type ForkResult = { ok: true; thread: string; expedition: string; restored: string[]; skipped: string[] };

export function ForkButton({ expId }: { expId: string }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function fork(rewind: boolean) {
    setBusy(true);
    try {
      const r = await api<ForkResult>("/api/fork", { id: expId, rewind });
      setOpen(false); setAsking(false);
      if (rewind && (r.restored.length || r.skipped.length)) {
        setMessage(`↩ Put back ${r.restored.length} ${plural(r.restored.length, "file")}.${r.skipped.length ? ` Left alone: ${r.skipped.join(", ")}.` : ""}`);
      }
      say({ do: "open-conversation", id: r.thread });
    } catch (e) { alert(errorText(e)); }
    setBusy(false);
  }

  return (
    <span className="aside-pick" ref={box}>
      <button type="button" className="btn small" aria-haspopup="menu" aria-expanded={open}
        title="Carry on from this point in a new conversation, keeping this one as it is"
        onClick={() => setOpen((o) => !o)}>Fork…</button>
      {open && (
        <span className="popover aside-menu" role="menu" aria-label="Fork">
          <button type="button" role="menuitem" className="mention-item" disabled={busy} onClick={() => fork(false)}>
            <span>Fork from here</span><small>A new conversation up to this answer. Files stay as they are.</small>
          </button>
          <button type="button" role="menuitem" className="mention-item" disabled={busy} onClick={() => { setOpen(false); setAsking(true); }}>
            <span>Go back to here…</span><small>The same, and later runs' changes to files are put back.</small>
          </button>
        </span>
      )}
      {message && <span className="meta" role="status">{message}</span>}
      {asking && (
        <Confirm title="Go back to this answer?" action="Go back" danger busy={busy} onConfirm={() => fork(true)} onCancel={() => setAsking(false)}>
          <p>Every file that later runs in this conversation changed is put back to how it was right after this answer, and a new conversation starts from here.</p>
          <p>This conversation stays in your history as it is. A file someone has changed since a run ended is left alone.</p>
        </Confirm>
      )}
    </span>
  );
}
