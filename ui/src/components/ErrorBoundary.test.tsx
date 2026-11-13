// When part of the page throws while drawing itself, that part says so and the rest carries on:
// one item in the feed, one zone, something opened over the page, or (the last resort) the page.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Feed } from "../feed/Feed.tsx";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent } from "../types.ts";
import { OverlayBoundary, PageBoundary, ZoneBoundary } from "./ErrorBoundary.tsx";

// A stand-in for a card the page can't lay out: any message whose text says so throws.
vi.mock("../markdown.tsx", () => ({
  Markdown: ({ text }: { text: string }) => { if (text.includes("BREAKS")) throw new Error("can't lay this out"); return <div className="md">{text}</div>; },
}));

beforeEach(() => { localStorage.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); }); // React reports what a boundary caught
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function Bomb({ on = true }: { on?: boolean }) {
  if (on) throw new Error("the panel blew up");
  return <div>All well</div>;
}

test("a zone that throws says which part and why, beside the rest of the page, and can be tried again", () => {
  let broken = true;
  const Flaky = () => <Bomb on={broken} />;
  render(<><ZoneBoundary name="Files"><Flaky /></ZoneBoundary><button type="button">Send</button></>);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Files couldn't be shown");
  expect(alert.textContent).toContain("the panel blew up");
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(); // what's beside it is untouched
  broken = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("All well")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("going somewhere else gives a broken zone another go", () => {
  const { rerender } = render(<ZoneBoundary name="This conversation" resetKey="c:a"><Bomb /></ZoneBoundary>);
  expect(screen.getByRole("alert")).toBeTruthy();
  rerender(<ZoneBoundary name="This conversation" resetKey="c:a"><Bomb on={false} /></ZoneBoundary>);
  expect(screen.getByRole("alert")).toBeTruthy(); // still the same place: it stays as it was
  rerender(<ZoneBoundary name="This conversation" resetKey="c:b"><Bomb on={false} /></ZoneBoundary>);
  expect(screen.getByText("All well")).toBeTruthy();
});

test("something opened over the page that throws leaves a dialog you can close", () => {
  const onClose = vi.fn();
  render(<OverlayBoundary name="Settings" onClose={onClose}><Bomb /></OverlayBoundary>);
  const dialog = screen.getByRole("alertdialog", { name: "Settings couldn't be shown" });
  expect(dialog.textContent).toContain("the panel blew up");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the whole page: the error, Reload, and a way out of a saved place that breaks it only when there is one", () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  const { unmount } = render(<PageBoundary><Bomb /></PageBoundary>);
  expect(screen.getByRole("alert").textContent).toContain("the panel blew up");
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reload"]); // nothing saved: nothing to clear
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(reload).toHaveBeenCalledTimes(1);
  unmount();

  localStorage.setItem("camp-view", JSON.stringify({ kind: "conversation", id: "c1" }));
  localStorage.setItem("camp-theme", "dark");
  render(<PageBoundary><Bomb /></PageBoundary>);
  fireEvent.click(screen.getByRole("button", { name: "Reload on a new conversation, default layout" }));
  expect(reload).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem("camp-view")).toBeNull();
  expect(localStorage.getItem("camp-theme")).toBe("dark"); // only where you were and the layout are forgotten
});

test("one item in the feed that can't be drawn leaves a line in its place; the items around it stay", () => {
  vi.useFakeTimers();
  const store = createFeedStore();
  const events: object[] = [
    { type: "expedition_start", id: "a", task: "Write it up", source: "user" },
    { type: "text", who: "Quartermaster", emoji: "🧭", depth: 0, text: "Here is the first part.", expeditionId: "a" },
    { type: "text", who: "Quartermaster", emoji: "🧭", depth: 0, text: "This one BREAKS the page.", expeditionId: "a" },
    { type: "text", who: "Quartermaster", emoji: "🧭", depth: 0, text: "And the last part.", expeditionId: "a" },
  ];
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  act(() => {
    events.forEach((e, i) => store.apply({ ...e, seq: i + 1, time: new Date().toISOString() } as CampEvent));
    vi.advanceTimersByTime(20);
  });
  expect(screen.getByText("Here is the first part.")).toBeTruthy();
  expect(screen.getByText("This item couldn't be shown.")).toBeTruthy();
  expect(screen.getByText("And the last part.")).toBeTruthy();
  expect(screen.queryByText(/BREAKS/)).toBeNull();
  expect(screen.getByText("Write it up")).toBeTruthy(); // the run's own card is whole
});
