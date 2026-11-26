// The goal set on this conversation (/goal …), above the message box: what it is, which round the
// crew is on, what the judge last said, and the two things you can do about it.

import { useState } from "react";
import { api, errorText } from "../api.ts";
import { goalStanding, type Goal } from "../goal.ts";
import { cx } from "../format.ts";
import { complain } from "./StatusLine.tsx";

export function GoalBar({ goal, paused, refresh }: { goal?: Goal; paused?: boolean; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!goal) return null;
  const act = async (action: "clear" | "resume") => {
    setBusy(true);
    try { await api("/api/goal", { thread: goal.thread, action }); refresh(); } catch (e) { complain(errorText(e)); }
    setBusy(false);
  };
  const active = goal.status === "active";
  return (
    <div className={cx("goal-bar", goal.status)} role="status" aria-label="This conversation's goal">
      <div className="goal-line">
        <span className="goal-what" title={goal.goal}><b>🎯 Goal</b> {goal.goal}</span>
        <span className="goal-standing">{goalStanding(goal, paused)}</span>
        {active && goal.maxRounds > 0 && <progress className="goal-rounds" max={goal.maxRounds} value={goal.rounds} aria-label={`Round ${goal.rounds} of ${goal.maxRounds}`} />}
        {!active && <button type="button" className="btn small" disabled={busy} title="Take it up again, with the rounds counted from the start" onClick={() => void act("resume")}>Resume</button>}
        <button type="button" className="btn small" disabled={busy} title={active ? "Stop working towards it: a run that's going finishes, and nothing follows" : "Take the goal off this conversation"} onClick={() => void act("clear")}>Clear</button>
      </div>
      {goal.lastReason && <div className="goal-reason">{goal.lastReason}</div>}
    </div>
  );
}
