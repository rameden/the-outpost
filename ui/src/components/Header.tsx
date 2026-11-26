// The top bar, kept to what you look at often: what's waiting on you (a count that opens the Inbox), how busy the camp is (a menu with
// what runs the crew, GitHub and today's spend), the connection (only when it drops), the Views
// menu (Orbit, the trail map and the constellation), a ··· menu for the page's occasional
// switches and Barnstorm, and Settings. A problem shows by itself.

import { memo, useEffect, useState } from "react";
import { api, errorText, storeSet } from "../api.ts";
import { toggleMode } from "../themes.ts";
import type { Connection } from "../camp.ts";
import type { ActivityTab } from "../feed/conversation.ts";
import { runningCount } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cash, cx, money, resetIn } from "../format.ts";
import { w } from "../words.ts";
import { Icon, type IconName } from "./bits.tsx";
import { ReadingPlayer } from "./ReadAloud.tsx";
import { MaeLogo } from "./MaeLogo.tsx";
import { outpostName, setOutpostName } from "../outpost.ts";
import { inboxLabel, NO_INBOX, type InboxCount } from "../inbox.ts";
import { canNotify, notificationsOn, toggleNotifications } from "../notifications.ts";
import { showCost } from "../prefs.ts";
import type { SettingsSection } from "../settings/sections.ts";
import type { CampState, GithubStatus } from "../types.ts";
import { ask } from "./Confirm.tsx";
import { usePopover } from "./usePopover.ts";
import { complain } from "./StatusLine.tsx";
import { switchRuntime } from "../runtime.ts";

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

// What runs the crew: your Claude subscription (through Claude Code) or the API, and switching it.
function useRuntime(S: CampState | null, refresh: () => void) {
  const sub = S?.runtime === "claude-code";
  const problem = sub && S?.login && !S.login.ok ? S.login.problem ?? "" : "";
  const plan = S?.login?.plan ? capital(S.login.plan) : "";
  const label = !S ? "…" : sub ? `Claude ${plan || "subscription"}` : "API key";
  const title = problem || (sub
    ? `The ${w("crew")} runs on your Claude ${plan || ""} subscription through Claude Code. Click to switch to the API.`
    : `The ${w("crew")} runs on the API (ANTHROPIC_API_KEY). Click to switch to your Claude subscription.`);
  async function toggleRuntime() {
    if (!S) return;
    if (problem) return complain(problem);
    await switchRuntime(sub ? "api" : "claude-code", refresh);
  }
  return { sub, problem, label, title, switchRuntime: toggleRuntime };
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
    catch (e) { complain(errorText(e)); }
    setBusy(false);
  }
  return { available: !!st?.available, active, next, canSwitch, busy, title, swap, problem: !!active && !active.ok };
}

const GH_MARK = <svg className="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>;

// Which GitHub account gh is using (pull requests, and git pushes if gh is your credential
// helper). Click to swap to your other account, like `gh auth switch`. In the top bar it shows
// only when its sign-in has a problem; otherwise it's a row of the status menu.
function GithubButton({ gh }: { gh: ReturnType<typeof useGithub> }) {
  return (
    <button className={cx("chip", gh.problem && "needs")} type="button" title={gh.title} aria-label={gh.title} disabled={gh.busy} onClick={gh.swap}>
      {GH_MARK}
      <span>{gh.busy ? "Switching…" : gh.active?.login ?? "No account"}</span>
      {gh.canSwitch && !gh.busy && <span className="gh-swap" aria-hidden="true">⇄</span>}
    </button>
  );
}

// How busy the camp is, as the one status chip in the bar; open, it holds what's set once and
// seldom looked at: what runs the crew, the GitHub account, and today's spend, each with its switch.
// (A problem with any of them shows in the bar by itself: see the Header.)
function StatusMenu({ S, refresh, onOpenSettings, onOpenActivity, gh, running, questsOut, queued }: {
  S: CampState | null; refresh: () => void; onOpenSettings?: (section?: SettingsSection) => void; onOpenActivity?: (tab: ActivityTab) => void;
  gh: ReturnType<typeof useGithub>; running: number; questsOut: number; queued: number;
}) {
  const { open, setOpen, box } = usePopover();
  const rt = useRuntime(S, refresh);
  const costShown = showCost.use(); // Settings → General can take it out
  const says = `${running === 0 ? "Idle" : running === 1 ? `On ${w("expedition")}` : `${running} ${w("expeditions")} running`}${questsOut > 1 ? ` · ${questsOut} ${w("quests")} out` : ""}${queued ? ` · ${queued} queued` : ""}`;
  const shut = (then: () => void) => () => { setOpen(false); then(); };
  return (
    <span className="top-pick" ref={box}>
      <button className={cx("chip", "chip-status", running > 0 && "busy")} type="button" aria-haspopup="menu" aria-expanded={open}
        title={`How busy the ${w("camp")} is. Click for what runs the ${w("crew")}, your GitHub account and today's spend.`} onClick={() => setOpen((o) => !o)}>
        <span className={cx("dot", running > 0 && "live")} /><span>{says}</span><Icon name="chevron" />
      </button>
      {open && (
        <div className="popover top-menu" role="menu" aria-label={`The ${w("camp")}`}>
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
            <button type="button" role="menuitem" className="top-item" onClick={shut(() => onOpenActivity?.("usage"))}
              title={rt.sub ? "Today's usage at API prices: an estimate, not a charge (you're on your Claude subscription)" : `Spend today on the API (the whole ${w("crew")})`}>
              <Icon name="chart" /><span><b>{money(S?.spend?.today ?? 0)} today{rt.sub ? " (est.)" : ""}</b><small>Usage and the {w("log")}</small></span>
            </button>
          )}
          <div className="top-menu-foot">Up to {S?.parallel ?? 3} {w("expeditions")} run at once; the rest wait their turn. Change it in Settings.</div>
        </div>
      )}
    </span>
  );
}

// A menu under an icon in the bar: rows with an icon and a name, and a tick on what's on. Two of
// them use it. ···  holds the page's occasional switches: focus, how it's laid out, light or dark,
// and notifications. (The files and notes are /files and /notes.) Views holds the camp's
// full-screen views: Orbit, the trail map and the constellation. (The trail map also opens from a plan card, or
// /trail; the constellation is Memory → Map put over the page, or /constellation.) Barnstorm, the game, is the last row of ···.
// A row with an href is a link to another page (newTab: in its own tab) rather than a switch.
type MenuItem = { label: string; icon: IconName; title: string; onClick?: () => void; href?: string; newTab?: boolean; checked?: boolean; wide?: boolean; says?: string; quiet?: boolean };
function ToolMenu({ name, title, icon, groups, className, waiting }: {
  name: string; title: string; icon: IconName; groups: (MenuItem | false | undefined)[][];
  className?: string;
  waiting?: boolean; // something in here is paused, and there to come back to
}) {
  const { open, setOpen, box } = usePopover();
  const shown = groups.map((g) => g.filter((i): i is MenuItem => !!i)).filter((g) => g.length);
  const all = shown.flat();
  if (!all.length) return null;
  const lit = all.some((i) => i.checked && !i.quiet); // something in here is on
  return (
    <span className="top-pick" ref={box}>
      <button className={cx("icon-btn", lit && "on", !lit && waiting && "egg-paused")} type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={name} title={title} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} />
      </button>
      {open && (
        <div className={cx("popover", "top-menu", className)} role="menu" aria-label={name}>
          {shown.map((g, gi) => g.map((i, ii) => {
            const cls = cx("top-item", "top-tool", i.wide && "wide-only", gi > 0 && ii === 0 && "top-item-sep");
            const body = <><Icon name={i.icon} /><span><b>{i.label}</b>{i.says && <small>{i.says}</small>}</span>{i.checked && <Icon name="check" />}</>;
            return i.href ? (
              <a key={i.icon} role="menuitem" aria-label={i.label} className={cls} title={i.title} href={i.href}
                {...(i.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={() => setOpen(false)}>{body}</a>
            ) : (
              <button key={i.icon} type="button" role={i.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={i.checked} aria-label={i.label}
                className={cls} title={i.title} onClick={() => { setOpen(false); i.onClick?.(); }}>{body}</button>
            );
          }))}
        </div>
      )}
    </span>
  );
}

// inbox: how many things are waiting on you (inbox.ts). The chip says it and opens Activity → Inbox,
// the one place they're listed and answered.
// stale: the panels' last reload failed (camp.ts), so what they show may be behind.
export const Header = memo(function Header({ S, store, conn, stale, refresh, onOpenSettings, onOpenActivity, focused, onToggleFocus, onOpenLayout, inbox = NO_INBOX, barnstorm = "off", onBarnstorm, onHome, orbit, onOrbit, trail, onTrail, constellation, onConstellation }: {
  onHome?: () => void; // the logo takes you to Today
  inbox?: InboxCount;
  S: CampState | null; store: FeedStore; conn: Connection; stale?: boolean; refresh: () => void; onOpenSettings?: (section?: SettingsSection) => void; onOpenActivity?: (tab: ActivityTab) => void;
  // Focus: closes every open panel (history, files, the terminal) to its tab, leaving the
  // conversation; again brings back the ones it closed.
  focused?: boolean; onToggleFocus?: () => void;
  onOpenLayout?: () => void;
  // The Views menu's three. Each is left out of the menu when it has no way to be opened.
  orbit?: boolean; onOrbit?: () => void; // the crew at work as a solar system, full screen (orbit/Orbit.tsx)
  trail?: boolean; onTrail?: () => void; // the plan as a trail of steps, full screen (trail/Trail.tsx)
  constellation?: boolean; onConstellation?: () => void; // Memory's Map, a map of stars, over the whole page (constellation/Constellation.tsx)
  // The game (egg/Barnstorm.tsx): fly a plane over the page. Its row starts it, then is play and pause.
  barnstorm?: "off" | "on" | "paused"; onBarnstorm?: () => void;
}) {
  const running = useFeed(store, runningCount);
  const questsOut = useFeed(store, (s) => s.quests.length);
  const queued = S?.queued?.length ?? 0;
  const rt = useRuntime(S, refresh);
  const gh = useGithub();

  // The tab's title: the name and its tag, behind the count of what needs you.
  // The name comes in the page, and with the camp's state once it's here (it can be renamed).
  const renamed = S?.settings?.outpost;
  const name = renamed || outpostName();
  useEffect(() => { if (renamed) setOutpostName(renamed); }, [renamed]);
  const outpost = `Outpost ${name}`;
  // The star chart that started this outpost (npm start), when this page is on the same machine as
  // it: the chart answers only there, so from anywhere else the link would lead nowhere.
  const chart = S?.settings?.chart && ["127.0.0.1", "localhost"].includes(location.hostname) ? S.settings.chart : null;
  useEffect(() => { document.title = inbox.total ? `(${inbox.total}) ${outpost}` : outpost; }, [inbox.total, outpost]);

  return (
    <header className="top">
      <div className="brand">
        {/* The logo, as the logo kit draws it: the mark and the name. */}
        {/* It's also the way home: to Today, the page the camp opens on. */}
        <h1>{onHome
          ? <button type="button" className="brand-home" title="Today: your brief, and where things stand" onClick={onHome}><MaeLogo name={name} /></button>
          : <MaeLogo name={name} />}</h1>
      </div>
      <div className="top-right">
        {/* What the camp is doing, then the page's own switches. On a phone the first group scrolls sideways and the second stays put (styles.css). */}
        <div className="top-chips">
        {inbox.total > 0 && (
          <button className={cx("chip", inbox.waiting ? "needs" : "news")} type="button" title="Open the Inbox: everything waiting on you, and where you answer it" onClick={() => onOpenActivity?.("inbox")}>
            <Icon name="inbox" /> {inboxLabel(inbox)}
          </button>
        )}
        {S?.pausedUntil && (
          <button className="chip paused" type="button" title={`${S.pauseMessage} Click for details.`} onClick={() => onOpenActivity?.("usage")}>
            ⏸ Plan limit · resets in {resetIn(S.pausedUntil)}
          </button>
        )}
        {S?.credit?.inUse && !S.pausedUntil && (
          <button className="chip credit" type="button" title={`Your plan's usage limit is used up, so the ${w("crew")} is running on extra-usage credit, which is charged. Click for details.`} onClick={() => onOpenActivity?.("usage")}>
            💳 On credit{S.credit.left != null ? ` · ${cash(S.credit.left, S.credit.currency)} left` : ""}
          </button>
        )}
        {/* Only a problem with what runs the crew or with GitHub is out here; otherwise they're in the status menu. */}
        {rt.problem && <button className="chip needs" type="button" title={rt.title} onClick={() => void rt.switchRuntime()}>⚠️ Claude Code sign-in</button>}
        {gh.available && gh.problem && <GithubButton gh={gh} />}
        {/* Connected is the normal state and says nothing; only a lost or not-yet-made connection shows. */}
        {conn === "offline" ? (
          // Down for a while: most likely the camp was stopped. The page keeps trying by itself.
          <span className="chip offline" role="status" title={`The page keeps trying, and picks up by itself once the ${w("camp")} is running again. If it doesn't, open the link the ${w("camp")} prints in the terminal when it starts.`}>
            <span className="dot warn" />
            <span>The {w("camp")} isn't running. Start it again, or reopen the link it prints in the terminal.</span>
          </span>
        ) : conn !== "live" ? (
          <span className="chip" title={`Connection to the ${w("camp")}: the page isn't getting updates until it's back`} role="status">
            <span className={cx("dot", conn === "reconnecting" && "warn")} />
            <span>{conn === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>
          </span>
        ) : stale && (
          // Connected, but the last reload of the panels failed: say so, and offer another go.
          <button className="chip" type="button" title={`The last reload of the page's panels (${w("crew")}, history, spend) failed, so they may be behind. Click to try again.`} onClick={refresh}>
            <span className="dot warn" />
            <span>Out of date · retry</span>
          </button>
        )}
        </div>
        <div className="top-tools">
        {/* Whatever is being read aloud, wherever it was started: its controls sit here while it reads. */}
        <ReadingPlayer />
        {/* With the icons, so it sits as close to them as they do to each other. */}
        <StatusMenu S={S} refresh={refresh} onOpenSettings={onOpenSettings} onOpenActivity={onOpenActivity} gh={gh} running={running} questsOut={questsOut} queued={queued} />
        {/* The full-screen views are in Views; the page's occasional switches, and the game, are behind ···. */}
        <ToolMenu name="Views" icon="views"
          title="Views: Orbit, the trail map and the constellation, each full screen"
          groups={[
            [
              onOrbit && { label: orbit ? "Leave Orbit" : "Orbit", icon: "orbit", checked: !!orbit, onClick: onOrbit, says: `The ${w("crew")} at work, as a solar system`,
                title: `Orbit: watch the ${w("crew")} at work as a solar system, full screen` },
              onTrail && { label: trail ? "Leave the trail map" : "Trail map", icon: "trail", checked: !!trail, onClick: onTrail, says: "The plan, step by step",
                title: "Trail map: the plan step by step, and who's on each, full screen" },
              onConstellation && { label: constellation ? "Leave the constellation" : "Constellation", icon: "constellation", checked: !!constellation, onClick: onConstellation, says: "The memory, as a map of stars",
                title: `Constellation: every line the ${w("crew")} remembers as a star, to pin, forget or merge, full screen` },
            ],
          ]} />
        <ToolMenu name="More" icon="more" className="top-more" waiting={barnstorm === "paused"}
          title={barnstorm === "paused" ? "More: Barnstorm is paused, and here to come back to" : "More: focus, layout, light or dark, notifications, Outposts, the tour and Barnstorm"} groups={[
          [
            onToggleFocus && { label: "Focus mode", icon: "focus", checked: !!focused, wide: true, onClick: onToggleFocus,
              title: focused ? "Leave focus: bring back the panels it closed" : "Focus: close the workspace, files, notes and terminal, leaving the conversation" },
            onOpenLayout && { label: "Arrange the layout", icon: "layout", wide: true, onClick: onOpenLayout, title: "Layout: arrange the page's zones and what each shows" },
            { label: "Light or dark", icon: "theme", onClick: toggleMode, title: "Switch between the light and dark theme" },
            canNotify() && { label: "Notifications", icon: "bell", checked: notificationsOn(), quiet: true, onClick: () => void toggleNotifications(),
              title: Notification.permission === "denied" ? "Notifications are blocked for this page in your browser's settings"
                : notificationsOn() ? `On: you're pinged when the ${w("camp")} needs a decision. Click to turn off.` : `Get pinged when the ${w("camp")} needs a decision` },
          ],
          // The ways out of this page: the star chart, and the tour (docs/index.html, served at /splash) in its own tab so nothing here is interrupted.
          [
            !!chart && { label: "Outposts", icon: "hub", href: chart, says: "Back to the star chart", title: "Outposts: back to the star chart, to pick another outpost. This one keeps running." },
            { label: "Tour", icon: "book", href: "/splash", newTab: true, says: "A one-page tour, in a new tab", title: "A one-page tour of Outpost (opens in a new tab)" },
          ],
          [
            onBarnstorm && { label: barnstorm === "on" ? "Pause Barnstorm" : barnstorm === "paused" ? "Resume Barnstorm" : "Barnstorm", icon: "plane", checked: barnstorm === "on", wide: true, onClick: onBarnstorm,
              says: barnstorm === "on" ? "Stop where it is, to carry on later" : barnstorm === "paused" ? "Carry on from where you paused" : "Fly a plane over the page",
              title: barnstorm === "on" ? "Pause: stop the game where it is and get the page back, to carry on later"
                : barnstorm === "paused" ? "Resume: carry on with the game from where you paused it"
                : "Barnstorm: fly a plane over the page and shoot it to bits (it all comes back)" },
          ],
        ]} />
        {onOpenSettings && (
          <button className="icon-btn" type="button" title="Settings" aria-label="Settings" onClick={() => onOpenSettings()}>
            <Icon name="gear" />
          </button>
        )}
        </div>
      </div>
    </header>
  );
});
