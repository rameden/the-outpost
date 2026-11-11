// Another view on a finished answer, from someone who wasn't part of it: a second opinion on
// what was said, or a review of what was changed. Whoever you pick steps into the conversation
// for that one turn (they read it, check the same code, and answer in it); the conversation
// stays with whoever it was with. A review ends with findings the page shows as a list.

import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.ts";
import { crewNow } from "../format.ts";

// kind: what's being asked for. answeredBy: the crew member whose answer this is (they aren't offered).
export function AsideButton({ expId, kind, answeredBy }: { expId: string; kind: "opinion" | "review"; answeredBy?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const crew = crewNow().filter((c) => c.id !== "quartermaster" && c.id !== answeredBy);
  if (!crew.length) return null;
  async function ask(id: string) {
    setBusy(true);
    // The camp has the standing brief for each (src/review.ts): a review's ends in findings the page shows as a list.
    try { await api("/api/send", { text: `@${id}`, replyTo: expId, aside: true, brief: kind }); setOpen(false); }
    catch (e) { alert(errorText(e)); }
    setBusy(false);
  }
  const name = kind === "review" ? "Review changes" : "Second opinion";
  return (
    <span className="aside-pick" ref={box}>
      <button type="button" className="btn small" aria-haspopup="menu" aria-expanded={open}
        title={kind === "review" ? "Have someone else read the diff and list what's wrong with it" : "Have someone else check this answer against the same code and say where it's wrong"}
        onClick={() => setOpen((o) => !o)}>{name}…</button>
      {open && (
        <span className="popover aside-menu" role="menu" aria-label={`${name} from`}>
          <span className="menu-label">{name} from</span>
          {crew.map((c) => (
            <button key={c.id} type="button" role="menuitem" className="mention-item" disabled={busy} onClick={() => ask(c.id)}>
              <span>{c.emoji} {c.name}</span><small>{c.role}</small>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
