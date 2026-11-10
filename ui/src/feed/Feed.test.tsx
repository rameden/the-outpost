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

test("steering, Resume, and a worktree's Commit each post to the right place", async () => {
  const store = twoExpeditions();
  const a = within(card("Research memory"));
  fireEvent.change(a.getByLabelText("Message to the running expedition"), { target: { value: "Focus on 2026 papers" } });
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Send" })); });
  expect(posts).toEqual([{ path: "/api/steer", body: { id: "exp-a", text: "Focus on 2026 papers" } }]);
  send(store, { type: "steer", id: "exp-a", text: "Focus on 2026 papers", expeditionId: "exp-a" });
  expect(a.getByText("Focus on 2026 papers")).toBeTruthy();

  const ws = { link: "site", path: "/repos/site-wt", branch: "camp/memory", created: true, changed: 2, commits: 0 };
  send(store, { type: "expedition_end", id: "exp-a", status: "out_of_turns", text: "partial", workspaces: [ws] });
  expect(a.queryByLabelText("Message to the running expedition")).toBeNull(); // steering ends with the run
  expect(a.getByText("camp/memory")).toBeTruthy();
  expect(a.getByText("2 uncommitted files")).toBeTruthy();

  posts.length = 0;
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Resume" })); });
  expect(posts).toEqual([{ path: "/api/send", body: { resume: "exp-a" } }]);

  posts.length = 0;
  vi.stubGlobal("prompt", () => "Summarize memory papers");
  await act(async () => { fireEvent.click(a.getByRole("button", { name: "Commit…" })); });
  expect(posts[0]).toEqual({ path: "/api/repo/commit", body: { link: "site", path: "/repos/site-wt", message: "Summarize memory papers" } });
  expect(within(card("Write the changelog")).queryByRole("button", { name: "Resume" })).toBeNull(); // still running
});
