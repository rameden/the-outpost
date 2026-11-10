// The crew, as a bar across the top: one compact card each, with what they're doing right now,
// their level, and their model. Click a card for that agent's page; click the model line to
// change model, effort, or turns.

import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, shortModel } from "../format.ts";
import type { CampState, Character } from "../types.ts";

export type OpenPicker = (c: Character, anchor: HTMLElement) => void;

export function Crew({ S, store, pickerFor, onOpenAgent, onOpenPicker }: {
  S: CampState | null; store: FeedStore; pickerFor: string | null; onOpenAgent: (id: string) => void; onOpenPicker: OpenPicker;
}) {
  const crew = useFeed(store, (s) => s.crew);
  return (
    <section className="crew" aria-label="The crew">
      {S?.characters.map((c) => {
        const st = crew[c.name] ?? { status: "idle", line: "" };
        const xp = S.xp[c.name] ?? 0;
        const statusText = st.status === "active" ? (st.line || "Working…") : st.status === "waiting" ? "Waiting for your OK" : (st.line ? `Last: ${st.line}` : "At camp");
        return (
          <div key={c.id} className={cx("member", cClass(c.name), st.status !== "idle" && st.status)} role="button" tabIndex={0}
            title={`${c.role}\n${c.personality ?? ""}\nClick to open ${c.name}'s page.`} aria-label={`Open ${c.name}'s page`}
            onClick={() => onOpenAgent(c.id)}
            onKeyDown={(ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === ev.currentTarget) { ev.preventDefault(); onOpenAgent(c.id); } }}>
            <div className="avatar" aria-hidden="true">{c.emoji}</div>
            <div className="member-main">
              <div className="member-name">
                <span>{c.name}</span>
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
  );
}
