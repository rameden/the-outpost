// The panel of whoever you're looking at: what they're doing, what they carry, and (only when it's live) the means to act.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFeedStore } from "../feed/store.ts";
import type { CampEvent } from "../types.ts";
import type { KitItem } from "./kit.ts";
import { Panel, type Body } from "./Panel.tsx";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

let seq = 0;
function send(store: ReturnType<typeof createFeedStore>, agoMs: number, ...bodies: object[]) {
  act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date(Date.now() - agoMs).toISOString() } as CampEvent); vi.advanceTimersByTime(20); });
}
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };
const scout = { who: "Scout", emoji: "🏹", depth: 1 };
const work = (ago = 1000) => [
  [ago, { type: "expedition_start", id: "A", task: "Audit the login flow", source: "user", thread: "A" }],
  [ago, { type: "dispatch", ...scout, questId: "q1", brief: "Read the session code", expeditionId: "A" }],
  [ago, { type: "tool", ...scout, tool: "read_file", input: "session.ts", questId: "q1", expeditionId: "A" }],
] as const;
function started(ago = 1000) { const store = createFeedStore(); for (const [a, b] of work(ago)) send(store, a, b); return store; }

const scoutBody: Body = { id: "scout", name: "Scout", emoji: "🏹", role: "Finds things out", model: "claude-sonnet-5-5", effort: "medium" };
const leadBody: Body = { id: "quartermaster", name: "Quartermaster", emoji: "🧭" };
type Props = Partial<Parameters<typeof Panel>[0]>;
function panel(store: ReturnType<typeof createFeedStore>, over: Props = {}) {
  const on = { onSent: vi.fn(), onBack: vi.fn(), onPick: vi.fn(), onOpenAgent: vi.fn(), onOpenQuest: vi.fn(), onOpenConversation: vi.fn() };
  const props = {
    body: scoutBody, lead: false, nth: 0, xp: 120, store, st: { status: "active", line: "Reading" } as const, bearing: createRef<HTMLElement>(), live: true,
    clock: () => Date.now(), kit: [] as KitItem[], picked: null, spend: null, limit: null, owns: (who: string) => who === "Scout", ...on, ...over,
  } as Parameters<typeof Panel>[0];
  return { ...render(<Panel {...props} />), ...on };
}
const kit: KitItem[] = [
  { id: "skill:scout/read-logs", kind: "skill", name: "read-logs", about: "Where to look." },
  { id: "connector:github", kind: "connector", name: "github", about: "PRs.", state: "error", error: "Token ran out", tools: ["a", "b"], write: true },
  { id: "skill:shared/rules", kind: "skill", name: "rules", about: "", shared: true },
];

test("when it isn't live there's nothing to act with: no steering, stopping, sending or decisions", () => {
  const store = started();
  send(store, 500, { type: "ask", ...scout, id: "k1", kind: "shell", title: "Run it", body: "ls", questId: "q1", expeditionId: "A" });
  panel(store, { live: false });
  expect(screen.getByText("Read the session code")).toBeTruthy(); // it can still be watched
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop this expedition" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Waiting for your decision" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Run command" })).toBeNull();
});

test("when it is live they can be steered or stopped once per expedition, sent something, and their decisions answered", () => {
  const store = started();
  send(store, 500, { type: "ask", ...scout, id: "k1", kind: "shell", title: "Run it", body: "ls", questId: "q1", expeditionId: "A" });
  panel(store);
  expect(screen.getAllByRole("button", { name: "Stop this expedition" })).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: "Say something to this expedition" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Ask Scout for something" })).toBeTruthy();
  const asks = screen.getByRole("region", { name: "Waiting for your decision" });
  expect(within(asks).getByRole("button", { name: "Run command" })).toBeTruthy();
});

test("only the decisions that are theirs are shown, and the Quartermaster takes the rest", () => {
  const store = started();
  send(store, 500, { type: "ask", ...qm, id: "k9", kind: "question", title: "Which one?", body: "?", expeditionId: "A" });
  const { unmount } = panel(store, { owns: (who) => who === "Scout" });
  expect(screen.queryByRole("region", { name: "Waiting for your decision" })).toBeNull();
  unmount();
  panel(store, { body: leadBody, lead: true, owns: (who) => who === "Quartermaster" });
  expect(screen.getByRole("region", { name: "Waiting for your decision" })).toBeTruthy();
});

test("a quest with nothing for three minutes says it's been quiet", () => {
  const store = started(5 * 60_000 + 10_000);
  panel(store);
  expect(screen.getByText(/^Quiet for 5m\./)).toBeTruthy();
  expect(screen.getByLabelText("What Scout is doing").querySelector(".orb-work-card")!.className).toContain("st-stalled");
  expect(screen.getByLabelText("What Scout is doing").querySelector(".orb-state")!.textContent).toBe("Quiet for 5m");
});

test("a quest that's recent isn't quiet, and one waiting for you says so instead", () => {
  const store = started(2 * 60_000);
  panel(store);
  expect(screen.queryByText(/Quiet for/)).toBeNull();
  cleanup();
  const waiting = started(10 * 60_000);
  send(waiting, 10 * 60_000, { type: "ask", ...scout, id: "k1", kind: "shell", title: "Run it", body: "ls", questId: "q1", expeditionId: "A" });
  panel(waiting);
  expect(screen.queryByText(/Quiet for/)).toBeNull();
  expect(screen.getByText("Waiting for your OK", { selector: "p" })).toBeTruthy();
});

test("it keeps time as long as something is out, so a quest turns quiet while you watch", () => {
  const store = started(2 * 60_000 + 30_000);
  panel(store);
  expect(screen.queryByText(/Quiet for/)).toBeNull();
  act(() => { vi.advanceTimersByTime(40_000); });
  expect(screen.getByText(/^Quiet for 3m\./)).toBeTruthy();
});

test("what they carry opens one at a time, and opening the open one closes it", () => {
  const store = createFeedStore();
  const { onPick, container, unmount } = panel(store, { kit });
  expect(screen.getByRole("heading", { name: /3 satellites/ })).toBeTruthy();
  expect(container.querySelector(".orb-kit-about")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /github/ }));
  expect(onPick).toHaveBeenCalledWith("connector:github");
  unmount();
  const again = panel(store, { kit, picked: "connector:github" }); // (which is open is the view's to say)
  const open = screen.getAllByRole("button", { expanded: true });
  expect(open).toHaveLength(1);
  expect(open[0].textContent).toContain("github");
  expect(screen.getByText("Token ran out")).toBeTruthy();
  expect(screen.getByText(/^2 tools, some of which can change things: a, b$/)).toBeTruthy();
  expect(open[0].textContent).toContain("connector, failing");
  fireEvent.click(open[0]);
  expect(again.onPick).toHaveBeenLastCalledWith(null);
});

test("a skill with nothing said about it says so, and the labels tell shared from their own", () => {
  const store = createFeedStore();
  panel(store, { kit, picked: "skill:shared/rules" });
  expect(screen.getByText("A skill, with nothing said about it.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /rules/ }).textContent).toContain("shared skill");
  expect(screen.getByRole("button", { name: /read-logs/ }).textContent).toContain("skill");
});

test("with nothing carried there is no list of satellites", () => {
  panel(createFeedStore());
  expect(screen.queryByRole("region", { name: /carries/ })).toBeNull();
});

test("the Quartermaster's panel shows the plan limit, and warns once it's nearly full", () => {
  const { unmount } = panel(createFeedStore(), { body: leadBody, lead: true, limit: { label: "This week", used: 0.62 } });
  const row = () => screen.getByText("Plan limit").parentElement!;
  expect(row().textContent).toBe("Plan limitThis week · 62% used");
  expect(row().className).toBe("");
  unmount();
  panel(createFeedStore(), { body: leadBody, lead: true, limit: { label: "This week", used: 0.8 } });
  expect(row().className).toBe("warn");
});

test("only the Quartermaster has the plan limit", () => {
  panel(createFeedStore(), { limit: { label: "This week", used: 0.9 } });
  expect(screen.queryByText("Plan limit")).toBeNull();
});

test("what they've cost today is a line, when the camp says", () => {
  panel(createFeedStore(), { spend: { cost: 1, share: 0.25 } });
  expect(screen.getByText("Today").nextElementSibling!.textContent).toBe("$1.00 · 25% of the camp's day");
  cleanup();
  panel(createFeedStore(), { spend: null });
  expect(screen.queryByText("Today")).toBeNull();
});

test("where to go from here: back, their page, and the quest in its conversation", () => {
  const store = started();
  const { onBack, onOpenAgent, onOpenQuest } = panel(store);
  fireEvent.click(screen.getByRole("button", { name: "Back to the whole system" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Scout's page" }));
  fireEvent.click(screen.getByRole("button", { name: "Go to it in the conversation" }));
  expect(onBack).toHaveBeenCalled();
  expect(onOpenAgent).toHaveBeenCalledWith("scout");
  expect(onOpenQuest.mock.calls[0][0]).toMatchObject({ id: "q1", expId: "A", who: "Scout" });
});

test("at camp with nothing out says so", () => {
  panel(createFeedStore());
  expect(screen.getByText(/^At camp, with nothing out/)).toBeTruthy();
  cleanup();
  panel(createFeedStore(), { body: leadBody, lead: true });
  expect(screen.getByText(/^No expedition is under way/)).toBeTruthy();
});
