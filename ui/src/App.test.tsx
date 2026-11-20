// The whole page, put together: it comes up before the camp has answered, and a zone that throws
// while drawing itself says so in its own space, leaving the message box (and the rest) working.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  expect(store.getState().items.at(-1)).toMatchObject({ kind: "sys", text: "There's no finished answer here to rate yet." }); // and in the feed, for All activity
});

test("Orbit takes the whole page from the Arcade menu in the top bar or /orbit, and going anywhere on the page leaves it", async () => {
  render(<App store={createFeedStore()} />);
  expect(screen.queryByRole("dialog", { name: "Orbit: the crew at work" })).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "Arcade" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Orbit" }));
  // Orbit is its own script, fetched the first time it's opened; after that it opens at once.
  const view = await screen.findByRole("dialog", { name: "Orbit: the crew at work" });
  expect(screen.getByRole("button", { name: "Arcade" }).classList.contains("on")).toBe(true); // the top bar's button, lit while it's open
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
