// The side panel: the camp's records, one tab each.

import { useState } from "react";
import { Quests } from "../panels/Quests.tsx";
import { Connectors, Inbox, Jobs, Memory, Skills, Wiki } from "../panels/Records.tsx";
import type { CampState, Link } from "../types.ts";

export type SideTab = "quests" | "memory" | "jobs" | "wiki" | "skills" | "connectors" | "inbox";
export const SIDE_TABS: [SideTab, string][] = [
  ["quests", "Quests"], ["memory", "Memory"], ["jobs", "Jobs"], ["wiki", "Wiki"], ["skills", "Skills"], ["connectors", "Connectors"], ["inbox", "Inbox"],
];
export const isSideTab = (id: string | null): id is SideTab => SIDE_TABS.some(([t]) => t === id);

export function SidePanel({ S, tab, setTab, refresh, onAttachLink }: {
  S: CampState | null; tab: SideTab; setTab: (t: SideTab) => void; refresh: () => void; onAttachLink: (link: Link) => void;
}) {
  const [wikiOpen, setWikiOpen] = useState<string | null>(null);
  return (
    <aside className="panel" aria-label="Camp records">
      <div className="tabs" role="tablist">
        {SIDE_TABS.map(([id, label]) => (
          <button key={id} type="button" className="tab" role="tab" aria-selected={tab === id} onClick={() => { setWikiOpen(null); setTab(id); }}>
            {label}{id === "skills" && !!S?.skills.length && <span className="count">{S.skills.length}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {!S ? null
          : tab === "quests" ? <Quests S={S} refresh={refresh} />
          : tab === "jobs" ? <Jobs S={S} refresh={refresh} />
          : tab === "wiki" ? <Wiki S={S} refresh={refresh} open={wikiOpen} setOpen={setWikiOpen} />
          : tab === "skills" ? <Skills S={S} refresh={refresh} />
          : tab === "inbox" ? <Inbox S={S} refresh={refresh} />
          : tab === "connectors" ? <Connectors S={S} refresh={refresh} onAttachLink={onAttachLink} />
          : <Memory S={S} refresh={refresh} />}
      </div>
    </aside>
  );
}
