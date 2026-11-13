// The crew bar: a slim strip by default, which opens up into the full cards and remembers which
// you chose. Either way a crew member opens their page, and shows what they're doing.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

test("a crew member with two quests out says so: a count by their name, and each quest's own line", () => {
  const store = createFeedStore();
  let seq = 0;
  const send = (...bodies: object[]) => act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); vi.advanceTimersByTime(20); });
  show(store);
  const scout = { who: "Scout", emoji: "🏹", depth: 1 };
  send({ type: "expedition_start", id: "A", task: "Two things", source: "user" },
    { type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Backend: thread links" });
  const card = () => screen.getByRole("button", { name: "Open Scout's page" });
  expect(card().querySelector(".member-count")).toBeNull(); // one quest out reads as it always has
  send({ type: "dispatch", ...scout, questId: "q2", expeditionId: "A", brief: "Studio UI: Share in the menu" },
    { type: "tool", ...scout, tool: "grep", input: "{}", questId: "q1", expeditionId: "A" });
  expect(card().querySelector(".member-count")!.textContent).toBe("×2");
  expect(card().querySelector(".member-status")!.textContent).toBe("2 quests out");
  expect(card().title).toContain("• Backend: thread links: Using grep\n• Studio UI: Share in the menu: Setting out");
  send({ type: "ask", id: "k", kind: "shell", title: "Run?", body: "", questId: "q2", expeditionId: "A" });
  expect(card().querySelector(".member-status")!.textContent).toBe("2 quests out · one needs your OK");
  send({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" });
  expect(card().querySelector(".member-count")).toBeNull();
});

test("under the crew bar, while anyone is out: one row per quest, and a row takes you to it", () => {
  const store = createFeedStore();
  let seq = 0;
  const send = (...bodies: object[]) => act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); vi.advanceTimersByTime(20); });
  const onOpenQuest = vi.fn();
  render(<Crew S={S} store={store} pickerFor={null} onOpenAgent={() => {}} onOpenPicker={() => {}} onOpenQuest={onOpenQuest} />);
  const scout = { who: "Scout", emoji: "🏹", depth: 1 };
  send({ type: "expedition_start", id: "A", task: "Two things", source: "user" });
  // Nobody's out: the right half of the roster says so, and keeps its place.
  expect(screen.getByRole("group", { name: "Quests out now" }).textContent).toBe("No agents running");
  expect(screen.getByRole("group", { name: "Quests out now" }).parentElement!.className).toBe("crew-area");
  send({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Backend: thread links" },
    { type: "dispatch", ...scout, questId: "q2", expeditionId: "A", brief: "Studio UI: Share in the menu" },
    { type: "tool", ...scout, tool: "grep", input: "{}", questId: "q1", expeditionId: "A" });
  const tray = screen.getByRole("group", { name: "Quests out now" });
  const rows = () => within(tray).getAllByRole("button").map((b) => [...b.children].map((c) => c.textContent!.trim()).join(" | "));
  expect(tray.querySelector(".co-head")!.textContent).toBe("2 out");
  expect(rows()).toEqual(["🏹 Scout | Backend: thread links | Using grep | 0s", "🏹 Scout | Studio UI: Share in the menu | Setting out | 0s"]);
  // It's the other half of the roster: beside the crew, in the same area.
  expect(tray.previousElementSibling?.className).toContain("crew");
  expect([...tray.parentElement!.children].length).toBe(2);
  act(() => { vi.advanceTimersByTime(65_000); });
  expect(rows()[0]).toMatch(/\| 1m 05s$/);

  fireEvent.click(within(tray).getAllByRole("button")[1]);
  expect(onOpenQuest).toHaveBeenCalledWith(expect.objectContaining({ id: "q2", expId: "A", brief: "Studio UI: Share in the menu" }));

  send({ type: "ask", id: "k", kind: "shell", title: "Run?", body: "", questId: "q2", expeditionId: "A" });
  expect(tray.querySelector(".co-head")!.textContent).toBe("2 out· 1 needs your OK");
  expect(rows()[1]).toMatch(/\| Waiting for your OK \|/);
  send({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" });
  expect(rows().length).toBe(1);
  send({ type: "expedition_end", id: "A", status: "done", text: "Done." });
  expect(screen.getByRole("group", { name: "Quests out now" }).textContent).toBe("No agents running");
});

test("the clock that counts how long each quest has been out only runs while someone is out", () => {
  const store = createFeedStore();
  let seq = 0;
  const send = (...bodies: object[]) => act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); vi.advanceTimersByTime(20); });
  const ticking = vi.spyOn(globalThis, "setInterval");
  const stopped = vi.spyOn(globalThis, "clearInterval");
  render(<Crew S={S} store={store} pickerFor={null} onOpenAgent={() => {}} onOpenPicker={() => {}} />);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(ticking).not.toHaveBeenCalled(); // nobody's out: nothing to count
  send({ type: "expedition_start", id: "A", task: "One thing", source: "user" },
    { type: "dispatch", who: "Scout", emoji: "🏹", depth: 1, questId: "q1", expeditionId: "A", brief: "Look into it" });
  expect(ticking).toHaveBeenCalledTimes(1);
  send({ type: "expedition_end", id: "A", status: "done", text: "Done." });
  expect(stopped).toHaveBeenCalledTimes(1);
  ticking.mockRestore(); stopped.mockRestore();
});
