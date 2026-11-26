// Mission control: the crew across the top, your history of conversations on the left, and the
// conversation you're in (with the composer) beside it. An agent's page opens as a drawer over
// it; Settings (with the camp's records) over everything.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storeGet, storeSet } from "./api.ts";
import { useCampEvents, useCampState } from "./camp.ts";
import { AgentDrawer, type AgentTab } from "./components/AgentDrawer.tsx";
import { Composer, type ComposerHandle, type SendContext } from "./components/Composer.tsx";
import { Dock } from "./components/Dock.tsx";
import { History, HistoryRail } from "./components/History.tsx";
import { TerminalRail } from "./components/TerminalRail.tsx";
import { CAMP_FILES, FilesPanel, FilesRail, type FileRoot } from "./components/Files.tsx";
import { NotesPanel, NotesRail, PickToNote } from "./components/Notes.tsx";
import { appendToNote, loadNotes, newNote, noteFile, notesNow, openNote, titleOf, useNotes } from "./notes.ts";
import { LayoutFrame, type ZoneState } from "./components/Zones.tsx";
import { LayoutEditor } from "./components/LayoutEditor.tsx";
import { focusPlan, loadLayout, PANELS, placed, saveLayout, type Layout, type Panel, type Part } from "./layout.ts";
import { Presence } from "./motion.tsx";
import { hear, COMMANDS } from "./bus.ts";
import { Palette, type PaletteItem } from "./components/Palette.tsx";
import { VoiceOn } from "./components/ReadAloud.tsx";
import { FileViewer } from "./components/FileViewer.tsx";
import { JiraTicket, type TicketStart } from "./components/JiraPage.tsx";
import { DraftTicketsDialog, MaeTicketDialog, TicketsPage } from "./components/TicketsPage.tsx";
import { closeDrafting, closeTicket as closeMaeTicket, loadTickets, showTicket, useTickets } from "./tickets.ts";
import { TicketWizard } from "./components/TicketWizard.tsx";
import { MemoryHome } from "./components/MemoryHome.tsx";
import { ActivityPage, activityTabs } from "./components/ActivityPage.tsx";
import { ReleaseNotes } from "./components/ReleaseNotes.tsx";
import { treeQuery } from "./api.ts";
import { runningCount } from "./feed/reducer.ts";
import { ProjectDialog } from "./components/ProjectDialog.tsx";
import { CrewDialog } from "./components/CrewDialog.tsx";
import { cx, handleOf, leadName, setCrewColors } from "./format.ts";
import { useSeason, wearPack } from "./themes.ts";
import { setWords, w, a as an } from "./words.ts";
import { ProjectPage, ProjectsOverview } from "./components/Projects.tsx";
import { Home } from "./components/Home.tsx";
import { api, errorText } from "./api.ts";
import type { History as HistoryData, Project, SendResult } from "./types.ts";
import { homeProject, latestLiveRun, parseView, usePast, type ActivityTab, type View } from "./feed/conversation.ts";
import { useFeed } from "./feed/store.ts";
import { Crew } from "./components/Crew.tsx";
import { Header } from "./components/Header.tsx";
import { ErrorBoundary, OverlayBoundary, ZoneBoundary } from "./components/ErrorBoundary.tsx";
import { StatusLine, tell, complain } from "./components/StatusLine.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { Feed } from "./feed/Feed.tsx";
import { DETAIL_KEY, parseDetail, type FeedDetail } from "./feed/condense.ts";
import { NextStep, WorkStrip, type Place } from "./feed/NextStep.tsx";
import { Waiting } from "./components/Waiting.tsx";
import { inboxCount } from "./inbox.ts";
import { loadSeen, markSeen, needsOf, seenAll, type Need } from "./needs.ts";
import { activityOf } from "./feed/conversation.ts";
import { isSettingsSection, settingsGroups, type SettingsSection } from "./settings/sections.ts";
import type { FeedStore } from "./feed/store.ts";
import type { Character, Link, Note } from "./types.ts";
import { ask, ConfirmHost } from "./components/Confirm.tsx";
import { useKonami } from "./egg/konami.ts";

// The big pieces that not every visit opens load when they're first opened, each its own script:
// the terminal (xterm.js is a quarter of the page's code), Orbit, Settings, and the game. Until
// one arrives (a moment, from this machine) nothing shows in its place.
const TerminalPanel = lazy(() => import("./components/Terminal.tsx").then((m) => ({ default: m.TerminalPanel })));
const Orbit = lazy(() => import("./orbit/Orbit.tsx").then((m) => ({ default: m.Orbit })));
const Trail = lazy(() => import("./trail/Trail.tsx").then((m) => ({ default: m.Trail })));
const Settings = lazy(() => import("./settings/Settings.tsx").then((m) => ({ default: m.Settings })));
const Barnstorm = lazy(() => import("./egg/Barnstorm.tsx").then((m) => ({ default: m.Barnstorm })));
// Decorations (Settings → General): only for looks, and loaded only while one is on. If one ever
// fails to draw, the page simply goes without it.
// What shows while one of those arrives: a quiet word, in the middle of the page (or of its panel).
function LazyWait({ inline }: { inline?: boolean }) {
  return <div className={cx("lazy-wait", inline && "inline")} role="status">Loading…</div>;
}
const Decor = lazy(() => import("./components/Decor.tsx").then((m) => ({ default: m.Decor })));
function Decorations() {
  const season = useSeason();
  return season ? <ErrorBoundary fallback={() => null}><Suspense fallback={null}><Decor season={season} /></Suspense></ErrorBoundary> : null;
}

export function App({ store }: { store: FeedStore }) {
  // Settings opens over everything; the last section is remembered. (While it's open, refreshes
  // bring the records it shows; the rest of the time they're left out.)
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // Which conversation (or page) the middle of the screen shows (remembered across reloads).
  const [view, setViewState] = useState<View>(() => parseView(storeGet("camp-view")));
  // The camp's records (memories, the wiki, the quest log…) come along while something that shows them is open.
  const [palette, setPalette] = useState<{ start: string } | null>(null); // the command palette (below)
  const [jiraKey, setJiraKey] = useState<string | null>(null); // a Jira ticket picked in the palette, for the Tickets page to open
  const { S, refresh, patch, stale } = useCampState(!!settings || !!palette || view.kind === "memory" || view.kind === "activity");
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

  // Orbit (orbit/Orbit.tsx): the crew at work as a solar system, over the whole page. Going anywhere on the page leaves it.
  // "demo": opened on its demo, a pretend camp at work (/orbit demo).
  const [orbit, setOrbit] = useState<false | "live" | "demo">(false);
  // The trail map (trail/Trail.tsx): the Quartermaster's plan as a trail, over the whole page. It and Orbit take the same
  // place, so opening one closes the other.
  const [trail, setTrail] = useState(false);
  const [trailPick, setTrailPick] = useState<string | undefined>(); // the run whose plan it opens on: a plan card's "Full screen" names its own
  // The memory map (constellation/Constellation.tsx) is Memory's Map view, drawn in that page. This is whether it's
  // over the whole page: its own "Full screen" does that, and /constellation opens it that way.
  const [mapFull, setMapFull] = useState(false);
  // One of the three is over the page at a time. Orbit is in the Views menu in the top bar; the trail map opens from a
  // plan card (or /trail), the memory map from Memory → Map (or /constellation).
  const toggleOrbit = useCallback(() => { setTrail(false); setMapFull(false); setOrbit((on) => (on ? false : "live")); }, []);
  const closeOrbit = useCallback(() => setOrbit(false), []);
  const closeTrail = useCallback(() => setTrail(false), []);
  // Leaving full screen leaves you on Memory → Map, with the map as you left it.
  const openMap = useCallback(() => { setSettings(null); setOrbit(false); setTrail(false); setViewState({ kind: "memory", tab: "map" }); storeSet("camp-view", JSON.stringify({ kind: "memory", tab: "map" })); setMapFull(true); }, []);

  const setView = useCallback((v: View) => {
    setOrbit(false);
    setTrail(false);
    setMapFull(false);
    setViewState(v);
    storeSet("camp-view", JSON.stringify(v));
    if (v.kind !== "memory" && v.kind !== "activity") composer.current?.focus(); // (their tabs keep the focus they were given)
  }, []);
  const thread = view.kind === "conversation" ? view.id : null;
  const past = usePast(thread);
  const liveRun = useFeed(store, (s) => (thread ? latestLiveRun(s.items, thread) : undefined));
  const conversation = thread ? S?.history.conversations.find((c) => c.id === thread) : undefined;
  // (From Today, what you send starts in the project you last worked in.)
  const project = S?.history.projects.find((p) => p.id === (view.kind === "new" ? view.project : view.kind === "home" ? homeProject(S?.history) : view.kind === "project" ? view.id : conversation?.project));
  // A project's page, or the list of them (also where a deleted project's page lands).
  const page = view.kind === "memory" ? "memory" : view.kind === "activity" ? "activity" : view.kind === "tickets" ? "tickets" : view.kind === "releases" ? "releases"
    : view.kind === "project" && project ? "project" : view.kind === "project" || view.kind === "projects" ? "projects" : null;
  // The ticket kickoff stepper: open, and on which ticket if one was already picked.
  const [wizard, setWizard] = useState<{ ticket?: TicketStart } | null>(null);
  const closeWizard = useCallback(() => setWizard(null), []);
  const [ticketOpen, setTicketOpen] = useState<string | null>(null); // a conversation's ticket, opened over it
  const closeTicket = useCallback(() => setTicketOpen(null), []);
  // The Outpost's own tickets (tickets.ts): read on arriving and on coming back to the window; the camp's change events keep them current between.
  const tickets = useTickets();
  useEffect(() => {
    void loadTickets();
    const again = () => void loadTickets();
    addEventListener("focus", again);
    return () => removeEventListener("focus", again);
  }, []);
  // What you send follows the conversation you're in; on a new page it starts one (in that project).
  const context = useMemo<SendContext | undefined>(() => {
    if (view.kind === "conversation") return { replyTo: liveRun ?? conversation?.expeditions.at(-1), live: liveRun, placeholder: "Reply in this conversation…", // In a project: its folders, and any others this conversation was given along the way.
      ...(project && project.id !== "general" ? { folders: [...new Set([...(project.links ?? []), ...(conversation?.links ?? []), ...Object.keys(conversation?.workspaces ?? {}).filter((l) => !conversation?.without?.includes(l))])] } : {}),
      ...(conversation?.workspaces ? { working: Object.fromEntries(Object.entries(conversation.workspaces).map(([l, w]) => [l, w.branch])) } : {}),
      ...(conversation?.without?.length ? { without: conversation.without } : {}) };
    if (view.kind === "all") return undefined;
    // A new page: what you send starts a conversation (in that project, if it's a project's).
    const inProject = project && project.id !== "general" && (view.kind === "home" || (view.kind === "new" && !!view.project));
    return {
      project: inProject ? project.id : undefined,
      placeholder: inProject ? `Start a conversation in ${project.name}…` : `Ask a model anything, or start with @ to bring in the ${w("crew")}…`,
      // In a project, the "work in" picker offers that project's folders only.
      ...(inProject ? { folders: project.links ?? [], newWorktree: project.settings?.workIn === "worktree" } : {}),
    };
  }, [view, liveRun, conversation, project]);
  const heading = view.kind === "all" ? "All runs" : view.kind === "new" ? "New conversation" : conversation?.title ?? "Conversation";
  const waiting = view.kind === "conversation" && S && !conversation ? "This one is waiting its turn. It shows up here when it starts."
    : view.kind === "new" && project && view.project && project.id !== "general" ? `It will be filed under ${project.name}. Ask the ${leadName()} for something, or @ ${an("crew")} member directly.`
    : view.kind === "new" ? `Outside a project this is a plain chat: what you ask goes straight to the model named beside the message box, with nobody from the ${w("crew")} involved. To put the ${w("crew")} on it, start your message with @ (for example @${handleOf({ id: "quartermaster", name: leadName() })}), or work in a project.`
    : undefined;
  // What a blank page offers to start from: a plain question outside a project, crew work inside one.
  const plainPage = view.kind === "new" && !(project && view.project && project.id !== "general");

  // The terminal pane along the bottom: shown or hidden (remembered), toggled with Ctrl+`.
  // The feed condensed (behind-the-scenes work folded, the default) or detailed (every line).
  const [detail, setDetailState] = useState<FeedDetail>(() => parseDetail(storeGet(DETAIL_KEY)));
  const setDetail = useCallback((d: FeedDetail) => { setDetailState(d); storeSet(DETAIL_KEY, d); }, []);
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

  // Your notes, in a panel of their own (components/Notes.tsx): shown or closed to a tab (remembered).
  const [notesOpen, setNotesOpen] = useState(() => storeGet("camp-notes-open") === "1");
  const showNotes = useCallback((on: boolean) => { setNotesOpen(on); storeSet("camp-notes-open", on ? "1" : "0"); }, []);
  const toggleNotes = useCallback(() => setNotesOpen((on) => { storeSet("camp-notes-open", on ? "0" : "1"); return !on; }), []);

  // History closes to a tab too (remembered).
  // On a narrow page, where it would sit above the conversation, it starts closed unless you've opened it.
  const [historyOpen, setHistoryOpen] = useState(() => {
    const kept = storeGet("camp-history-open");
    return kept ? kept !== "0" : !(typeof matchMedia === "function" && matchMedia("(max-width: 860px)").matches);
  });
  const toggleHistory = useCallback(() => setHistoryOpen((on) => { storeSet("camp-history-open", on ? "0" : "1"); return !on; }), []);

  // The page's layout: zones you arrange in the layout editor (remembered in this browser).
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const setLayout = useCallback((next: Layout) => { setLayoutState(next); saveLayout(next); }, []);
  const [layoutEditor, setLayoutEditor] = useState<{ select?: string } | null>(null);
  const closeLayoutEditor = useCallback(() => setLayoutEditor(null), []);
  // History, Files, Notes and the terminal each close to a slim tab; Files has nothing to show without a folder.
  const stateOf = (part: Part | null): ZoneState =>
    part === "terminal" ? (terminal ? "shown" : "collapsed") : part === "history" ? (historyOpen ? "shown" : "collapsed")
    : part === "notes" ? (notesOpen ? "shown" : "collapsed")
    : part === "files" ? (!hasFiles ? "hidden" : files ? "shown" : "collapsed") : "shown";
  const hasNotes = placed(layout, "notes");

  // Keep something in a note: the note open in the panel, or (fresh, or with none open) a new
  // one, which remembers the conversation it came from. The panel opens to show it.
  const noteIt = (said: string, fresh?: boolean) => {
    const text = said.trim();
    if (!text) return;
    const N = notesNow();
    const target = !fresh && hasNotes && notesOpen ? N.notes.find((n) => n.id === N.open) : undefined;
    if (target) appendToNote(target.id, text);
    else newNote({ text, from: conversation ? { conversation: conversation.id, title: conversation.title } : undefined });
    if (hasNotes) showNotes(true);
    tell(store, `${target ? `Added to the note “${titleOf(target)}”` : "Kept in a new note"}${hasNotes ? "" : ". Notes has no zone in your layout: give it one with /layout to see it."}`);
  };

  // Focus mode: close whichever of those panels are open, leaving the conversation. Leaving
  // focus brings back the ones it closed (remembered, so it survives a reload).
  const openNow = PANELS.filter((p) => placed(layout, p) && stateOf(p) === "shown");
  const focused = openNow.length === 0;
  const toggleFocus = () => {
    const set = (part: Panel, on: boolean) => {
      if (part === "history") { setHistoryOpen(on); storeSet("camp-history-open", on ? "1" : "0"); }
      if (part === "files") { setFiles(on); storeSet("camp-files-open-pane", on ? "1" : "0"); }
      if (part === "notes") showNotes(on);
      if (part === "terminal") { setTerminal(on); storeSet("camp-term-open", on ? "1" : "0"); }
    };
    const plan = focusPlan(openNow, storeGet("camp-focus-closed"));
    if (plan.close.length) storeSet("camp-focus-closed", plan.close.join(","));
    for (const p of plan.close) set(p, false);
    for (const p of plan.reopen) set(p, true);
  };

  // ---------- Getting about from the keyboard ----------
  // The command palette (⌘P / Ctrl+P), and a file opened over the page from it or from a path in an answer.
  const closePalette = useCallback(() => setPalette(null), []);
  const [opened, setOpened] = useState<{ root: FileRoot; rel: string; line?: number } | null>(null);
  const closeOpened = useCallback(() => setOpened(null), []);
  const openFile = useCallback((root: FileRoot, rel: string, line?: number) => setOpened({ root, rel, line }), []);
  const asks = useFeed(store, (s) => s.asks);

  // Everything that needs you, wherever it is (needs.ts). Having a conversation open marks what's in it as seen.
  const activity = useFeed(store, activityOf);

  // A conversation's worktrees, and where each stands: one strip under its title (WorkStrip) and,
  // with more than one repository, each one's own on its row in Files. A click in either looks again at both.
  const worktrees = useMemo<Place[]>(() => Object.entries(conversation?.workspaces ?? {}).map(([link, w]) => ({ link, ...w })), [conversation?.workspaces]);
  const [stepLooks, setStepLooks] = useState(0);
  const stepChanged = useCallback(() => setStepLooks((n) => n + 1), []);
  const showFiles = useCallback(() => setFiles(() => { storeSet("camp-files-open-pane", "1"); return true; }), []);
  const convRunning = !!(conversation && activity[conversation.id]?.running);
  const worktreeStep = useMemo(() => {
    if (!conversation || worktrees.length < 2) return undefined;
    return (root: FileRoot) => {
      const w = worktrees.find((x) => x.link === root.link && x.path === root.path);
      return w ? <NextStep key={w.path} compact ws={w} pr={(S?.prs ?? []).find((p) => p.path === w.path)} running={convRunning} status={conversation.status}
        title={conversation.title} ticket={conversation.jira} lastRun={conversation.expeditions.at(-1)} refresh={stepLooks} onChanged={stepChanged} /> : null;
    };
  }, [conversation, worktrees, S?.prs, convRunning, stepLooks, stepChanged]);
  const [seen, setSeen] = useState(loadSeen);
  useEffect(() => {
    if (!conversation) return;
    setSeen((was) => markSeen(was, conversation, new Set(S?.history.conversations.map((c) => c.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.updated]);
  const needs = useMemo(() => needsOf({ conversations: S?.history.conversations ?? [], prs: S?.prs, queued: S?.queued, activity, seen, viewing: thread }),
    [S?.history.conversations, S?.prs, S?.queued, activity, seen, thread]);
  // The inbox's one count (inbox.ts): the header, the sidebar, Today and the Inbox all show this.
  const inbox = useMemo(() => inboxCount(S, needs, asks.length), [S, needs, asks.length]);
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
    tell(store, own ? `Couldn't find ${raw} in the ${w("camp")} folder.` : `Couldn't find ${raw} in the folders attached here.`, true);
  };

  // /good and /bad: rate the latest finished answer in this conversation.
  const rate = async (rating: "up" | "down", note?: string) => {
    const id = conversation?.status !== "running" ? conversation?.expeditions.at(-1) : conversation.expeditions.at(-2);
    if (!id) return tell(store, "There's no finished answer here to rate yet.");
    try { await api("/api/feedback", { id, rating, note: note || undefined }); tell(store, `Rated ${rating === "up" ? "👍" : "👎"}${note ? `: ${note}` : ""}`); }
    catch (e) { tell(store, errorText(e), true); }
  };

  // Today (the logo, and /today).
  const goHome = useCallback(() => { setSettings(null); setView({ kind: "home" }); }, [setView]);
  // One of your notes, picked on Today: the Notes panel opens on it.
  const showNote = (id: string) => {
    openNote(id);
    if (hasNotes) showNotes(true); else { tell(store, "Notes has no zone in your layout yet: pick one for it here."); setLayoutEditor({}); }
  };
  // One place for everything a typed /command, the palette, or a shortcut can ask for.
  const command = (name: string, arg?: string) => {
    if (name === "today") goHome();
    else if (name === "orbit") { setTrail(false); setMapFull(false); setOrbit(arg?.trim().toLowerCase() === "demo" ? "demo" : "live"); }
    else if (name === "trail") { setOrbit(false); setMapFull(false); setTrailPick(arg?.trim() || undefined); setTrail(true); }
    else if (name === "new") setView(project && project.id !== "general" ? { kind: "new", project: project.id } : { kind: "new" });
    else if (name === "focus") toggleFocus();
    else if (name === "files") { if (hasFiles) toggleFiles(); else tell(store, "No folder is attached here, so there are no files to show."); }
    else if (name === "terminal") toggleTerminal();
    else if (name === "history") toggleHistory();
    else if (name === "notes") { if (hasNotes) toggleNotes(); else { tell(store, "Notes has no zone in your layout yet: pick one for it here."); setLayoutEditor({}); } }
    else if (name === "note") { if (arg?.trim()) noteIt(arg, true); else { newNote(); if (hasNotes) showNotes(true); } }
    else if (name === "find") setPalette({ start: arg ?? "" });
    else if (name === "next") { if (asks.length || !needs.length) nextDecision(); else goToNeed(needs[0]); }
    else if (name === "good") void rate("up", arg);
    else if (name === "bad") void rate("down", arg);
    else if (name === "layout") setLayoutEditor({});
    else if (name === "settings") openSettings();
    else if (name === "connectors") openSettings("connectors");
    else if (name === "tickets") { setSettings(null); setView({ kind: "tickets" }); }
    else if (name === "memory" || name === "wiki") { setSettings(null); setView(arg?.trim() ? { kind: "memory", tab: "member", member: arg.trim() } : { kind: "memory" }); }
    else if (name === "constellation") openMap();
    else if (name === "ticket") setWizard({});
  };
  // The newest of each, for the listeners and the handlers below that are set up once.
  const act = useRef({ command, openPath, toggleFocus, goToNeed, noteIt });
  act.current = { command, openPath, toggleFocus, goToNeed, noteIt };
  useEffect(() => hear((ask) => {
    if (ask.do === "command") act.current.command(ask.name, ask.arg);
    else if (ask.do === "open-file") { setSettings(null); void act.current.openPath(ask.path, ask.line); } // (Settings steps aside: the file opens over the page)
    else if (ask.do === "open-conversation") { setSettings(null); setView({ kind: "conversation", id: ask.id }); }
    else if (ask.do === "note") act.current.noteIt(ask.text, ask.fresh);
    else if (ask.do === "compose") { if (ask.replyTo) composer.current?.setReply(ask.replyTo, ask.task ?? ""); composer.current?.setText(ask.text); }
    else if (ask.do === "send") void (composer.current?.send(ask.text) ?? Promise.resolve(null)).then((how) => ask.sent?.(how));
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
  useEffect(() => { if (palette) { void loadNotes(); void loadTickets(); } }, [!!palette]); // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useNotes();
  const paletteItems = useMemo<PaletteItem[]>(() => !palette || !S ? [] : [
    ...COMMANDS.filter((c) => c.name !== "find" && c.name !== "good" && c.name !== "bad").map((c): PaletteItem => ({
      id: `do:${c.name}`, group: "Do", icon: c.name === "new" ? "plus" : c.name === "orbit" ? "orbit" : c.name === "trail" ? "trail" : c.name === "constellation" ? "constellation" : c.name === "memory" ? "layers" : c.name === "settings" ? "gear" : c.name === "layout" ? "layout" : c.name === "next" ? "check" : c.name === "terminal" ? "terminal" : c.name === "files" ? "panelRight" : c.name === "history" ? "list" : c.name === "notes" || c.name === "note" ? "note" : "focus",
      label: c.does, hint: `/${c.name}`, run: () => act.current.command(c.name),
    })),
    ...S.history.conversations.map((c): PaletteItem => ({
      id: `c:${c.id}`, group: "Conversations", icon: "reply", label: c.title, hint: S.history.projects.find((p) => p.id === c.project)?.name, run: () => setView({ kind: "conversation", id: c.id }),
    })),
    ...S.history.projects.filter((p) => p.id !== "general").map((p): PaletteItem => ({
      id: `p:${p.id}`, group: "Projects", icon: "folder", label: p.name, hint: (p.links ?? []).map((l) => `links/${l}`).join(", "), run: () => setView({ kind: "project", id: p.id }),
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    ...activityTabs(inbox.total).map((t): PaletteItem => ({ id: `a:${t.id}`, group: "Activity", icon: "activity", label: `Activity: ${t.label}`, hint: typeof t.title === "string" ? t.title : undefined, run: () => setView({ kind: "activity", tab: t.id }) })),
    ...settingsGroups().flatMap((g) => g.items.map(([id, label, icon]): PaletteItem => ({ id: `s:${id}`, group: "Settings", icon, label: `Settings: ${label}`, hint: g.title, run: () => openSettings(id) }))),
    ...tickets.tickets.map((t): PaletteItem => ({ id: `t:${t.key}`, group: "Tickets", icon: "flag", label: `${t.key}: ${t.title}`, hint: "Outpost", run: () => { setSettings(null); setView({ kind: "tickets" }); showTicket(t.key); } })),
    ...notes.notes.map((n): PaletteItem => ({ id: `n:${n.id}`, group: "Notes", icon: "note", label: titleOf(n), hint: "Note", run: () => showNote(n.id) })),
    ...(S.memory ?? []).flatMap((p) => p.lines.map((l, i): PaletteItem => ({
      id: `m:${p.where}:${i}`, group: "Memory", icon: "layers", label: l.text.length > 80 ? `${l.text.slice(0, 80).trimEnd()}…` : l.text, hint: p.name,
      run: () => { setSettings(null); setView(p.kind === "agent" ? { kind: "memory", tab: "member", member: p.where.slice(6) } : { kind: "memory", tab: "list" }); },
    }))),
  ], [palette, S?.history, S?.memory, tickets.tickets, notes.notes]);
  // Where you are, for the draft kept in the message box.
  const draftKey = view.kind === "conversation" ? `c:${view.id}` : view.kind === "new" ? `new:${view.project ?? ""}` : view.kind === "home" ? "home" : view.kind === "project" ? `p:${view.id}` : view.kind;

  // The crew dialog: a new crew member (the + at the end of the crew bar), or one you added being edited.
  const [crewDialog, setCrewDialog] = useState<{ member: Character | null } | null>(null);
  const closeCrewDialog = useCallback(() => setCrewDialog(null), []);
  // Colours of crew members you added, for their cards and messages anywhere on the page.
  useMemo(() => { setCrewColors(S?.characters ?? [], S?.packs, S?.packNamesBefore); setWords(S?.pack, S?.packs); if (S) wearPack(S.pack, S.packs); }, [S?.characters, S?.pack, S?.packs, S?.packNamesBefore]);

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
    } catch (e) { complain(errorText(e)); }
  }, [patch]);
  const deleteProject = useCallback(async (p: Project) => {
    if (!await ask({ title: `Delete the project "${p.name}"?`, body: "Its conversations move to General. The folder itself isn't touched.", action: "Delete project", danger: true })) return;
    try {
      const r = await api<{ history: HistoryData }>("/api/history", { action: "project.remove", id: p.id });
      patch((s) => ({ ...s, history: r.history }));
      setView({ kind: "projects" });
    } catch (e) { complain(errorText(e)); }
  }, [patch, setView]);

  // Where you were last talking (a conversation, or a new one): where "Attach to message" on a page takes you back to.
  const talking = useRef<View>({ kind: "new" });
  if (view.kind === "conversation" || view.kind === "new" || view.kind === "all") talking.current = view;
  const attachTicket = (issue: { key: string; summary: string }) => {
    composer.current?.attachJira(issue);
    setView(talking.current.kind === "all" ? { kind: "new" } : talking.current);
  };

  // The easter egg: a plane to fly over the page, from its button in the top bar or the Konami code.
  // It can be paused and picked up again later: the plane in the top bar is play and pause, and a
  // paused game keeps everything about itself until it's resumed (or landed, from its pill).
  const [barnstorm, setBarnstorm] = useState<"off" | "on" | "paused">("off");
  const toggleBarnstorm = useCallback(() => setBarnstorm((was) => (was === "on" ? "paused" : "on")), []);
  const pauseBarnstorm = useCallback(() => setBarnstorm("paused"), []);
  const resumeBarnstorm = useCallback(() => setBarnstorm("on"), []);
  const endBarnstorm = useCallback(() => setBarnstorm("off"), []);
  useKonami(resumeBarnstorm); // (the code starts it, and resumes it if it's paused)

  const onReply = useCallback((expId: string, task: string) => composer.current?.setReply(expId, task), []);
  const onExample = useCallback((text: string) => composer.current?.setText(text), []);
  const onAttachLink = useCallback((link: Link) => composer.current?.attachLink(link), []);
  const onInsertNote = useCallback((text: string) => composer.current?.insert(text), []);
  const onAttachNote = useCallback((note: Note) => composer.current?.attachFiles([noteFile(note)]), []);
  // The project the Notes panel works for (a ticket is written from its code; ideas are suggested for it): none, outside one.
  const notesProject = useMemo(() => (project && project.id !== "general" ? { id: project.id, name: project.name } : undefined), [project?.id, project?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPickToNote = useCallback((text: string, fresh: boolean) => act.current.noteIt(text, fresh), []);
  const openConversation = useCallback((id: string) => setView({ kind: "conversation", id }), [setView]);

  // What the header, history, the terminal and the message box are handed. Each is the same
  // function from one draw of the page to the next, so those parts (memo'd) are only drawn again
  // when something they show has changed, not every time a word arrives in the feed.
  const onToggleFocus = useCallback(() => act.current.toggleFocus(), []);
  const onSeenAll = useCallback(() => setSeen(seenAll()), []);
  const openLayout = useCallback(() => setLayoutEditor({}), []);
  const openActivity = useCallback((tab: ActivityTab) => { setSettings(null); setView({ kind: "activity", tab }); }, [setView]);
  const openInbox = useCallback(() => openActivity("inbox"), [openActivity]);
  const startTicket = useCallback(() => setWizard({}), []);
  const newProject = useCallback(() => setDialog({ project: null }), []);
  const editProject = useCallback((p: Project) => setDialog({ project: p }), []);
  const setUpTerminal = useCallback(() => openSettings("terminal"), [openSettings]);
  const inAll = view.kind === "all"; // All runs stays put when you send; anywhere else goes to the conversation
  const onSent = useCallback((r: SendResult) => { if (!inAll) setView({ kind: "conversation", id: r.thread }); }, [inAll, setView]);

  return (
    <VoiceOn.Provider value={!!S?.voice?.connected}>
      <div className="app">
        <ZoneBoundary name="The top bar">
          <Header S={S} store={store} conn={conn} stale={stale} refresh={refresh} onOpenSettings={openSettings} onOpenActivity={openActivity} focused={focused} onToggleFocus={onToggleFocus}
            onOpenLayout={openLayout} inbox={inbox} barnstorm={barnstorm} onBarnstorm={toggleBarnstorm} onHome={goHome} orbit={!!orbit} onOrbit={toggleOrbit} />
        </ZoneBoundary>
        <LayoutFrame layout={layout} onChange={setLayout} className="zones" stateOf={(z) => stateOf(z.part)} animate>
          {(zone, state) => {
            switch (zone.part) {
              // Each zone keeps its own trouble: one that can't be drawn says so in its own space,
              // and the rest of the page (the message box above all) carries on.
              case "roster": return (
                <ZoneBoundary name={`The ${w("crew")} bar`}>
                  <Crew S={S} store={store} pickerFor={picker?.id ?? null} onOpenAgent={setAgentId} onOpenPicker={openPicker} onOpenQuest={openQuest}
                    onAdd={() => setCrewDialog({ member: null })} onEdit={(c) => setCrewDialog({ member: c })} />
                </ZoneBoundary>
              );
              case "history": return state === "collapsed" ? <HistoryRail onShow={toggleHistory} /> : (
                <ZoneBoundary name="Workspace">
                  <History S={S} store={store} view={view} setView={setView} patch={patch} onHide={toggleHistory} needs={needs} inbox={inbox}
                    onStartTicket={startTicket} onNewProject={newProject} onEditProject={editProject} />
                </ZoneBoundary>
              );
              case "chat": return (
                <main className="mission">
                  {/* Going somewhere else gives it another go: the trouble may be one conversation's. */}
                  <ZoneBoundary name={page ? "This page" : "This conversation"} resetKey={draftKey}>
                  {page === "project" && S && project ? (
                    <ProjectPage key={project.id} S={S} store={store} project={project} setView={setView} refresh={refresh} patch={patch} onEdit={(p) => setDialog({ project: p })} onDelete={deleteProject} />
                  ) : page === "tickets" && S ? (
                    <TicketsPage S={S} onAttach={attachTicket} refresh={refresh} openKey={jiraKey} onOpened={() => setJiraKey(null)} onStart={(t) => setWizard({ ticket: t })} onKickoff={() => setWizard({})} />
                  ) : page === "memory" && S && view.kind === "memory" ? (
                    <MemoryHome S={S} tab={view.tab ?? "list"} member={view.member} page={view.page} setView={setView} refresh={refresh} mapFull={mapFull} onMapFull={setMapFull} onOpenConversation={openConversation} onOpenSettings={() => openSettings("memory")} onOpenInbox={openInbox} />
                  ) : page === "activity" && S && view.kind === "activity" ? (
                    <ActivityPage S={S} store={store} tab={view.tab ?? "usage"} setTab={(tab) => setView({ kind: "activity", tab })} refresh={refresh} onOpenSettings={openSettings} setView={setView}
                      needs={needs} inbox={inbox} onSeenAll={onSeenAll} onStartTicket={(t) => setWizard({ ticket: t })} />
                  ) : page === "releases" ? (
                    <ReleaseNotes />
                  ) : page === "projects" && S ? (
                    <ProjectsOverview S={S} setView={setView} onNew={() => setDialog({ project: null })} />
                  ) : view.kind === "home" && !S ? (
                    // Today's page, before the camp has answered: its heading, and nothing to mislead under it.
                    <><div className="conv-head"><h2>Today</h2></div><div className="feed" /></>
                  ) : view.kind === "home" && S ? (
                    <Home S={S} setView={setView} onStartTicket={(t) => setWizard({ ticket: t })} onOpenNote={showNote} onOpenMemory={() => setView({ kind: "memory" })}
                      refresh={refresh} needs={needs} inbox={inbox} asks={asks.length} onOpenInbox={openInbox} onOpenSettings={openSettings} onExample={onExample} />
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
                        {conversation?.ticket && (
                          <button type="button" className="pill pill-link jira-key" title={`This conversation is working on ${conversation.ticket}. Open the ticket.`} onClick={() => showTicket(conversation.ticket!)}>{conversation.ticket}</button>
                        )}
                        {conversation && (
                          <span className="detail-switch" role="group" aria-label="How much of the work to show">
                            <button type="button" aria-pressed={detail === "condensed"} title="Fold tool calls and answered commands into one line each" onClick={() => setDetail("condensed")}>Condensed</button>
                            <button type="button" aria-pressed={detail === "detailed"} title="Show every tool call, command and approval" onClick={() => setDetail("detailed")}>Detailed</button>
                          </span>
                        )}
                        {conversation?.suggest && suggested && (
                          <span className="conv-suggest">It used {suggested.name}'s folder.
                            <button type="button" className="linkish" onClick={() => moveTo(conversation.id, suggested.id)}>Move it to {suggested.name}</button>
                          </span>
                        )}
                      </div>
                      {/* Where its branch stands and the next step: one strip, however many repositories it worked in
                          (each repository's own is on its row in Files); none while it has nothing to step through. */}
                      {conversation && (
                        <WorkStrip worktrees={worktrees} prs={S?.prs ?? []} running={!!activity[conversation.id]?.running} status={conversation.status}
                          title={conversation.title} ticket={conversation.jira} lastRun={conversation.expeditions.at(-1)}
                          refresh={stepLooks} onChanged={stepChanged} onShowRepos={showFiles} />
                      )}
                      <Feed key={S?.pack /* its cards are memoised: a new pack draws them again in its words */} store={store} onReply={onReply} onExample={onExample} view={view} past={past} waiting={waiting} plain={plainPage} stopInBox={view.kind === "conversation" ? liveRun : undefined} detail={detail} />
                    </>
                  )}
                  </ZoneBoundary>
                  {/* The foot of the pane floats over the thread, which scrolls underneath it (Dock.tsx). */}
                  <Dock>
                    {/* The message box belongs to conversations: the pages (Projects, a project, Jira, the wiki) don't have one. */}
                    {S && !page && <ZoneBoundary name="What's waiting"><Waiting S={S} onOpenInbox={openInbox} /></ZoneBoundary>}
                    {/* What the page has to say back (nothing to rate, a file it couldn't find, "queued"). All runs shows the ones it records in the feed itself. */}
                    <StatusLine skipFed={inAll} />
                    <ZoneBoundary name="The message box">
                      <Composer ref={composer} S={S} store={store} refresh={refresh} patch={patch} context={context}
                        onSent={onSent} onFolders={setAttached} draftKey={draftKey} hidden={!!page} />
                    </ZoneBoundary>
                  </Dock>
                </main>
              );
              case "files": return state === "collapsed"
                ? <FilesRail onShow={toggleFiles} />
                : <ZoneBoundary name="Files">
                    {/* On a narrow page the panel sits over everything: the rest is dimmed, and a press there closes it (styles.css). */}
                    <button type="button" className="files-scrim" aria-label="Hide the files" tabIndex={-1} onClick={toggleFiles} />
                    <FilesPanel roots={fileRoots} refreshKey={running} onHide={toggleFiles} onMention={onMention} rootExtra={worktreeStep} />
                  </ZoneBoundary>;
              case "notes": return state === "collapsed"
                ? <NotesRail onShow={toggleNotes} />
                : <ZoneBoundary name="Notes">
                    {/* On a narrow page the panel sits over everything, like Files: a press on the rest closes it. */}
                    <button type="button" className="notes-scrim" aria-label="Hide the notes" tabIndex={-1} onClick={toggleNotes} />
                    {/* A page with no message box (Projects, Jira, the wiki) has nowhere to send a note to. */}
                    <NotesPanel onHide={toggleNotes} onInsert={page ? undefined : onInsertNote} onAttach={page ? undefined : onAttachNote} onOpenConversation={openConversation} project={notesProject} />
                  </ZoneBoundary>;
              case "terminal": return state === "collapsed"
                ? <TerminalRail onShow={toggleTerminal} />
                : <ZoneBoundary name="The terminal"><Suspense fallback={<LazyWait inline />}><TerminalPanel project={project?.id} onHide={toggleTerminal} ready={!!S} actions={S?.settings.termActions} onSetUp={setUpTerminal} /></Suspense></ZoneBoundary>;
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
      {/* Orbit takes the whole page, and sits under what opens over the page: an agent's page opens over it, and it stays. */}
      <Presence>{orbit && (
        <OverlayBoundary name="Orbit" onClose={closeOrbit}>
          <Suspense fallback={<LazyWait />}><Orbit key={orbit} S={S} store={store} demo={orbit === "demo"} onClose={closeOrbit} onOpenAgent={setAgentId} onOpenConversation={openConversation}
            onOpenQuest={(q) => { setOrbit(false); openQuest(q); }} /></Suspense>
        </OverlayBoundary>
      )}</Presence>
      <Presence>{trail && (
        <OverlayBoundary name="The trail map" onClose={closeTrail}>
          <Suspense fallback={<LazyWait />}><Trail S={S} store={store} pick={trailPick} onClose={closeTrail} onOpenQuest={(q) => { setTrail(false); openQuest(q); }} /></Suspense>
        </OverlayBoundary>
      )}</Presence>
      {/* What opens over the page. One that can't be drawn leaves a small dialog to close, not a blank page. */}
      <Presence>{agentId && (
        <OverlayBoundary key={agentId} name={`This ${w("member")}'s page`} onClose={closeAgent}>
          <AgentDrawer agentId={agentId} tab={agentTab} setTab={setAgentTab} S={S} store={store} project={project?.id}
            pickerOpen={!!picker} onOpenPicker={openPicker} onClose={closeAgent} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{settings && (
        <OverlayBoundary name="Settings" onClose={closeSettings}>
          <Suspense fallback={<LazyWait />}><Settings S={S} section={settings} setSection={setSection} refresh={refresh} onAttachLink={onAttachLink} onClose={closeSettings} onOpenActivity={openActivity} /></Suspense>
        </OverlayBoundary>
      )}</Presence>
      <Presence>{layoutEditor && (
        <OverlayBoundary name="The layout editor" onClose={closeLayoutEditor}>
          <LayoutEditor layout={layout} onChange={setLayout} onClose={closeLayoutEditor} select={layoutEditor.select} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{crewDialog && (
        <OverlayBoundary key={crewDialog.member?.id ?? "new"} name={`The ${w("crew")} dialog`} onClose={closeCrewDialog}>
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
      {/* An Outpost ticket, and turning a note or a plan into tickets: opened from the Tickets page, a note, a plan card or a conversation. */}
      <Presence>{tickets.showing && S && (
        <OverlayBoundary key={"key" in tickets.showing ? tickets.showing.key : "new"} name="This ticket" onClose={closeMaeTicket}>
          <MaeTicketDialog S={S} onAttach={attachTicket} onStart={(t) => setWizard({ ticket: t })} onOpenConversation={openConversation} />
        </OverlayBoundary>
      )}</Presence>
      <Presence>{tickets.drafting && S && (
        <OverlayBoundary key={tickets.drafting.text.slice(0, 40)} name="Turning it into tickets" onClose={closeDrafting}>
          <DraftTicketsDialog S={S} ask={tickets.drafting.from || tickets.drafting.kind === "note" || !conversation ? tickets.drafting
            : { ...tickets.drafting, from: { kind: "plan", id: conversation.id, title: conversation.title }, project: tickets.drafting.project ?? conversation.project }}
            onFiled={(made) => tell(store, made.length === 1 ? `Filed ${made[0].key}: ${made[0].title}` : `Filed ${made.length} tickets: ${made[0].key} to ${made.at(-1)!.key}`)} />
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
          <Palette items={paletteItems} roots={fileRoots} start={palette.start} jira={!!S?.jira?.connected} onOpenJira={(k) => { setSettings(null); setView({ kind: "tickets" }); setJiraKey(k); }} onOpenFile={openFile} onClose={closePalette} />
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
      {/* Text selected in the thread: a small bar beside it, to keep it in a note or have it read aloud. */}
      {!page && <PickToNote active={hasNotes && notesOpen} onAdd={onPickToNote} />}
      {/* "Are you sure?", asked from anywhere on the page (ask() in Confirm.tsx). */}
      <ConfirmHost />
      <Decorations />
      {barnstorm !== "off" && (
        <OverlayBoundary name="Barnstorm" onClose={endBarnstorm}>
          <Suspense fallback={null}><Barnstorm paused={barnstorm === "paused"} onPause={pauseBarnstorm} onResume={resumeBarnstorm} onClose={endBarnstorm} /></Suspense>
        </OverlayBoundary>
      )}
    </VoiceOn.Provider>
  );
}
