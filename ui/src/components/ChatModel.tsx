// Which model you're talking to, for a conversation outside any project: a quiet label beside
// the message box that opens a list of every model you can use (Claude's, and each provider
// you've connected). Outside a project a message with no @ is a plain chat with that model, and
// nobody from the crew is involved. The choice goes with the message and stays with the
// conversation: replies keep it until you pick another, or go back to the default.
//
// If you @ someone, it's the model they answer on for that conversation. Crew the Quartermaster
// sends out on quests keep the models they're set to.

import { useEffect, useRef, useState } from "react";
import type { CampState } from "../types.ts";
import { Icon } from "./bits.tsx";
import { ModelOptions, useModelList } from "./ModelPicker.tsx";

// picked: what you've chosen for the next message (undefined: nothing yet; null: back to their own).
// standing: what the conversation already runs on, if you picked one before.
export function ChatModel({ S, picked, standing, onPick }: {
  S: CampState; picked: string | null | undefined; standing?: string; onPick: (model: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const connected = (S.providers ?? []).filter((p) => p.connected).map((p) => p.id).join(",");
  const { list } = useModelList(`${S.runtime}|${connected}`);
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const now = picked === undefined ? standing ?? "" : picked ?? "";
  const info = list?.models.find((m) => m.id === now);
  const name = !now ? "Default model" : info ? `${info.provider ? `${info.provider} · ` : ""}${info.name}` : now;
  const changed = picked !== undefined && (picked ?? "") !== (standing ?? "");
  return (
    <span className="model-pick" ref={box}>
      <button type="button" className={now ? "work-btn changed" : "work-btn"} aria-haspopup="dialog" aria-expanded={open} aria-label={`Model for this conversation: ${name}`}
        title={now ? `This conversation is answered by ${name}${changed ? ", from this message on" : ""}. Click to change.` : "A message with no @ goes straight to the camp's default model (Claude Sonnet). Click to pick another for this conversation."}
        onClick={() => setOpen((o) => !o)}><Icon name="spark" /><b>{name}</b></button>
      {open && (
        <div className="popover model-menu" role="dialog" aria-label="Model for this conversation">
          <label className="field">Model for this conversation
            <select autoFocus value={now} disabled={!list} aria-label="Model" onChange={(ev) => { onPick(ev.target.value || null); setOpen(false); }}>
              <option value="">Default model (Claude Sonnet; a crew member's own if you @ one)</option>
              {list && now && !info && <option value={now}>{now} (not available right now)</option>}
              {list && <ModelOptions models={list.models} />}
            </select>
          </label>
          <div className="menu-tip">With no @, your message goes straight to this model: a plain chat, no crew. If you @ a crew member, they answer on it. Crew sent out on quests keep their own models. Replies keep your choice until you change it.</div>
        </div>
      )}
    </span>
  );
}
