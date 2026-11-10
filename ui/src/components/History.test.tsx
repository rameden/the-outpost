// History on screen: conversations under their projects, what's running or waiting on you,
// opening one, starting a new one in a project, and moving one between projects.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cardsFor, cardsFrom, latestLiveRun, parseView, type View } from "../feed/conversation.ts";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent, CampState, History as HistoryData } from "../types.ts";
import { History } from "./History.tsx";

const conv = (id: string, title: string, project: string, more: object = {}) =>
  ({ id, title, project, created: "2026-11-10T09:00:00Z", updated: "2026-11-10T09:05:00Z", agent: "quartermaster", direct: false, expeditions: [id], status: "done", ...more });
const HISTORY: HistoryData = {
  projects: [{ id: "general", name: "General" }, { id: "p1", name: "mi-web-app", link: "mi-web-app" }],
  conversations: [conv("c1", "Rebuild the UI", "general"), conv("c2", "Fix the flaky test", "p1"), conv("c3", "What's new in memory research?", "general", { agent: "scout", direct: true })],
};
const S = { history: HISTORY } as CampState;

const posts: { path: string; body: any }[] = [];
beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
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
  render(<History S={S} store={store} view={view} setView={setView} patch={patch} />);
  const send = (...events: CampEvent[]) => act(() => { for (const e of events) store.apply(e); vi.advanceTimersByTime(20); });
  return { store, setView, patch, send };
}
const project = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("section")!;

test("conversations sit under their projects, and opening one selects it", () => {
  const { setView } = setup({ kind: "conversation", id: "c2" });
  expect(within(project("General")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Rebuild the UI⋯", "@scout · What's new in memory research?⋯"]);
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

test("search narrows the list by title", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Search/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversations" }), { target: { value: "flaky" } });
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Fix the flaky test⋯"]);
  expect(screen.queryByRole("button", { name: /^General/ })).toBeNull();
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
  expect(parseView(null)).toEqual({ kind: "new" });
  expect(parseView("not json")).toEqual({ kind: "new" });
});
