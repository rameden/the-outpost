// The Activity page: what the camp has been doing and what it costs, as tabs. Usage (the spend
// and the log of every run), Stats, what it does unasked, scheduled jobs, and the inbox. These
// were Settings' Activity group; Settings keeps the limits (Usage links there to change them).

import { unreadCount } from "../unread.ts";
import type { ActivityTab } from "../feed/conversation.ts";
import { Inbox, Jobs } from "../panels/Records.tsx";
import { Usage } from "../panels/Usage.tsx";
import { StatsPage, UnaskedPage } from "../settings/DrivePage.tsx";
import type { SettingsSection } from "../settings/sections.ts";
import type { CampState } from "../types.ts";
import { outpostName } from "../outpost.ts";
import { w } from "../words.ts";
import { PageTabs, type PageTab } from "./PageTabs.tsx";

export const activityTabs = (S?: CampState | null): PageTab<ActivityTab>[] => [
  { id: "usage", label: "Usage", title: `What the ${w("camp")} has spent, and the log of every ${w("expedition")} and job run` },
  { id: "stats", label: "Stats" },
  { id: "unasked", label: "Unasked", title: `What ${outpostName()} does before you ask` },
  { id: "jobs", label: "Scheduled jobs" },
  { id: "inbox", label: "Inbox", count: unreadCount(S) },
];

export function ActivityPage({ S, tab, setTab, refresh, onOpenSettings, onOpenMemory }: {
  S: CampState; tab: ActivityTab; setTab: (t: ActivityTab) => void; refresh: () => void;
  onOpenSettings: (s: SettingsSection) => void; onOpenMemory: () => void;
}) {
  return (
    <div className="feed proj-page activity-page">
      <header className="proj-head"><div><h2>Activity</h2><div className="meta">What the {w("camp")} has been doing, and what it cost.</div></div></header>
      <PageTabs label="Activity" tabs={activityTabs(S)} value={tab} onChange={setTab} />
      <div className="page-panel" role="tabpanel" aria-label={activityTabs().find((t) => t.id === tab)?.label}>
        {tab === "usage" ? <Usage S={S} refresh={refresh} onOpenSettings={() => onOpenSettings("limits")} />
          : tab === "stats" ? <StatsPage S={S} />
          : tab === "unasked" ? <UnaskedPage S={S} refresh={refresh} onOpenSection={(s) => (s === "memory" ? onOpenMemory() : s === "skills" ? onOpenSettings("skills") : setTab(s))} />
          : tab === "jobs" ? <Jobs S={S} refresh={refresh} />
          : <Inbox S={S} refresh={refresh} />}
      </div>
    </div>
  );
}
