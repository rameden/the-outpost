// The crew bar: a slim strip by default, which opens up into the full cards and remembers which
// you chose. Either way a crew member opens their page, and shows what they're doing.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent, CampState } from "../types.ts";
import { Crew } from "./Crew.tsx";

const S = {
  xp: { Scout: 120 },
  characters: [
    { id: "quartermaster", name: "Quartermaster", emoji: "🧭", role: "Plans and dispatches", model: "claude-sonnet-5-5", effort: "high", maxTurns: 30, defaultMaxTurns: 30 },
    { id: "scout", name: "Scout", emoji: "🏹", role: "Finds things out", model: "claude-sonnet-5-5", effort: "medium", maxTurns: 20, defaultMaxTurns: 20 },
  ],
} as unknown as CampState;

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function show(store = createFeedStore()) {
  const onOpenAgent = vi.fn(), onOpenPicker = vi.fn(), onAdd = vi.fn();
  const r = render(<Crew S={S} store={store} pickerFor={null} onOpenAgent={onOpenAgent} onOpenPicker={onOpenPicker} onAdd={onAdd} />);
  return { ...r, store, onOpenAgent, onOpenPicker, onAdd, bar: () => r.container.querySelector(".crew")! };
}

test("it starts as a slim strip, and the chevron opens it up into cards", () => {
  const { bar } = show();
  expect(bar().classList.contains("slim")).toBe(true);
  const more = screen.getByRole("button", { name: "Show more about the crew" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(bar().classList.contains("slim")).toBe(false);
  const less = screen.getByRole("button", { name: "Show less about the crew" });
  expect(less.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(less);
  expect(bar().classList.contains("slim")).toBe(true);
});

test("which one you chose is remembered", () => {
  const first = show();
  fireEvent.click(screen.getByRole("button", { name: "Show more about the crew" }));
  expect(localStorage.getItem("camp-crew")).toBe("cards");
  first.unmount();
  const again = show();
  expect(again.bar().classList.contains("slim")).toBe(false);
});

test("slim or not, a crew member opens their page, and the + adds one", () => {
  const { onOpenAgent, onAdd } = show();
  fireEvent.click(screen.getByRole("button", { name: "Open Scout's page" }));
  expect(onOpenAgent).toHaveBeenCalledWith("scout");
  fireEvent.click(screen.getByRole("button", { name: "Add a crew member" }));
  expect(onAdd).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Show more about the crew" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Quartermaster's page" }));
  expect(onOpenAgent).toHaveBeenLastCalledWith("quartermaster");
});

test("the slim strip still says what each is doing: on hover always, and in the open while they work", () => {
  const { store } = show();
  const scout = screen.getByRole("button", { name: "Open Scout's page" });
  expect(scout.title).toContain("Scout: At camp");
  expect(scout.title).toContain("sonnet-5-5 · medium · Lv 3");
  expect(scout.classList.contains("active")).toBe(false);
  act(() => {
    store.apply({ type: "expedition_start", id: "e1", task: "Look into it", source: "user", thread: "e1", expeditionId: "e1", seq: 1, time: "2026-11-10T09:00:00Z" } as CampEvent);
    vi.advanceTimersByTime(50);
  });
  const qm = screen.getByRole("button", { name: "Open Quartermaster's page" });
  expect(qm.classList.contains("active")).toBe(true);
  expect(qm.querySelector(".member-status")?.textContent).toBe("Planning the expedition");
  expect(qm.title).toContain("Quartermaster: Planning the expedition");
});
