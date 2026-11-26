// The Activity page: what the camp has been doing and what it costs, as tabs. Usage (the spend
// and the log of every run), Stats, automatic work (what's on; the switches are in Settings →
// Automatic work), scheduled jobs, and the Inbox: the one list of everything waiting on you.

import type { ActivityTab, View } from "../feed/conversation.ts";
import type { FeedStore } from "../feed/store.ts";
import { NO_INBOX, type InboxCount } from "../inbox.ts";
import type { Need } from "../needs.ts";
import { Jobs } from "../panels/Records.tsx";
import { Usage } from "../panels/Usage.tsx";
import { AutomaticSummary, StatsPage } from "../settings/DrivePage.tsx";
import type { SettingsSection } from "../settings/sections.ts";
import type { CampState } from "../types.ts";
import { outpostName } from "../outpost.ts";
import { w } from "../words.ts";
import { Inbox } from "./Inbox.tsx";
import { PageTabs, type PageTab } from "./PageTabs.tsx";

// inbox: how many things are in the Inbox (inbox.ts), the same number the header and the sidebar show.
export const activityTabs = (inbox = 0): PageTab<ActivityTab>[] => [
  { id: "usage", label: "Usage", title: `What the ${w("camp")} has spent, and the log of every ${w("expedition")} and job run` },
  { id: "stats", label: "Stats" },
  { id: "unasked", label: "Automatic work", title: `What ${outpostName()} does before you ask` },
  { id: "jobs", label: "Scheduled jobs" },
  { id: "inbox", label: "Inbox", count: inbox, title: "Everything waiting on you, and where you answer it" },
];

const noNeeds: Need[] = [];
export function ActivityPage({ S, store, tab, setTab, refresh, onOpenSettings, setView, needs = noNeeds, inbox = NO_INBOX, onSeenAll, onStartTicket }: {
  S: CampState; store: FeedStore; tab: ActivityTab; setTab: (t: ActivityTab) => void; refresh: () => void;
  onOpenSettings: (s: SettingsSection) => void; setView: (v: View) => void;
  // What the Inbox lists and counts (App.tsx works both out once, for every place that shows them).
  needs?: Need[]; inbox?: InboxCount; onSeenAll: () => void;
  onStartTicket: (t: { key: string; summary: string }) => void;
}) {
  const tabs = activityTabs(inbox.total);
  return (
    <div className="feed proj-page activity-page">
      <header className="proj-head"><div><h2>Activity</h2><div className="meta">What the {w("camp")} has been doing, what it cost, and what's waiting on you.</div></div></header>
      <PageTabs label="Activity" tabs={tabs} value={tab} onChange={setTab} />
      <div className="page-panel" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
        {tab === "usage" ? <Usage S={S} refresh={refresh} onOpenSettings={() => onOpenSettings("limits")} />
          : tab === "stats" ? <StatsPage S={S} />
          : tab === "unasked" ? <AutomaticSummary S={S} onOpen={() => onOpenSettings("automatic")} />
          : tab === "jobs" ? <Jobs S={S} refresh={refresh} />
          : <Inbox S={S} store={store} refresh={refresh} needs={needs} count={inbox} onSeenAll={onSeenAll} setView={setView} onStartTicket={onStartTicket} />}
      </div>
    </div>
  );
}
