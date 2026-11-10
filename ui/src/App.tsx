// Mission control: the crew on the left, the live feed and the composer in the middle, the
// camp's records on the right. An agent's page opens as a drawer over it.

import { useCallback, useRef, useState } from "react";
import { storeGet, storeSet } from "./api.ts";
import { useCampEvents, useCampState } from "./camp.ts";
import { AgentDrawer, type AgentTab } from "./components/AgentDrawer.tsx";
import { Composer, type ComposerHandle } from "./components/Composer.tsx";
import { Crew } from "./components/Crew.tsx";
import { Header } from "./components/Header.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { SidePanel, isSideTab, type SideTab } from "./components/SidePanel.tsx";
import { Feed } from "./feed/Feed.tsx";
import type { FeedStore } from "./feed/store.ts";
import type { Character, Link } from "./types.ts";

export function App({ store }: { store: FeedStore }) {
  const { S, refresh, patch } = useCampState();
  const conn = useCampEvents(store, refresh);
  const composer = useRef<ComposerHandle>(null);

  const [tab, setTabState] = useState<SideTab>(() => { const saved = storeGet("camp-tab"); return isSideTab(saved) ? saved : "quests"; });
  const setTab = useCallback((t: SideTab) => { setTabState(t); storeSet("camp-tab", t); }, []);

  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentTab, setAgentTab] = useState<AgentTab>("chat"); // remembered from one agent's page to the next
  const closeAgent = useCallback(() => setAgentId(null), []);

  // The model picker opens under whichever model line was clicked (a crew card's, or the drawer's).
  const [picker, setPicker] = useState<{ id: string; left: number; top: number } | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const openPicker = useCallback((c: Character, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setPicker((open) => open?.id === c.id ? null : {
      id: c.id,
      left: Math.max(16, Math.min(r.left, innerWidth - 336)),
      top: Math.max(16, Math.min(r.bottom + 6, innerHeight - 400)),
    });
  }, []);
  const picking = picker && S?.characters.find((c) => c.id === picker.id);

  const onReply = useCallback((expId: string, task: string) => composer.current?.setReply(expId, task), []);
  const onExample = useCallback((text: string) => composer.current?.setText(text), []);
  const onAttachLink = useCallback((link: Link) => composer.current?.attachLink(link), []);

  return (
    <>
      <div className="app">
        <Header S={S} store={store} conn={conn} refresh={refresh} onShowLimits={() => setTab("quests")} />
        <Crew S={S} store={store} pickerFor={picker?.id ?? null} onOpenAgent={setAgentId} onOpenPicker={openPicker} />
        <main className="mission">
          <Feed store={store} onReply={onReply} onExample={onExample} />
          <Composer ref={composer} S={S} store={store} refresh={refresh} patch={patch} />
        </main>
        <SidePanel S={S} tab={tab} setTab={setTab} refresh={refresh} onAttachLink={onAttachLink} />
      </div>
      {agentId && (
        <AgentDrawer key={agentId} agentId={agentId} tab={agentTab} setTab={setAgentTab} S={S} store={store}
          pickerOpen={!!picker} onOpenPicker={openPicker} onClose={closeAgent} />
      )}
      {picker && picking && S && (
        <ModelPicker key={picker.id} c={picking} runtime={S.runtime} at={picker} onClose={closePicker} onSaved={() => { closePicker(); refresh(); }} />
      )}
    </>
  );
}
