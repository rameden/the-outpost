// The top bar: what needs you, what runs the crew, today's spend, how busy the camp is, the
// connection, notifications, the theme, and Settings.

import { useEffect, useState } from "react";
import { api, errorText, storeSet } from "../api.ts";
import type { Connection } from "../camp.ts";
import { runningCount } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cx, money, resetIn } from "../format.ts";
import { canNotify, notificationsOn, toggleNotifications } from "../notifications.ts";
import type { SettingsSection } from "../settings/Settings.tsx";
import type { CampState } from "../types.ts";

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

// What runs the crew: your Claude subscription (through Claude Code) or the API. Click to switch.
function RuntimeChip({ S, refresh }: { S: CampState | null; refresh: () => void }) {
  if (!S) return <button className="chip" type="button" title="What runs the crew">…</button>;
  const sub = S.runtime === "claude-code";
  const problem = sub && S.login && !S.login.ok ? S.login.problem ?? "" : "";
  const plan = S.login?.plan ? capital(S.login.plan) : "";
  const title = problem || (sub
    ? `The crew runs on your Claude ${plan || ""} subscription through Claude Code. Click to switch to the API.`
    : "The crew runs on the API (ANTHROPIC_API_KEY). Click to switch to your Claude subscription.");
  async function switchRuntime() {
    if (problem) return alert(problem);
    const next = sub ? "api" : "claude-code";
    const msg = next === "api"
      ? "Switch the crew to the API? Usage will be billed to your API key."
      : "Switch the crew to your Claude subscription (through Claude Code)? Usage will count against your plan's limits.";
    if (!confirm(msg)) return;
    try { await api("/api/runtime", { runtime: next }); refresh(); } catch (e) { alert(errorText(e)); }
  }
  return (
    <button className={cx("chip", problem && "needs")} type="button" title={title} onClick={switchRuntime}>
      {problem ? "⚠️ Claude Code sign-in" : sub ? <><span className="dot live" />Claude {plan || "subscription"}</> : "API key"}
    </button>
  );
}

function Bell() {
  const [, redraw] = useState(0);
  if (!canNotify()) return null;
  const on = notificationsOn();
  const title = Notification.permission === "denied" ? "Notifications are blocked for this page in your browser's settings"
    : on ? "Notifications are on: you'll be pinged when the camp needs a decision. Click to turn off."
    : "Notify me when the camp needs a decision";
  return (
    <button className="icon-btn" type="button" title={title} aria-label={on ? "Turn off notifications" : "Turn on notifications"}
      onClick={async () => { await toggleNotifications(); redraw((n) => n + 1); }}>{on ? "🔔" : "🔕"}</button>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  storeSet("camp-theme", root.dataset.theme);
}

export function Header({ S, store, conn, refresh, onOpenSettings, terminalOpen, onToggleTerminal }: {
  S: CampState | null; store: FeedStore; conn: Connection; refresh: () => void; onOpenSettings?: (section?: SettingsSection) => void;
  terminalOpen?: boolean; onToggleTerminal?: () => void;
}) {
  const asks = useFeed(store, (s) => s.asks);
  const running = useFeed(store, runningCount);
  const queued = S?.queued?.length ?? 0;
  const sub = S?.runtime === "claude-code";

  useEffect(() => { document.title = asks.length ? `(${asks.length}) Guild Camp` : "Guild Camp"; }, [asks.length]);

  return (
    <header className="top">
      <div className="brand"><h1>⛺ Guild Camp</h1><span>Mission control</span></div>
      <div className="top-right">
        {asks.length > 0 && (
          <button className="chip needs" type="button" onClick={() => document.getElementById(`ask-${asks[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            {asks.length === 1 ? "1 decision needs you" : `${asks.length} decisions need you`}
          </button>
        )}
        {S?.pausedUntil && (
          <button className="chip paused" type="button" title={`${S.pauseMessage} Click for details.`} onClick={() => onOpenSettings?.("usage")}>
            ⏸ Plan limit · resets in {resetIn(S.pausedUntil)}
          </button>
        )}
        <RuntimeChip S={S} refresh={refresh} />
        <button className="chip" type="button" onClick={() => onOpenSettings?.("usage")}
          title={`${sub ? "Today's usage at API prices: an estimate, not a charge (you're on your Claude subscription)" : "Spend today on the API (all agents)"}. Click for usage and the quest log.`}>
          {money(S?.spend?.today ?? 0)} today{sub ? " (est.)" : ""}
        </button>
        <span className={cx("chip", running > 0 && "busy")} title={`Up to ${S?.parallel ?? 3} expeditions run at once; the rest wait their turn. Change it in Settings.`}>
          <span className={cx("dot", running > 0 && "live")} />
          <span>{running === 0 ? "Idle" : running === 1 ? "On expedition" : `${running} expeditions running`}{queued ? ` · ${queued} queued` : ""}</span>
        </span>
        <span className="chip" title="Connection to the camp">
          <span className={cx("dot", conn === "live" && "live", conn === "reconnecting" && "warn")} />
          <span>{conn === "live" ? "Live" : conn === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>
        </span>
        <Bell />
        {onToggleTerminal && (
          <button className={cx("icon-btn", terminalOpen && "on")} type="button" aria-pressed={!!terminalOpen} aria-label={terminalOpen ? "Hide the terminal" : "Show the terminal"}
            title={`${terminalOpen ? "Hide" : "Show"} the terminal (Ctrl+\`)`} onClick={onToggleTerminal}>&gt;_</button>
        )}
        <button className="icon-btn" type="button" title="Switch light or dark" aria-label="Switch light or dark theme" onClick={toggleTheme}>◐</button>
        {onOpenSettings && (
          <button className="icon-btn" type="button" title="Settings" aria-label="Settings" onClick={() => onOpenSettings()}>
            ⚙{!!S?.skills.length && <span className="badge" title={`${S.skills.length} skill proposals to review`}>{S.skills.length}</span>}
          </button>
        )}
      </div>
    </header>
  );
}
