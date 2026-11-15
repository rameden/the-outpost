// The whole page, put together: it comes up before the camp has answered, and a zone that throws
// while drawing itself says so in its own space, leaving the message box (and the rest) working.
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
