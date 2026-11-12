// The top bar: what needs you, what runs the crew, today's spend, how busy the camp is, the
// connection (only when it drops), notifications, the theme, and Settings.

import { useEffect, useRef, useState } from "react";
import { api, errorText, storeSet } from "../api.ts";
import type { Connection } from "../camp.ts";
import { runningCount } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cx, money, resetIn } from "../format.ts";
import { Icon, type IconName } from "./bits.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { needsDoing, needsLabel, type Need } from "../needs.ts";
import { canNotify, notificationsOn, toggleNotifications } from "../notifications.ts";
import type { SettingsSection } from "../settings/Settings.tsx";
import type { CampState, GithubStatus } from "../types.ts";

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

// Which GitHub account gh is using (pull requests, and git pushes if gh is your credential
// helper). Click to swap to your other account, like `gh auth switch`. Hidden without gh.
export function GithubChip() {
  const [st, setSt] = useState<GithubStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    const load = () => api<GithubStatus>("/api/github").then((s) => { if (!gone) setSt(s); }).catch(() => {});
    load();
    window.addEventListener("focus", load); // you may have switched in a terminal meanwhile
    return () => { gone = true; window.removeEventListener("focus", load); };
  }, []);
  if (!st?.available) return null;
  const active = st.accounts.find((a) => a.active);
  const others = st.accounts.filter((a) => !a.active);
  // Two accounts: swap. More: go round them in order.
  const at = st.accounts.findIndex((a) => a.active);
  const next = others.length === 1 ? others[0] : st.accounts[(at + 1) % st.accounts.length];
  const canSwitch = st.accounts.length > 1 && next && !next.active;
  const title = `GitHub: gh is using ${active?.login ?? "no account"} (pull requests, and git pushes if gh is your git credential helper).` +
    (active && !active.ok ? " Its sign-in has a problem: run `gh auth login` again." : "") +
    (canSwitch ? ` Click to switch to ${next.login}.` : " Sign in to another account with `gh auth login` to switch between them here.");
  async function swap() {
    if (!canSwitch || busy) return;
    setBusy(true);
    try { setSt(await api<GithubStatus>("/api/github/switch", { login: next.login })); }
    catch (e) { alert(errorText(e)); }
    setBusy(false);
  }
  return (
    <button className={cx("chip", active && !active.ok && "needs")} type="button" title={title} aria-label={title} disabled={busy} onClick={swap}>
      <svg className="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
      <span>{busy ? "Switching…" : active?.login ?? "No account"}</span>
      {canSwitch && !busy && <span className="gh-swap" aria-hidden="true">⇄</span>}
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
      onClick={async () => { await toggleNotifications(); redraw((n) => n + 1); }}><Icon name={on ? "bell" : "bellOff"} /></button>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  storeSet("camp-theme", root.dataset.theme);
}

// What needs you, as a list under its chip: each row goes to where the thing is.
const NEED_ICON: Record<Need["kind"], IconName> = { decision: "check", pr: "branch", held: "clock", failed: "down", finished: "reply" };
function NeedsChip({ list, onGo, onSeenAll }: { list: Need[]; onGo: (n: Need) => void; onSeenAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!list.length) return null;
  const doing = needsDoing(list).length > 0; // something to do, rather than only something to read
  return (
    <span className="needs-pick" ref={box}>
      <button className={cx("chip", doing ? "needs" : "news")} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => (list.length === 1 ? onGo(list[0]) : setOpen((o) => !o))}>{needsLabel(list)}</button>
      {open && (
        <div className="popover needs-menu" role="menu" aria-label="What needs you">
          {list.map((n) => (
            <button key={n.key} type="button" role="menuitem" className={cx("needs-item", n.kind)} onClick={() => { setOpen(false); onGo(n); }}>
              <Icon name={NEED_ICON[n.kind]} /><span><b>{n.title}</b><small>{n.says}</small></span>
            </button>
          ))}
          {onSeenAll && list.some((n) => n.kind === "finished") && (
            <button type="button" role="menuitem" className="needs-item needs-clear" onClick={() => { setOpen(false); onSeenAll(); }}><span><small>Mark what's finished as seen</small></span></button>
          )}
        </div>
      )}
    </span>
  );
}

// needs / onNeed: everything waiting on you and how to get to one (without them, the chip counts decisions only).
export function Header({ S, store, conn, refresh, onOpenSettings, focused, onToggleFocus, filesOpen, onToggleFiles, onOpenLayout, needs, onNeed, onSeenAll }: {
  needs?: Need[]; onNeed?: (n: Need) => void; onSeenAll?: () => void;
  S: CampState | null; store: FeedStore; conn: Connection; refresh: () => void; onOpenSettings?: (section?: SettingsSection) => void;
  // Focus: closes every open panel (history, files, the terminal) to its tab, leaving the
  // conversation; again brings back the ones it closed.
  focused?: boolean; onToggleFocus?: () => void;
  filesOpen?: boolean; onToggleFiles?: () => void; // only passed while a folder is attached here
  onOpenLayout?: () => void;
}) {
  const asks = useFeed(store, (s) => s.asks);
  const running = useFeed(store, runningCount);
  const questsOut = useFeed(store, (s) => s.quests.length);
  const queued = S?.queued?.length ?? 0;
  const sub = S?.runtime === "claude-code";

  useEffect(() => { document.title = asks.length ? `(${asks.length}) Satchel` : "Satchel"; }, [asks.length]);

  return (
    <header className="top">
      <div className="brand">
        <h1><Wordmark className="wordmark" /></h1>
        {/* The tour (docs/index.html, served at /splash), in its own tab so nothing here is interrupted. */}
        <a className="tour-link" href="/splash" target="_blank" rel="noopener noreferrer" title="A one-page tour of Satchel (opens in a new tab)">Tour</a>
      </div>
      <div className="top-right">
        {needs && onNeed ? <NeedsChip list={needs} onGo={onNeed} onSeenAll={onSeenAll} /> : asks.length > 0 && (
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
        <GithubChip />
        <button className="chip" type="button" onClick={() => onOpenSettings?.("usage")}
          title={`${sub ? "Today's usage at API prices: an estimate, not a charge (you're on your Claude subscription)" : "Spend today on the API (all agents)"}. Click for usage and the quest log.`}>
          {money(S?.spend?.today ?? 0)} today{sub ? " (est.)" : ""}
        </button>
        <span className={cx("chip", running > 0 && "busy")} title={`Up to ${S?.parallel ?? 3} expeditions run at once; the rest wait their turn. Change it in Settings.`}>
          <span className={cx("dot", running > 0 && "live")} />
          <span>{running === 0 ? "Idle" : running === 1 ? "On expedition" : `${running} expeditions running`}{questsOut > 1 ? ` · ${questsOut} quests out` : ""}{queued ? ` · ${queued} queued` : ""}</span>
        </span>
        {/* Connected is the normal state and says nothing; only a lost or not-yet-made connection shows. */}
        {conn !== "live" && (
          <span className="chip" title="Connection to the camp: the page isn't getting updates until it's back" role="status">
            <span className={cx("dot", conn === "reconnecting" && "warn")} />
            <span>{conn === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>
          </span>
        )}
        <Bell />
        {onToggleFocus && (
          <button className={cx("icon-btn", focused && "on")} type="button" aria-pressed={!!focused} aria-label={focused ? "Leave focus mode" : "Focus mode"}
            title={focused ? "Leave focus: bring back the panels it closed" : "Focus: close the history, files and terminal, leaving the conversation"} onClick={onToggleFocus}><Icon name="focus" /></button>
        )}
        {onToggleFiles && (
          <button className={cx("icon-btn", filesOpen && "on")} type="button" aria-pressed={!!filesOpen} aria-label={filesOpen ? "Hide the files" : "Show the files"}
            title={`${filesOpen ? "Hide" : "Show"} the files of the attached folder (Ctrl+Shift+E)`} onClick={onToggleFiles}><Icon name="panelRight" /></button>
        )}
        {onOpenLayout && (
          <button className="icon-btn" type="button" aria-label="Arrange the layout" title="Layout: arrange the page's zones and what each shows" onClick={onOpenLayout}><Icon name="layout" /></button>
        )}
        <button className="icon-btn" type="button" title="Switch light or dark" aria-label="Switch light or dark theme" onClick={toggleTheme}><Icon name="theme" /></button>
        {onOpenSettings && (
          <button className="icon-btn" type="button" title="Settings" aria-label="Settings" onClick={() => onOpenSettings()}>
            <Icon name="gear" />{(() => {
              const skills = S?.skills.length ?? 0, memory = S?.memoryProposals?.length ?? 0;
              return skills + memory > 0 && <span className="badge" title={[skills && `${skills} skill ${skills === 1 ? "proposal" : "proposals"} to review`, memory && `${memory} about memory waiting for you`].filter(Boolean).join(" · ")}>{skills + memory}</span>;
            })()}
          </button>
        )}
      </div>
    </header>
  );
}
