// Mission control: the crew on the left, the live feed and the composer beside it. An agent's
// page opens as a drawer over it; Settings (with the camp's records) over everything.

import { useCallback, useRef, useState } from "react";
import { storeGet, storeSet } from "./api.ts";
import { useCampEvents, useCampState } from "./camp.ts";
import { AgentDrawer, type AgentTab } from "./components/AgentDrawer.tsx";
import { Composer, type ComposerHandle } from "./components/Composer.tsx";
import { Crew } from "./components/Crew.tsx";
import { Header } from "./components/Header.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { Feed } from "./feed/Feed.tsx";
import { Settings, isSettingsSection, type SettingsSection } from "./settings/Settings.tsx";
import type { FeedStore } from "./feed/store.ts";
import type { Character, Link } from "./types.ts";

export function App({ store }: { store: FeedStore }) {
  const { S, refresh, patch } = useCampState();
  const conn = useCampEvents(store, refresh);
  const composer = useRef<ComposerHandle>(null);

  // Settings opens over everything; the last section is remembered.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const openSettings = useCallback((s?: SettingsSection) => {
    const saved = storeGet("camp-settings");
    setSettings(s ?? (isSettingsSection(saved) ? saved : "general"));
  }, []);
  const setSection = useCallback((s: SettingsSection) => { setSettings(s); storeSet("camp-settings", s); }, []);
  const closeSettings = useCallback(() => setSettings(null), []);

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
        <Header S={S} store={store} conn={conn} refresh={refresh} onOpenSettings={openSettings} />
        <Crew S={S} store={store} pickerFor={picker?.id ?? null} onOpenAgent={setAgentId} onOpenPicker={openPicker} />
        <main className="mission">
          <Feed store={store} onReply={onReply} onExample={onExample} />
          <Composer ref={composer} S={S} store={store} refresh={refresh} patch={patch} />
        </main>
      </div>
      {agentId && (
        <AgentDrawer key={agentId} agentId={agentId} tab={agentTab} setTab={setAgentTab} S={S} store={store}
          pickerOpen={!!picker} onOpenPicker={openPicker} onClose={closeAgent} />
      )}
      {settings && (
        <Settings S={S} section={settings} setSection={setSection} refresh={refresh} onAttachLink={onAttachLink} onClose={closeSettings} />
      )}
      {picker && picking && S && (
        <ModelPicker key={picker.id} c={picking} runtime={S.runtime} at={picker} onClose={closePicker} onSaved={() => { closePicker(); refresh(); }} />
      )}
    </>
  );
}
