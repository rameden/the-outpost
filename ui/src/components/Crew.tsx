// The crew, as a bar: by default a slim strip with each agent's icon, name, and a dot (plus what
// they're doing, while they're doing it). The chevron at the end opens it up into cards that
// also show each one's level and model; your choice is remembered. Click an agent for its page;
// on a card, click the model line to change model, effort, or turns.

import { useRef, useState } from "react";
import { storeGet, storeSet } from "../api.ts";
import { glide } from "../motion.tsx";
import { Icon } from "./bits.tsx";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, shortModel } from "../format.ts";
import type { CampState, Character } from "../types.ts";

export type OpenPicker = (c: Character, anchor: HTMLElement) => void;

// onAdd / onEdit: the + card at the end opens the crew dialog; so does the pencil on a crew member you added.
export function Crew({ S, store, pickerFor, onOpenAgent, onOpenPicker, onAdd, onEdit }: {
  S: CampState | null; store: FeedStore; pickerFor: string | null; onOpenAgent: (id: string) => void; onOpenPicker: OpenPicker;
  onAdd?: () => void; onEdit?: (c: Character) => void;
}) {
  const crew = useFeed(store, (s) => s.crew);
  const [slim, setSlim] = useState(() => storeGet("camp-crew") !== "cards");
  const bar = useRef<HTMLElement>(null);
  // Opening the bar up (or folding it down) moves everything after it: those glide to their new
  // places, and the bar's own contents fade up.
  const toggle = () => {
    const zone = bar.current?.closest<HTMLElement>(".zone");
    const after: HTMLElement[] = [];
    for (let el = zone?.nextElementSibling; el; el = el.nextElementSibling) after.push(el as HTMLElement);
    glide(() => setSlim((on) => { storeSet("camp-crew", on ? "cards" : "slim"); return !on; }), after, { within: zone?.parentElement, fresh: bar.current });
  };
  return (
    <section className={cx("crew", slim && "slim")} aria-label="The crew" ref={bar}>
      {S?.characters.map((c) => {
        const st = crew[c.name] ?? { status: "idle", line: "" };
        const xp = S.xp[c.name] ?? 0;
        const statusText = st.status === "active" ? (st.line || "Working…") : st.status === "waiting" ? "Waiting for your OK" : (st.line ? `Last: ${st.line}` : "At camp");
        return (
          <div key={c.id} className={cx("member", cClass(c.name), st.status !== "idle" && st.status)} role="button" tabIndex={0}
            title={slim ? `${c.name}: ${statusText}\n${shortModel(c.model)} · ${c.effort} · Lv ${Math.floor(xp / 50) + 1}\n${c.role}\nClick to open ${c.name}'s page.`
              : `${c.role}\n${c.personality ?? ""}\nClick to open ${c.name}'s page.`} aria-label={`Open ${c.name}'s page`}
            onClick={() => onOpenAgent(c.id)}
            onKeyDown={(ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === ev.currentTarget) { ev.preventDefault(); onOpenAgent(c.id); } }}>
            <div className="avatar" aria-hidden="true">{c.emoji}</div>
            <div className="member-main">
              <div className="member-name">
                <span>{c.name}</span>
                {c.custom && onEdit && (
                  <button type="button" className="member-edit" aria-label={`Edit ${c.name}`} title={`Edit ${c.name}`}
                    onClick={(ev) => { ev.stopPropagation(); onEdit(c); }}>✎</button>
                )}
                <span className="member-level" title={`${xp} XP`}>Lv {Math.floor(xp / 50) + 1}</span>
              </div>
              <button type="button" className={cx("kit-btn", c.overridden && "custom")} title={c.overridden ? "Custom model (click to change)" : "Change model"}
                aria-haspopup="dialog" aria-expanded={pickerFor === c.id}
                onClick={(ev) => { ev.stopPropagation(); onOpenPicker(c, ev.currentTarget); }}>
                <span>{shortModel(c.model)} · {c.effort}{c.maxTurns !== c.defaultMaxTurns ? ` · ${c.maxTurns} turns` : ""}</span>▾
              </button>
              <div className="member-status"><span className="dot" /><span>{statusText}</span></div>
            </div>
          </div>
        );
      })}
      {S && onAdd && (
        <button type="button" className="member-add" aria-label="Add a crew member" title="Add a crew member" onClick={onAdd}>＋</button>
      )}
      {S && (
        <button type="button" className="hist-icon crew-toggle" aria-expanded={!slim} aria-label={slim ? "Show more about the crew" : "Show less about the crew"}
          title={slim ? "Open the crew up into cards: level, model, and what each is doing" : "Fold the crew down to a slim strip"} onClick={toggle}>
          <Icon name={slim ? "chevron" : "chevronUp"} />
        </button>
      )}
    </section>
  );
}
