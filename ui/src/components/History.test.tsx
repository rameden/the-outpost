// History on screen: conversations under their projects, what's running or waiting on you,
// opening one, starting a new one in a project, and moving one between projects.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cardsFor, cardsFrom, latestLiveRun, parseView, type View } from "../feed/conversation.ts";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent, CampState, History as HistoryData } from "../types.ts";
import { History, HistoryRail } from "./History.tsx";
import { ProjectDialog } from "./ProjectDialog.tsx";
import { ProjectPage } from "./Projects.tsx";

const conv = (id: string, title: string, project: string, more: object = {}) =>
  ({ id, title, project, created: "2026-11-10T09:00:00Z", updated: "2026-11-10T09:05:00Z", agent: "quartermaster", direct: false, expeditions: [id], status: "done", ...more });
const HISTORY: HistoryData = {
  projects: [{ id: "general", name: "General" }, { id: "p1", name: "mi-web-app", links: ["mi-web-app"], description: "The Meltwater web app. Use pnpm.", pins: ["links/mi-web-app/docs/arch.md"], settings: { web: "careful" } }],
  conversations: [conv("c1", "Rebuild the UI", "general"), conv("c2", "Fix the flaky test", "p1"), conv("c3", "What's new in memory research?", "general", { agent: "scout", direct: true })],
};
const S = {
  history: HISTORY, runtime: "claude-code", settings: { approval: "safe" }, sandbox: { available: true }, budgetUsd: null,
  characters: [{ id: "scout", name: "Scout", emoji: "🏹", model: "claude-sonnet-5-5" }],
  links: [{ name: "mi-web-app", path: "/Users/me/mi-web-app", access: "write", added: "" }, { name: "notes", path: "/Users/me/notes", access: "read", added: "" }],
} as unknown as CampState;
const PAGE = {
  notes: "- 2026-11-10 Tests live next to the code.", brief: "", usage: { runs: 3, cost: 1.5, week: 0.5, lastRun: "2026-11-10T09:00:00Z" },
  workspaces: [], changed: [{ path: "links/mi-web-app/src/a.ts", change: "modified", conversation: "c2", title: "Fix the flaky test" }],
  jobs: [{ name: "nightly-check", schedule: "daily 08:00", enabled: true }],
};

const posts: { path: string; body: any }[] = [];
beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(path).startsWith("/api/project?")) return new Response(JSON.stringify(PAGE), { status: 200 });
    if (String(path).startsWith("/api/models")) return new Response(JSON.stringify({ models: [{ id: "claude-haiku-5-5", name: "Claude Haiku 5.5", efforts: ["low"] }], live: true }), { status: 200 });
    if (String(path).startsWith("/api/history/search")) return new Response(JSON.stringify({ results: [{ id: "c2", snippet: "…the flaky parallel-edit guard…" }] }), { status: 200 });
    if (String(path) === "/api/project/survey") return new Response(JSON.stringify({ ok: true, id: "s1", thread: "s1", position: 0 }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, history: HISTORY }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

let seq = 0;
const ev = (body: object) => ({ ...body, seq: ++seq, time: new Date().toISOString() }) as CampEvent;
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };

function setup(view: View = { kind: "new" }) {
  const store = createFeedStore();
  const setView = vi.fn();
  const patch = vi.fn();
  const onNewProject = vi.fn();
  const onEditProject = vi.fn();
  render(<History S={S} store={store} view={view} setView={setView} patch={patch} onNewProject={onNewProject} onEditProject={onEditProject} />);
  const send = (...events: CampEvent[]) => act(() => { for (const e of events) store.apply(e); vi.advanceTimersByTime(20); });
  return { store, setView, patch, send, onNewProject, onEditProject };
}
const project = (name: string) => screen.getByRole("button", { name: name }).closest("section")!;

test("conversations sit under their projects, and opening one selects it", () => {
  const { setView } = setup({ kind: "conversation", id: "c2" });
  // The Quartermaster's conversation is listed; the chat with the Scout waits behind the Scout's name.
  expect(within(project("General")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Rebuild the UI⋯", "›@scout1"]);
  expect(within(project("mi-web-app")).getByRole("button", { name: /^Fix the flaky test/ }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: /^Rebuild the UI/ }));
  expect(setView).toHaveBeenCalledWith({ kind: "conversation", id: "c1" });
});

test("new conversations: a clean page, or one filed under a project", () => {
  const { setView } = setup();
  fireEvent.click(screen.getByRole("button", { name: /New conversation$/ }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "new" });
  fireEvent.click(screen.getByRole("button", { name: "New conversation in mi-web-app" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "new", project: "p1" });
  fireEvent.click(screen.getByRole("button", { name: /All activity/ }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "all" });
});

test("a conversation shows when something is running in it and how many decisions wait on you", () => {
  const { send } = setup();
  send(
    ev({ type: "expedition_start", id: "c2b", task: "And the other test", source: "user", thread: "c2", expeditionId: "c2b" }),
    ev({ type: "ask", id: "ask_1", kind: "plan", title: "Plan", body: "1. Fix it", expeditionId: "c2b" }),
  );
  const row = within(project("mi-web-app")).getByRole("listitem");
  expect(within(row).getByTitle("Something is running here")).toBeTruthy();
  expect(within(row).getByTitle("1 waiting for your decision").textContent).toBe("1");
  expect(screen.getByText("1 running")).toBeTruthy();
  expect(within(project("General")).queryByTitle("Something is running here")).toBeNull();
  send(ev({ type: "answered", id: "ask_1", answer: "", expeditionId: "c2b" }), ev({ type: "expedition_end", id: "c2b", status: "done", text: "ok", expeditionId: "c2b" }));
  expect(within(project("mi-web-app")).queryByTitle("Something is running here")).toBeNull();
  expect(screen.queryByText("1 running")).toBeNull();
});

test("moving a conversation to another project asks the camp, and the list comes back", async () => {
  vi.useRealTimers();
  const { patch } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Options for Rebuild the UI" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "mi-web-app" }));
  await vi.waitFor(() => expect(patch).toHaveBeenCalled());
  expect(posts).toEqual([{ path: "/api/history", body: { action: "conversation.move", id: "c1", project: "p1" } }]);
  expect(screen.queryByRole("menu")).toBeNull();
});

test("search looks inside conversations and shows where the words were found", async () => {
  vi.useRealTimers();
  const { setView } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Search/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversations" }), { target: { value: "guard" } });
  await vi.waitFor(() => expect(screen.getByText(/the flaky parallel-edit guard/)).toBeTruthy());
  expect(posts.map((p) => p.path)).toEqual(["/api/history/search?q=guard"]);
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Fix the flaky testmi-web-app · …the flaky parallel-edit guard…"]);
  expect(screen.queryByRole("button", { name: "General" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Fix the flaky test/ }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "c2" });
});

test("a long project shows its newest conversations and a way to see them all; projects can be pinned", async () => {
  vi.useRealTimers();
  const many: HistoryData = { ...HISTORY, conversations: Array.from({ length: 8 }, (_, i) => conv(`m${i}`, `Chat ${i}`, "p1")) };
  const store = createFeedStore();
  const setView = vi.fn();
  const patch = vi.fn();
  render(<History S={{ ...S, history: many } as CampState} store={store} view={{ kind: "conversation", id: "m7" }} setView={setView} patch={patch} onNewProject={() => {}} onEditProject={() => {}} />);
  // The first five, plus the one you're in.
  expect(within(project("mi-web-app")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Chat 0⋯", "Chat 1⋯", "Chat 2⋯", "Chat 3⋯", "Chat 4⋯", "Chat 7⋯"]);
  fireEvent.click(screen.getByRole("button", { name: "View all 8" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "project", id: "p1" });
  fireEvent.click(screen.getByRole("button", { name: "Options for mi-web-app" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Pin to the top" }));
  await vi.waitFor(() => expect(patch).toHaveBeenCalled());
  expect(posts.at(-1)).toEqual({ path: "/api/history", body: { action: "project.pin", id: "p1", pinned: true } });
});

test("Projects sits under New conversation and opens the projects page; its + opens the dialog; a project's name opens its page", () => {
  const { setView, onNewProject, onEditProject } = setup();
  const nav = screen.getByRole("navigation");
  expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["New conversation", "Projects", "+", "Search", "All activity"]);
  fireEvent.click(within(nav).getByRole("button", { name: /Projects$/ }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "projects" });
  expect(onNewProject).not.toHaveBeenCalled();
  fireEvent.click(within(nav).getByRole("button", { name: "Create project" }));
  expect(onNewProject).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "mi-web-app" }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "project", id: "p1" });
  // The arrow beside the name folds its conversations away, without leaving the page you're on.
  fireEvent.click(screen.getByRole("button", { name: "Hide mi-web-app's conversations" }));
  expect(within(project("mi-web-app")).queryByRole("listitem")).toBeNull();
  expect(setView).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Options for mi-web-app" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit…" }));
  expect(onEditProject).toHaveBeenCalledWith(HISTORY.projects[1]);
});

test("the project dialog: name, description, folders, pinned references, and defaults, saved in one go", async () => {
  vi.useRealTimers();
  const onSaved = vi.fn();
  render(<ProjectDialog S={S} project={null} onClose={() => {}} onSaved={onSaved} />);
  const dialog = screen.getByRole("dialog", { name: "New project" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  expect(within(dialog).getByRole("alert").textContent).toBe("Give the project a name.");
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Home network" } });
  fireEvent.change(within(dialog).getByLabelText(/^Description/), { target: { value: "UniFi gear. Never reboot the gateway." } });
  // Folders: one that's already linked, and one to link when the project is saved.
  fireEvent.change(within(dialog).getByLabelText("Add a folder that's already linked"), { target: { value: "notes" } });
  expect(within(dialog).getByText(/links\/notes\//)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Link another folder…" }));
  fireEvent.click(within(dialog).getByLabelText(/Read-only/));
  fireEvent.change(within(dialog).getByLabelText("Folder path"), { target: { value: "/Users/me/network" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  expect(within(dialog).getByText(/linked when you save/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(/^Pinned references/), { target: { value: "links/notes/topology.md\nhttps://ui.com/docs" } });
  fireEvent.change(within(dialog).getByLabelText(/^Web access/), { target: { value: "off" } });
  fireEvent.change(within(dialog).getByLabelText(/^Budget/), { target: { value: "1.5" } });
  await vi.waitFor(() => expect(within(dialog).getByRole("option", { name: "Claude Haiku 5.5" })).toBeTruthy());
  fireEvent.change(within(dialog).getByLabelText("Scout's model in this project"), { target: { value: "claude-haiku-5-5" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(posts.find((p) => p.path === "/api/history")!.body).toEqual({
    action: "project.add", name: "Home network", description: "UniFi gear. Never reboot the gateway.",
    links: ["notes"], folders: [{ path: "/Users/me/network", access: "read" }],
    pins: ["links/notes/topology.md", "https://ui.com/docs"],
    settings: { web: "off", budgetUsd: 1.5, agents: { scout: { model: "claude-haiku-5-5", effort: "" } } },
  });
});

test("a project's page: what the crew is told, what they've learned, usage, files, jobs; survey and edit notes", async () => {
  vi.useRealTimers();
  const onSaved = vi.fn();
  const { unmount } = render(<ProjectDialog S={S} project={HISTORY.projects[1]} onClose={() => {}} onSaved={onSaved} />);
  const dialog = screen.getByRole("dialog", { name: "Edit mi-web-app" });
  expect((within(dialog).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("The Meltwater web app. Use pnpm.");
  expect((within(dialog).getByLabelText(/^Web access/) as HTMLSelectElement).value).toBe("careful");
  expect(within(dialog).getByText("Defaults for this project (1 set)")).toBeTruthy();
  unmount();

  const setView = vi.fn();
  const patch = vi.fn();
  render(<ProjectPage S={S} store={createFeedStore()} project={HISTORY.projects[1]} setView={setView} refresh={() => {}} patch={patch} onEdit={() => {}} onDelete={() => {}} />);
  expect(screen.getByRole("heading", { name: "mi-web-app" })).toBeTruthy();
  expect(screen.getByText("The Meltwater web app. Use pnpm.")).toBeTruthy();
  expect(screen.getByText(/\/Users\/me\/mi-web-app · the crew can edit/)).toBeTruthy();
  expect(screen.getByText("Confidential web searches")).toBeTruthy();
  expect(screen.getByText("links/mi-web-app/docs/arch.md")).toBeTruthy();
  await vi.waitFor(() => expect(screen.getByText(/Tests live next to the code/)).toBeTruthy());
  expect(screen.getByText("$1.50")).toBeTruthy();
  expect(screen.getByText("links/mi-web-app/src/a.ts")).toBeTruthy();
  expect(screen.getByText("nightly-check")).toBeTruthy();
  expect(screen.getByText(/Not surveyed yet/)).toBeTruthy();

  // Edit the crew's notes by hand.
  const notes = screen.getByText("What the crew has learned here").closest("section")!;
  fireEvent.click(within(notes).getByRole("button", { name: "Edit" }));
  fireEvent.change(within(notes).getByLabelText("What the crew has learned here"), { target: { value: "- Use pnpm, never npm." } });
  fireEvent.click(within(notes).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(patch).toHaveBeenCalled());
  expect(posts.find((p) => p.body?.action === "project.notes")!.body).toEqual({ action: "project.notes", id: "p1", notes: "- Use pnpm, never npm." });

  // Survey: starts a conversation with the Scout, and takes you to it.
  fireEvent.click(screen.getAllByRole("button", { name: "Survey this project" })[0]);
  // It asks first, in the page's own dialog, saying what it does and what it costs.
  const ask = screen.getByRole("alertdialog", { name: "Survey mi-web-app?" });
  expect(ask.textContent).toContain("links/mi-web-app/");
  expect(ask.textContent).toContain("uses some of your plan");
  expect(posts.find((p) => p.path === "/api/project/survey")).toBeUndefined();
  fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(posts.find((p) => p.path === "/api/project/survey")).toBeUndefined();
  fireEvent.click(screen.getAllByRole("button", { name: "Survey this project" })[0]);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Survey" }));
  await vi.waitFor(() => expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "s1" }));
  expect(posts.find((p) => p.path === "/api/project/survey")!.body).toEqual({ id: "p1" });
});

test("a conversation's view: its earlier runs from history, then its live ones, never twice", () => {
  const store = createFeedStore();
  const live = (id: string, thread: string | undefined, task: string) => store.apply(ev({ type: "expedition_start", id, task, source: thread ? "user" : "job", thread, expeditionId: id }));
  live("c1b", "c1", "Second ask");
  live("job1", undefined, "Nightly job");
  live("c2", "c2", "Other conversation");
  const past = cardsFrom([
    { type: "expedition_start", id: "c1", task: "First ask", source: "user", thread: "c1", expeditionId: "c1", seq: 0, time: "2026-11-01T10:00:00Z" },
    { type: "text", ...qm, text: "Done.", expeditionId: "c1", seq: 0, time: "2026-11-01T10:01:00Z" },
    { type: "expedition_end", id: "c1", status: "done", text: "Done.", expeditionId: "c1", seq: 0, time: "2026-11-01T10:01:00Z" },
    { type: "expedition_start", id: "c1b", task: "Second ask", source: "user", thread: "c1", expeditionId: "c1b", seq: 0, time: "2026-11-10T09:00:00Z" },
  ] as CampEvent[]);
  const items = store.getState().items;
  const tasks = (view: View) => cardsFor(view, items, past).map((n) => (n.kind === "exp" ? n.task : n.kind));
  expect(tasks({ kind: "conversation", id: "c1" })).toEqual(["First ask", "Second ask"]);
  expect(cardsFor({ kind: "conversation", id: "c1" }, items, past)[1]).toBe(items[0]); // the live copy, which keeps updating
  expect(tasks({ kind: "all" })).toEqual(["Second ask", "Nightly job", "Other conversation"]);
  expect(tasks({ kind: "new" })).toEqual([]);
  expect(latestLiveRun(items, "c1")).toBe("c1b");
  expect(latestLiveRun(items, "c9")).toBeUndefined();
  expect(past[0].kind === "exp" && past[0].end?.status).toBe("done");
});

test("the page remembers which conversation you were in", () => {
  expect(parseView(JSON.stringify({ kind: "conversation", id: "c1" }))).toEqual({ kind: "conversation", id: "c1" });
  expect(parseView(JSON.stringify({ kind: "all" }))).toEqual({ kind: "all" });
  expect(parseView(JSON.stringify({ kind: "project", id: "p1" }))).toEqual({ kind: "project", id: "p1" });
  expect(parseView(JSON.stringify({ kind: "projects" }))).toEqual({ kind: "projects" });
  expect(parseView(null)).toEqual({ kind: "new" });
  expect(parseView("not json")).toEqual({ kind: "new" });
});

test("open, history keeps its rail, and clicking the rail closes it, as the rail opened it", () => {
  const onHide = vi.fn(), onShow = vi.fn();
  const { container } = render(<History S={S} store={createFeedStore()} view={{ kind: "new" }} setView={() => {}} patch={() => {}} onNewProject={() => {}} onEditProject={() => {}} onHide={onHide} />);
  expect(screen.getByRole("button", { name: "Hide the history" }).textContent).toBe("History"); // its name, always shown
  expect(container.querySelector(".hist-top")!.textContent).toBe("New conversation"); // no « beside it any more
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
  expect(onHide).not.toHaveBeenCalled();
  fireEvent.click(container.querySelector(".zone-rail.open")!); // the rail's empty space
  expect(onHide).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Hide the history" }));
  expect(onHide).toHaveBeenCalledTimes(2);
  cleanup();
  render(<HistoryRail onShow={onShow} />);
  fireEvent.click(screen.getByRole("button", { name: "Show history" }));
  expect(onShow).toHaveBeenCalled();
});

test("chats with a crew member are kept together under the project, behind their name", () => {
  const history: HistoryData = {
    projects: HISTORY.projects,
    conversations: [conv("q1", "Fix the flaky test", "p1"), conv("s1", "Survey of mi-web-app", "p1", { agent: "scout", direct: true }), conv("s2", "What changed in v5?", "p1", { agent: "scout", direct: true }),
      conv("w1", "Tidy the README", "p1", { agent: "scribe", direct: true })],
  };
  const store = createFeedStore(), setView = vi.fn();
  const draw = (view: View) => render(<History S={{ ...S, history } as CampState} store={store} view={view} setView={setView} patch={() => {}} onNewProject={() => {}} onEditProject={() => {}} />);
  const { unmount } = draw({ kind: "new" });
  const items = () => within(project("mi-web-app")).getAllByRole("listitem").map((li) => li.textContent);
  expect(items()).toEqual(["Fix the flaky test⋯", "›@scout2", "›@scribe1"]); // the Quartermaster's stays out in the open
  const scout = screen.getByRole("button", { name: /@scout/ });
  expect(scout.getAttribute("aria-expanded")).toBe("false");
  expect(scout.closest("li")!.className).toContain("c-scout"); // in the Scout's colour
  fireEvent.click(scout);
  expect(scout.getAttribute("aria-expanded")).toBe("true");
  expect(within(scout.closest("li")!).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Survey of mi-web-app⋯", "What changed in v5?⋯"]); // no "@scout ·" in front: it's under the name
  fireEvent.click(screen.getByRole("button", { name: /^What changed in v5\?/ }));
  expect(setView).toHaveBeenLastCalledWith({ kind: "conversation", id: "s2" });
  fireEvent.click(scout);
  expect(screen.queryByText("What changed in v5?")).toBeNull();
  expect(JSON.parse(localStorage.getItem("camp-agents-open")!)).toEqual([]);
  unmount();

  // The group holding the chat you're in is open whether or not you opened it.
  draw({ kind: "conversation", id: "w1" });
  expect(screen.getByRole("button", { name: /@scribe/ }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: /^Tidy the README/ }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: /@scout/ }).getAttribute("aria-expanded")).toBe("false");
});

test("with Jira linked, the sidebar offers Start a ticket, then Jira and the Wiki under Projects", () => {
  const setView = vi.fn(), onOpenWiki = vi.fn(), onStartTicket = vi.fn();
  const linked = { ...S, jira: { connected: true } } as CampState;
  const { rerender } = render(<History S={linked} store={createFeedStore()} view={{ kind: "wiki" }} setView={setView} patch={() => {}} onNewProject={() => {}} onEditProject={() => {}}
    onOpenWiki={onOpenWiki} onStartTicket={onStartTicket} />);
  const nav = screen.getByRole("navigation");
  expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["New conversation", "Start a ticket", "Projects", "+", "Jira", "Wiki", "Search", "All activity"]);
  expect(within(nav).getByRole("button", { name: "Wiki" }).getAttribute("aria-current")).toBe("page"); // you're on it
  fireEvent.click(within(nav).getByRole("button", { name: "Wiki" }));
  expect(onOpenWiki).toHaveBeenCalledTimes(1);
  fireEvent.click(within(nav).getByRole("button", { name: "Start a ticket" }));
  expect(onStartTicket).toHaveBeenCalledTimes(1);
  // Without Jira there's no ticket to start, but the wiki is still there.
  rerender(<History S={S} store={createFeedStore()} view={{ kind: "new" }} setView={setView} patch={() => {}} onNewProject={() => {}} onEditProject={() => {}} onOpenWiki={onOpenWiki} onStartTicket={onStartTicket} />);
  expect(within(screen.getByRole("navigation")).getAllByRole("button").map((b) => b.textContent)).toEqual(["New conversation", "Projects", "+", "Wiki", "Search", "All activity"]);
});

test("words arriving in a reply don't redraw History: only a run starting, ending or asking does", () => {
  const store = createFeedStore();
  let draws = 0;
  let reads = 0; // History reads the camp's history each time it's drawn
  const watched = new Proxy(S, { get(camp, key) { if (key === "history") reads++; return camp[key as keyof CampState]; } });
  const props = { S: watched, store, view: { kind: "new" } as View, setView: () => {}, patch: () => {}, onNewProject: () => {}, onEditProject: () => {} };
  const page = () => <Profiler id="history" onRender={() => { draws++; }}><History {...props} /></Profiler>;
  const { rerender } = render(page());
  const send = (...events: CampEvent[]) => act(() => { for (const e of events) store.apply(e); vi.advanceTimersByTime(20); });
  send(ev({ type: "expedition_start", id: "c2b", task: "And the other test", source: "user", thread: "c2", expeditionId: "c2b" }));
  expect(screen.getByText("1 running")).toBeTruthy();
  const before = draws;
  for (const word of ["Looking ", "into ", "it ", "now"]) send(ev({ type: "text_delta", ...qm, delta: word, expeditionId: "c2b" }));
  expect(draws).toBe(before);
  // Nor does the page around it being drawn again, while what History is given stays the same.
  const read = reads;
  rerender(page());
  expect(reads).toBe(read);
  send(ev({ type: "ask", id: "ask_9", kind: "plan", title: "Plan", body: "1. Fix it", expeditionId: "c2b" }));
  expect(draws).toBeGreaterThan(before);
  expect(screen.getByTitle("1 waiting for your decision")).toBeTruthy();
});
