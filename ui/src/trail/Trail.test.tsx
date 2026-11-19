// The trail map: where each step sits, how it fills in as the crew works, and what it shows with no plan.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../api.ts";
import { createFeedStore, type FeedStore } from "../feed/store.ts";
import type { CampEvent, CampState } from "../types.ts";
import { layoutOf, STEP_H, STEP_W, waitsOf } from "./layout.ts";
import { Trail } from "./Trail.tsx";

vi.mock("../api.ts", async (real) => ({ ...(await real<typeof import("../api.ts")>()), api: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.mocked(api).mockReset(); });

const where = (steps: { n: number; after?: number[] }[]) => layoutOf(steps).spots.map((s) => `${s.n}@${s.col}.${s.row}`);
const lines = (steps: { n: number; after?: number[] }[]) => layoutOf(steps).edges.map((e) => `${e.from}>${e.to}`).sort();

describe("where the steps sit", () => {
  test("a plan that says nothing about order is a straight trail", () => {
    const steps = [{ n: 1 }, { n: 2 }, { n: 3 }];
    expect(where(steps)).toEqual(["1@1.1", "2@2.1", "3@3.1"]);
    expect(lines(steps)).toEqual(["1>2", "2>3"]);
    expect([...waitsOf(steps)]).toEqual([[1, []], [2, [1]], [3, [2]]]);
  });

  test("a step sits one column past the furthest thing it waits for, and steps that share a column are stacked", () => {
    const diamond = [{ n: 1 }, { n: 2, after: [1] }, { n: 3, after: [1] }, { n: 4, after: [2, 3] }];
    expect(where(diamond)).toEqual(["1@1.1", "2@2.1", "3@2.2", "4@3.1"]);
    expect(lines(diamond)).toEqual(["1>2", "1>3", "2>4", "3>4"]);
    // The column of two is the tall one; the single steps on either side are centred on it.
    const { spots, width, height } = layoutOf(diamond), y = (n: number) => spots.find((s) => s.n === n)!.y;
    expect(y(1)).toBe((y(2) + y(3)) / 2);
    expect(y(4)).toBe(y(1));
    expect(spots.every((s) => s.x >= 0 && s.y >= 0 && s.x < width && s.y < height)).toBe(true);
  });

  test("once a plan marks any order, a step it marks nothing on can start right away", () => {
    expect(where([{ n: 1 }, { n: 2 }, { n: 3, after: [1, 2] }])).toEqual(["1@1.1", "2@1.2", "3@2.1"]);
  });

  test("a line that says nothing new isn't drawn, and a step can't wait for itself, a later step or one that isn't there", () => {
    // 3 waits for 1 and 2, and 2 already waits for 1: the trail is 1 → 2 → 3.
    const chain = [{ n: 1 }, { n: 2, after: [1] }, { n: 3, after: [1, 2] }];
    expect(lines(chain)).toEqual(["1>2", "2>3"]);
    expect(layoutOf(chain).spots[2].after).toEqual([1, 2]); // (it still says all it waits for)
    expect(where([{ n: 1, after: [1, 2, 9] }, { n: 2, after: [1] }])).toEqual(["1@1.1", "2@2.1"]);
    expect(layoutOf([])).toMatchObject({ spots: [], edges: [], cols: 0, width: 0, height: 0 });
  });

  test("a line to a step further on goes round the cards between, not behind them", () => {
    // 4 → 6 passes step 5's column; 5 sits alone in it, at the height the line would cross.
    const steps = [{ n: 1 }, { n: 2 }, { n: 3, after: [1, 2] }, { n: 4, after: [1] }, { n: 5, after: [3] }, { n: 6, after: [4, 5] }];
    const { spots, edges } = layoutOf(steps), five = spots.find((s) => s.n === 5)!;
    expect(where(steps)).toEqual(["1@1.1", "2@1.2", "3@2.1", "4@2.2", "5@3.1", "6@4.1"]);
    const across = edges.find((e) => e.from === 4 && e.to === 6)!.d.match(/C[\d. -]+ ([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/)!.slice(1).map(Number);
    expect(across[0]).toBe(five.x); // straight across the column, from its left edge to its right,
    expect(across[2]).toBe(five.x + STEP_W);
    expect(across[1]).toBe(across[3]);
    expect(across[1] < five.y || across[1] > five.y + STEP_H).toBe(true); // clear of the card
    // A line to the next column has no such run.
    expect(edges.find((e) => e.from === 5 && e.to === 6)!.d).not.toContain("L");
  });
});

// Events as the server sends them: numbered in order, a second apart.
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
let seq = 0;
const ev = (body: Record<string, unknown>) => ({ ...body, seq: ++seq, time: new Date(T0 + seq * 1000).toISOString() }) as CampEvent;
beforeEach(() => { seq = 0; });
const scout = { who: "Scout", emoji: "🔭", depth: 1 }, smith = { who: "Artificer", emoji: "🔨", depth: 1 };
const begin = (id = "A", task = "Share a whole thread") => ev({ type: "expedition_start", id, task, source: "user" });
const planned = (steps: { n: number; text: string; after?: number[] }[], expeditionId = "A") => ev({ type: "plan", steps, expeditionId });
const diamond = [{ n: 1, text: "Scout reads the code" }, { n: 2, text: "Artificer builds the backend", after: [1] }, { n: 3, text: "Artificer builds the page", after: [1] }, { n: 4, text: "I read the diffs", after: [2, 3] }];

const S = { characters: [{ id: "scout", name: "Scout", emoji: "🔭" }, { id: "artificer", name: "Artificer", emoji: "🔨" }] } as unknown as CampState;
function mount(events: CampEvent[] = [], camp: CampState | null = S) {
  const store = createFeedStore();
  for (const e of events) store.apply(e);
  const onClose = vi.fn(), onOpenQuest = vi.fn();
  const r = render(<Trail S={camp} store={store} onClose={onClose} onOpenQuest={onOpenQuest} />);
  return { ...r, store, onClose, onOpenQuest };
}
// The store tells React about new events a frame later.
const send = (store: FeedStore, ...events: CampEvent[]) => act(() => { for (const e of events) store.apply(e); vi.advanceTimersByTime(20); });
const step = (c: HTMLElement, n: number) => c.querySelector<HTMLElement>(`.trail-step[data-n="${n}"]`)!;
const stands = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".trail-step")].map((el) => `${el.dataset.n} ${el.dataset.state}`);
const edge = (c: HTMLElement, id: string) => c.querySelector(`[data-line="${id}"]`)!;

describe("the trail map", () => {
  test("with no plan it says so, and Esc leaves", () => {
    const { container, onClose } = mount([begin()]);
    expect(screen.getByText("No plan yet")).toBeTruthy();
    expect(container.querySelector(".trail-step")).toBeNull();
    expect(screen.queryByLabelText("Which plan")).toBeNull();
    const map = screen.getByRole("dialog", { name: /Trail map/ });
    expect(document.activeElement).toBe(map);
    fireEvent.keyDown(map, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("each step is a waypoint in its column, with a line from what it waits for", () => {
    const { container } = mount([begin(), planned(diamond)]);
    expect([...container.querySelectorAll<HTMLElement>(".trail-step")].map((el) => `${el.dataset.n}@${el.dataset.col}.${el.dataset.row}`)).toEqual(["1@1.1", "2@2.1", "3@2.2", "4@3.1"]);
    expect([...container.querySelectorAll("[data-line]")].map((g) => g.getAttribute("data-line")).sort()).toEqual(["1-2", "1-3", "2-4", "3-4"]);
    expect(stands(container)).toEqual(["1 todo", "2 todo", "3 todo", "4 todo"]);
    expect(step(container, 4).getAttribute("aria-label")).toBe("Step 4, not started: I read the diffs. Waits for steps 2 and 3.");
    expect(step(container, 1).textContent).toContain("Scout reads the code");
    expect(step(container, 1).textContent).toContain("Nobody sent yet");
    expect(screen.getByText("0 of 4 done")).toBeTruthy();
    expect(screen.getByText("Share a whole thread")).toBeTruthy();
  });

  test("it fills in live: a step goes out when someone is sent on it, and is done when they're back", () => {
    const { container, store } = mount([begin(), planned(diamond)]);
    send(store, ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Read", step: 1 }));
    expect(stands(container)).toEqual(["1 out", "2 todo", "3 todo", "4 todo"]);
    expect(step(container, 1).querySelector(".trail-chip")!.textContent).toContain("Scout");
    expect(screen.getByText("0 of 4 done · 1 out")).toBeTruthy();
    expect(edge(container, "1-2").getAttribute("class")).toBe("trail-edge");

    send(store, ev({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" }),
      ev({ type: "dispatch", ...smith, questId: "q2", expeditionId: "A", brief: "Backend", step: 2 }));
    expect(stands(container)).toEqual(["1 done", "2 out", "3 todo", "4 todo"]);
    expect(edge(container, "1-2").getAttribute("class")).toBe("trail-edge walked live"); // the line being walked now
    expect(edge(container, "1-3").getAttribute("class")).toBe("trail-edge walked");
    expect(edge(container, "2-4").getAttribute("class")).toBe("trail-edge");
    expect(screen.getByText("1 of 4 done · 1 out")).toBeTruthy();

    // A quest that comes back failed, and a run that ends with steps unwalked.
    send(store, ev({ type: "return", ...smith, status: "failed", questId: "q2", expeditionId: "A" }), ev({ type: "expedition_end", id: "A", status: "stopped", text: "Stopped by you." }));
    expect(stands(container)).toEqual(["1 done", "2 failed", "3 stopped", "4 stopped"]);
    expect(screen.getByText("1 of 4 done · 1 didn't finish · 2 cut short")).toBeTruthy();
  });

  test("a plan that arrives while it's open appears, and a crew chip goes to its quest", () => {
    const { container, store, onOpenQuest } = mount([begin()]);
    expect(screen.getByText("No plan yet")).toBeTruthy();
    const plan = planned([{ n: 1, text: "Scout reads" }, { n: 2, text: "Scribe writes" }]);
    const sent = ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Read", step: 1 });
    send(store, plan, sent);
    expect(screen.queryByText("No plan yet")).toBeNull();
    expect(stands(container)).toEqual(["1 out", "2 todo"]);
    fireEvent.click(screen.getByRole("button", { name: "Scout, out now: go to this quest" }));
    expect(onOpenQuest).toHaveBeenCalledWith({ expId: "A", node: `q${sent.seq}` });
  });

  test("a quest sent without a step is listed off the trail, and the map stands", () => {
    const { container, store } = mount([begin(), planned(diamond)]);
    send(store, ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "A side errand" }));
    expect(stands(container)).toEqual(["1 todo", "2 todo", "3 todo", "4 todo"]);
    const loose = screen.getByRole("group", { name: "Quests sent without a step" });
    expect(loose.querySelectorAll(".trail-chip")).toHaveLength(1);
    expect(loose.textContent).toContain("Scout");
    // One sent on a step isn't also listed there.
    send(store, ev({ type: "dispatch", ...smith, questId: "q2", expeditionId: "A", brief: "Backend", step: 1 }));
    expect(loose.querySelectorAll(".trail-chip")).toHaveLength(1);
    expect(stands(container)[0]).toBe("1 out");
  });

  test("a crew member's colour hangs on who they are, not on what they're called", () => {
    const renamed = { characters: [{ id: "scout", name: "Pathfinder", emoji: "🔭" }] } as unknown as CampState;
    const { container } = mount([begin(), planned([{ n: 1, text: "Read" }]),
      ev({ type: "dispatch", who: "Pathfinder", emoji: "🔭", depth: 1, questId: "q1", expeditionId: "A", brief: "Read", step: 1 })], renamed);
    const chip = container.querySelector<HTMLElement>(".trail-chip")!;
    expect(chip.textContent).toContain("Pathfinder");
    expect(chip.classList.contains("c-scout")).toBe(true);
    expect(chip.dataset.who).toBe("scout");
  });

  test("with several plans it shows the newest, and you can pick an earlier one", () => {
    const { container, store } = mount([begin("A", "The first ask"), planned([{ n: 1, text: "Only step" }], "A"), begin("B", "The second ask"), planned(diamond, "B")]);
    const pick = screen.getByLabelText("Which plan") as HTMLSelectElement;
    expect(pick.value).toBe("B");
    expect(stands(container)).toHaveLength(4);
    fireEvent.change(pick, { target: { value: "A" } });
    expect(stands(container)).toEqual(["1 todo"]);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("The first ask");
    // It stays on the one you picked when a newer plan arrives.
    send(store, begin("C", "The third ask"), planned([{ n: 1, text: "x" }, { n: 2, text: "y" }], "C"));
    expect(stands(container)).toEqual(["1 todo"]);
    expect(pick.options).toHaveLength(3);
  });

  test("Replay plays the last day into a feed of its own, where nothing can be opened", async () => {
    const day = [begin("Z", "Yesterday's ask"), planned([{ n: 1, text: "Scout reads" }, { n: 2, text: "Scribe writes" }], "Z"),
      ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "Z", brief: "Read", step: 1 }), ev({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "Z" })];
    vi.mocked(api).mockResolvedValue({ events: day });
    seq = 100;
    const { container, onOpenQuest, onClose } = mount([begin(), planned(diamond)]);
    expect(stands(container)).toHaveLength(4);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replay" })); await vi.advanceTimersByTimeAsync(20); });
    expect(api).toHaveBeenCalledWith("/api/feed/day");
    const line = screen.getByRole("slider", { name: "Where in the day" }) as HTMLInputElement;
    act(() => { fireEvent.change(line, { target: { value: line.max } }); vi.advanceTimersByTime(20); });
    expect(stands(container)).toEqual(["1 done", "2 todo"]);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("Yesterday's ask");
    expect(container.querySelector("button.trail-chip")).toBeNull();
    fireEvent.click(container.querySelector(".trail-chip")!);
    expect(onOpenQuest).not.toHaveBeenCalled();
    // Esc leaves the replay first, back to the plan as it is now.
    fireEvent.keyDown(screen.getByRole("dialog", { name: /Trail map/ }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(stands(container)).toHaveLength(4);
  });

  test("a day with nothing in it says so instead of replaying", async () => {
    vi.mocked(api).mockResolvedValue({ events: [] });
    mount([begin(), planned(diamond)]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replay" })); await vi.advanceTimersByTimeAsync(20); });
    expect(screen.getByText("Nothing has happened in the last day to replay.")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
