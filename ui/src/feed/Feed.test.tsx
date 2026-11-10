// The feed on screen: two expeditions side by side, each with its own Stop, and an approval.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CampEvent } from "../types.ts";
import { Feed } from "./Feed.tsx";
import { createFeedStore } from "./store.ts";

const posts: { path: string; body: unknown }[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

let seq = 0;
function send(store: ReturnType<typeof createFeedStore>, ...bodies: object[]) {
  act(() => {
    for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent);
    vi.advanceTimersByTime(20); // the store tells React once per frame
  });
}
const qm = { who: "Quartermaster", emoji: "🧭", depth: 0 };
const card = (task: string) => screen.getByRole("heading", { name: task }).closest("article")!;

function twoExpeditions() {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store,
    { type: "expedition_start", id: "exp-a", task: "Research memory", source: "user" },
    { type: "expedition_start", id: "exp-b", task: "Write the changelog", source: "user" },
    { type: "text_delta", ...qm, delta: "Working on A", expeditionId: "exp-a" },
    { type: "text", ...qm, text: "Plan for **B**", expeditionId: "exp-b" },
  );
  return store;
}

test("two running expeditions show as two cards, each with its own words", () => {
  twoExpeditions();
  expect(within(card("Research memory")).getByText("Working on A")).toBeTruthy();
  expect(within(card("Write the changelog")).getByText("B").tagName).toBe("STRONG"); // the finished reply is formatted
  expect(within(card("Research memory")).queryByText(/Plan for/)).toBeNull();
});

test("Stop posts that expedition's id, and only that card stops", async () => {
  const store = twoExpeditions();
  await act(async () => { fireEvent.click(within(card("Write the changelog")).getByRole("button", { name: "Stop" })); });
  expect(posts).toEqual([{ path: "/api/stop", body: { id: "exp-b" } }]);
  expect(within(card("Write the changelog")).getByRole("button", { name: "Stopping…" })).toHaveProperty("disabled", true);
  expect(within(card("Research memory")).getByRole("button", { name: "Stop" })).toHaveProperty("disabled", false);

  send(store, { type: "expedition_end", id: "exp-b", status: "stopped", text: "Stopped by you." });
  expect(within(card("Write the changelog")).queryByRole("button", { name: /Stop/ })).toBeNull();
  expect(within(card("Write the changelog")).getByText("stopped")).toBeTruthy();
  expect(within(card("Research memory")).getByRole("button", { name: "Stop" })).toBeTruthy(); // A is still running
});

test("an approval card answers with its id and closes when the camp confirms", async () => {
  const store = twoExpeditions();
  send(store, { type: "ask", id: "ask-1", kind: "shell", title: "🖥️ Run a shell command", body: "npm test", expeditionId: "exp-a" });
  const a = within(card("Research memory"));
  expect(a.getByText("npm test")).toBeTruthy();
  expect(a.getByRole("button", { name: "Always allow this command" })).toBeTruthy();
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Run command" })); });
  expect(posts).toEqual([{ path: "/api/answer", body: { id: "ask-1", answer: "y" } }]);

  send(store, { type: "answered", id: "ask-1", answer: "y" });
  expect(a.getByText("✓ Command allowed")).toBeTruthy();
  expect(a.queryByRole("button", { name: "Run command" })).toBeNull();
});
