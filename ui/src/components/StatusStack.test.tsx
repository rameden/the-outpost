// The card above the message box: the working run's plan, its quests out, and the messages queued
// behind it, which can be changed, said now, or taken off. Folded per conversation; gone when empty.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyFeed, type FeedState } from "../feed/reducer.ts";
import type { FeedStore } from "../feed/store.ts";
import type { CampState } from "../types.ts";
import { StatusStack, queueBehind } from "./StatusStack.tsx";

const calls: { path: string; body: any }[] = [];
let answer: (path: string) => Response = () => new Response(JSON.stringify({ ok: true }));
beforeEach(() => {
  calls.length = 0;
  answer = () => new Response(JSON.stringify({ ok: true }));
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ path: url, body: JSON.parse(String(init?.body ?? "{}")) });
    return Promise.resolve(answer(url));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const storeOf = (state: Partial<FeedState>) => {
  const s = { ...emptyFeed, ...state } as FeedState;
  return { getState: () => s, subscribe: () => () => {} } as unknown as FeedStore;
};
const planned = storeOf({
  items: [{ kind: "exp", id: "e1", expId: "run-1", task: "Plan the work", source: "user", followUp: false, attachments: [], time: "", end: null,
    nodes: [{ kind: "plan", id: "p1", steps: [
      { n: 1, text: "Read the code", quests: [{ node: "q1", who: "scout", emoji: "🧭", status: "done" }] },
      { n: 2, text: "Write the fix", quests: [{ node: "q2", who: "artificer", emoji: "🔧", status: null }] },
      { n: 3, text: "Check it", quests: [] },
    ] }] }] as FeedState["items"],
  quests: [{ id: "q2", expId: "run-1", node: "q2", who: "artificer", emoji: "🔧", brief: "Write the fix", started: 0, line: "Editing server.ts", waiting: false, last: 0 },
    { id: "qx", expId: "run-9", node: "qx", who: "scout", emoji: "🧭", brief: "Elsewhere", started: 0, line: "Reading", waiting: false, last: 0 }],
});
const S = (queued: any[] = []) => ({ running: [{ id: "run-1", label: "@quartermaster", task: "Plan the work" }], queued } as unknown as CampState);
const lined = [
  { id: "a", label: "@quartermaster", task: "Then the docs", text: "Then the docs, in full", after: "run-1", held: null },
  { id: "b", label: "@quartermaster", task: "And the changelog", text: "And the changelog", after: "a", held: null },
  { id: "z", label: "@scout", task: "Something else", after: "run-7", held: null },
];

test("queueBehind follows the line behind a run, and only that line", () => {
  expect(queueBehind(lined as any, "run-1").map((q) => q.id)).toEqual(["a", "b"]);
  expect(queueBehind(lined as any, "run-7").map((q) => q.id)).toEqual(["z"]);
  expect(queueBehind(lined as any, null)).toEqual([]);
  // A loop (it shouldn't happen) doesn't hang.
  expect(queueBehind([{ id: "x", after: "y" }, { id: "y", after: "x" }] as any, "x").map((q) => q.id)).toEqual(["y", "x"]);
});

test("with nothing planned, out or queued, it isn't there at all", () => {
  const { container } = render(<StatusStack S={S()} store={storeOf({})} anchor="run-1" live="run-1" draftKey="c:a" refresh={() => {}} />);
  expect(container.innerHTML).toBe("");
});

test("it shows the working run's plan, its quests out (not other runs'), and the queue behind it", () => {
  render(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:a" refresh={() => {}} />);
  expect(screen.getByRole("button", { expanded: true }).textContent).toContain("Plan: 1 of 3 done · 1 quest out · 2 queued");
  const plan = screen.getByRole("list", { name: "Plan" });
  expect(plan.textContent).toContain("✓Read the code");
  expect(plan.textContent).toContain("●Write the fix");
  expect(screen.getByRole("list", { name: "quests out" }).textContent).toContain("Editing server.ts");
  expect(screen.queryByText("Reading")).toBeNull();
  const queue = screen.getByRole("list", { name: "Queued" });
  expect(queue.textContent).toContain("Then the docs, in full");
  expect(queue.textContent).not.toContain("Something else");
  expect(document.activeElement).toBe(document.body); // it never takes the focus
});

test("it folds to its header, and remembers that for the conversation", () => {
  const { rerender } = render(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:a" refresh={() => {}} />);
  fireEvent.click(screen.getByRole("button", { expanded: true }));
  expect(screen.queryByRole("list", { name: "Queued" })).toBeNull();
  expect(screen.getByRole("button", { expanded: false })).toBeTruthy();
  rerender(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:b" refresh={() => {}} />);
  expect(screen.getByRole("list", { name: "Queued" })).toBeTruthy(); // another conversation: open
  rerender(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:a" refresh={() => {}} />);
  expect(screen.queryByRole("list", { name: "Queued" })).toBeNull(); // back: still folded
});

test("a queued message can be changed before it goes", async () => {
  const refresh = vi.fn();
  render(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:a" refresh={refresh} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  const box = screen.getByRole("textbox", { name: "Change the queued message" }) as HTMLTextAreaElement;
  expect(box.value).toBe("Then the docs, in full");
  fireEvent.change(box, { target: { value: "Then the docs, short" } });
  fireEvent.keyDown(box, { key: "Enter", metaKey: true });
  await waitFor(() => expect(calls).toEqual([{ path: "/api/queue/edit", body: { id: "a", text: "Then the docs, short" } }]));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(refresh).toHaveBeenCalled();
});

test("Esc leaves it as it was; a refusal is shown and the box stays open", async () => {
  render(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:a" refresh={() => {}} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(calls).toEqual([]);

  answer = () => new Response(JSON.stringify({ error: "That one has already started, or was taken off." }), { status: 404 });
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
  expect((await screen.findByRole("alert")).textContent).toContain("already started");
  expect(screen.getByRole("textbox")).toBeTruthy();
});

test("Steer now says it to the run and takes it off the queue; Remove only takes it off", async () => {
  render(<StatusStack S={S(lined)} store={planned} anchor="run-1" live="run-1" draftKey="c:a" refresh={() => {}} />);
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Steer now" })[1]); });
  await waitFor(() => expect(calls).toEqual([
    { path: "/api/steer", body: { id: "run-1", text: "And the changelog" } },
    { path: "/api/stop", body: { id: "b" } },
  ]));
  calls.length = 0;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Take off queued message 1" })); });
  expect(calls).toEqual([{ path: "/api/stop", body: { id: "a" } }]);
});

test("after the run, a held message offers to send it anyway, and there's nothing to steer", async () => {
  const held = [{ ...lined[0], held: "failed" }];
  render(<StatusStack S={{ running: [], queued: held } as unknown as CampState} store={storeOf({})} anchor="run-1" live={null} draftKey="c:a" refresh={() => {}} />);
  expect(screen.getByText(/ended as failed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Steer now" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send it anyway" })); });
  expect(calls).toEqual([{ path: "/api/queue/release", body: { id: "a" } }]);
});
