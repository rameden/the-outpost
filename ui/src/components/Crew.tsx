// The roster area is two halves, side by side. On the left, the crew. On the right, who's running:
// every quest that's out right now, one row each (two quests by the same crew member are two
// rows), with what it's for, what it's doing this moment, how long it's been out, and whether
// it's waiting on you; a row goes to that quest in its conversation. With nobody out, it shrinks
// to a short note at the end and the crew has the whole width (styles.css).
//
// The crew, as a bar: by default a slim strip with each agent's icon, name, and a dot (plus what
// they're doing, while they're doing it). The chevron at the end of the strip opens it up into
// cards that also show each one's level and model, and folds it again; your choice is remembered.
// The + beside it adds a crew member. Click an agent for its page;
// on a card, click the model line to change model, effort, or turns.

import { useEffect, useRef, useState } from "react";
import { storeGet, storeSet } from "../api.ts";
import { glide } from "../motion.tsx";
import { Icon } from "./bits.tsx";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, shortModel, took } from "../format.ts";
import type { CampState, Character } from "../types.ts";
import type { QuestOut } from "../feed/reducer.ts";

// How long something has been going, as you'd say it.
export const outFor = (ms: number) => took(ms / 1000);

function QuestsOut({ quests, onOpen }: { quests: QuestOut[]; onOpen?: (q: QuestOut) => void }) {
  // The clock ticks only while someone is out.
  const [now, setNow] = useState(() => Date.now());
  const out = quests.length > 0;
  useEffect(() => {
    if (!out) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [out]);
  const waiting = quests.filter((q) => q.waiting).length;
  if (!quests.length) return <div className="crew-out idle" role="group" aria-label="Quests out now"><span className="co-none">No agents running</span></div>;
  return (
    <div className="crew-out" role="group" aria-label="Quests out now">
      <span className="co-head"><b>{quests.length} out</b>{waiting > 0 && <span>· {waiting} {waiting === 1 ? "needs" : "need"} your OK</span>}</span>
      <ul>
        {quests.map((q) => (
          <li key={`${q.expId}|${q.id}`}>
            <button type="button" className={cx("co-row", cClass(q.who), q.waiting && "waiting")} title={`${q.who}: ${q.brief || "a quest"}\nClick to go to it.`} onClick={() => onOpen?.(q)}>
              <span className="co-who"><span aria-hidden="true">{q.emoji}</span> {q.who}</span>
              <span className="co-brief">{q.step ? <b className="co-step" title={`Step ${q.step} of the plan`}>{q.step}</b> : null}{q.brief || "A quest"}</span>
              <span className="co-doing">{q.waiting ? "Waiting for your OK" : q.line}</span>
              <time className="co-time">{outFor(now - q.started)}</time>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type OpenPicker = (c: Character, anchor: HTMLElement) => void;

// onAdd / onEdit: the + card at the end opens the crew dialog; so does the pencil on a crew member you added.
// onOpenQuest: go to a quest that's out (its conversation, and its own block there).
export function Crew({ S, store, pickerFor, onOpenAgent, onOpenPicker, onAdd, onEdit, onOpenQuest }: {
  onOpenQuest?: (q: QuestOut) => void;
  S: CampState | null; store: FeedStore; pickerFor: string | null; onOpenAgent: (id: string) => void; onOpenPicker: OpenPicker;
  onAdd?: () => void; onEdit?: (c: Character) => void;
}) {
  const crew = useFeed(store, (s) => s.crew);
  const quests = useFeed(store, (s) => s.quests); // every quest that's out: a crew member can have several
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
    <div className="crew-zone">
    <div className="crew-area">
    <div className="crew-half">
    <section className={cx("crew", slim && "slim")} aria-label="The crew" ref={bar}>
      {S?.characters.map((c) => {
        const st = crew[c.name] ?? { status: "idle", line: "" };
        const xp = S.xp[c.name] ?? 0;
        const out = quests.filter((q) => q.who === c.name);
        const several = out.length > 1;
        const outLines = several ? `\n${out.map((q) => `• ${q.brief || "A quest"}: ${q.waiting ? "waiting for your OK" : q.line || "working"}`).join("\n")}` : "";
        const statusText = several ? `${out.length} quests out${out.some((q) => q.waiting) ? " · one needs your OK" : ""}` : st.status === "active" ? (st.line || "Working…") : st.status === "waiting" ? "Waiting for your OK" : (st.line ? `Last: ${st.line}` : "At camp");
        return (
          <div key={c.id} className={cx("member", cClass(c.name), st.status !== "idle" && st.status)} role="button" tabIndex={0}
            title={slim ? `${c.name}: ${statusText}${outLines}\n${shortModel(c.model)} · ${c.effort} · Lv ${Math.floor(xp / 50) + 1}\n${c.role}\nClick to open ${c.name}'s page.`
              : `${several ? `${statusText}${outLines}\n\n` : ""}${c.role}\n${c.personality ?? ""}\nClick to open ${c.name}'s page.`} aria-label={`Open ${c.name}'s page`}
            onClick={() => onOpenAgent(c.id)}
            onKeyDown={(ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === ev.currentTarget) { ev.preventDefault(); onOpenAgent(c.id); } }}>
            <div className="avatar" aria-hidden="true">{c.emoji}</div>
            <div className="member-main">
              <div className="member-name">
                <span>{c.name}</span>
                {several && <span className="member-count" aria-label={`${out.length} quests out`}>×{out.length}</span>}
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
    </section>
    {S && onAdd && <button type="button" className="hist-icon crew-add" aria-label="Add a crew member" title="Add a crew member" onClick={onAdd}>+</button>}
    {S && (
      <button type="button" className="hist-icon crew-fold" aria-expanded={!slim} aria-label={slim ? "Show more about the crew" : "Show less about the crew"}
        title={slim ? "Open the crew up into cards: level, model, and what each is doing" : "Fold the crew down to a slim strip"} onClick={toggle}>
        <Icon name={slim ? "chevron" : "chevronUp"} />
      </button>
    )}
    </div>
    <QuestsOut quests={quests} onOpen={onOpenQuest} />
    </div>
    </div>
  );
}
