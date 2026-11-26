// Usage: what the camp has spent and your plan's limits (the budget and how many run at once
// are changed in Settings), then the log of every expedition and job run.

import { useState } from "react";
import { ReviewSpend } from "../components/SkillCare.tsx";
import { api, errorText } from "../api.ts";
import { Clamp, Empty } from "../components/bits.tsx";
import { autoName, cash, cClass, cx, kTok, money, nameNow, plural, resetIn, shortModel, spaced, took, when } from "../format.ts";
import { w } from "../words.ts";
import type { CampState } from "../types.ts";
import { complain } from "../components/StatusLine.tsx";

const tryIt = async (work: () => Promise<unknown>, then: () => void) => {
  try { await work(); then(); } catch (e) { complain(errorText(e)); }
};

// Your plan's usage windows, as Claude Code last reported them.
function Limits({ S, refresh }: { S: CampState; refresh: () => void }) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  if (S.runtime !== "claude-code") return null;
  // Ask Claude Code for the plan's own figures now. It sends no message, so it uses none of the plan.
  const read = async () => {
    setReading(true); setError("");
    try { await api("/api/limits/refresh", {}); refresh(); } catch (e) { setError(errorText(e)); }
    setReading(false);
  };
  return (
    <>
      <div className="limits">
        {!S.limits.length && <div className="meta">Your plan's usage hasn't been read yet.</div>}
        {S.limits.map((l) => {
          const full = l.status === "rejected";
          const pct = l.utilization == null ? null : Math.min(100, Math.round(l.utilization * 100));
          const level = full ? "full" : l.status === "allowed_warning" || (pct ?? 0) >= 80 ? "warn" : "";
          return (
            <div className="limit-row" key={l.type}>
              <div className="limit-top">
                <b>{l.label[0].toUpperCase() + l.label.slice(1)}</b>
                <span>{full ? "used up" : pct == null ? "OK" : `${pct}% used`}{l.resetsAt ? ` · resets in ${resetIn(l.resetsAt)}` : ""}</span>
              </div>
              {(pct != null || full) && <div className={cx("meter", level)}><i style={{ width: `${full ? 100 : pct}%` }} /></div>}
            </div>
          );
        })}
        <Credit S={S} />
        <div className="limit-as-of">
          <span>{S.limitsMeasured ? `Your plan's own figures, as of ${new Date(S.limitsMeasured).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "These are from what the last run reported; they haven't been read from your plan yet."}</span>
          <button type="button" className="linkish" disabled={reading} title="Read your plan's usage now. It sends no message, so it uses none of your plan." onClick={read}>{reading ? "Reading…" : "Refresh"}</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      {S.pausedUntil && (
        <div className="pause-note">
          <span>{S.pauseMessage} Queued work and scheduled jobs wait until then.</span>
          <button type="button" className="btn small" onClick={() => tryIt(() => api("/api/limits/resume", {}), refresh)}>Try anyway</button>
        </div>
      )}
    </>
  );
}

// Extra usage: what's left of this month's credit, and whether the crew is drawing on it now.
function Credit({ S }: { S: CampState }) {
  const c = S.credit;
  if (!c) return null;
  const pct = c.limit ? Math.min(100, Math.round(((c.used ?? 0) / c.limit) * 100)) : null;
  const level = c.out ? "full" : c.inUse || (pct ?? 0) >= 80 ? "warn" : "";
  const left = c.out ? "used up" : c.left != null ? `${cash(c.left, c.currency)} left of ${cash(c.limit!, c.currency)}`
    : c.used != null ? `${cash(c.used, c.currency)} used · no monthly cap` : "on";
  return (
    <div className="limit-row">
      <div className="limit-top">
        <b>Extra usage (credit){c.inUse && <span className="credit-live"> · in use</span>}</b>
        <span>{left}</span>
      </div>
      {pct != null && <div className={cx("meter", level)}><i style={{ width: `${c.out ? 100 : pct}%` }} /></div>}
      {c.inUse && !c.out && <div className="meta">Your plan's limit is used up, so the {w("crew")} is carrying on with credit{c.until ? ` until it resets in ${resetIn(c.until)}` : ""}. This is charged.</div>}
      {c.out && <div className="meta">Your extra-usage credit is used up for this month.</div>}
    </div>
  );
}

function SpendCard({ S, refresh, onOpenSettings }: { S: CampState; refresh: () => void; onOpenSettings?: () => void }) {
  const sub = S.runtime === "claude-code";
  return (
    <div className="spend-card">
      <div className="spend-row">
        <div><b>{money(S.spend.today)}</b><span>Today</span></div>
        <div><b>{money(S.spend.week)}</b><span>Last 7 days</span></div>
        <div><b>{money(S.spend.total)}</b><span>All time</span></div>
      </div>
      {sub && <div className="meta" style={{ marginTop: 8 }}>{S.credit?.inUse
        ? `On your Claude subscription these are estimates at API prices. Right now the ${w("crew")} is running on credit, which is charged: see Extra usage below.`
        : "On your Claude subscription these are estimates at API prices, not charges; your plan's usage limits apply."}</div>}
      <Limits S={S} refresh={refresh} />
      <div className="budget-form">
        <span>{S.budgetUsd ? `Budget ${money(S.budgetUsd)} per ${w("expedition")}` : "No budget"} · up to {S.parallel} at once</span>
        {onOpenSettings && <button type="button" className="btn small" onClick={onOpenSettings}>Change limits</button>}
      </div>
    </div>
  );
}

export function Usage({ S, refresh, onOpenSettings }: { S: CampState; refresh: () => void; onOpenSettings?: () => void }) {
  // By who they are, not what they were called then: the log keeps the name each had at the time.
  const emojiFor = (name: string) => { const now = nameNow(name); return S.characters.find((c) => c.name === now)?.emoji ?? "✦"; };
  return (
    <>
      <SpendCard S={S} refresh={refresh} onOpenSettings={onOpenSettings} />
      <ReviewSpend S={S} />
      {!S.quests.length ? <Empty title={`Nothing in the ${w("log")} yet`}>Every {w("expedition")}, {w("quest")} and job run is logged here with its time and cost.</Empty> : (
        <>
          <p className="panel-note">Newest first. Costs are estimates from token counts. Click a line to expand it.</p>
          <ul className="list">
            {S.quests.map((q, i) => {
              const u = q.usage;
              const total = u.input + u.cacheRead + u.cacheWrite;
              const cached = total ? Math.round((100 * u.cacheRead) / total) : 0;
              return (
                <li key={`${q.time}-${i}`} className={cx("card", cClass(q.character))}>
                  <div className="card-top">
                    <span className="who">{emojiFor(q.character)} {q.character}{q.job ? ` · ${q.job}` : ""}</span>
                    <span className={cx("pill", q.status === "done" ? "done" : "bad")}>{spaced(q.status)}</span>
                    <time>{when(q.time)}</time>
                  </div>
                  <div className="meta">
                    <b>{money(q.cost)}{q.runtime === "claude-code" ? " est." : ""}</b> · {took(q.seconds)} · {q.turns} {plural(q.turns, "turn")} · {kTok(total)} in ({cached}% cached) · {kTok(u.output)} out · {shortModel(q.model)} · {q.effort ?? "default"}
                  </div>
                  {q.route && <Clamp><b>{autoName(q.route.choice)}</b> {q.route.steps.map((st) => `${shortModel(st.model)}${st.effort ? ` · ${st.effort}` : ""}: ${st.reason}`).join(" → ")}</Clamp>}
                  <Clamp><b>Asked</b> {q.task}</Clamp>
                  <Clamp><b>Result</b> {q.result}</Clamp>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
