// The panel of whoever you're looking at in the full-screen view (Orbit.tsx): what they're doing,
// what's waiting on you from them, and the means to act on it without leaving: answer a decision,
// say something to an expedition or stop it, and send them something new (Act.tsx). Below that,
// what they carry: each skill and connector, which is what their satellites are.

import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Icon } from "../components/bits.tsx";
import type { CrewStatus, QuestOut } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, leadName, shortModel, took } from "../format.ts";
import { Decisions, Dispatch, Steer, Stop } from "./Act.tsx";
import { asksOf, questsOf, runsOf, type Line } from "./doing.ts";
import { levelOf, questsDone, type KitItem } from "./kit.ts";
import { quietFor, sayOf, spendLine, stalled, NEAR_FULL } from "./meaning.ts";
import { lapOf } from "./scene.ts";

import { w, a as an, cap } from "../words.ts";
export type Body = { id: string; name: string; emoji?: string; role?: string; model?: string; effort?: string };

// The time, ticking, for as long as there's something to time. clock: what time it is (a replay has its own).
export function useNow(on: boolean, clock: () => number = Date.now) {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    if (!on) return;
    setNow(clock());
    const t = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(t);
  }, [on, clock]);
  return now;
}

// (Its classes, here and for who's working or waiting below, are orb-… and st-…: the page has styles of its own for plain "ask", "tool" and "waiting".)
const TAGS: Record<Line["tag"], string> = { said: "says", tool: "tool", file: "file", ask: "asks", note: "note", you: "you" };
function Log({ lines }: { lines: Line[] }) {
  if (!lines.length) return null;
  return (
    <ol className="orb-log">
      {lines.map((l) => <li key={l.id} className={`orb-l-${l.tag}`}><i>{TAGS[l.tag]}</i><span>{l.text}{l.live && <b className="orb-caret" aria-hidden="true" />}</span></li>)}
    </ol>
  );
}

// Say something to an expedition, or stop it: once for each, however many of its quests are listed.
function Hand({ expId }: { expId: string }) {
  return <div className="orb-hand"><Steer expId={expId} /><Stop expId={expId} /></div>;
}

// What they carry. One opens at a time (picked: which, as its satellite is the one marked in the sky).
function Kit({ name, kit, picked, onPick }: { name: string; kit: KitItem[]; picked: string | null; onPick: (id: string | null) => void }) {
  if (!kit.length) return null;
  return (
    <section className="orb-kit" aria-label={`What ${name} carries`}>
      <h4>{kit.length === 1 ? "One satellite" : `${kit.length} satellites`}<small>its skills and connectors</small></h4>
      <ul>
        {kit.map((k) => {
          const open = picked === k.id;
          return (
            <li key={k.id} className={cx(`kit-${k.kind}`, k.state === "error" && "bad", open && "on")}>
              <button type="button" aria-expanded={open} onClick={() => onPick(open ? null : k.id)}>
                <i aria-hidden="true" /><span>{k.name}</span><em>{k.kind === "skill" ? (k.shared ? "shared skill" : "skill") : k.state === "error" ? "connector, failing" : k.state === "connected" ? "connector" : "connector, not yet used"}</em>
              </button>
              {open && (
                <div className="orb-kit-about">
                  <p>{k.about || (k.kind === "skill" ? "A skill, with nothing said about it." : "A connector, with nothing said about it.")}</p>
                  {k.error && <p className="bad">{k.error}</p>}
                  {k.tools && k.tools.length > 0 && <p className="orb-kit-tools">{k.tools.length === 1 ? "One tool" : `${k.tools.length} tools`}{k.write ? ", some of which can change things" : ""}: {k.tools.slice(0, 8).join(", ")}{k.tools.length > 8 ? "…" : ""}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// What the one you're looking at is doing. bearing: where its planet is round the sun, kept up to date by the drawing.
// make: the HD view's world maker for this one, when HD is on. live: this is the real camp as it is now, so it can be
// acted on (a demo or a replay can only be watched). owns: whether a decision asked by that name is this one's to show
// (the Quartermaster's panel takes any that nobody in the sky asked). onSent: something was sent to them from here.
export function Panel({ body, lead, nth, xp, store, st, bearing, make, live, clock, kit, picked, onPick, spend, limit, owns, onSent, onBack, onOpenAgent, onOpenQuest, onOpenConversation }: {
  body: Body; lead: boolean; nth: number; xp: number | null; store: FeedStore; st: CrewStatus; bearing: RefObject<HTMLElement | null>; make?: ReactNode;
  live: boolean; clock: () => number; kit: KitItem[]; picked: string | null; onPick: (id: string | null) => void;
  spend: { cost: number; share: number } | null; limit: { label: string; used: number } | null; owns: (who: string) => boolean; onSent: () => void;
  onBack: () => void; onOpenAgent?: (id: string) => void; onOpenQuest?: (q: QuestOut) => void; onOpenConversation?: (id: string) => void;
}) {
  const items = useFeed(store, (s) => s.items);
  const open = useFeed(store, (s) => s.open);
  const quests = useFeed(store, (s) => s.quests);
  const waiting = useFeed(store, (s) => s.asks);
  const out = useMemo(() => questsOf({ items, open, quests }, body.name), [items, open, quests, body.name]);
  const runs = useMemo(() => runsOf({ items, open }, body.name), [items, open, body.name]);
  const asks = useMemo(() => (live ? asksOf({ items, asks: waiting }, owns) : []), [live, items, waiting, owns]);
  const now = useNow(out.length + runs.length > 0, clock);
  // Each expedition is spoken to or stopped from one place: its own card if it has one here, else the first of its quests.
  const handed = new Set(runs.map((r) => r.expId));
  const hand = (expId: string) => { if (!live || handed.has(expId)) return null; handed.add(expId); return <Hand expId={expId} />; };
  return (
    <aside className={cx("orb-panel", cClass(body.name), `st-${st.status}`)} aria-label={`What ${body.name} is doing`}>
      <header>
        <span className="orb-p-face" aria-hidden="true">{body.emoji ?? body.name.slice(0, 1)}</span>
        <div><h3>{body.name}</h3>{body.role && <p>{body.role}</p>}</div>
        <button type="button" className="orb-tool" aria-label="Back to the whole system" title="Back to the whole system (Esc)" onClick={onBack}><Icon name="x" /></button>
      </header>
      <dl className="orb-facts">
        <div><dt>Now</dt><dd className="orb-state">{sayOf(st, out, now).text}</dd></div>
        {body.model && <div><dt>Model</dt><dd>{shortModel(body.model)}{body.effort ? ` · ${body.effort}` : ""}</dd></div>}
        {xp !== null && <div><dt>Level</dt><dd>{levelOf(xp)}{questsDone(xp) > 0 ? ` · ${questsDone(xp)} ${questsDone(xp) === 1 ? w("quest") : w("quests")} done` : ""}</dd></div>}
        {spend && <div><dt>Today</dt><dd>{spendLine(spend)}</dd></div>}
        {lead && limit && <div className={limit.used >= NEAR_FULL ? "warn" : undefined}><dt>Plan limit</dt><dd>{limit.label} · {Math.round(limit.used * 100)}% used</dd></div>}
        {lead ? <div><dt>Place</dt><dd>The sun</dd></div>
          : <div><dt>Orbit</dt><dd>{nth + 1} out · a lap every {Math.round(lapOf(nth))}s · <span ref={bearing} title="Where it is round the sun, clockwise from due right">000°</span></dd></div>}
      </dl>
      <div className="orb-p-body">
        <Decisions asks={asks} />
        {make}
        {out.length > 0 && <h4>{out.length === 1 ? `Out on ${an("quest")}` : `${out.length} ${w("quests")} out`}</h4>}
        {out.map((q) => {
          const quiet = stalled(q, now);
          return (
            <article key={`${q.expId}|${q.id}`} className={cx("orb-work-card", q.waiting && "st-waiting", quiet && "st-stalled")}>
              <div className="orb-w-head">{q.step ? <b className="orb-step" title={`Step ${q.step} of the plan`}>{q.step}</b> : null}<span>{q.brief || cap(an("quest"))}</span><time>{took((now - q.started) / 1000)}</time></div>
              <p className="orb-w-doing">{q.waiting ? "Waiting for your OK" : quiet ? `${quietFor(q, now)}. ${q.line}` : q.line}</p>
              <Log lines={q.log} />
              {hand(q.expId)}
              {onOpenQuest && <button type="button" className="orb-btn" onClick={() => onOpenQuest(q)}>{q.waiting ? "Go to it and answer" : "Go to it in the conversation"}</button>}
            </article>
          );
        })}
        {runs.length > 0 && <h4>{lead ? (runs.length === 1 ? `${cap(an("expedition"))} under way` : `${runs.length} ${w("expeditions")} under way`) : "In a conversation with you"}</h4>}
        {runs.map((r) => (
          <article key={r.expId} className="orb-work-card">
            <div className="orb-w-head"><span>{r.task}</span><time>{took((now - r.started) / 1000)}</time></div>
            {r.steps && <p className="orb-w-doing">{r.steps.done} of {r.steps.total} {r.steps.total === 1 ? "step" : "steps"} done{r.steps.out ? ` · ${r.steps.out} out now` : ""}</p>}
            {r.plan && <ol className="orb-plan">{r.plan.map((s) => <li key={s.n} className={`way-${s.state}`}><i aria-hidden="true" /><span>{s.text}</span></li>)}</ol>}
            <Log lines={r.log} />
            {live && <Hand expId={r.expId} />}
            {onOpenConversation && r.thread && <button type="button" className="orb-btn" onClick={() => onOpenConversation(r.thread!)}>Open the conversation</button>}
          </article>
        ))}
        {!out.length && !runs.length && !asks.length && (
          <p className="orb-quiet">{lead
            ? `No ${w("expedition")} is under way. When you send the ${body.name} on one, its plan and its progress show here as they happen.`
            : `At ${w("camp")}, with nothing out. When the ${leadName()} sends ${body.name} on ${an("quest")}, it shows here as it happens.`}</p>
        )}
        <Kit name={body.name} kit={kit} picked={picked} onPick={onPick} />
      </div>
      {(live || onOpenAgent) && (
        <footer>
          {live && <Dispatch id={body.id} name={body.name} lead={lead} onSent={onSent} />}
          {onOpenAgent && <button type="button" className="orb-btn" onClick={() => onOpenAgent(body.id)}>Open {body.name}'s page</button>}
        </footer>
      )}
    </aside>
  );
}
