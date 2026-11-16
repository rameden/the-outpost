// The top bar, kept to what you look at often: what needs you, how busy the camp is (a menu with
// what runs the crew, GitHub and today's spend), the connection (only when it drops), Orbit and
// Barnstorm, a ··· menu for the page's occasional switches, and Settings. A problem shows by itself.

import { memo, useEffect, useRef, useState } from "react";
import { api, errorText, storeSet } from "../api.ts";
import { toggleMode } from "../themes.ts";
import type { Connection } from "../camp.ts";
import { runningCount } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cx, money, resetIn } from "../format.ts";
import { Icon, type IconName } from "./bits.tsx";
import { MaeLogo } from "./MaeLogo.tsx";
import { needsDoing, needsLabel, type Need } from "../needs.ts";
import { canNotify, notificationsOn, toggleNotifications } from "../notifications.ts";
import { showCost } from "../prefs.ts";
import type { SettingsSection } from "../settings/Settings.tsx";
import type { CampState, GithubStatus } from "../types.ts";
import { ask } from "./Confirm.tsx";

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

// What runs the crew: your Claude subscription (through Claude Code) or the API, and switching it.
function useRuntime(S: CampState | null, refresh: () => void) {
  const sub = S?.runtime === "claude-code";
  const problem = sub && S?.login && !S.login.ok ? S.login.problem ?? "" : "";
  const plan = S?.login?.plan ? capital(S.login.plan) : "";
  const label = !S ? "…" : sub ? `Claude ${plan || "subscription"}` : "API key";
  const title = problem || (sub
    ? `The crew runs on your Claude ${plan || ""} subscription through Claude Code. Click to switch to the API.`
    : "The crew runs on the API (ANTHROPIC_API_KEY). Click to switch to your Claude subscription.");
  async function switchRuntime() {
    if (!S) return;
    if (problem) return alert(problem);
    const next = sub ? "api" : "claude-code";
    const question = next === "api"
      ? { title: "Switch the crew to the API?", body: "Usage will be billed to your API key.", action: "Switch to the API" }
      : { title: "Switch the crew to your Claude subscription (through Claude Code)?", body: "Usage will count against your plan's limits.", action: "Switch to my subscription" };
    if (!await ask(question)) return;
    try { await api("/api/runtime", { runtime: next }); refresh(); } catch (e) { alert(errorText(e)); }
  }
  return { sub, problem, label, title, switchRuntime };
}

// Which GitHub account gh is using (pull requests, and git pushes if gh is your credential
// helper). Click to swap to your other account, like `gh auth switch`. Hidden without gh.
function useGithub() {
  const [st, setSt] = useState<GithubStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    const load = () => api<GithubStatus>("/api/github").then((s) => { if (!gone) setSt(s); }).catch(() => {});
    load();
    window.addEventListener("focus", load); // you may have switched in a terminal meanwhile
    return () => { gone = true; window.removeEventListener("focus", load); };
  }, []);
  const accounts = st?.available ? st.accounts : [];
  const active = accounts.find((a) => a.active);
  const others = accounts.filter((a) => !a.active);
  // Two accounts: swap. More: go round them in order.
  const at = accounts.findIndex((a) => a.active);
  const next = others.length === 1 ? others[0] : accounts[(at + 1) % Math.max(accounts.length, 1)];
  const canSwitch = accounts.length > 1 && !!next && !next.active;
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
  return { available: !!st?.available, active, next, canSwitch, busy, title, swap, problem: !!active && !active.ok };
}

const GH_MARK = <svg className="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>;

// Which GitHub account gh is using (pull requests, and git pushes if gh is your credential
// helper). Click to swap to your other account, like `gh auth switch`. Hidden without gh. In the
// top bar it shows only when its sign-in has a problem; otherwise it's a row of the status menu.
export function GithubChip() {
  const gh = useGithub();
  if (!gh.available) return null;
  return <GithubButton gh={gh} />;
}
function GithubButton({ gh }: { gh: ReturnType<typeof useGithub> }) {
  return (
    <button className={cx("chip", gh.problem && "needs")} type="button" title={gh.title} aria-label={gh.title} disabled={gh.busy} onClick={gh.swap}>
      {GH_MARK}
      <span>{gh.busy ? "Switching…" : gh.active?.login ?? "No account"}</span>
      {gh.canSwitch && !gh.busy && <span className="gh-swap" aria-hidden="true">⇄</span>}
    </button>
  );
}

// A menu under a button in the top bar: open and shut, and shut by a click elsewhere or Esc.
function usePopover() {
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
  return { open, setOpen, box };
}

// How busy the camp is, as the one status chip in the bar; open, it holds what's set once and
// seldom looked at: what runs the crew, the GitHub account, and today's spend, each with its switch.
// (A problem with any of them shows in the bar by itself: see the Header.)
function StatusMenu({ S, refresh, onOpenSettings, gh, running, questsOut, queued }: {
  S: CampState | null; refresh: () => void; onOpenSettings?: (section?: SettingsSection) => void;
  gh: ReturnType<typeof useGithub>; running: number; questsOut: number; queued: number;
}) {
  const { open, setOpen, box } = usePopover();
  const rt = useRuntime(S, refresh);
  const costShown = showCost.use(); // Settings → General can take it out
  const says = `${running === 0 ? "Idle" : running === 1 ? "On expedition" : `${running} expeditions running`}${questsOut > 1 ? ` · ${questsOut} quests out` : ""}${queued ? ` · ${queued} queued` : ""}`;
  const shut = (then: () => void) => () => { setOpen(false); then(); };
  return (
    <span className="top-pick" ref={box}>
      <button className={cx("chip", "chip-status", running > 0 && "busy")} type="button" aria-haspopup="menu" aria-expanded={open}
        title="How busy the camp is. Click for what runs the crew, your GitHub account and today's spend." onClick={() => setOpen((o) => !o)}>
        <span className={cx("dot", running > 0 && "live")} /><span>{says}</span><Icon name="chevron" />
      </button>
      {open && (
        <div className="popover top-menu" role="menu" aria-label="The camp">
          <button type="button" role="menuitem" className="top-item" title={rt.title} onClick={shut(() => void rt.switchRuntime())}>
            <span className={cx("dot", !rt.problem && "live", rt.problem && "warn")} />
            <span><b>{rt.label}</b><small>{rt.problem ? "Sign-in problem: click for what to do" : rt.sub ? "Switch to the API" : "Switch to your Claude subscription"}</small></span>
          </button>
          {gh.available && (gh.canSwitch ? (
            <button type="button" role="menuitem" className="top-item" title={gh.title} disabled={gh.busy} onClick={() => void gh.swap()}>
              {GH_MARK}<span><b>{gh.busy ? "Switching…" : gh.active?.login ?? "No account"}</b><small>Switch GitHub to {gh.next.login}</small></span>
            </button>
          ) : (
            <div className="top-item" role="presentation" title={gh.title}>
              {GH_MARK}<span><b>{gh.active?.login ?? "No account"}</b><small>Your GitHub account (gh)</small></span>
            </div>
          ))}
          {costShown && (
            <button type="button" role="menuitem" className="top-item" onClick={shut(() => onOpenSettings?.("usage"))}
              title={rt.sub ? "Today's usage at API prices: an estimate, not a charge (you're on your Claude subscription)" : "Spend today on the API (all agents)"}>
              <Icon name="gauge" /><span><b>{money(S?.spend?.today ?? 0)} today{rt.sub ? " (est.)" : ""}</b><small>Usage and the quest log</small></span>
            </button>
          )}
          <div className="top-menu-foot">Up to {S?.parallel ?? 3} expeditions run at once; the rest wait their turn. Change it in Settings.</div>
        </div>
      )}
    </span>
  );
}

// The page's occasional switches, behind ···: focus, how it's laid out, light or dark, and
// notifications. Each says what it is in words, which an icon on its own couldn't. (The files and
// notes are /files and /notes; Orbit and Barnstorm keep their own buttons beside it.)
type MoreItem = { label: string; icon: IconName; title: string; onClick: () => void; checked?: boolean; wide?: boolean };
function MoreMenu({ groups }: { groups: (MoreItem | false | undefined)[][] }) {
  const { open, setOpen, box } = usePopover();
  const shown = groups.map((g) => g.filter((i): i is MoreItem => !!i)).filter((g) => g.length);
  const all = shown.flat();
  if (!all.length) return null;
  const lit = all.some((i) => i.checked && i.icon !== "bell"); // something in here is on (focus)
  return (
    <span className="top-pick" ref={box}>
      <button className={cx("icon-btn", lit && "on")} type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label="More" title="More: focus, layout, light or dark, and notifications" onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="popover top-menu top-more" role="menu" aria-label="More">
          {shown.map((g, gi) => g.map((i, ii) => (
            <button key={i.label} type="button" role={i.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={i.checked}
              className={cx("top-item", "top-tool", i.wide && "wide-only", gi > 0 && ii === 0 && "top-item-sep")} title={i.title}
              onClick={() => { setOpen(false); i.onClick(); }}>
              <Icon name={i.icon} /><span><b>{i.label}</b></span>{i.checked && <Icon name="check" />}
            </button>
          )))}
        </div>
      )}
    </span>
  );
}

// What needs you, as a list under its chip: each row goes to where the thing is.
const NEED_ICON: Record<Need["kind"], IconName> = { decision: "check", pr: "branch", held: "clock", failed: "down", finished: "reply" };
function NeedsChip({ list, onGo, onSeenAll }: { list: Need[]; onGo: (n: Need) => void; onSeenAll?: () => void }) {
  const { open, setOpen, box } = usePopover();
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
// stale: the panels' last reload failed (camp.ts), so what they show may be behind.
export const Header = memo(function Header({ S, store, conn, stale, refresh, onOpenSettings, focused, onToggleFocus, onOpenLayout, needs, onNeed, onSeenAll, barnstorm = "off", onBarnstorm, onHome, orbit, onOrbit }: {
  onHome?: () => void; // the logo takes you to Today
  needs?: Need[]; onNeed?: (n: Need) => void; onSeenAll?: () => void;
  S: CampState | null; store: FeedStore; conn: Connection; stale?: boolean; refresh: () => void; onOpenSettings?: (section?: SettingsSection) => void;
  // Focus: closes every open panel (history, files, the terminal) to its tab, leaving the
  // conversation; again brings back the ones it closed.
  focused?: boolean; onToggleFocus?: () => void;
  onOpenLayout?: () => void;
  // The easter egg (egg/Barnstorm.tsx): fly a plane over the page. Its button starts it, then is play and pause.
  barnstorm?: "off" | "on" | "paused"; onBarnstorm?: () => void;
  orbit?: boolean; onOrbit?: () => void; // the crew at work as a solar system, full screen (orbit/Orbit.tsx)
}) {
  const asks = useFeed(store, (s) => s.asks);
  const running = useFeed(store, runningCount);
  const questsOut = useFeed(store, (s) => s.quests.length);
  const queued = S?.queued?.length ?? 0;
  const rt = useRuntime(S, refresh);
  const gh = useGithub();

  // The tab's title: the name and its tag, behind the count of what needs you.
  useEffect(() => { document.title = asks.length ? `(${asks.length}) Mae, My Alter Ego` : "Mae, My Alter Ego"; }, [asks.length]);

  return (
    <header className="top">
      <div className="brand">
        {/* The logo, as the logo kit draws it: the mark and the name. */}
        {/* It's also the way home: to Today, the page the camp opens on. */}
        <h1>{onHome
          ? <button type="button" className="brand-home" title="Today: your brief, and where things stand" onClick={onHome}><MaeLogo /></button>
          : <MaeLogo />}</h1>
        {/* The tour (docs/index.html, served at /splash), in its own tab so nothing here is interrupted. */}
        <a className="tour-link" href="/splash" target="_blank" rel="noopener noreferrer" title="A one-page tour of Mae (opens in a new tab)">Tour</a>
      </div>
      <div className="top-right">
        {/* What the camp is doing, then the page's own switches. On a phone the first group scrolls sideways and the second stays put (styles.css). */}
        <div className="top-chips">
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
        {/* Only a problem with what runs the crew or with GitHub is out here; otherwise they're in the status menu. */}
        {rt.problem && <button className="chip needs" type="button" title={rt.title} onClick={() => void rt.switchRuntime()}>⚠️ Claude Code sign-in</button>}
        {gh.available && gh.problem && <GithubButton gh={gh} />}
        {/* Connected is the normal state and says nothing; only a lost or not-yet-made connection shows. */}
        {conn === "offline" ? (
          // Down for a while: most likely the camp was stopped. The page keeps trying by itself.
          <span className="chip offline" role="status" title="The page keeps trying, and picks up by itself once the camp is running again. If it doesn't, open the link the camp prints in the terminal when it starts.">
            <span className="dot warn" />
            <span>The camp isn't running. Start it again, or reopen the link it prints in the terminal.</span>
          </span>
        ) : conn !== "live" ? (
          <span className="chip" title="Connection to the camp: the page isn't getting updates until it's back" role="status">
            <span className={cx("dot", conn === "reconnecting" && "warn")} />
            <span>{conn === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>
          </span>
        ) : stale && (
          // Connected, but the last reload of the panels failed: say so, and offer another go.
          <button className="chip" type="button" title="The last reload of the page's panels (crew, history, spend) failed, so they may be behind. Click to try again." onClick={refresh}>
            <span className="dot warn" />
            <span>Out of date · retry</span>
          </button>
        )}
        </div>
        <div className="top-tools">
        {/* With the icons, so it sits as close to them as they do to each other. */}
        <StatusMenu S={S} refresh={refresh} onOpenSettings={onOpenSettings} gh={gh} running={running} questsOut={questsOut} queued={queued} />
        {/* The two toys keep their own buttons; the page's occasional switches are behind ···. */}
        {onOrbit && (
          <button className={cx("icon-btn", orbit && "on")} type="button" aria-pressed={!!orbit} aria-label={orbit ? "Leave Orbit" : "Orbit"}
            title="Orbit: watch the crew at work as a solar system, full screen" onClick={onOrbit}><Icon name="orbit" /></button>
        )}
        {onBarnstorm && (
          <button className={cx("icon-btn", "wide-only", barnstorm === "on" && "on", barnstorm === "paused" && "egg-paused")} type="button" aria-pressed={barnstorm === "on"}
            aria-label={barnstorm === "on" ? "Pause Barnstorm" : barnstorm === "paused" ? "Resume Barnstorm" : "Barnstorm"}
            title={barnstorm === "on" ? "Pause: stop the game where it is and get the page back, to carry on later"
              : barnstorm === "paused" ? "Resume: carry on with the game from where you paused it"
              : "Barnstorm: fly a plane over the page and shoot it to bits (it all comes back)"} onClick={onBarnstorm}><Icon name="plane" /></button>
        )}
        <MoreMenu groups={[
          [
            onToggleFocus && { label: "Focus mode", icon: "focus", checked: !!focused, wide: true, onClick: onToggleFocus,
              title: focused ? "Leave focus: bring back the panels it closed" : "Focus: close the history, files, notes and terminal, leaving the conversation" },
            onOpenLayout && { label: "Arrange the layout", icon: "layout", wide: true, onClick: onOpenLayout, title: "Layout: arrange the page's zones and what each shows" },
            { label: "Light or dark", icon: "theme", onClick: toggleMode, title: "Switch between the light and dark theme" },
            canNotify() && { label: "Notifications", icon: "bell", checked: notificationsOn(), onClick: () => void toggleNotifications(),
              title: Notification.permission === "denied" ? "Notifications are blocked for this page in your browser's settings"
                : notificationsOn() ? "On: you're pinged when the camp needs a decision. Click to turn off." : "Get pinged when the camp needs a decision" },
          ],
        ]} />
        {onOpenSettings && (
          <button className="icon-btn" type="button" title="Settings" aria-label="Settings" onClick={() => onOpenSettings()}>
            <Icon name="gear" />{(() => {
              const skills = S?.skills.length ?? 0, memory = S?.memoryProposals?.length ?? 0;
              return skills + memory > 0 && <span className="badge" title={[skills && `${skills} skill ${skills === 1 ? "proposal" : "proposals"} to review`, memory && `${memory} about memory waiting for you`].filter(Boolean).join(" · ")}>{skills + memory}</span>;
            })()}
          </button>
        )}
        </div>
      </div>
    </header>
  );
});
