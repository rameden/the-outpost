// The roster area is two halves, side by side. On the left, the crew. On the right, who's running:
// every quest that's out right now, one row each (two quests by the same crew member are two
// rows), with what it's for, what it's doing this moment, how long it's been out, and whether
// it's waiting on you; a row goes to that quest in its conversation. With nobody out, the right
// half says so, so the area keeps its shape.
//
// The halves start the same width. Drag the line between them to give one more room, and the
// arrow at the end of either half folds that half away to a slim rail at its edge (the crew's
// says how many are busy, the other how many are out), which brings it back. One half is always
// open: folding the second opens the first. The widths and what's folded are remembered.
//
// The crew, as a bar: by default a slim strip with each agent's icon, name, and a dot (plus what
// they're doing, while they're doing it). The "Crew" rail under the whole roster area (the same
// rail History, Files and the terminal have) opens it up into cards that also show each one's
// level and model, and folds it again; your choice is remembered. The + at the end of the crew's
// half adds a crew member. Click an agent for its page;
// on a card, click the model line to change model, effort, or turns.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { storeGet, storeSet } from "../api.ts";
import { glide } from "../motion.tsx";
import { Icon } from "./bits.tsx";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, shortModel, took } from "../format.ts";
import type { CampState, Character } from "../types.ts";
import { statusLine, type CrewStatus, type QuestOut } from "../feed/reducer.ts";

// How long something has been going, as you'd say it.
export const outFor = (ms: number) => took(ms / 1000);

// How much of the roster the crew's half takes, and which half is folded away (if either).
const DEFAULT_SHARE = 0.5, MIN_SHARE = 0.2, MAX_SHARE = 0.8;
type Fold = "crew" | "out" | null;
function rememberedShare(): number {
  const n = Number(storeGet("camp-crew-share"));
  return n >= MIN_SHARE && n <= MAX_SHARE ? n : DEFAULT_SHARE;
}
const rememberedFold = (): Fold => { const v = storeGet("camp-crew-fold"); return v === "crew" || v === "out" ? v : null; };

function QuestsOut({ quests, onOpen, onHide }: { quests: QuestOut[]; onOpen?: (q: QuestOut) => void; onHide: () => void }) {
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
  const hide = <button type="button" className="hist-icon half-hide" aria-label="Hide who's running" title="Fold this half away to a rail, and give the crew the room" onClick={onHide}><Icon name="chevronRight" /></button>;
  if (!quests.length) return <div className="crew-out idle" role="group" aria-label="Quests out now"><span className="co-none">No agents running</span>{hide}</div>;
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
      {hide}
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
  const area = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(rememberedShare);
  const [fold, setFold] = useState<Fold>(rememberedFold);
  const folded = (next: Fold) => { storeSet("camp-crew-fold", next ?? ""); setFold(next); };
  // The line between the halves sits where the pointer is, as a share of the roster's width.
  const keepShare = (next: number) => { const s = Math.min(MAX_SHARE, Math.max(MIN_SHARE, next)); setShare(s); return s; };
  function startDrag(ev: ReactPointerEvent<HTMLElement>) {
    ev.preventDefault();
    const box = area.current?.getBoundingClientRect();
    if (!box?.width) return;
    let last = share;
    const move = (m: PointerEvent) => { last = keepShare((m.clientX - box.left) / box.width); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); storeSet("camp-crew-share", String(+last.toFixed(4))); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }
  function onLineKey(ev: KeyboardEvent<HTMLElement>) {
    const step = { ArrowLeft: -0.02, ArrowRight: 0.02 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    storeSet("camp-crew-share", String(+keepShare(share + step).toFixed(4)));
  }
  const busy = S?.characters.filter((c) => (crew[c.name]?.status ?? "idle") !== "idle").length ?? 0;
  const waiting = quests.filter((q) => q.waiting).length;
  // Opening the bar up (or folding it down) moves everything after it: those glide to their new
  // places, and the bar's own contents fade up.
  const toggle = () => {
    if (fold === "crew") return folded(null); // nothing to open up while the crew is folded away: bring it back
    const zone = bar.current?.closest<HTMLElement>(".zone");
    const after: HTMLElement[] = [];
    for (let el = zone?.nextElementSibling; el; el = el.nextElementSibling) after.push(el as HTMLElement);
    glide(() => setSlim((on) => { storeSet("camp-crew", on ? "cards" : "slim"); return !on; }), after, { within: zone?.parentElement, fresh: bar.current });
  };
  return (
    <div className="crew-zone">
    <div className={cx("crew-area", fold && `fold-${fold}`)} ref={area} style={{ "--crew-share": share } as CSSProperties}>
    {fold === "crew" ? (
      <button type="button" className="zone-rail half-rail" aria-expanded="false" aria-label="Show the crew" onClick={() => folded(null)}
        title={`${busy ? `${busy} of the crew ${busy === 1 ? "is" : "are"} busy.\n\n` : ""}Show the crew.`}>
        <Icon name="users" />{busy > 0 && <b>{busy}</b>}
      </button>
    ) : (
    <div className="crew-half">
    <section className={cx("crew", slim && "slim")} aria-label="The crew" ref={bar}>
      {S?.characters.map((c) => {
        const st: CrewStatus = crew[c.name] ?? { status: "idle", line: "" };
        const xp = S.xp[c.name] ?? 0;
        const out = quests.filter((q) => q.who === c.name);
        const several = out.length > 1;
        const outLines = several ? `\n${out.map((q) => `• ${q.brief || "A quest"}: ${q.waiting ? "waiting for your OK" : q.line || "working"}`).join("\n")}` : "";
        const statusText = statusLine(st, out);
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
    {S && <button type="button" className="hist-icon half-hide" aria-label="Hide the crew" title="Fold this half away to a rail, and give who's running the room" onClick={() => folded("crew")}><Icon name="chevronLeft" /></button>}
    </div>
    )}
    {!fold && (
      <div className="crew-line" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize the crew and who's running" title="Drag to resize"
        aria-valuenow={Math.round(share * 100)} aria-valuemin={MIN_SHARE * 100} aria-valuemax={MAX_SHARE * 100}
        onPointerDown={startDrag} onKeyDown={onLineKey} />
    )}
    {fold === "out" ? (
      <button type="button" className={cx("zone-rail half-rail", waiting > 0 && "waiting")} aria-expanded="false" aria-label="Show who's running" onClick={() => folded(null)}
        title={`${quests.length ? `${quests.length} out${waiting ? `, ${waiting} ${waiting === 1 ? "needs" : "need"} your OK` : ""}` : "No agents running"}.\n\nShow who's running.`}>
        <Icon name="list" />{quests.length > 0 && <b>{quests.length}</b>}
      </button>
    ) : <QuestsOut quests={quests} onOpen={onOpenQuest} onHide={() => folded("out")} />}
    </div>
    {S && fold === "crew" ? (
      <button type="button" className="zone-rail crew-rail" aria-expanded="false" aria-label="Show the crew" title="Show the crew" onClick={toggle}>
        <Icon name="users" /><span>Crew</span><Icon name="chevronRight" />
      </button>
    ) : S && (
      <button type="button" className="zone-rail crew-rail" aria-expanded={!slim} aria-label={slim ? "Show more about the crew" : "Show less about the crew"}
        title={slim ? "Open the crew up into cards: level, model, and what each is doing" : "Fold the crew down to a slim strip"} onClick={toggle}>
        <Icon name="users" /><span>Crew</span><Icon name={slim ? "chevron" : "chevronUp"} />
      </button>
    )}
    </div>
  );
}
