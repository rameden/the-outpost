// The Memory page: everything the camp remembers, in one place, in three views. List is the
// lines (what's waiting on you, you, each crew member's memory, each project's notes) and the
// wiki's pages: where you read, change and forget them. Map is the constellation (every line
// a star), opened full screen from here. By member is one crew member's memory on its own.
// The two switches for how memory is looked after stay in Settings → Memory.

import type { MemoryTab } from "../feed/conversation.ts";
import { MemoryLines } from "../settings/MemoryPage.tsx";
import type { CampState } from "../types.ts";
import { w } from "../words.ts";
import { Icon } from "./bits.tsx";
import { PageTabs, type PageTab } from "./PageTabs.tsx";
import { WikiHome } from "./Wiki.tsx";

const TABS: PageTab<MemoryTab>[] = [
  { id: "list", label: "List", title: "Every line and every wiki page: read, change, forget" },
  { id: "map", label: "Map", title: "Every line as a star on a map" },
  { id: "member", label: "By member", get title() { return `One ${w("crew")} member's memory`; } },
];

export function MemoryHome({ S, tab, member, page, setView, refresh, onOpenMap, onOpenSettings }: {
  S: CampState; tab: MemoryTab; member?: string; page?: string;
  setView: (v: { kind: "memory"; tab?: MemoryTab; member?: string; page?: string }) => void;
  refresh: () => void; onOpenMap: () => void; onOpenSettings: () => void;
}) {
  const open = (path: string | null) => setView(path ? { kind: "memory", tab: "list", page: path } : { kind: "memory", tab: "list" });
  if (page) return <WikiHome S={S} open={page} onOpen={open} refresh={refresh} />; // a page being read or written takes the whole page
  const who = S.characters.find((c) => c.id === member) ?? S.characters[0];
  const lines = (S.memory ?? []).reduce((n, p) => n + p.lines.length, 0);
  return (
    <div className="feed proj-page memory-page">
      <header className="proj-head">
        <div>
          <h2>Memory</h2>
          <div className="meta">What the {w("crew")} starts each run knowing: {lines} {lines === 1 ? "line" : "lines"} remembered, and the {w("camp")}'s wiki.</div>
        </div>
        <div className="proj-actions"><button type="button" className="btn small" title="How memory is looked after: tidying and suggestions" onClick={onOpenSettings}><Icon name="gear" /> Settings</button></div>
      </header>
      <PageTabs label="Memory" tabs={TABS} value={tab} onChange={(t) => setView({ kind: "memory", tab: t, ...(t === "member" ? { member: who?.id } : {}) })} />
      <div className="page-panel" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === "list" ? (
          <>
            <p className="set-note">Only the newest part of each memory fits in a prompt; the rest is still on disk, and the {w("crew")} can search it with <code>recall</code> (along with past sessions, this project's earlier conversations and the wiki).</p>
            <MemoryLines S={S} refresh={refresh} />
            <h3 className="page-sub">Wiki</h3>
            <WikiHome S={S} open={undefined} onOpen={open} refresh={refresh} embedded />
          </>
        ) : tab === "map" ? (
          <div className="memory-map">
            <p className="set-note">Every remembered line is a star, grouped by where it lives: see what's alike and what gets used, and pin, forget or merge from there.</p>
            <button type="button" className="btn primary" onClick={onOpenMap}><Icon name="constellation" /> Open the map</button>
            <span className="meta"> Full screen. Esc comes back here.</span>
          </div>
        ) : (
          <>
            <label className="memory-member">Memory of{" "}
              <select aria-label={`${w("Crew")} member`} value={who?.id ?? ""} onChange={(ev) => setView({ kind: "memory", tab: "member", member: ev.target.value })}>
                {S.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {who && <MemoryLines S={S} refresh={refresh} member={who.id} />}
          </>
        )}
      </div>
    </div>
  );
}
