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
import { CAMP_FILES, FilesPanel, FilesRail, type FileRoot } from "./components/Files.tsx";
import { LayoutFrame, type ZoneState } from "./components/Zones.tsx";
import { LayoutEditor } from "./components/LayoutEditor.tsx";
import { focusPlan, loadLayout, PANELS, placed, saveLayout, type Layout, type Panel, type Part } from "./layout.ts";
import { Presence } from "./motion.tsx";
import { hear, COMMANDS } from "./bus.ts";
import { Palette, type PaletteItem } from "./components/Palette.tsx";
import { FileViewer } from "./components/FileViewer.tsx";
import { JiraPage, JiraTicket, type TicketStart } from "./components/JiraPage.tsx";
import { TicketWizard } from "./components/TicketWizard.tsx";
import { WikiHome } from "./components/Wiki.tsx";
import { treeQuery } from "./api.ts";
import { runningCount } from "./feed/reducer.ts";
import { ProjectDialog } from "./components/ProjectDialog.tsx";
import { CrewDialog } from "./components/CrewDialog.tsx";
import { setCrewColors } from "./format.ts";
import { ProjectPage, ProjectsOverview } from "./components/Projects.tsx";
import { api, errorText } from "./api.ts";
import type { History as HistoryData, Project, SendResult } from "./types.ts";
import { latestLiveRun, parseView, usePast, type View } from "./feed/conversation.ts";
import { useFeed } from "./feed/store.ts";
import { Crew } from "./components/Crew.tsx";
import { Header } from "./components/Header.tsx";
import { OverlayBoundary, ZoneBoundary } from "./components/ErrorBoundary.tsx";
import { StatusLine, tell } from "./components/StatusLine.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { Feed } from "./feed/Feed.tsx";
import { NextStep } from "./feed/NextStep.tsx";
import { Waiting } from "./components/Waiting.tsx";
import { loadSeen, markSeen, needsOf, seenAll, type Need } from "./needs.ts";
import { activityOf } from "./feed/conversation.ts";
import { Settings, isSettingsSection, type SettingsSection } from "./settings/Settings.tsx";
import type { FeedStore } from "./feed/store.ts";
import type { Character, Link } from "./types.ts";

export function App({ store }: { store: FeedStore }) {
  // Settings opens over everything; the last section is remembered. (While it's open, refreshes
  // bring the records it shows; the rest of the time they're left out.)
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // Which conversation (or page) the middle of the screen shows (remembered across reloads).
  const [view, setViewState] = useState<View>(() => parseView(storeGet("camp-view")));
  // The camp's records (memories, the wiki, the quest log…) come along while something that shows them is open.
  const { S, refresh, patch, stale } = useCampState(!!settings || view.kind === "wiki");
  const conn = useCampEvents(store, refresh);
  const composer = useRef<ComposerHandle>(null);

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
  const page = view.kind === "wiki" ? "wiki" : view.kind === "jira" ? (S?.jira?.connected ? "jira" : "projects") // unlinked since: there's nothing to show
    : view.kind === "project" && project ? "project" : view.kind === "project" || view.kind === "projects" ? "projects" : null;
  // The ticket kickoff stepper: open, and on which ticket if one was already picked.
  const [wizard, setWizard] = useState<{ ticket?: TicketStart } | null>(null);
  const closeWizard = useCallback(() => setWizard(null), []);
  const [ticketOpen, setTicketOpen] = useState<string | null>(null); // a conversation's ticket, opened over it
  const closeTicket = useCallback(() => setTicketOpen(null), []);
  // What you send follows the conversation you're in; on a new page it starts one (in that project).
  const context = useMemo<SendContext | undefined>(() => {
    if (view.kind === "conversation") return { replyTo: liveRun ?? conversation?.expeditions.at(-1), placeholder: "Reply in this conversation…", // In a project: its folders, and any others this conversation was given along the way.
      ...(project && project.id !== "general" ? { folders: [...new Set([...(project.links ?? []), ...(conversation?.links ?? []), ...Object.keys(conversation?.workspaces ?? {}).filter((l) => !conversation?.without?.includes(l))])] } : {}),
      ...(conversation?.workspaces ? { working: Object.fromEntries(Object.entries(conversation.workspaces).map(([l, w]) => [l, w.branch])) } : {}),
      ...(conversation?.without?.length ? { without: conversation.without } : {}) };
    if (view.kind === "all") return undefined;
    // A new page: what you send starts a conversation (in that project, if it's a project's).
    const inProject = project && project.id !== "general" && view.kind === "new" && !!view.project;
    return {
      project: inProject ? project.id : undefined,
      placeholder: inProject ? `Start a conversation in ${project.name}…` : "Ask a model anything, or start with @ to bring in the crew…",
      // In a project, the "work in" picker offers that project's folders only.
      ...(inProject ? { folders: project.links ?? [], newWorktree: project.settings?.workIn === "worktree" } : {}),
    };
  }, [view, liveRun, conversation, project]);
  const heading = view.kind === "all" ? "All activity" : view.kind === "new" ? "New conversation" : conversation?.title ?? "Conversation";
  const waiting = view.kind === "conversation" && S && !conversation ? "This one is waiting its turn. It shows up here when it starts."
    : view.kind === "new" && project && view.project && project.id !== "general" ? `It will be filed under ${project.name}. Ask the Quartermaster for something, or @ a crew member directly.`
    : view.kind === "new" ? "Outside a project this is a plain chat: what you ask goes straight to the model named beside the message box, with nobody from the crew involved. To put the crew on it, start your message with @ (for example @quartermaster), or work in a project."
    : undefined;
  // What a blank page offers to start from: a plain question outside a project, crew work inside one.
  const plainPage = view.kind === "new" && !(project && view.project && project.id !== "general");

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
    // A folder this conversation was started without isn't shown for it either.
    return [...names].filter((n) => S?.links.some((l) => l.name === n) && !conversation?.without?.includes(n)).map((n) => {
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

  // ---------- Getting about from the keyboard ----------
  // The command palette (⌘P / Ctrl+P), and a file opened over the page from it or from a path in an answer.
  const [palette, setPalette] = useState<{ start: string } | null>(null);
  const closePalette = useCallback(() => setPalette(null), []);
  const [opened, setOpened] = useState<{ root: FileRoot; rel: string; line?: number } | null>(null);
  const closeOpened = useCallback(() => setOpened(null), []);
  const openFile = useCallback((root: FileRoot, rel: string, line?: number) => setOpened({ root, rel, line }), []);
  const asks = useFeed(store, (s) => s.asks);

  // Everything that needs you, wherever it is (needs.ts). Having a conversation open marks what's in it as seen.
  const activity = useFeed(store, activityOf);
  const [seen, setSeen] = useState(loadSeen);
  useEffect(() => {
    if (!conversation) return;
    setSeen((was) => markSeen(was, conversation, new Set(S?.history.conversations.map((c) => c.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.updated]);
  const needs = useMemo(() => needsOf({ conversations: S?.history.conversations ?? [], prs: S?.prs, queued: S?.queued, activity, seen, viewing: thread }),
    [S?.history.conversations, S?.prs, S?.queued, activity, seen, thread]);
  const goToNeed = (n: Need) => {
    if (n.kind === "decision") return nextDecision(n.conversation);
    setView({ kind: "conversation", id: n.conversation });
  };

  // The next decision waiting on you (in that conversation, if one is named): go to its
  // conversation, bring it into view, and leave its first button focused, so Enter approves.
  const nextDecision = (inConversation?: string) => {
    const of = (a: (typeof asks)[number]) => S?.history.conversations.find((c) => !!a.expId && c.expeditions.includes(a.expId));
    const ask = (inConversation ? asks.find((a) => of(a)?.id === inConversation) : undefined) ?? asks[0];
    if (!ask) return tell(store, "Nothing is waiting on you.");
    const conv = of(ask) ?? (inConversation ? S?.history.conversations.find((c) => c.id === inConversation) : undefined);
    if (conv && view.kind !== "all" && !(view.kind === "conversation" && view.id === conv.id)) setView({ kind: "conversation", id: conv.id });
    let tries = 0;
    const look = () => {
      const card = document.getElementById(`ask-${ask.id}`);
      if (!card) { if (tries++ < 30) setTimeout(look, 50); return; }
      card.scrollIntoView({ block: "center" });
      card.querySelector<HTMLElement>("button.primary, button, input")?.focus();
    };
    look();
  };

  // A quest that's out, picked in the crew bar: open its conversation and bring its own block into view.
  const openQuest = (q: { expId: string; node: string }) => {
    const run = store.getState().items.find((n) => n.kind === "exp" && n.expId === q.expId);
    const thread = run?.kind === "exp" ? run.thread : undefined;
    if (thread && view.kind !== "all" && !(view.kind === "conversation" && view.id === thread)) setView({ kind: "conversation", id: thread });
    let tries = 0;
    const look = () => {
      const block = document.getElementById(`quest-${q.node}`);
      if (!block) { if (tries++ < 30) setTimeout(look, 50); return; }
      block.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    look();
  };

  // A path as the crew wrote it: links/<name>/…, a full path inside a linked folder, or a path
  // inside one of the folders attached here. The first place it's found is opened.
  const openPath = async (raw: string, line?: number) => {
    const path = raw.replace(/^\.\//, "");
    const tries: { root: FileRoot; rel: string }[] = [];
    const named = path.match(/^links\/([A-Za-z0-9_-]+)\/(.+)$/);
    const own = path.match(/^(?:.*\/)?camp\/((?:agents\/[^/]+\/outputs|wiki|uploads)\/.+)$/); // what the camp keeps: an output, a wiki page, an upload
    if (named && S?.links.some((l) => l.name === named[1])) {
      tries.push({ root: fileRoots.find((r) => r.link === named[1]) ?? { link: named[1] }, rel: named[2] });
    } else if (own) {
      tries.push({ root: { link: CAMP_FILES }, rel: own[1] });
    } else {
      for (const r of fileRoots) if (r.path && path.startsWith(`${r.path}/`)) tries.push({ root: r, rel: path.slice(r.path.length + 1) });
      for (const l of S?.links ?? []) if (path.startsWith(`${l.path}/`)) tries.push({ root: { link: l.name }, rel: path.slice(l.path.length + 1) });
      if (!path.startsWith("/")) for (const r of fileRoots) tries.push({ root: r, rel: path });
    }
    for (const t of tries) {
      try { await api(`/api/tree/file?${treeQuery(t.root.link, t.root.path, t.rel)}`); return openFile(t.root, t.rel, line); } catch { /* not there: try the next */ }
    }
    tell(store, own ? `Couldn't find ${raw} in the camp folder.` : `Couldn't find ${raw} in the folders attached here.`, true);
  };

  // /good and /bad: rate the latest finished answer in this conversation.
  const rate = async (rating: "up" | "down", note?: string) => {
    const id = conversation?.status !== "running" ? conversation?.expeditions.at(-1) : conversation.expeditions.at(-2);
    if (!id) return tell(store, "There's no finished answer here to rate yet.");
    try { await api("/api/feedback", { id, rating, note: note || undefined }); tell(store, `Rated ${rating === "up" ? "👍" : "👎"}${note ? `: ${note}` : ""}`); }
    catch (e) { tell(store, errorText(e), true); }
  };

  // One place for everything a typed /command, the palette, or a shortcut can ask for.
  const command = (name: string, arg?: string) => {
    if (name === "new") setView(project && project.id !== "general" ? { kind: "new", project: project.id } : { kind: "new" });
    else if (name === "focus") toggleFocus();
    else if (name === "files") { if (hasFiles) toggleFiles(); else tell(store, "No folder is attached here, so there are no files to show."); }
    else if (name === "terminal") toggleTerminal();
    else if (name === "history") toggleHistory();
    else if (name === "find") setPalette({ start: arg ?? "" });
    else if (name === "next") { if (asks.length || !needs.length) nextDecision(); else goToNeed(needs[0]); }
    else if (name === "good") void rate("up", arg);
    else if (name === "bad") void rate("down", arg);
    else if (name === "layout") setLayoutEditor({});
    else if (name === "settings") openSettings();
    else if (name === "connectors") openSettings("connectors");
    else if (name === "wiki") setView({ kind: "wiki" });
    else if (name === "ticket") { if (S?.jira?.connected) setWizard({}); else { tell(store, "Link your Jira account first (Settings → Connectors)."); openSettings("connectors"); } }
  };
  // The newest of each, for the listeners and the handlers below that are set up once.
  const act = useRef({ command, openPath, toggleFocus, goToNeed });
  act.current = { command, openPath, toggleFocus, goToNeed };
  useEffect(() => hear((ask) => {
    if (ask.do === "command") act.current.command(ask.name, ask.arg);
    else if (ask.do === "open-file") { setSettings(null); void act.current.openPath(ask.path, ask.line); } // (Settings steps aside: the file opens over the page)
    else if (ask.do === "open-conversation") { setSettings(null); setView({ kind: "conversation", id: ask.id }); }
    else if (ask.do === "compose") { if (ask.replyTo) composer.current?.setReply(ask.replyTo, ask.task ?? ""); composer.current?.setText(ask.text); }
  }), []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform ?? "");
      const mod = mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
      if (mod && !ev.shiftKey && !ev.altKey && ev.code === "KeyP") { ev.preventDefault(); setPalette((p) => (p ? null : { start: "" })); }
      else if (ev.ctrlKey && ev.shiftKey && !ev.metaKey && !ev.altKey && ev.code === "KeyA") { ev.preventDefault(); act.current.command("next"); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);
  const paletteItems = useMemo<PaletteItem[]>(() => !palette || !S ? [] : [
    ...COMMANDS.filter((c) => c.name !== "find" && c.name !== "good" && c.name !== "bad").map((c): PaletteItem => ({
      id: `do:${c.name}`, group: "Do", icon: c.name === "new" ? "plus" : c.name === "settings" ? "gear" : c.name === "layout" ? "layout" : c.name === "next" ? "check" : c.name === "terminal" ? "terminal" : c.name === "files" ? "panelRight" : c.name === "history" ? "list" : "focus",
      label: c.does, hint: `/${c.name}`, run: () => act.current.command(c.name),
    })),
    ...S.history.conversations.map((c): PaletteItem => ({
      id: `c:${c.id}`, group: "Conversations", icon: "reply", label: c.title, hint: S.history.projects.find((p) => p.id === c.project)?.name, run: () => setView({ kind: "conversation", id: c.id }),
    })),
    ...S.history.projects.filter((p) => p.id !== "general").map((p): PaletteItem => ({
      id: `p:${p.id}`, group: "Projects", icon: "folder", label: p.name, hint: (p.links ?? []).map((l) => `links/${l}`).join(", "), run: () => setView({ kind: "project", id: p.id }),
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [palette, S?.history]);
  // Where you are, for the draft kept in the message box.
  const draftKey = view.kind === "conversation" ? `c:${view.id}` : view.kind === "new" ? `new:${view.project ?? ""}` : view.kind === "project" ? `p:${view.id}` : view.kind;

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

  // Where you were last talking (a conversation, or a new one): where "Attach to message" on a page takes you back to.
  const talking = useRef<View>({ kind: "new" });
  if (view.kind === "conversation" || view.kind === "new" || view.kind === "all") talking.current = view;
  const attachTicket = (issue: { key: string; summary: string }) => {
    composer.current?.attachJira(issue);
    setView(talking.current.kind === "all" ? { kind: "new" } : talking.current);
  };

  const onReply = useCallback((expId: string, task: string) => composer.current?.setReply(expId, task), []);
  const onExample = useCallback((text: string) => composer.current?.setText(text), []);
  const onAttachLink = useCallback((link: Link) => composer.current?.attachLink(link), []);

  // What the header, history, the terminal and the message box are handed. Each is the same
  // function from one draw of the page to the next, so those parts (memo'd) are only drawn again
  // when something they show has changed, not every time a word arrives in the feed.
  const onToggleFocus = useCallback(() => act.current.toggleFocus(), []);
  const onNeed = useCallback((n: Need) => act.current.goToNeed(n), []);
  const onSeenAll = useCallback(() => setSeen(seenAll()), []);
  const openLayout = useCallback(() => setLayoutEditor({}), []);
  const openWiki = useCallback(() => setView({ kind: "wiki" }), [setView]);
  const startTicket = useCallback(() => setWizard({}), []);
  const newProject = useCallback(() => setDialog({ project: null }), []);
  const editProject = useCallback((p: Project) => setDialog({ project: p }), []);
  const setUpTerminal = useCallback(() => openSettings("terminal"), [openSettings]);
  const inAll = view.kind === "all"; // All activity stays put when you send; anywhere else goes to the conversation
  const onSent = useCallback((r: SendResult) => { if (!inAll) setView({ kind: "conversation", id: r.thread }); }, [inAll, setView]);

  return (
    <>
      <div className="app">
        <ZoneBoundary name="The top bar">
          <Header S={S} store={store} conn={conn} stale={stale} refresh={refresh} onOpenSettings={openSettings} focused={focused} onToggleFocus={onToggleFocus}
            filesOpen={files} onToggleFiles={hasFiles && placed(layout, "files") ? toggleFiles : undefined} onOpenLayout={openLayout}
            needs={needs} onNeed={onNeed} onSeenAll={onSeenAll} />
        </ZoneBoundary>
        <LayoutFrame layout={layout} onChange={setLayout} className="zones" stateOf={(z) => stateOf(z.part)} animate>
          {(zone, state) => {
            switch (zone.part) {
              // Each zone keeps its own trouble: one that can't be drawn says so in its own space,
              // and the rest of the page (the message box above all) carries on.
              case "roster": return (
                <ZoneBoundary name="The crew bar">
                  <Crew S={S} store={store} pickerFor={picker?.id ?? null} onOpenAgent={setAgentId} onOpenPicker={openPicker} onOpenQuest={openQuest}
                    onAdd={() => setCrewDialog({ member: null })} onEdit={(c) => setCrewDialog({ member: c })} />
                </ZoneBoundary>
              );
              case "history": return state === "collapsed" ? <HistoryRail onShow={toggleHistory} /> : (
                <ZoneBoundary name="History">
                  <History S={S} store={store} view={view} setView={setView} patch={patch} onHide={toggleHistory} needs={needs}
                    onOpenWiki={openWiki} onStartTicket={startTicket} onNewProject={newProject} onEditProject={editProject} />
                </ZoneBoundary>
              );
              case "chat": return (
                <main className="mission">
                  {/* Going somewhere else gives it another go: the trouble may be one conversation's. */}
                  <ZoneBoundary name={page ? "This page" : "This conversation"} resetKey={draftKey}>
                  {page === "project" && S && project ? (
                    <ProjectPage key={project.id} S={S} store={store} project={project} setView={setView} refresh={refresh} patch={patch} onEdit={(p) => setDialog({ project: p })} onDelete={deleteProject} />
                  ) : page === "jira" && S ? (
                    <JiraPage S={S} onAttach={attachTicket} onFilter={() => openSettings("connectors")} onStart={(t) => setWizard({ ticket: t })} onKickoff={() => setWizard({})} />
                  ) : page === "wiki" && S ? (
                    <WikiHome S={S} open={view.kind === "wiki" ? view.page : undefined} onOpen={(path) => setView(path ? { kind: "wiki", page: path } : { kind: "wiki" })} refresh={refresh} />
                  ) : page === "projects" && S ? (
                    <ProjectsOverview S={S} setView={setView} onNew={() => setDialog({ project: null })} />
                  ) : (
                    <>
                      <div className="conv-head">
                        <h2>{heading}</h2>
                        {project && project.id !== "general" && (
                          <button type="button" className="pill pill-link" title={`Open the project ${project.name}`} onClick={() => setView({ kind: "project", id: project.id })}>{project.name}</button>
                        )}
                        {conversation?.jira && (S?.jira?.connected
                          ? <button type="button" className="pill pill-link jira-key" title={`This conversation is working on ${conversation.jira}. Open the ticket.`} onClick={() => setTicketOpen(conversation.jira!)}>{conversation.jira}</button>
                          : <span className="pill jira-key" title={`This conversation is working on ${conversation.jira}`}>{conversation.jira}</span>)}
                        {conversation?.suggest && suggested && (
                          <span className="conv-suggest">It used {suggested.name}'s folder.
                            <button type="button" className="linkish" onClick={() => moveTo(conversation.id, suggested.id)}>Move it to {suggested.name}</button>
                          </span>
                        )}
                      </div>
                      {/* Where its branch stands and the next step (one strip per worktree; none while it has nothing to step through). */}
                      {conversation && (Object.keys(conversation.workspaces ?? {}).length
                        ? Object.entries(conversation.workspaces!).map(([link, w]) => (
                            <NextStep key={w.path} ws={{ link, ...w }} pr={(S?.prs ?? []).find((p) => p.path === w.path)} running={!!activity[conversation.id]?.running} status={conversation.status}
                              title={conversation.title} ticket={conversation.jira} lastRun={conversation.expeditions.at(-1)} />
                          ))
                        : <NextStep running={!!activity[conversation.id]?.running} status={conversation.status} title={conversation.title} lastRun={conversation.expeditions.at(-1)} />)}
                      <Feed store={store} onReply={onReply} onExample={onExample} view={view} past={past} waiting={waiting} plain={plainPage} />
                    </>
                  )}
                  {/* The message box belongs to conversations: the pages (Projects, a project, Jira, the wiki) don't have one. */}
                  {S && !page && <Waiting S={S} refresh={refresh} onOpen={(id) => setView({ kind: "conversation", id })} />}
                  </ZoneBoundary>
                  {/* What the page has to say back (nothing to rate, a file it couldn't find, "queued"). All activity shows these in the feed itself. */}
                  {!inAll && <StatusLine />}
                  <ZoneBoundary name="The message box">
                    <Composer ref={composer} S={S} store={store} refresh={refresh} patch={patch} context={context}
                      onSent={onSent} onFolders={setAttached} draftKey={draftKey} hidden={!!page} />
                  </ZoneBoundary>
                </main>
              );
              case "files": return state === "collapsed"
                ? <FilesRail onShow={toggleFiles} />
                : <ZoneBoundary name="Files"><FilesPanel roots={fileRoots} refreshKey={running} onHide={toggleFiles} onMention={onMention} /></ZoneBoundary>;
              case "terminal": return state === "collapsed"
                ? <TerminalRail onShow={toggleTerminal} />
                : <ZoneBoundary name="The terminal"><TerminalPanel project={project?.id} onHide={toggleTerminal} ready={!!S} actions={S?.settings.termActions} onSetUp={setUpTerminal} /></ZoneBoundary>;
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
      {/* What opens over the page. One that can't be drawn leaves a small dialog to close, not a blank page. */}
      <Presence>{agentId && (
        <OverlayBoundary key={agentId} name="This agent's page" onClose={closeAgent}>
          <AgentDrawer agentId={agentId} tab={agentTab} setTab={setAgentTab} S={S} store={store} project={project?.id}
            pickerOpen={!!picker} onOpenPicker={openPicker} onClose={closeAgent} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{settings && (
        <OverlayBoundary name="Settings" onClose={closeSettings}>
          <Settings S={S} section={settings} setSection={setSection} refresh={refresh} onAttachLink={onAttachLink} onClose={closeSettings} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{layoutEditor && (
        <OverlayBoundary name="The layout editor" onClose={closeLayoutEditor}>
          <LayoutEditor layout={layout} onChange={setLayout} onClose={closeLayoutEditor} select={layoutEditor.select} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{crewDialog && (
        <OverlayBoundary key={crewDialog.member?.id ?? "new"} name="The crew dialog" onClose={closeCrewDialog}>
          <CrewDialog member={crewDialog.member} onClose={closeCrewDialog} onSaved={() => { setCrewDialog(null); refresh(); }} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{dialog && (
        <OverlayBoundary key={dialog.project?.id ?? "new"} name="The project dialog" onClose={closeDialog}>
          <ProjectDialog S={S} project={dialog.project} onClose={closeDialog} onSaved={onProjectSaved} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{ticketOpen && S && (
        <OverlayBoundary key={ticketOpen} name="This ticket" onClose={closeTicket}>
          <JiraTicket id={ticketOpen} summary="" onClose={closeTicket} onOpen={setTicketOpen} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{wizard && S && (
        <OverlayBoundary key={wizard.ticket?.key ?? "pick"} name="The ticket kickoff" onClose={closeWizard}>
          <TicketWizard S={S} start={wizard.ticket} onClose={closeWizard}
            onStarted={(thread) => { setWizard(null); refresh(); setView({ kind: "conversation", id: thread }); }} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{palette && (
        <OverlayBoundary name="The command palette" onClose={closePalette}>
          <Palette items={paletteItems} roots={fileRoots} start={palette.start} onOpenFile={openFile} onClose={closePalette} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{opened && (
        <OverlayBoundary key={`${opened.root.link}|${opened.rel}`} name="This file" onClose={closeOpened}>
          <FileViewer root={opened.root} rel={opened.rel} line={opened.line} onClose={closeOpened} onMention={(p) => { onMention(p); setOpened(null); }} />
        </OverlayBoundary>
      )}</Presence>
      {picker && picking && S && (
        <OverlayBoundary key={picker.id} name="The model picker" onClose={closePicker}>
          <ModelPicker c={picking} runtime={S.runtime} at={picker} onClose={closePicker} onSaved={() => { closePicker(); refresh(); }} />
        </OverlayBoundary>
      )}
    </>
  );
}
