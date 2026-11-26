// The whole page, put together: it comes up before the camp has answered, and a zone that throws
// while drawing itself says so in its own space, leaving the message box (and the rest) working.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { say } from "./bus.ts";
import { createFeedStore } from "./feed/store.ts";

// xterm.js needs a real browser to draw; the terminal isn't what's being looked at here.
vi.mock("@xterm/xterm", () => ({ Terminal: class { options = {}; loadAddon() {} open() {} focus() {} dispose() {} write() {} reset() {} onData() { return { dispose() {} }; } } }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
// The crew bar stands in for "a panel that can't be drawn".
vi.mock("./components/Crew.tsx", () => ({ Crew: () => { throw new Error("the crew bar blew up"); } }));

const { App } = await import("./App.tsx");

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {}); // React reports what a boundary caught
  vi.stubGlobal("EventSource", class { readyState = 0; onmessage = null; onerror = null; addEventListener() {} close() {} });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {}))); // the camp hasn't answered yet
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a zone that throws is the only thing lost: the top bar, the conversation and the message box are all there", () => {
  render(<App store={createFeedStore()} />);
  const broken = screen.getByRole("alert");
  expect(broken.textContent).toContain("The crew bar couldn't be shown");
  expect(broken.textContent).toContain("the crew bar blew up");
  expect(screen.getByRole("textbox", { name: "Request for the camp" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy(); // the camp opens on today's page
  expect(screen.getByText("Connecting…")).toBeTruthy();
  // What the page says back to you has its place by the message box from the start.
  expect(document.querySelector(".status-line")?.getAttribute("aria-live")).toBe("polite");
});

test("what the page says back shows by the message box, where a conversation's view can see it", () => {
  const store = createFeedStore();
  render(<App store={store} />);
  const line = document.querySelector<HTMLElement>(".status-line")!;
  expect(line.childElementCount).toBe(0);
  act(() => say({ do: "command", name: "good" })); // what typing /good does, on a page with nothing to rate
  expect(within(line).getByText("There's no finished answer here to rate yet.")).toBeTruthy();
  expect(store.getState().items.at(-1)).toMatchObject({ kind: "sys", text: "There's no finished answer here to rate yet." }); // and in the feed, for All runs
});

test("Orbit takes the whole page from the Views menu in the top bar or /orbit, and going anywhere on the page leaves it", async () => {
  render(<App store={createFeedStore()} />);
  expect(screen.queryByRole("dialog", { name: "Orbit: the crew at work" })).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Orbit" }));
  // Orbit is its own script, fetched the first time it's opened; after that it opens at once.
  const view = await screen.findByRole("dialog", { name: "Orbit: the crew at work" });
  expect(screen.getByRole("button", { name: "Views" }).classList.contains("on")).toBe(true); // the top bar's button, lit while it's open
  fireEvent.keyDown(view, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Orbit: the crew at work" })).toBe(null);
  act(() => say({ do: "command", name: "orbit" })); // what typing /orbit does
  expect(screen.getByRole("dialog", { name: "Orbit: the crew at work" })).toBeTruthy();
  act(() => say({ do: "open-conversation", id: "c1" })); // the page went somewhere: you're taken there
  expect(screen.queryByRole("dialog", { name: "Orbit: the crew at work" })).toBe(null);
  // /orbit demo opens it on its demo: a pretend camp, which says that's what it is.
  act(() => say({ do: "command", name: "orbit", arg: "demo" }));
  expect(within(screen.getByRole("dialog", { name: "Orbit: the crew at work" })).getByRole("status").textContent).toMatch(/^Demo: a pretend camp/);
});

test("the trail map and the constellation are in the Views menu too: it or /trail opens the map over the page, it or /constellation opens Memory's Map over the page", async () => {
  // The Memory page is drawn from what the camp holds, so here the camp answers (with next to nothing in it).
  const camp = { characters: [], quests: [], queued: [], parallel: 3, limits: [], pausedUntil: null, pauseMessage: null, spend: { today: 0, week: 0, total: 0 }, budgetUsd: null, runtime: "api", login: null,
    history: { conversations: [], projects: [] }, prs: [], packs: [], links: [], memory: [], memoryProposals: [], wiki: [], settings: { memoryCare: { tidy: false, suggest: false } } };
  vi.stubGlobal("fetch", vi.fn((path: string) => (String(path).startsWith("/api/state") ? Promise.resolve(new Response(JSON.stringify(camp))) : new Promise<Response>(() => {}))));
  // The page asks for it once the stream says hello.
  vi.stubGlobal("EventSource", class { readyState = 1; onmessage = null; onerror = null; close() {}
    addEventListener(name: string, heard: (m: unknown) => void) { if (name === "hello") setTimeout(() => heard({ data: JSON.stringify({ bootId: "b1" }) })); } });
  render(<App store={createFeedStore()} />);
  await waitFor(() => expect(screen.queryByText("Connecting…")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  expect(within(screen.getByRole("menu", { name: "Views" })).getAllByRole("menuitemcheckbox").map((i) => i.getAttribute("aria-label"))).toEqual(["Orbit", "Trail map", "Constellation"]);
  // From the menu: each takes the whole page, one at a time, and its row leaves it again.
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Trail map" }));
  expect(await screen.findByRole("dialog", { name: /^Trail map/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Views", hidden: true }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Constellation", hidden: true }));
  expect(screen.queryByRole("dialog", { name: /^Trail map/ })).toBeNull();
  expect(await screen.findByRole("dialog", { name: /^Memory constellation/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Map", hidden: true }).getAttribute("aria-selected")).toBe("true"); // Memory → Map is under it
  fireEvent.click(screen.getByRole("button", { name: "Views", hidden: true }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Leave the constellation", hidden: true }));
  expect(screen.queryByRole("dialog", { name: /^Memory constellation/ })).toBeNull();
  expect(screen.getByRole("region", { name: /^Memory constellation/ })).toBeTruthy(); // the same map, in the page

  act(() => say({ do: "command", name: "trail" })); // what typing /trail does, and a plan card's "Full screen"
  const trail = await screen.findByRole("dialog", { name: /^Trail map/ });
  expect(within(trail).getByText("No plan yet")).toBeTruthy();
  fireEvent.keyDown(trail, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: /^Trail map/ })).toBeNull();

  act(() => say({ do: "command", name: "trail" }));
  expect(screen.getByRole("dialog", { name: /^Trail map/ })).toBeTruthy();
  act(() => say({ do: "command", name: "constellation" })); // what typing /constellation does
  expect(screen.queryByRole("dialog", { name: /^Trail map/ })).toBeNull(); // one whole-page view at a time
  const map = await screen.findByRole("dialog", { name: /^Memory constellation/ });
  expect(within(map).getByRole("button", { name: "Leave full screen" })).toBeTruthy();
  // Under it is the Memory page, on Map: leaving full screen (Esc) leaves the same map there, in the page.
  expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(map, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: /^Memory constellation/ })).toBeNull();
  const here = screen.getByRole("region", { name: /^Memory constellation/ });
  fireEvent.click(within(here).getByRole("button", { name: "Full screen" }));
  expect(screen.getByRole("dialog", { name: /^Memory constellation/ })).toBeTruthy();
  // Going anywhere on the page leaves full screen; so does opening the trail map or Orbit.
  act(() => say({ do: "command", name: "trail" }));
  expect(screen.queryByRole("dialog", { name: /^Memory constellation/ })).toBeNull();
  expect(screen.getByRole("dialog", { name: /^Trail map/ })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog", { name: /^Trail map/ }), { key: "Escape" });
  act(() => say({ do: "command", name: "constellation" }));
  expect(screen.getByRole("dialog", { name: /^Memory constellation/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "List", hidden: true }));
  expect(screen.queryByRole("dialog", { name: /^Memory constellation/ })).toBeNull();
  expect(screen.queryByRole("region", { name: /^Memory constellation/ })).toBeNull();
});

test("Ctrl+K (⌘K on a Mac) opens the command palette and closes it again, but not from the terminal; /help opens it on the commands", () => {
  render(<App store={createFeedStore()} />);
  const palette = () => screen.queryByRole("combobox", { name: /Go to a page/ }) as HTMLInputElement | null;
  expect(palette()).toBe(null);
  fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
  expect(palette()).toBeTruthy();
  expect(palette()!.value).toBe("");
  fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
  expect(palette()).toBe(null);
  // In the terminal pane, Ctrl+K is the shell's.
  const shell = document.createElement("div");
  shell.className = "xterm";
  const typing = document.createElement("textarea");
  shell.append(typing);
  document.body.append(shell);
  fireEvent.keyDown(typing, { key: "k", code: "KeyK", ctrlKey: true });
  expect(palette()).toBe(null);
  shell.remove();
  act(() => say({ do: "command", name: "help" }));
  expect(palette()!.value).toBe("/");
});
