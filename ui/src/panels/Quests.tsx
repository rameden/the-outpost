// Quests: what the camp has spent, your plan's limits, the budget and how many expeditions run
// at once, then the log of every quest, expedition, and job run.

import type { FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { Clamp, Empty } from "../components/bits.tsx";
import { cClass, cx, kTok, money, plural, resetIn, shortModel, spaced, when } from "../format.ts";
import type { CampState } from "../types.ts";

const tryIt = async (work: () => Promise<unknown>, then: () => void) => {
  try { await work(); then(); } catch (e) { alert(errorText(e)); }
};

// Your plan's usage windows, as Claude Code last reported them.
function Limits({ S, refresh }: { S: CampState; refresh: () => void }) {
  if (S.runtime !== "claude-code") return null;
  return (
    <>
      <div className="limits">
        {!S.limits.length && <div className="meta">Plan usage appears here after the next run.</div>}
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

function SpendCard({ S, refresh }: { S: CampState; refresh: () => void }) {
  const sub = S.runtime === "claude-code";
  function saveBudget(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = String(new FormData(ev.currentTarget).get("budget") ?? "").trim();
    void tryIt(() => api("/api/budget", { usd: v === "" || Number(v) === 0 ? null : Number(v) }), refresh);
  }
  const choices = [1, 2, 3, 4, 5, 6, 8];
  return (
    <div className="spend-card">
      <div className="spend-row">
        <div><b>{money(S.spend.today)}</b><span>Today</span></div>
        <div><b>{money(S.spend.week)}</b><span>Last 7 days</span></div>
        <div><b>{money(S.spend.total)}</b><span>All time</span></div>
      </div>
      {sub && <div className="meta" style={{ marginTop: 8 }}>On your Claude subscription these are estimates at API prices, not charges; your plan's usage limits apply.</div>}
      <Limits S={S} refresh={refresh} />
      <form className="budget-form" onSubmit={saveBudget}>
        <label>Budget per expedition $ <input key={S.budgetUsd ?? "none"} name="budget" className="budget-input" type="number" min="0" step="0.25" placeholder="none" defaultValue={S.budgetUsd ?? ""} /></label>
        <button className="btn small" type="submit">Save</button>
        <span>{S.budgetUsd ? `Stops at ${money(S.budgetUsd)}, all agents together.` : "No limit."}</span>
      </form>
      {S.sandbox?.available && (
        <label className="budget-form sandbox-form">
          <input type="checkbox" checked={S.sandbox.on} onChange={(ev) => tryIt(() => api("/api/sandbox", { on: ev.target.checked }), refresh)} />
          <span><b>Sandboxed shell.</b> Commands run without asking, with no network and writes only inside the project they run in. Installs and pushes still ask.</span>
        </label>
      )}
      <form className="budget-form parallel-form" onSubmit={(ev) => ev.preventDefault()}>
        <label>Run up to <select className="parallel-input" aria-label="Expeditions at once" value={S.parallel}
          onChange={(ev) => tryIt(() => api("/api/parallel", { parallel: Number(ev.target.value) }), refresh)}>
          {(choices.includes(S.parallel) ? choices : [...choices, S.parallel].sort((x, y) => x - y)).map((n) => <option key={n}>{n}</option>)}
        </select> expeditions at once</label>
        <span>The rest wait their turn. More at once uses your {sub ? "plan's limits" : "API budget"} faster.</span>
      </form>
    </div>
  );
}

export function Quests({ S, refresh }: { S: CampState; refresh: () => void }) {
  const emojiFor = (name: string) => S.characters.find((c) => c.name === name)?.emoji ?? "✦";
  return (
    <>
      <SpendCard S={S} refresh={refresh} />
      {!S.quests.length ? <Empty title="No quests yet">Every dispatch, expedition, and job run is logged here with its time and cost.</Empty> : (
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
                    <b>{money(q.cost)}{q.runtime === "claude-code" ? " est." : ""}</b> · {q.seconds}s · {q.turns} {plural(q.turns, "turn")} · {kTok(total)} in ({cached}% cached) · {kTok(u.output)} out · {shortModel(q.model)} · {q.effort ?? "default"}
                  </div>
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
