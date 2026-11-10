// Mission control: the crew across the top, your history of conversations on the left, and the
// conversation you're in (with the composer) beside it. An agent's page opens as a drawer over
// it; Settings (with the camp's records) over everything.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storeGet, storeSet } from "./api.ts";
import { useCampEvents, useCampState } from "./camp.ts";
import { AgentDrawer, type AgentTab } from "./components/AgentDrawer.tsx";
import { Composer, type ComposerHandle, type SendContext } from "./components/Composer.tsx";
import { History, HistoryRail } from "./components/History.tsx";
import { TerminalPanel, TerminalRail } from "./components/Terminal.tsx";
import { FilesPanel, FilesRail, type FileRoot } from "./components/Files.tsx";
import { LayoutFrame, type ZoneState } from "./components/Zones.tsx";
import { LayoutEditor } from "./components/LayoutEditor.tsx";
import { focusPlan, loadLayout, PANELS, placed, saveLayout, type Layout, type Panel, type Part } from "./layout.ts";
import { Presence } from "./motion.tsx";
import { runningCount } from "./feed/reducer.ts";
import { ProjectDialog } from "./components/ProjectDialog.tsx";
import { CrewDialog } from "./components/CrewDialog.tsx";
import { setCrewColors } from "./format.ts";
import { ProjectPage, ProjectsOverview } from "./components/Projects.tsx";
import { api, errorText } from "./api.ts";
import type { History as HistoryData, Project } from "./types.ts";
import { latestLiveRun, parseView, usePast, type View } from "./feed/conversation.ts";
import { useFeed } from "./feed/store.ts";
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
    if (view.kind === "conversation") return { replyTo: liveRun ?? conversation?.expeditions.at(-1), placeholder: "Reply in this conversation…", ...(project && project.id !== "general" ? { folders: project.links ?? [] } : {}) };
    if (view.kind === "all") return undefined;
    // A new page, or a project's own page: what you send starts a conversation (in that project).
    const inProject = project && project.id !== "general" && (view.kind === "project" || (view.kind === "new" && !!view.project));
    return {
      project: inProject ? project.id : undefined,
      placeholder: inProject ? `Start a conversation in ${project.name}…` : "Start a new conversation…",
      // In a project, the "work in" picker offers that project's folders only.
      ...(inProject ? { folders: project.links ?? [], newWorktree: project.settings?.workIn === "worktree" } : {}),
    };
  }, [view, liveRun, conversation, project]);
  const heading = view.kind === "all" ? "All activity" : view.kind === "new" ? "New conversation" : conversation?.title ?? "Conversation";
  const waiting = view.kind === "conversation" && S && !conversation ? "This one is waiting its turn. It shows up here when it starts."
    : view.kind === "new" && project && view.project ? `It will be filed under ${project.name}. Ask the Quartermaster for something, or @ a crew member directly.`
    : undefined;

  // The terminal pane along the bottom: shown or hidden (remembered), toggled with Ctrl+`.
  const [terminal, setTerminal] = useState(() => storeGet("camp-term-open") === "1");
  const toggleTerminal = useCallback(() => setTerminal((on) => { storeSet("camp-term-open", on ? "0" : "1"); return !on; }), []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.code === "Backquote") { ev.preventDefault(); toggleTerminal(); } };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [toggleTerminal]);

  // The Files flyout on the right: the folders attached to where you are (the project's own, the
  // conversation's, and any sitting in the message box). Shown or hidden (remembered), toggled
  // with Ctrl+Shift+E; with no folder attached there's nothing to show, so no way to open it.
  const [attached, setAttached] = useState<string[]>([]);
  const fileRoots = useMemo<FileRoot[]>(() => {
    const names = new Set([...(project && project.id !== "general" ? project.links ?? [] : []), ...(conversation?.links ?? []), ...Object.keys(conversation?.workspaces ?? {}), ...attached]);
    return [...names].filter((n) => S?.links.some((l) => l.name === n)).map((n) => {
      const w = conversation?.workspaces?.[n]; // it worked in its own worktree: show that
      return w ? { link: n, path: w.path, branch: w.branch } : { link: n };
    });
  }, [S?.links, project, conversation, attached]);
  const hasFiles = fileRoots.length > 0;
  const [files, setFiles] = useState(() => storeGet("camp-files-open-pane") === "1");
  const toggleFiles = useCallback(() => setFiles((on) => { storeSet("camp-files-open-pane", on ? "0" : "1"); return !on; }), []);
  useEffect(() => {
    if (!hasFiles) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.ctrlKey && ev.shiftKey && !ev.metaKey && !ev.altKey && ev.code === "KeyE") { ev.preventDefault(); toggleFiles(); } };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [hasFiles, toggleFiles]);
  const running = useFeed(store, runningCount);
  const onMention = useCallback((path: string) => composer.current?.mention(path), []);

  // History closes to a tab too (remembered).
  const [historyOpen, setHistoryOpen] = useState(() => storeGet("camp-history-open") !== "0");
  const toggleHistory = useCallback(() => setHistoryOpen((on) => { storeSet("camp-history-open", on ? "0" : "1"); return !on; }), []);

  // The page's layout: zones you arrange in the layout editor (remembered in this browser).
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const setLayout = useCallback((next: Layout) => { setLayoutState(next); saveLayout(next); }, []);
  const [layoutEditor, setLayoutEditor] = useState<{ select?: string } | null>(null);
  const closeLayoutEditor = useCallback(() => setLayoutEditor(null), []);
  // History, Files and the terminal each close to a slim tab; Files has nothing to show without a folder.
  const stateOf = (part: Part | null): ZoneState =>
    part === "terminal" ? (terminal ? "shown" : "collapsed") : part === "history" ? (historyOpen ? "shown" : "collapsed")
    : part === "files" ? (!hasFiles ? "hidden" : files ? "shown" : "collapsed") : "shown";

  // Focus mode: close whichever of those panels are open, leaving the conversation. Leaving
  // focus brings back the ones it closed (remembered, so it survives a reload).
  const openNow = PANELS.filter((p) => placed(layout, p) && stateOf(p) === "shown");
  const focused = openNow.length === 0;
  const toggleFocus = () => {
    const set = (part: Panel, on: boolean) => {
      if (part === "history") { setHistoryOpen(on); storeSet("camp-history-open", on ? "1" : "0"); }
      if (part === "files") { setFiles(on); storeSet("camp-files-open-pane", on ? "1" : "0"); }
      if (part === "terminal") { setTerminal(on); storeSet("camp-term-open", on ? "1" : "0"); }
    };
    const plan = focusPlan(openNow, storeGet("camp-focus-closed"));
    if (plan.close.length) storeSet("camp-focus-closed", plan.close.join(","));
    for (const p of plan.close) set(p, false);
    for (const p of plan.reopen) set(p, true);
  };

  // The crew dialog: a new crew member (the + at the end of the crew bar), or one you added being edited.
  const [crewDialog, setCrewDialog] = useState<{ member: Character | null } | null>(null);
  const closeCrewDialog = useCallback(() => setCrewDialog(null), []);
  // Colours of crew members you added, for their cards and messages anywhere on the page.
  useMemo(() => setCrewColors(S?.characters ?? []), [S?.characters]);

  // The project dialog: a new project, or one being edited.
  const [dialog, setDialog] = useState<{ project: Project | null } | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const onProjectSaved = useCallback((history: HistoryData, id: string) => {
    patch((s) => ({ ...s, history }));
    refresh(); // a folder may have been linked along the way
    setDialog(null);
    setView({ kind: "project", id });
  }, [patch, refresh, setView]);
  // A conversation in General that used one project's folder: offer to file it there.
  const suggested = conversation?.suggest ? S?.history.projects.find((p) => p.id === conversation.suggest) : undefined;
  const moveTo = useCallback(async (id: string, to: string) => {
    try {
      const r = await api<{ history: HistoryData }>("/api/history", { action: "conversation.move", id, project: to });
      patch((s) => ({ ...s, history: r.history }));
    } catch (e) { alert(errorText(e)); }
  }, [patch]);
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
        <Header S={S} store={store} conn={conn} refresh={refresh} onOpenSettings={openSettings} focused={focused} onToggleFocus={toggleFocus}
          filesOpen={files} onToggleFiles={hasFiles && placed(layout, "files") ? toggleFiles : undefined} onOpenLayout={() => setLayoutEditor({})} />
        <LayoutFrame layout={layout} onChange={setLayout} className="zones" stateOf={(z) => stateOf(z.part)} animate>
          {(zone, state) => {
            switch (zone.part) {
              case "roster": return (
                <Crew S={S} store={store} pickerFor={picker?.id ?? null} onOpenAgent={setAgentId} onOpenPicker={openPicker}
                  onAdd={() => setCrewDialog({ member: null })} onEdit={(c) => setCrewDialog({ member: c })} />
              );
              case "history": return state === "collapsed" ? <HistoryRail onShow={toggleHistory} /> : (
                <History S={S} store={store} view={view} setView={setView} patch={patch} onHide={toggleHistory}
                  onNewProject={() => setDialog({ project: null })} onEditProject={(p) => setDialog({ project: p })} />
              );
              case "chat": return (
                <main className="mission">
                  {page === "project" && S && project ? (
                    <ProjectPage key={project.id} S={S} store={store} project={project} setView={setView} refresh={refresh} patch={patch} onEdit={(p) => setDialog({ project: p })} onDelete={deleteProject} />
                  ) : page === "projects" && S ? (
                    <ProjectsOverview S={S} setView={setView} onNew={() => setDialog({ project: null })} />
                  ) : (
                    <>
                      <div className="conv-head">
                        <h2>{heading}</h2>
                        {project && project.id !== "general" && (
                          <button type="button" className="pill pill-link" title={`Open the project ${project.name}`} onClick={() => setView({ kind: "project", id: project.id })}>{project.name}</button>
                        )}
                        {conversation?.suggest && suggested && (
                          <span className="conv-suggest">It used {suggested.name}'s folder.
                            <button type="button" className="linkish" onClick={() => moveTo(conversation.id, suggested.id)}>Move it to {suggested.name}</button>
                          </span>
                        )}
                      </div>
                      <Feed store={store} onReply={onReply} onExample={onExample} view={view} past={past} waiting={waiting} />
                    </>
                  )}
                  <Composer ref={composer} S={S} store={store} refresh={refresh} patch={patch} context={context}
                    onSent={(r) => { if (view.kind !== "all") setView({ kind: "conversation", id: r.thread }); }} onFolders={setAttached} />
                </main>
              );
              case "files": return state === "collapsed"
                ? <FilesRail onShow={toggleFiles} />
                : <FilesPanel roots={fileRoots} refreshKey={running} onHide={toggleFiles} onMention={onMention} />;
              case "terminal": return state === "collapsed"
                ? <TerminalRail onShow={toggleTerminal} />
                : <TerminalPanel project={project?.id} onHide={toggleTerminal} ready={!!S} />;
              default: return (
                <div className="zone-empty">
                  <b>Empty zone</b>
                  <button type="button" className="linkish" onClick={() => setLayoutEditor({ select: zone.id })}>Choose what goes here</button>
                </div>
              );
            }
          }}
        </LayoutFrame>
      </div>
      <Presence>{agentId && (
        <AgentDrawer key={agentId} agentId={agentId} tab={agentTab} setTab={setAgentTab} S={S} store={store} project={project?.id}
          pickerOpen={!!picker} onOpenPicker={openPicker} onClose={closeAgent} />
      )}</Presence>
      <Presence>{settings && (
        <Settings S={S} section={settings} setSection={setSection} refresh={refresh} onAttachLink={onAttachLink} onClose={closeSettings} />
      )}</Presence>
      <Presence>{layoutEditor && <LayoutEditor layout={layout} onChange={setLayout} onClose={closeLayoutEditor} select={layoutEditor.select} />}</Presence>
      <Presence>{crewDialog && <CrewDialog key={crewDialog.member?.id ?? "new"} member={crewDialog.member} onClose={closeCrewDialog} onSaved={() => { setCrewDialog(null); refresh(); }} />}</Presence>
      <Presence>{dialog && <ProjectDialog key={dialog.project?.id ?? "new"} S={S} project={dialog.project} onClose={closeDialog} onSaved={onProjectSaved} />}</Presence>
      {picker && picking && S && (
        <ModelPicker key={picker.id} c={picking} runtime={S.runtime} at={picker} onClose={closePicker} onSaved={() => { closePicker(); refresh(); }} />
      )}
    </>
  );
}
