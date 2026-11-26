// The trail map: where each step sits, how it fills in as the crew works, and what it shows with no plan.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../api.ts";
import { Opener, expectTabWraps } from "../components/modalkit.tsx";
import { createFeedStore, type FeedStore } from "../feed/store.ts";
import type { CampEvent, CampState } from "../types.ts";
import { layoutOf, STEP_H, STEP_W, waitsOf } from "./layout.ts";
import { Trail } from "./Trail.tsx";

vi.mock("../api.ts", async (real) => ({ ...(await real<typeof import("../api.ts")>()), api: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.mocked(api).mockReset(); localStorage.clear(); });

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
function mount(events: CampEvent[] = [], camp: CampState | null = S, pick?: string) {
  const store = createFeedStore();
  for (const e of events) store.apply(e);
  const onClose = vi.fn(), onOpenQuest = vi.fn();
  const r = render(<Trail S={camp} store={store} onClose={onClose} onOpenQuest={onOpenQuest} pick={pick} />);
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

  test("opened from a plan's card it shows that card's plan, not the newest; a run it can't find is the newest after all", () => {
    const two = () => [begin("A", "The first ask"), planned([{ n: 1, text: "Only step" }], "A"), begin("B", "The second ask"), planned(diamond, "B")];
    const { container, unmount } = mount(two(), S, "A");
    expect((screen.getByLabelText("Which plan") as HTMLSelectElement).value).toBe("A");
    expect(stands(container)).toEqual(["1 todo"]);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("The first ask");
    // Everything else is still a pick away: the other plans, the whole map, the replay.
    fireEvent.change(screen.getByLabelText("Which plan"), { target: { value: "B" } });
    expect(stands(container)).toHaveLength(4);
    expect(["Whole map", "Replay"].map((name) => !!screen.getByRole("button", { name }))).toEqual([true, true]);
    unmount();
    seq = 0;
    mount(two(), S, "gone");
    expect((screen.getByLabelText("Which plan") as HTMLSelectElement).value).toBe("B");
  });

  test("it's a dialog over the page: Tab stays inside it, and the X leaves it", () => {
    const { onClose } = mount([begin(), planned(diamond)]);
    const map = screen.getByRole("dialog", { name: /Trail map/ });
    expect(map.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(map);
    const stops = [...map.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex="0"]')];
    expect(stops.length).toBeGreaterThan(4);
    expect(fireEvent.keyDown(map, { key: "Tab", shiftKey: true })).toBe(false); // back from the map itself: round to its last stop
    expect(document.activeElement).toBe(stops.at(-1));
    expect(fireEvent.keyDown(stops.at(-1)!, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(stops[0]);
    fireEvent.click(screen.getByRole("button", { name: "Leave the trail map" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the whole map shows every plan at once, newest first, each chip going to its own run's quest", () => {
    localStorage.setItem("camp-trail-whole", "tree");
    const { container, store, onOpenQuest } = mount([begin("A", "The first ask"), planned([{ n: 1, text: "Only step" }], "A")]);
    const sent = ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Read", step: 1 });
    // With one plan there's nothing more to show, so it isn't offered.
    expect(screen.queryByRole("button", { name: "Whole map" })).toBeNull();
    send(store, sent, begin("B", "The second ask"), planned(diamond, "B"));
    expect(screen.queryByRole("group", { name: "How big the map is drawn" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Whole map" }));
    const branches = () => [...container.querySelectorAll<HTMLElement>(".trail-branch")];
    expect(branches().map((b) => b.dataset.exp)).toEqual(["B", "A"]);
    expect(branches().map((b) => b.querySelectorAll(".trail-step").length)).toEqual([4, 1]);
    expect(branches().map((b) => b.querySelector(".trail-branch-head b")!.textContent)).toEqual(["The second ask", "The first ask"]);
    expect(branches().map((b) => b.querySelector(".trail-count")!.textContent)).toEqual(["0 of 4 done", "0 of 1 done · 1 out"]);
    // Each branch leaves the line at the steps that wait for nothing.
    // Each plan is a bough off the trunk: one line to each first step, from one knot.
    expect(branches().map((b) => [b.querySelectorAll(".trail-bough").length, b.querySelectorAll(".trail-knot").length])).toEqual([[1, 1], [1, 1]]);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("All 2 plans, newest first");
    expect(container.querySelector(".trail-ask .trail-count")!.textContent).toBe("0 of 5 steps done · 1 out");
    expect(screen.queryByLabelText("Which plan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Scout, out now: go to this quest" }));
    expect(onOpenQuest).toHaveBeenCalledWith({ expId: "A", node: `q${sent.seq}` });
    // A plan that arrives joins at the top, and a quest off its trail is listed with it.
    send(store, begin("C", "The third ask"), planned([{ n: 1, text: "x" }], "C"), ev({ type: "dispatch", ...smith, questId: "q2", expeditionId: "C", brief: "Fix" }));
    expect(branches().map((b) => b.dataset.exp)).toEqual(["C", "B", "A"]);
    expect(branches()[0].querySelector(".trail-loose")!.textContent).toContain("Artificer");
    expect(branches()[1].querySelector(".trail-loose")).toBeNull();
    // From a branch, back to that plan on its own.
    fireEvent.click(screen.getByRole("button", { name: "Just this plan: The first ask" }));
    expect(branches()).toHaveLength(0);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("The first ask");
    expect((screen.getByLabelText("Which plan") as HTMLSelectElement).value).toBe("A");
    expect(screen.getByRole("button", { name: "Whole map" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("the whole map can be drawn smaller and bigger, as far as it goes, and M goes in and out of it", () => {
    localStorage.setItem("camp-trail-whole", "tree");
    const { container } = mount([begin("A", "The first ask"), planned([{ n: 1, text: "Only step" }], "A"), begin("B", "The second ask"), planned(diamond, "B")]);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "m" });
    const size = () => container.querySelector(".trail-zoom output")!.textContent;
    const smaller = screen.getByRole("button", { name: "Draw the map smaller" }) as HTMLButtonElement, bigger = screen.getByRole("button", { name: "Draw the map bigger" }) as HTMLButtonElement;
    expect(size()).toBe("100%");
    expect(bigger.disabled).toBe(true);
    fireEvent.click(smaller);
    expect(size()).toBe("80%");
    expect(container.querySelector<HTMLElement>(".trail-all")!.style.zoom).toBe("0.8");
    fireEvent.click(smaller); fireEvent.click(smaller); fireEvent.click(smaller);
    expect(size()).toBe("50%");
    expect(smaller.disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: "+" });
    expect(size()).toBe("65%");
    fireEvent.keyDown(dialog, { key: "-" });
    expect(size()).toBe("50%");
    // Out, and back in at full size.
    fireEvent.keyDown(dialog, { key: "m" });
    expect(container.querySelector(".trail-all")).toBeNull();
    expect(stands(container)).toHaveLength(4);
    fireEvent.keyDown(dialog, { key: "m" });
    expect(size()).toBe("100%");
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

// The whole map drawn as rings (rings.ts has where everything sits; this is what's on the page).
describe("the whole map as rings", () => {
  const two = () => [begin("A", "The first ask"), planned([{ n: 1, text: "Only step" }], "A"), begin("B", "The second ask"), planned(diamond, "B")];
  const inThread = (id: string, thread: string, task = `Ask ${id}`) => ev({ type: "expedition_start", id, task, source: "user", thread, ...(id === thread ? {} : { replyTo: thread }) });
  const runs = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".trail-run")];
  const ringRun = (c: HTMLElement, expId: string) => c.querySelector<HTMLElement>(`.trail-ring-run[data-exp="${expId}"]`)!;
  const way = (c: HTMLElement, expId: string, n: number) => ringRun(c, expId).querySelector<HTMLElement>(`.trail-way[data-n="${n}"]`)!;

  test("every plan is a ring, the first asked innermost; its steps are waypoints, and a moon goes to its own run's quest", () => {
    const { container, store, onOpenQuest } = mount(two());
    const sent = ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Read", step: 1 });
    send(store, sent);
    fireEvent.click(screen.getByRole("button", { name: "Whole map" }));
    // Rings unless you've chosen the tree.
    expect(screen.getByRole("button", { name: "Rings" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".trail-all")).toBeNull();
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("All 2 plans, a ring each: the first asked innermost");
    expect(container.querySelector(".trail-ask .trail-count")!.textContent).toBe("0 of 5 steps done · 1 out");
    // The rings, from the middle out; and each by name down the side, newest first.
    const orbits = [...container.querySelectorAll<SVGGElement>(".trail-ring")];
    expect(orbits.map((g) => g.dataset.exp)).toEqual(["A", "B"]);
    const [ra, rb] = orbits.map((g) => Number(g.querySelector(".trail-orbit")!.getAttribute("r")));
    expect(rb).toBeGreaterThan(ra);
    expect(runs(container).map((r) => `${r.dataset.exp} ${r.dataset.ring} ${r.querySelector("b")!.textContent} | ${r.querySelector(".trail-count")!.textContent}`))
      .toEqual(["B 2 The second ask | 0 of 4 done", "A 1 The first ask | 0 of 1 done · 1 out"]);
    expect(screen.getByRole("list", { name: "Ring 2, the steps of: The second ask" }).querySelectorAll(".trail-way")).toHaveLength(4);
    // A waypoint says its step in full, and can be tabbed to.
    const four = way(container, "B", 4);
    expect(four.getAttribute("aria-label")).toBe("Step 4, not started: I read the diffs. Waits for steps 2 and 3.");
    expect(four.tabIndex).toBe(0);
    expect(way(container, "A", 1).dataset.state).toBe("out");
    // The lines between a ring's steps: the diamond's four.
    expect([...orbits[1].querySelectorAll<SVGGElement>(".trail-edge")].map((g) => g.dataset.line).sort()).toEqual(["1-2", "1-3", "2-4", "3-4"]);
    // Whoever was sent is a moon by the step, and goes to that run's quest.
    const moon = screen.getByRole("button", { name: "Scout, out now: go to this quest" });
    expect(moon.closest(".trail-way")).toBe(way(container, "A", 1));
    expect(moon.dataset.who).toBe("scout");
    expect(moon.classList.contains("c-scout")).toBe(true);
    fireEvent.click(moon);
    expect(onOpenQuest).toHaveBeenCalledWith({ expId: "A", node: `q${sent.seq}` });
    // As a step is walked, its waypoint and the line out of it say so.
    send(store, ev({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" }));
    expect(way(container, "A", 1).dataset.state).toBe("done");
    expect(way(container, "A", 1).getAttribute("aria-label")).toBe("Step 1, done: Only step.");
  });

  test("a quest sent without a step is listed with its run, on no waypoint; and a run with no steps is still a ring", () => {
    const { container, store } = mount(two());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    send(store, begin("C", "The third ask"), planned([{ n: 1, text: "x" }], "C"), ev({ type: "dispatch", ...smith, questId: "q2", expeditionId: "C", brief: "Fix" }),
      begin("D", "The fourth ask"), planned([], "D"));
    expect(runs(container).map((r) => r.dataset.exp)).toEqual(["D", "C", "B", "A"]);
    const c = runs(container)[1];
    expect(c.querySelector(".trail-loose")!.textContent).toContain("Artificer");
    expect(c.querySelector(".trail-loose")!.getAttribute("aria-label")).toBe("Quests sent without a step");
    expect(ringRun(container, "C").querySelectorAll(".trail-moon")).toHaveLength(0);
    expect(runs(container)[2].querySelector(".trail-loose")).toBeNull();
    expect(container.querySelectorAll(".trail-ring")).toHaveLength(4);
    expect(ringRun(container, "D").querySelector(".trail-way")).toBeNull();
    expect(ringRun(container, "D").textContent).toContain("Ring 4, no steps: The fourth ask");
    // From its name, back to that plan on its own.
    fireEvent.click(screen.getByRole("button", { name: "Just this plan: The first ask" }));
    expect(container.querySelector(".trail-sky")).toBeNull();
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("The first ask");
    expect((screen.getByLabelText("Which plan") as HTMLSelectElement).value).toBe("A");
  });

  test("the runs of one conversation are joined, ring to ring; runs that aren't in one are joined to nothing", () => {
    const one = [{ n: 1, text: "x" }];
    const { container } = mount([inThread("A", "A"), planned(one, "A"), inThread("B", "B"), planned(one, "B"), begin("J", "A job"), planned(one, "J"),
      inThread("A2", "A"), planned(one, "A2"), begin("K", "Another job"), planned(one, "K")]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    expect([...container.querySelectorAll<SVGPathElement>(".trail-link")].map((l) => l.dataset.join)).toEqual(["A>A2"]);
    expect(runs(container).map((r) => `${r.dataset.exp}: ${r.querySelector(".trail-follows")?.textContent ?? "-"}`)).toEqual(["K: -", "A2: Follows ring 1", "J: -", "B: -", "A: -"]);
    // Pointing at a run (or tabbing into it) picks out its ring and the line to the one it follows.
    fireEvent.mouseEnter(runs(container)[1]);
    expect(container.querySelector('.trail-ring[data-exp="A2"]')!.classList.contains("hot")).toBe(true);
    expect(container.querySelector(".trail-link")!.classList.contains("hot")).toBe(true);
    expect(container.querySelector('.trail-ring[data-exp="B"]')!.classList.contains("hot")).toBe(false);
    fireEvent.mouseLeave(runs(container)[1]);
    expect(container.querySelector(".trail-ring.hot")).toBeNull();
  });

  test("the waypoint you point at or tab to is read out in full under the rings", () => {
    const { container, store } = mount(two());
    send(store, ev({ type: "dispatch", ...smith, questId: "q1", expeditionId: "B", brief: "Build", step: 2 }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    const readout = () => container.querySelector(".trail-readout")!.textContent;
    expect(readout()).toContain("Each ring is a plan");
    fireEvent.focus(way(container, "B", 2));
    expect(readout()).toContain("Ring 2 · Step 2");
    expect(readout()).toContain("Artificer builds the backend");
    expect(readout()).toContain("🔨 Artificer");
    expect(runs(container)[0].classList.contains("hot")).toBe(true);
    fireEvent.blur(way(container, "B", 2));
    fireEvent.mouseEnter(way(container, "B", 4));
    expect(readout()).toContain("Nobody sent yet");
  });

  test("Tree and Rings swap with the buttons or R, the choice is remembered, and the size buttons work on either", () => {
    const first = mount(two());
    const dialog = screen.getByRole("dialog");
    // The switch belongs to the whole map: outside it there's none, and R does nothing.
    expect(screen.queryByRole("group", { name: "How the whole map is drawn" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "r" });
    expect(localStorage.getItem("camp-trail-whole")).toBeNull();
    fireEvent.keyDown(dialog, { key: "m" });
    const group = screen.getByRole("group", { name: "How the whole map is drawn" });
    const pressed = () => [...group.querySelectorAll("button")].map((b) => `${b.textContent} ${b.getAttribute("aria-pressed")}`);
    expect(pressed()).toEqual(["Tree false", "Rings true"]);
    fireEvent.click(screen.getByRole("button", { name: "Draw the map smaller" }));
    expect(first.container.querySelector<HTMLElement>(".trail-sky")!.style.zoom).toBe("0.8");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(pressed()).toEqual(["Tree true", "Rings false"]);
    expect(first.container.querySelector(".trail-sky")).toBeNull();
    expect(first.container.querySelectorAll(".trail-branch")).toHaveLength(2);
    expect(first.container.querySelector(".trail-zoom output")!.textContent).toBe("100%"); // (fitted afresh)
    expect(localStorage.getItem("camp-trail-whole")).toBe("tree");
    fireEvent.keyDown(dialog, { key: "R" });
    expect(first.container.querySelector(".trail-all")).toBeNull();
    expect(first.container.querySelectorAll(".trail-ring")).toHaveLength(2);
    expect(localStorage.getItem("camp-trail-whole")).toBe("rings");
    fireEvent.keyDown(dialog, { key: "r" });
    expect(localStorage.getItem("camp-trail-whole")).toBe("tree");
    // Next time, it opens the way you left it.
    first.unmount();
    const again = mount(two());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    expect(again.container.querySelectorAll(".trail-branch")).toHaveLength(2);
    expect(again.container.querySelector(".trail-sky")).toBeNull();
  });

  test("Replay with the rings on: the day's plans join as rings, and a moon goes nowhere", async () => {
    const day = [begin("Y", "Yesterday's first"), planned([{ n: 1, text: "Scout reads" }, { n: 2, text: "Scribe writes" }], "Y"),
      ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "Y", brief: "Read", step: 1 }), ev({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "Y" }),
      begin("Z", "Yesterday's second"), planned([{ n: 1, text: "x" }], "Z")];
    vi.mocked(api).mockResolvedValue({ events: day });
    seq = 100;
    const { container, onOpenQuest } = mount(two());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    expect(container.querySelectorAll(".trail-ring")).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replay" })); await vi.advanceTimersByTimeAsync(20); });
    const line = screen.getByRole("slider", { name: "Where in the day" }) as HTMLInputElement;
    act(() => { fireEvent.change(line, { target: { value: line.max } }); vi.advanceTimersByTime(20); });
    expect([...container.querySelectorAll<SVGGElement>(".trail-ring")].map((g) => g.dataset.exp)).toEqual(["Y", "Z"]);
    expect(way(container, "Y", 1).dataset.state).toBe("done");
    expect(container.querySelector("button.trail-moon")).toBeNull();
    const moon = container.querySelector<HTMLElement>(".trail-moon")!;
    expect(moon.textContent).toContain("Scout, back, done");
    fireEvent.click(moon);
    expect(onOpenQuest).not.toHaveBeenCalled();
    // Out of the replay, back to the map as it is now: the page's own plans, after the day's earlier ones.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect([...container.querySelectorAll<SVGGElement>(".trail-ring")].map((g) => g.dataset.exp)).toEqual(["Y", "Z", "A", "B"]);
  });

  test("the map shows the whole day, as a replay ends on: plans the page's feed no longer holds are fetched, and can't be opened", async () => {
    // The day as the server has it: an early plan the page has lost, and the start of one it still has.
    const day = [begin("Y", "This morning's"), planned([{ n: 1, text: "Scout reads" }], "Y"),
      ev({ type: "dispatch", ...scout, questId: "q0", expeditionId: "Y", brief: "Read", step: 1 }), ev({ type: "return", ...scout, status: "done", questId: "q0", expeditionId: "Y" }),
      begin("A"), planned(diamond, "A")];
    vi.mocked(api).mockResolvedValue({ events: day });
    seq = 100;
    const live = [begin("A"), planned(diamond, "A"), ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Read", step: 1 }), ev({ type: "return", ...scout, status: "done", questId: "q1", expeditionId: "A" })];
    const { container, onOpenQuest } = mount(live);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(api).toHaveBeenCalledWith("/api/feed/day");
    // Both plans can be picked, and the newest is still the page's own.
    expect([...screen.getByRole("combobox", { name: "Which plan" }).querySelectorAll("option")].map((o) => o.value)).toEqual(["A", "Y"]);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("Share a whole thread");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    expect([...container.querySelectorAll<SVGGElement>(".trail-ring")].map((g) => g.dataset.exp)).toEqual(["Y", "A"]);
    // Where both have the plan, the page's is drawn (it knows step 1 is done).
    expect(way(container, "A", 1).dataset.state).toBe("done");
    // A quest of the page's own plan opens; one from earlier has no block on the page to go to.
    const moons = [...container.querySelectorAll<HTMLElement>(".trail-moon")];
    expect(moons.map((m) => m.tagName)).toEqual(["SPAN", "BUTTON"]);
    fireEvent.click(moons[0]);
    expect(onOpenQuest).not.toHaveBeenCalled();
    fireEvent.click(moons[1]);
    expect(onOpenQuest).toHaveBeenCalledWith({ expId: "A", node: expect.any(String) });
  });

  test("keeping the step that's out in sight hands nothing back to the page, even where scrolling answers with a promise", () => {
    // Newer browsers answer scrollIntoView with a promise; an effect that handed it back broke the map as it closed.
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: HTMLElement) { scrolled.push(this.dataset.n ?? ""); return Promise.resolve(); } as unknown as Element["scrollIntoView"];
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { store, unmount } = mount([begin(), planned(diamond)]);
      send(store, ev({ type: "dispatch", ...scout, questId: "q1", expeditionId: "A", brief: "Read", step: 1 }));
      expect(scrolled).toEqual(["1"]);
      expect(() => unmount()).not.toThrow();
      expect(said).not.toHaveBeenCalled();
    } finally {
      said.mockRestore();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test("the tree climbs to a plan that joins at its tip, and not as it opens (it opens at its foot)", () => {
    const climbed: (string | undefined)[] = [];
    Element.prototype.scrollIntoView = function (this: HTMLElement) { climbed.push(this.dataset.exp ?? this.className); };
    try {
      localStorage.setItem("camp-trail-whole", "tree");
      const { container, store } = mount(two());
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
      expect([...container.querySelectorAll<HTMLElement>(".trail-branch")].map((li) => li.dataset.exp)).toEqual(["B", "A"]);
      expect(climbed).toEqual([]);
      seq = 200;
      send(store, begin("C", "A third"), planned(diamond, "C"));
      expect(climbed).toEqual(["C"]);
      // As rings there's nothing to climb.
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "r" });
      send(store, begin("D", "A fourth"), planned(diamond, "D"));
      expect(climbed).toEqual(["C"]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test("the whole map is fitted again as plans join, so it ends the size it would have opened at; not once you've set the size", () => {
    // A window with room for exactly the two rings it opens with (the sky says how big it is).
    let room = 0;
    const was = ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight"].map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)!] as const);
    const skyOr = (el: Element, n: number) => (el.classList.contains("trail-sky") ? parseFloat((el as HTMLElement).style.width) : n);
    for (const [k] of was) Object.defineProperty(Element.prototype, k, { configurable: true, get(this: Element) { return k.startsWith("scroll") ? skyOr(this, 0) : room; } });
    try {
      const probe = mount(two());
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
      room = parseFloat(probe.container.querySelector<HTMLElement>(".trail-sky")!.style.width);
      cleanup();

      const { container, store } = mount(two());
      const size = () => container.querySelector(".trail-zoom output")!.textContent;
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
      expect(size()).toBe("100%");
      seq = 200;
      send(store, begin("C", "A third"), planned(diamond, "C"));
      expect(container.querySelectorAll(".trail-ring")).toHaveLength(3);
      const fitted = size();
      expect(fitted).not.toBe("100%");
      // Opened afresh with all three, it's the same size.
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
      expect(size()).toBe(fitted);
      // Set bigger by hand, it stays as set when another joins.
      fireEvent.click(screen.getByRole("button", { name: "Draw the map bigger" }));
      const mine = size();
      expect(mine).not.toBe(fitted);
      send(store, begin("D", "A fourth"), planned(diamond, "D"));
      expect(container.querySelectorAll(".trail-ring")).toHaveLength(4);
      expect(size()).toBe(mine);
    } finally {
      for (const [k, d] of was) Object.defineProperty(Element.prototype, k, d);
    }
  });

  test("wound back in a replay, a plan that goes stays drawn while it fades: a ring, and a bough of the tree", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q })); // (someone who hasn't asked for less motion)
    const day = [inThread("Y", "Y", "Yesterday's first"), planned([{ n: 1, text: "Scout reads" }, { n: 2, text: "Scribe writes" }], "Y"),
      begin("Z", "Yesterday's second"), inThread("Y2", "Y", "More of the first"), planned([{ n: 1, text: "x" }], "Y2")];
    vi.mocked(api).mockResolvedValue({ events: day });
    seq = 100;
    const { container } = mount(two());
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "m" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replay" })); await vi.advanceTimersByTimeAsync(20); });
    const line = screen.getByRole("slider", { name: "Where in the day" }) as HTMLInputElement;
    const seek = (to: string) => act(() => { fireEvent.change(line, { target: { value: to } }); vi.advanceTimersByTime(20); });
    const rings = () => [...container.querySelectorAll<SVGGElement>(".trail-ring")].map((g) => `${g.dataset.exp}${g.classList.contains("leaving") ? " leaving" : ""}`);
    seek(line.max);
    expect(rings()).toEqual(["Y", "Y2"]); // (today's rings, gone as the replay began, were not kept)
    expect(container.querySelector<SVGPathElement>(".trail-link")!.dataset.join).toBe("Y>Y2");
    // Each waypoint knows its place round the ring, for landing in turn.
    expect(way(container, "Y", 2).style.getPropertyValue("--slot")).toBe("1");

    // Back to the start of the day: both go, but stay where they were, marked and out of reach, while they fade.
    seek("0");
    expect(rings()).toEqual(["Y leaving", "Y2 leaving"]);
    expect(container.querySelector(".trail-link")!.classList.contains("leaving")).toBe(true);
    expect([...container.querySelectorAll<HTMLElement>(".trail-run")].map((li) => [li.dataset.exp, li.classList.contains("leaving"), li.hasAttribute("inert")])).toEqual([["Y2", true, true], ["Y", true, true]]);
    expect([...container.querySelectorAll<HTMLElement>(".trail-ring-run")].every((li) => li.classList.contains("leaving") && li.hasAttribute("inert"))).toBe(true);
    expect(container.querySelector(".trail-ask b")!.textContent).toBe("No plan at this point in the day");
    // Then they're gone, and the map says there's nothing yet.
    act(() => { vi.advanceTimersByTime(300); });
    expect(rings()).toEqual([]);
    expect(screen.getByText("No plan yet at this point in the day")).toBeTruthy();

    // Forward again, then back while it's drawn as a tree.
    seek(line.max);
    expect(rings()).toEqual(["Y", "Y2"]);
    fireEvent.keyDown(dialog, { key: "r" });
    const boughs = () => [...container.querySelectorAll<HTMLElement>(".trail-branch")].map((li) => `${li.dataset.exp}${li.classList.contains("leaving") ? " leaving" : ""}`);
    expect(boughs()).toEqual(["Y2", "Y"]);
    expect(container.querySelector<HTMLElement>('.trail-branch[data-exp="Y"] .trail-step[data-n="2"]')!.style.getPropertyValue("--col")).toBe("2");
    expect(container.querySelector(".trail-bough")!.getAttribute("pathLength")).toBe("1"); // (so it can be drawn growing)
    seek("0");
    expect(boughs()).toEqual(["Y2 leaving", "Y leaving"]);
    expect(container.querySelector<HTMLElement>(".trail-branch")!.hasAttribute("inert")).toBe(true);
    // Played on before they've gone, they're simply there again.
    seek(line.max);
    expect(boughs()).toEqual(["Y2", "Y"]);
    act(() => { vi.advanceTimersByTime(300); });
    expect(boughs()).toEqual(["Y2", "Y"]);
    // Out of the replay nothing lingers: the plans as they are now are there at once (the page's own, then the day's earlier ones).
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(boughs()).toEqual(["B", "A", "Y2", "Y"]);
    vi.unstubAllGlobals();
  });

  test("live too: a plan that joins is simply drawn, and plans that go (the camp restarted) fade where they stood", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
    const { container, store } = mount(two());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "m" });
    const rings = () => [...container.querySelectorAll<SVGGElement>(".trail-ring")].map((g) => `${g.dataset.exp}${g.classList.contains("leaving") ? " leaving" : ""}`);
    expect(rings()).toEqual(["A", "B"]);
    send(store, begin("C", "A third ask"), planned([{ n: 1, text: "x" }], "C"));
    expect(rings()).toEqual(["A", "B", "C"]);
    act(() => { store.reset(); vi.advanceTimersByTime(20); });
    expect(rings()).toEqual(["A leaving", "B leaving", "C leaving"]);
    act(() => { vi.advanceTimersByTime(300); });
    expect(rings()).toEqual([]);
    expect(screen.getByText("No plan yet")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  test("changing how you look at the map plays nothing: what a new view would play is skipped to its end", () => {
    // jsdom has no animations, so stand in for the browser: one entrance, one that never ends, and the map's own fade.
    class Effect { constructor(public target: Element | null, private end: number) {} getComputedTiming() { return { endTime: this.end }; } }
    vi.stubGlobal("KeyframeEffect", Effect);
    const entrance = vi.fn(), endless = vi.fn(), own = vi.fn();
    const proto = HTMLElement.prototype as unknown as { getAnimations?: unknown };
    proto.getAnimations = function (this: HTMLElement) {
      return [{ effect: new Effect(this.firstElementChild, 420), finish: entrance }, { effect: new Effect(this.firstElementChild, Infinity), finish: endless }, { effect: new Effect(this, 220), finish: own }];
    };
    try {
      const { store } = mount(two());
      const dialog = screen.getByRole("dialog");
      expect(entrance).toHaveBeenCalledTimes(1); // as the map opens
      fireEvent.keyDown(dialog, { key: "m" }); // every plan
      fireEvent.keyDown(dialog, { key: "r" }); // the other drawing
      expect(entrance).toHaveBeenCalledTimes(3);
      // A plan joining, or a step moving on, is the plans changing, not the view: it plays.
      send(store, begin("C", "A third ask"), planned([{ n: 1, text: "x" }], "C"));
      expect(entrance).toHaveBeenCalledTimes(3);
      fireEvent.keyDown(dialog, { key: "m" }); // back to one plan
      expect(entrance).toHaveBeenCalledTimes(4);
      fireEvent.change(screen.getByRole("combobox", { name: "Which plan" }), { target: { value: "A" } }); // another plan
      expect(entrance).toHaveBeenCalledTimes(5);
      expect(endless).not.toHaveBeenCalled();
      expect(own).not.toHaveBeenCalled();
    } finally {
      delete proto.getAnimations;
      vi.unstubAllGlobals();
    }
  });
});

test("Tab stays inside the trail map, and focus goes back to what opened it when it closes", () => {
  const store = createFeedStore();
  for (const e of [begin(), planned(diamond)]) store.apply(e);
  render(<Opener>{(close) => <Trail S={S} store={store} onClose={close} onOpenQuest={vi.fn()} />}</Opener>);
  const opener = screen.getByRole("button", { name: "Open it" });
  opener.focus();
  fireEvent.click(opener);
  const map = screen.getByRole("dialog", { name: /Trail map/ });
  expect(map.contains(document.activeElement)).toBe(true);
  expectTabWraps(map);
  fireEvent.keyDown(map, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
