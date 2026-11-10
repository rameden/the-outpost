// Mission control: the crew across the top, your history of conversations on the left, the
// conversation you're in (and the composer) in the middle, the camp's records on the right.
// An agent's page opens as a drawer over it.

import { useCallback, useMemo, useRef, useState } from "react";
import { storeGet, storeSet } from "./api.ts";
import { useCampEvents, useCampState } from "./camp.ts";
import { AgentDrawer, type AgentTab } from "./components/AgentDrawer.tsx";
import { Composer, type ComposerHandle, type SendContext } from "./components/Composer.tsx";
import { History } from "./components/History.tsx";
import { ProjectDialog } from "./components/ProjectDialog.tsx";
import { ProjectPage, ProjectsOverview } from "./components/Projects.tsx";
import { api, errorText } from "./api.ts";
import type { History as HistoryData, Project } from "./types.ts";
import { latestLiveRun, parseView, usePast, type View } from "./feed/conversation.ts";
import { useFeed } from "./feed/store.ts";
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

  // Which conversation the middle of the page shows (remembered across reloads).
  const [view, setViewState] = useState<View>(() => parseView(storeGet("camp-view")));
  const setView = useCallback((v: View) => {
    setViewState(v);
    storeSet("camp-view", JSON.stringify(v));
    composer.current?.focus();
  }, []);
  const thread = view.kind === "conversation" ? view.id : null;
  const past = usePast(thread);
  const liveRun = useFeed(store, (s) => (thread ? latestLiveRun(s.items, thread) : undefined));
  const conversation = thread ? S?.history.conversations.find((c) => c.id === thread) : undefined;
  const project = S?.history.projects.find((p) => p.id === (view.kind === "new" ? view.project : view.kind === "project" ? view.id : conversation?.project));
  // A project's page, or the list of them (also where a deleted project's page lands).
  const page = view.kind === "project" && project ? "project" : view.kind === "project" || view.kind === "projects" ? "projects" : null;
  // What you send follows the conversation you're in; on a new page it starts one (in that project).
  const context = useMemo<SendContext | undefined>(() => {
    if (view.kind === "conversation") return { replyTo: liveRun ?? conversation?.expeditions.at(-1), placeholder: "Reply in this conversation…" };
    if (view.kind === "all") return undefined;
    // A new page, or a project's own page: what you send starts a conversation (in that project).
    const inProject = project && project.id !== "general" && (view.kind === "project" || (view.kind === "new" && !!view.project));
    return { project: inProject ? project.id : undefined, placeholder: inProject ? `Start a conversation in ${project.name}…` : "Start a new conversation…" };
  }, [view, liveRun, conversation, project]);
  const heading = view.kind === "all" ? "All activity" : view.kind === "new" ? "New conversation" : conversation?.title ?? "Conversation";
  const waiting = view.kind === "conversation" && S && !conversation ? "This one is waiting its turn. It shows up here when it starts."
    : view.kind === "new" && project && view.project ? `It will be filed under ${project.name}. Ask the Quartermaster for something, or @ a crew member directly.`
    : undefined;

  // The project dialog: a new project, or one being edited.
  const [dialog, setDialog] = useState<{ project: Project | null } | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const onProjectSaved = useCallback((history: HistoryData, id: string) => {
    patch((s) => ({ ...s, history }));
    refresh(); // a folder may have been linked along the way
    setDialog(null);
    setView({ kind: "project", id });
  }, [patch, refresh, setView]);
  const deleteProject = useCallback(async (p: Project) => {
    if (!confirm(`Delete the project "${p.name}"? Its conversations move to General. The folder itself isn't touched.`)) return;
    try {
      const r = await api<{ history: HistoryData }>("/api/history", { action: "project.remove", id: p.id });
      patch((s) => ({ ...s, history: r.history }));
      setView({ kind: "projects" });
    } catch (e) { alert(errorText(e)); }
  }, [patch, setView]);

  const onReply = useCallback((expId: string, task: string) => composer.current?.setReply(expId, task), []);
  const onExample = useCallback((text: string) => composer.current?.setText(text), []);
  const onAttachLink = useCallback((link: Link) => composer.current?.attachLink(link), []);

  return (
    <>
      <div className="app">
        <Header S={S} store={store} conn={conn} refresh={refresh} onShowLimits={() => setTab("quests")} />
        <Crew S={S} store={store} pickerFor={picker?.id ?? null} onOpenAgent={setAgentId} onOpenPicker={openPicker} />
        <History S={S} store={store} view={view} setView={setView} patch={patch}
          onNewProject={() => setDialog({ project: null })} onEditProject={(p) => setDialog({ project: p })} />
        <main className="mission">
          {page === "project" && S && project ? (
            <ProjectPage S={S} store={store} project={project} setView={setView} onEdit={(p) => setDialog({ project: p })} onDelete={deleteProject} />
          ) : page === "projects" && S ? (
            <ProjectsOverview S={S} setView={setView} onNew={() => setDialog({ project: null })} />
          ) : (
            <>
              <div className="conv-head">
                <h2>{heading}</h2>
                {project && project.id !== "general" && (
                  <button type="button" className="pill pill-link" title={`Open the project ${project.name}`} onClick={() => setView({ kind: "project", id: project.id })}>{project.name}</button>
                )}
              </div>
              <Feed store={store} onReply={onReply} onExample={onExample} view={view} past={past} waiting={waiting} />
            </>
          )}
          <Composer ref={composer} S={S} store={store} refresh={refresh} patch={patch} context={context}
            onSent={(r) => { if (view.kind !== "all") setView({ kind: "conversation", id: r.thread }); }} />
        </main>
        <SidePanel S={S} tab={tab} setTab={setTab} refresh={refresh} onAttachLink={onAttachLink} />
      </div>
      {agentId && (
        <AgentDrawer key={agentId} agentId={agentId} tab={agentTab} setTab={setAgentTab} S={S} store={store}
          pickerOpen={!!picker} onOpenPicker={openPicker} onClose={closeAgent} />
      )}
      {dialog && <ProjectDialog key={dialog.project?.id ?? "new"} S={S} project={dialog.project} onClose={closeDialog} onSaved={onProjectSaved} />}
      {picker && picking && S && (
        <ModelPicker key={picker.id} c={picking} runtime={S.runtime} at={picker} onClose={closePicker} onSaved={() => { closePicker(); refresh(); }} />
      )}
    </>
  );
}
