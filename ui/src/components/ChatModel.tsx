// Which model you're talking to, for a conversation outside any project: a quiet label beside
// the message box that opens a list of every model you can use (Claude's, and each provider
// you've connected). Outside a project a message with no @ is a plain chat with that model, and
// nobody from the crew is involved. The choice goes with the message and stays with the
// conversation: replies keep it until you pick another, or go back to the default.
//
// If you @ someone, it's the model they answer on for that conversation. Crew the Quartermaster
// sends out on quests keep the models they're set to.

import type { CampState } from "../types.ts";
import { Icon } from "./bits.tsx";
import { ModelOptions, useModelList } from "./ModelPicker.tsx";
import { autoName, isAuto } from "../format.ts";
import { usePopover } from "./usePopover.ts";

import { w, a as an } from "../words.ts";
// picked: what you've chosen for the next message (undefined: nothing yet; null: back to their own).
// standing: what the conversation already runs on, if you picked one before.
export function ChatModel({ S, picked, standing, onPick }: {
  S: CampState; picked: string | null | undefined; standing?: string; onPick: (model: string | null) => void;
}) {
  const { open, setOpen, box } = usePopover();
  const connected = (S.providers ?? []).filter((p) => p.connected).map((p) => p.id).join(",");
  const { list } = useModelList(`${S.runtime}|${connected}`);

  const now = picked === undefined ? standing ?? "" : picked ?? "";
  const info = list?.models.find((m) => m.id === now);
  const name = !now ? "Default model" : isAuto(now) ? autoName(now) : info ? `${info.provider ? `${info.provider} · ` : ""}${info.name}` : now;
  const changed = picked !== undefined && (picked ?? "") !== (standing ?? "");
  return (
    <span className="model-pick" ref={box}>
      <button type="button" className={now ? "work-btn changed" : "work-btn"} aria-haspopup="dialog" aria-expanded={open} aria-label={`Model for this conversation: ${name}`}
        title={now ? `This conversation is answered by ${name}${changed ? ", from this message on" : ""}. Click to change.` : `A message with no @ goes straight to the ${w("camp")}'s default model (Claude Sonnet). Click to pick another for this conversation.`}
        onClick={() => setOpen((o) => !o)}><Icon name="cpu" /><b>{name}</b></button>
      {open && (
        <div className="popover model-menu" role="dialog" aria-label="Model for this conversation">
          <label className="field">Model for this conversation
            <select autoFocus value={now} disabled={!list} aria-label="Model" onChange={(ev) => { onPick(ev.target.value || null); setOpen(false); }}>
              <option value="">Default model (Claude Sonnet; {an("crew")} member's own if you @ one)</option>
              {list && now && !info && !isAuto(now) && <option value={now}>{now} (not available right now)</option>}
              {list && <ModelOptions models={list.models} auto />}
            </select>
          </label>
          <div className="menu-tip">With no @, your message goes straight to this model: a plain chat, no {w("crew")}. If you @ {an("crew")} member, they answer on it. {w("Crew")} sent out on {w("quests")} keep their own models. Replies keep your choice until you change it.
            {isAuto(now) && " Auto picks a model for each task and can switch part-way; each run says which model it used and why."}</div>
        </div>
      )}
    </span>
  );
}
