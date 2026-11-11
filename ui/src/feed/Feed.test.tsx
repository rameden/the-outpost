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
  // Commit asks for the message in the page's own dialog, starting from the request.
  fireEvent.click(a.getByRole("button", { name: "Commit…" }));
  const dialog = within(screen.getByRole("dialog", { name: "Commit to camp/memory" }));
  expect((dialog.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Research memory");
  fireEvent.change(dialog.getByLabelText("Message"), { target: { value: "Summarize memory papers" } });
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Commit" })); });
  expect(a.queryByRole("button", { name: "PR feedback…" })).toBeNull(); // feedback is brought in from the strip at the top, in one place
  expect(posts[0]).toEqual({ path: "/api/repo/commit", body: { link: "site", path: "/repos/site-wt", message: "Summarize memory papers" } });
  expect(within(card("Write the changelog")).queryByRole("button", { name: "Resume" })).toBeNull(); // still running
});

test("feedback: a thumb is saved at once, a note on Save, and it shows where the note was kept", async () => {
  vi.useRealTimers();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    posts.push({ path, body });
    return new Response(JSON.stringify({ ok: true, rating: body.rating, note: body.note ?? "", kept: body.note && body.keep ? "the Quartermaster's memory" : null }), { status: 200 });
  }));
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const apply = (...bodies: object[]) => act(() => { for (const b of bodies) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent); });
  apply({ type: "expedition_start", id: "f1", task: "Plan the release", source: "user", expeditionId: "f1" });
  await vi.waitFor(() => expect(screen.getByRole("heading", { name: "Plan the release" })).toBeTruthy());
  expect(screen.queryByText("How was this?")).toBeNull(); // not while it's running
  apply({ type: "expedition_end", id: "f1", status: "done", text: "Planned.", expeditionId: "f1" });
  await vi.waitFor(() => expect(screen.getByText("How was this?")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Not what I wanted" }));
  await vi.waitFor(() => expect(posts.at(-1)).toEqual({ path: "/api/feedback", body: { id: "f1", rating: "down", note: "" } }));
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Not what I wanted" }).getAttribute("aria-pressed")).toBe("true"));
  const note = screen.getByRole("textbox", { name: "Feedback note" });
  expect(note.getAttribute("placeholder")).toMatch(/do differently next time/);
  fireEvent.change(note, { target: { value: "Too many quests. Batch the small ones." } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await vi.waitFor(() => expect(screen.getByText("Kept in the Quartermaster's memory")).toBeTruthy());
  expect(posts.at(-1)!.body).toEqual({ id: "f1", rating: "down", note: "Too many quests. Batch the small ones.", keep: true });
  expect(screen.queryByRole("textbox", { name: "Feedback note" })).toBeNull();
});

test("feedback given earlier comes back with the feed, and jobs aren't rated", async () => {
  vi.useRealTimers();
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  act(() => {
    for (const b of [
      { type: "expedition_start", id: "g1", task: "Summarize the wiki", source: "user", expeditionId: "g1" },
      { type: "expedition_end", id: "g1", status: "done", text: "ok", expeditionId: "g1" },
      { type: "feedback", id: "g1", rating: "up", note: "Right length.", kept: "the Quartermaster's memory", expeditionId: "g1" },
      { type: "expedition_start", id: "j1", task: "Nightly check", source: "job", job: "nightly", expeditionId: "j1" },
      { type: "expedition_end", id: "j1", status: "done", text: "ok", expeditionId: "j1" },
    ]) store.apply({ ...b, seq: ++seq, time: new Date().toISOString() } as CampEvent);
  });
  await vi.waitFor(() => expect(screen.getByText("Your feedback")).toBeTruthy());
  const rated = card("Summarize the wiki");
  expect(within(rated).getByRole("button", { name: "Good answer" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(rated).getByText("“Right length.”")).toBeTruthy();
  expect(within(card("Nightly check")).queryByRole("button", { name: "Good answer" })).toBeNull();
});

test("a run reads as an exchange: your message, formatted, then the answer; no card header", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store, { type: "expedition_start", id: "exp-m", task: "Swap the buttons in `mp-544`: it should be **Open** then Export\n- keep the icons", source: "user" });
  const ask = screen.getByRole("heading", { level: 3 });
  // What you typed is shown the way the message box showed it, not with its markers.
  expect(ask.className).toBe("ask-bubble");
  expect(within(ask).getByText("mp-544").tagName).toBe("CODE");
  expect(within(ask).getByText("Open").tagName).toBe("STRONG");
  expect(within(ask).getByRole("listitem").textContent).toBe("keep the icons");
  const run = ask.closest("article")!;
  expect(run.querySelector(".exp-head")).toBeNull();
  expect(within(run).queryByText("Expedition")).toBeNull();
  expect(within(run).queryByText(/Follow-up/)).toBeNull();
  expect(run.querySelector(".exp-ask time")).toBeTruthy();
  // Your message first, the answer after it. Until something comes back, the answer says it's on its way.
  expect([...run.children].map((c) => c.className)).toEqual(["exp-ask", "exp-reply"]);
  expect(within(run).getByRole("status").textContent).toBe("Reading your message…");
  // Stop is at the foot of the answer, beside the box for saying something to the run.
  expect(within(run).getByRole("button", { name: "Stop" }).closest(".exp-steer")).toBeTruthy();
  send(store, { type: "text", ...qm, text: "On it.", expeditionId: "exp-m" });
  expect(within(run).queryByRole("status")).toBeNull();
  expect(within(run.querySelector(".exp-reply") as HTMLElement).getByText("On it.")).toBeTruthy();
});

test("under the message: a reply says it follows on, and a scheduled job says it wasn't typed just now", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  send(store,
    { type: "expedition_start", id: "exp-1", task: "First question", source: "user" },
    { type: "expedition_end", id: "exp-1", status: "done", text: "Answered." },
    { type: "expedition_start", id: "exp-2", task: "And another thing", source: "user", replyTo: "exp-1" },
    { type: "expedition_start", id: "exp-3", task: "Summarise the wiki", source: "job", job: "wiki-digest" },
  );
  expect(card("First question").querySelector(".ask-meta")!.textContent).not.toMatch(/Follow-up|job/);
  expect(within(card("And another thing")).getByText("Follow-up").title).toBe("Carries the earlier conversation");
  const job = card("Summarise the wiki");
  expect(within(job).getByText("Scheduled job · wiki-digest")).toBeTruthy();
  // A job has nobody to talk to: it can be stopped, and that's all.
  expect(within(job).queryByLabelText("Message to the running expedition")).toBeNull();
  expect(within(job).getByText("A scheduled job is running.")).toBeTruthy();
  expect(within(job).getByRole("button", { name: "Stop" })).toBeTruthy();
  expect(within(job).getByRole("status").textContent).toBe("Starting…");
});

test("a very long message is folded until you ask for all of it", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const brief = "Pick up APP-12\n" + Array.from({ length: 20 }, (_, i) => `- criterion ${i + 1}`).join("\n");
  send(store, { type: "expedition_start", id: "exp-long", task: brief, source: "user" }, { type: "expedition_start", id: "exp-short", task: "Short one", source: "user" });
  const ask = card("Short one").parentElement!.querySelector<HTMLElement>('[data-id="exp-long"] .ask-bubble')!;
  expect(ask.className).toBe("ask-bubble folded");
  const more = within(ask.closest("article")!).getByRole("button", { name: "Show all of it" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(ask.className).toBe("ask-bubble");
  expect(within(ask.closest("article")!).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  expect(within(card("Short one")).queryByRole("button", { name: /Show/ })).toBeNull();
});

test("each quest's own block says what it's for, so two by the same crew member can be told apart", () => {
  const store = createFeedStore();
  render(<Feed store={store} onReply={() => {}} onExample={() => {}} />);
  const smith = { who: "Artificer", emoji: "🔨", depth: 1 };
  send(store, { type: "expedition_start", id: "exp-p", task: "Share a whole thread", source: "user" },
    { type: "dispatch", ...smith, questId: "q1", expeditionId: "exp-p", brief: "Backend: thread links" },
    { type: "dispatch", ...smith, questId: "q2", expeditionId: "exp-p", brief: "Studio UI: Share in the menu" });
  const blocks = [...document.querySelectorAll(".quest")];
  expect(blocks.map((b) => b.querySelector(".quest-brief")?.textContent)).toEqual(["Backend: thread links", "Studio UI: Share in the menu"]);
  expect(blocks.every((b) => /^quest-q\d+$/.test(b.id))).toBe(true); // the crew bar's rows lead here
  expect(document.querySelector(".whos-out")).toBeNull();            // nothing floats over the answer
});
